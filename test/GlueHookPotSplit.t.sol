// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Vm} from "forge-std/Vm.sol";
import {GlueHookFixture} from "./helpers/GlueHookFixture.sol";
import {IGlueHook} from "../contracts/interfaces/IGlueHook.sol";
import {IPoolManagerMin} from "../contracts/libs/GluedV4Core.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {BlockingERC20} from "./mocks/HostileTokens.sol";

/// @dev A native recipient that always reverts — the split's delivered rest must park, never brick.
contract SplitRefusesEth {
    receive() external payable {
        revert("never");
    }
}

/// @dev A recipient that tries to re-enter the hook from inside its bounded delivery push.
contract SplitReentrantRecipient {
    IGlueHook public hook;
    IPoolManagerMin.PoolKey internal key;
    bool public reentered;

    function arm(IGlueHook _hook, IPoolManagerMin.PoolKey memory _key) external {
        hook = _hook;
        key = _key;
    }

    receive() external payable {
        // Any state-bearing entry must bounce off the transient guard while the frame is live
        try hook.donate{value: 1}(key, 1) {
            reentered = true;
        } catch {}
    }
}

/**
 * @title  GlueHookPotSplit — the BUYBACK SPLIT on the pot's output, mechanics and armor.
 * @notice SP1–SP10 pin the waterfall itself: zero-default parity with the unsplit delivery, the
 *         wei-exact three-way carve on both the pump's and the shield's output, the burn-intent
 *         merge into one cascade walk, validation and operator gating, the plain-addLiquidity
 *         defaults (owner == operator, split off), the remove-all-liquidity carry cycle, and the
 *         100%-compound and native-main edges. NS1–NS4 are the never-stop matrix for the new legs:
 *         a refusing recipient, an unburnable main under a burn share, a hostile native recipient,
 *         and a re-entering recipient — every one of them fails SIDEWAYS (park, hold, book) while
 *         the carrying swap lands.
 */
contract GlueHookPotSplit is GlueHookFixture {
    address carol; // program secondary recipient
    address dave; // program main recipient
    address rita; // pot recipient

    function setUp() public {
        carol = makeAddr("split_carol");
        dave = makeAddr("split_dave");
        rita = makeAddr("split_rita");
    }

    /// @dev The campaign's standard program: seeded liquidity, harvest disarmed (the pot split is
    ///      what's under test), the pot split set to `comp`/`burn` WAD shares.
    function _openWithSplit(address mainToken, address potRecipient, uint64 comp, uint64 burn)
        internal
        returns (IPoolManagerMin.PoolKey memory key, bytes32 id)
    {
        _deployCore();
        (key, id) = _openEthPool(mainToken, potRecipient);
        _mintTo(mainToken, address(this), 10_000_000e18);
        (bool ok, ) = mainToken.call(
            abi.encodeWithSignature("approve(address,uint256)", address(pump), type(uint256).max)
        );
        require(ok, "approve");
        pump.addLiquidityAdvanced{value: 60 ether}(
            key, TICK_LO, TICK_HI, 1e21, address(this), _cfg(comp, burn)
        );
        _donateEth(key, 30 ether);
    }

    function _cfg(uint64 comp, uint64 burn) internal view returns (IGlueHook.ProgramConfig memory) {
        return IGlueHook.ProgramConfig({
            buybackShareWad: 0,
            burnShareWad: 0,
            compoundShareWad: 0,
            potCompoundShareWad: comp,
            potBurnShareWad: burn,
            publicHarvest: true,
            secondaryRecipient: carol,
            mainRecipient: dave,
            minMain: type(uint256).max,
            minSecondary: type(uint256).max
        });
    }

    /// @dev Run a buy that carries a pump; return what it bought.
    function _pump(IPoolManagerMin.PoolKey memory key) internal returns (uint256 bought, Vm.Log[] memory logs) {
        vm.recordLogs();
        helper.swap(key, true, -int256(1 ether));
        logs = vm.getRecordedLogs();
        ( , , bought) = _lastPumped(logs);
    }

    /// @dev Σ `Delivered(COMPOUNDED)` amounts in a log window.
    function _compounded(Vm.Log[] memory logs) internal view returns (uint256 total) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(pump)) continue;
            if (logs[i].topics[0] != keccak256("Delivered(bytes32,address,uint256,uint8)")) continue;
            (uint256 amt, uint256 mode) = abi.decode(logs[i].data, (uint256, uint256));
            if (mode == uint256(IGlueHook.Delivery.COMPOUNDED)) total += amt;
        }
    }

    // ─────────────────────────────── SP — the waterfall itself ───────────────────────────────

    /// SP1 — ZERO-DEFAULT PARITY: a program whose pot split is off delivers the pump's output whole
    ///       to the pot's live recipient, bit-for-bit the unsplit behaviour; the carry never moves.
    function test_SP1_zeroSplitIsUnsplit() public {
        MockERC20 main = new MockERC20("Main", "MAIN", 18);
        (IPoolManagerMin.PoolKey memory key, bytes32 id) = _openWithSplit(address(main), rita, 0, 0);

        (uint256 bought, Vm.Log[] memory logs) = _pump(key);
        assertGt(bought, 0, "the pump fired");
        assertEq(main.balanceOf(rita), bought, "the whole output reached the recipient");
        assertEq(pump.programOf(id).carryMain, 0, "the carry never moved");
        assertEq(_compounded(logs), 0, "and no COMPOUNDED delivery exists");
        assertEq(main.balanceOf(DEAD), 0, "nothing burned");
    }

    /// SP2 — THE THREE-WAY CARVE, WEI-EXACT: 25% compound + 25% burn + the exact rest to a live
    ///       recipient. Floors on the shares, the remainder by subtraction — the legs sum to the
    ///       output byte-for-byte, the carry is booked in the carry-total ledger, and custody
    ///       covers the whole obligation.
    function test_SP2_exactThreeWaySplit() public {
        MockERC20 main = new MockERC20("Main", "MAIN", 18);
        (IPoolManagerMin.PoolKey memory key, bytes32 id) =
            _openWithSplit(address(main), rita, uint64(25e16), uint64(25e16));

        (uint256 bought, Vm.Log[] memory logs) = _pump(key);
        assertGt(bought, 0, "the pump fired");

        uint256 comp = (bought * 25e16) / 1e18;
        uint256 burnLeg = (bought * 25e16) / 1e18;
        uint256 rest = bought - comp - burnLeg;

        assertEq(pump.programOf(id).carryMain, comp, "a quarter joined the compound carry");
        assertEq(_compounded(logs), comp, "announced as a COMPOUNDED delivery");
        assertEq(main.balanceOf(DEAD), burnLeg, "a quarter walked the cascade to dead");
        assertEq(main.balanceOf(rita), rest, "the recipient got the exact remainder");
        assertEq(comp + burnLeg + rest, bought, "conservation to the wei");
        assertEq(pump.obligationOf(address(main)), comp, "the carry is the only main obligation");
        assertGe(main.balanceOf(address(pump)), comp, "and custody covers it");
    }

    /// SP3 — BURN-INTENT MERGE: on a pot whose recipient IS burn, the compound leg still peels off
    ///       to the carry and everything else (burn share + rest) walks the cascade as ONE amount.
    function test_SP3_burnIntentPotStillCompounds() public {
        MockERC20 main = new MockERC20("Main", "MAIN", 18);
        (IPoolManagerMin.PoolKey memory key, bytes32 id) =
            _openWithSplit(address(main), address(0), uint64(4e17), 0);

        (uint256 bought, ) = _pump(key);
        assertGt(bought, 0, "the pump fired");

        uint256 comp = (bought * 4e17) / 1e18;
        assertEq(pump.programOf(id).carryMain, comp, "the compound leg joined the carry");
        assertEq(main.balanceOf(DEAD), bought - comp, "everything else burned in one walk");
    }

    /// SP4 — THE SHIELD SPLITS TOO: absorbed main runs the identical waterfall — the split is on
    ///       the pot's OUTPUT, whichever mechanic produced it.
    function test_SP4_shieldOutputSplits() public {
        MockERC20 main = new MockERC20("Main", "MAIN", 18);
        (IPoolManagerMin.PoolKey memory key, bytes32 id) =
            _openWithSplit(address(main), rita, uint64(25e16), uint64(25e16));

        _mintTo(address(main), address(helper), 1_000e18);
        vm.recordLogs();
        helper.swap(key, false, -int256(1_000e18)); // a sell the pot absorbs
        Vm.Log[] memory logs = vm.getRecordedLogs();
        ( , uint256 absorbed, ) = _lastShielded(logs);
        assertGt(absorbed, 0, "the shield absorbed");

        uint256 comp = (absorbed * 25e16) / 1e18;
        uint256 burnLeg = (absorbed * 25e16) / 1e18;
        assertEq(pump.programOf(id).carryMain, comp, "compound leg carved off the absorb");
        assertEq(main.balanceOf(DEAD), burnLeg, "burn leg walked the cascade");
        assertEq(main.balanceOf(rita), absorbed - comp - burnLeg, "the rest delivered");
    }

    /// SP5 — NO PROGRAM, NO SPLIT: a pool that never created a program delivers whole. The shares
    ///       live in the program's storage, and a non-existent program is all zeros by construction.
    function test_SP5_noProgramDeliversWhole() public {
        MockERC20 main = new MockERC20("Main", "MAIN", 18);
        _deployCore();
        (IPoolManagerMin.PoolKey memory key, bytes32 id) = _openEthPool(address(main), rita);
        _donateEth(key, 30 ether);

        (uint256 bought, Vm.Log[] memory logs) = _pump(key);
        assertGt(bought, 0, "the pump fired");
        assertEq(main.balanceOf(rita), bought, "delivered whole");
        assertEq(_compounded(logs), 0, "no compound leg");
        assertEq(pump.programOf(id).carryMain, 0, "no carry");
    }

    /// SP6 — SET-TIME VALIDATION: the two shares may not sum above 100%, a native main rejects a
    ///       burn share (the mirror of the pot's own rule), and exactly 100% is legal.
    function test_SP6_configValidation() public {
        MockERC20 main = new MockERC20("Main", "MAIN", 18);
        (IPoolManagerMin.PoolKey memory key, bytes32 id) = _openWithSplit(address(main), rita, 0, 0);

        // Above 100% across the two shares
        IGlueHook.ProgramConfig memory bad = _cfg(uint64(6e17), uint64(5e17));
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.setProgramConfig(id, bad);

        // Exactly 100% is legal
        pump.setProgramConfig(id, _cfg(uint64(5e17), uint64(5e17)));
        assertEq(pump.programOf(id).potCompoundShareWad, uint64(5e17), "stored");

        // A native main can never carry a pot burn share
        _deployCore();
        MockERC20 secondary = new MockERC20("Sec", "SEC", 18);
        IPoolManagerMin.PoolKey memory nkey = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: address(secondary), fee: FEE, tickSpacing: SPACING, hooks: address(pump)
        });
        IPoolManagerMin(POOL_MANAGER).initialize(nkey, LAUNCH_SQRT);
        pump.initPot(nkey, ETH, rita); // main = the network token
        _mintTo(address(secondary), address(this), 10_000_000e18);
        secondary.approve(address(pump), type(uint256).max);
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.addLiquidityAdvanced{value: 60 ether}(
            nkey, TICK_LO, TICK_HI, 1e21, address(this), _cfg(0, uint64(1e17))
        );
        // ... while a pure compound share on a native main is fine
        pump.addLiquidityAdvanced{value: 60 ether}(
            nkey, TICK_LO, TICK_HI, 1e21, address(this), _cfg(uint64(3e17), 0)
        );
    }

    /// SP7 — OPERATOR-GATED, LIKE EVERY OTHER RULE: a stranger cannot set the split, the operator
    ///       can, and zeroing the operator freezes it forever.
    function test_SP7_operatorGating() public {
        MockERC20 main = new MockERC20("Main", "MAIN", 18);
        (IPoolManagerMin.PoolKey memory key, bytes32 id) = _openWithSplit(address(main), rita, 0, 0);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.setProgramConfig(id, _cfg(uint64(1e17), 0));

        // The operator (this test, from addLiquidityAdvanced) edits freely
        pump.setProgramConfig(id, _cfg(uint64(1e17), 0));
        assertEq(pump.programOf(id).potCompoundShareWad, uint64(1e17), "operator set it");

        // Frozen forever once the operator surrenders
        pump.setProgramOperator(id, address(0));
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.setProgramConfig(id, _cfg(uint64(2e17), 0));
    }

    /// SP8 — PLAIN addLiquidity DEFAULTS: the named owner is BOTH owner and operator (so the split
    ///       can be turned on later), and the pot split ships OFF — the buyback keeps following the
    ///       pot's own recipient until the operator opts in.
    function test_SP8_plainAddLiquidityDefaults() public {
        MockERC20 main = new MockERC20("Main", "MAIN", 18);
        _deployCore();
        (IPoolManagerMin.PoolKey memory key, bytes32 id) = _openEthPool(address(main), address(0));
        address lpOwner = makeAddr("lp_owner");

        _mintTo(address(main), address(this), 10_000_000e18);
        main.approve(address(pump), type(uint256).max);
        pump.addLiquidity{value: 60 ether}(key, TICK_LO, TICK_HI, 1e21, lpOwner);

        IGlueHook.Program memory g = pump.programOf(id);
        assertEq(g.owner, lpOwner, "the named owner holds the property");
        assertEq(g.operator, lpOwner, "and IS the operator, so the rules stay editable");
        assertEq(g.potCompoundShareWad, 0, "pot split off by default");
        assertEq(g.potBurnShareWad, 0, "both shares");

        // The default delivery: this pot is burn-intent, so the pump's output burns whole
        _donateEth(key, 20 ether);
        (uint256 bought, ) = _pump(key);
        assertEq(main.balanceOf(DEAD), bought, "the default buyback delivery burns whole");

        // ... and the owner-operator can turn the split on later
        vm.prank(lpOwner);
        pump.setProgramConfig(id, _cfg(uint64(5e17), 0));
        assertEq(pump.programOf(id).potCompoundShareWad, uint64(5e17), "opted in later");
    }

    /// SP9 — THE CARRY CYCLE SURVIVES A FULL EXIT: remove ALL liquidity — pumps keep splitting into
    ///       the carry (waiting LP budget, custody-covered) — re-add — the next harvest re-mints it
    ///       into the position. Nothing leaks, nothing strands.
    function test_SP9_removeAllThenCarryRemints() public {
        MockERC20 main = new MockERC20("Main", "MAIN", 18);
        (IPoolManagerMin.PoolKey memory key, bytes32 id) =
            _openWithSplit(address(main), rita, uint64(5e17), 0);

        // Full exit: the position empties, the program (and its rules) remain
        uint128 staked = pump.programOf(id).liquidity;
        pump.removeProgramLiquidity(key, staked, address(this));
        assertEq(pump.programOf(id).liquidity, 0, "all liquidity out");

        // The pot is independent: pumps keep firing and their compound legs accumulate as carry
        (uint256 bought, ) = _pump(key);
        uint256 comp = (bought * 5e17) / 1e18;
        assertGt(comp, 0, "the pump fired into the carry");
        assertEq(pump.programOf(id).carryMain, comp, "the carry accumulates while empty");
        assertGe(main.balanceOf(address(pump)), comp, "custody covers the waiting budget");

        // Re-add, arm a compound share so future fees fund the secondary side, and trade a little
        pump.addProgramLiquidity{value: 60 ether}(key, 1e21);
        pump.setProgramConfig(
            id,
            IGlueHook.ProgramConfig({
                buybackShareWad: 0,
                burnShareWad: 0,
                compoundShareWad: uint64(5e17),
                potCompoundShareWad: uint64(5e17),
                potBurnShareWad: 0,
                publicHarvest: true,
                secondaryRecipient: carol,
                mainRecipient: dave,
                minMain: type(uint256).max,
                minSecondary: type(uint256).max
            })
        );
        helper.swap(key, true, -int256(2 ether));
        helper.swap(key, false, -int256(50_000e18)); // outsize the pot so real main fees accrue

        uint256 carryBefore = pump.programOf(id).carryMain;
        uint128 liqBefore = pump.programOf(id).liquidity;
        vm.recordLogs();
        pump.harvest(key);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (uint256 fMain, uint256 usedMain) = _harvestMainFlow(logs);

        assertGt(pump.programOf(id).liquidity, liqBefore, "the harvest minted");
        assertGt(usedMain, 0, "and consumed real main-side budget");
        // The carry identity: the standing carry entered the mint's budget alongside this
        // harvest's own slice, and what the mint did not place is EXACTLY what remains
        assertEq(
            pump.programOf(id).carryMain,
            carryBefore + (fMain * 5e17) / 1e18 - usedMain,
            "carry(after) == carry(before) + slice - minted"
        );
    }

    /// @dev Decode the harvest's main-side flow out of a log window: the gross main fees
    ///      ({Harvested}) and the main the compound mint consumed ({Compounded}'s currency1 leg on
    ///      the ETH-secondary pools, where main is always currency1).
    function _harvestMainFlow(Vm.Log[] memory logs)
        internal
        view
        returns (uint256 fMain, uint256 usedMain)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(pump)) continue;
            if (logs[i].topics[0] == keccak256("Harvested(bytes32,uint256,uint256,uint256,uint256)")) {
                (fMain, , , ) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
            } else if (logs[i].topics[0] == keccak256("Compounded(bytes32,uint128,uint256,uint256)")) {
                ( , , usedMain) = abi.decode(logs[i].data, (uint128, uint256, uint256));
            }
        }
    }

    /// SP10 — 100% COMPOUND: the whole output becomes waiting LP budget; the recipient and the
    ///        cascade both see nothing, and the obligation covers every wei.
    function test_SP10_fullCompound() public {
        MockERC20 main = new MockERC20("Main", "MAIN", 18);
        (IPoolManagerMin.PoolKey memory key, bytes32 id) =
            _openWithSplit(address(main), rita, uint64(1e18), 0);

        (uint256 bought, ) = _pump(key);
        assertGt(bought, 0, "the pump fired");
        assertEq(pump.programOf(id).carryMain, bought, "everything joined the carry");
        assertEq(main.balanceOf(rita), 0, "the recipient saw nothing");
        assertEq(main.balanceOf(DEAD), 0, "the cascade saw nothing");
        assertEq(pump.obligationOf(address(main)), bought, "attributed in full");
    }

    // ─────────────────────────────── NS — the never-stop matrix ───────────────────────────────

    /// NS1 — A REFUSING RECIPIENT: the split's delivered rest hits a token blocklist. The swap
    ///       lands, the compound and burn legs settle normally, and the rest PARKS for
    ///       {flushDirect} — a hostile recipient can only hurt itself.
    function test_NS1_refusingRecipientParksTheRest() public {
        BlockingERC20 main = new BlockingERC20();
        (IPoolManagerMin.PoolKey memory key, bytes32 id) =
            _openWithSplit(address(main), rita, uint64(25e16), uint64(25e16));
        main.setBlocked(rita, true); // the recipient becomes untransferable-to

        (uint256 bought, ) = _pump(key);
        assertGt(bought, 0, "the swap and its pump still landed");

        uint256 comp = (bought * 25e16) / 1e18;
        uint256 burnLeg = (bought * 25e16) / 1e18;
        uint256 rest = bought - comp - burnLeg;
        assertEq(pump.programOf(id).carryMain, comp, "the compound leg settled");
        assertEq(main.balanceOf(DEAD), burnLeg, "the burn leg settled");
        assertEq(pump.parkedDirectOf(id), rest, "the refused rest parked per pool");

        // The park retries to the pot's CURRENT recipient once the refusal clears
        main.setBlocked(rita, false);
        pump.flushDirect(id);
        assertEq(main.balanceOf(rita), rest, "and was delivered on retry");
    }

    /// NS2 — AN UNBURNABLE MAIN UNDER A BURN SHARE: both probes fail, the leg settles to the held
    ///       ledger (custody IS the burn), and the swap lands.
    function test_NS2_unburnableBurnLegHolds() public {
        BlockingERC20 main = new BlockingERC20();
        (IPoolManagerMin.PoolKey memory key, bytes32 id) =
            _openWithSplit(address(main), rita, 0, uint64(5e17));
        main.setBlocked(DEAD, true); // no burn() and no dead route

        (uint256 bought, ) = _pump(key);
        assertGt(bought, 0, "the swap landed");

        uint256 burnLeg = (bought * 5e17) / 1e18;
        assertEq(pump.heldOf(address(main)), burnLeg, "the burn leg held forever");
        assertEq(main.balanceOf(rita), bought - burnLeg, "the rest still delivered");
        assertEq(pump.obligationOf(address(main)), burnLeg, "and attributed");
    }

    /// NS3 — NATIVE MAIN, HOSTILE NATIVE RECIPIENT: an ETH-main pot with a compound share and a
    ///       recipient that reverts every send. The swap lands, the compound leg joins the carry in
    ///       ETH, the refused rest parks, and the venue stays solvent in native terms.
    function test_NS3_nativeMainHostileRecipient() public {
        _deployCore();
        MockERC20 secondary = new MockERC20("Sec", "SEC", 18);
        SplitRefusesEth hostile = new SplitRefusesEth();
        IPoolManagerMin.PoolKey memory key = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: address(secondary), fee: FEE, tickSpacing: SPACING, hooks: address(pump)
        });
        bytes32 id = keccak256(abi.encode(key));
        IPoolManagerMin(POOL_MANAGER).initialize(key, LAUNCH_SQRT);
        pump.initPot(key, ETH, address(hostile)); // main = the network token

        _mintTo(address(secondary), address(helper), 20_000_000e18);
        helper.addLiquidity(key, TICK_LO, TICK_HI, _launchLiquidity());
        _mintTo(address(secondary), address(this), 10_000_000e18);
        secondary.approve(address(pump), type(uint256).max);
        pump.addLiquidityAdvanced{value: 60 ether}(
            key, TICK_LO, TICK_HI, 1e21, address(this), _cfg(uint64(3e17), 0)
        );
        // Fund the pot in its secondary (the ERC20 side)
        pump.donate(key, 50_000e18);

        // A buy of main: pay secondary for ETH
        vm.recordLogs();
        helper.swap(key, false, -int256(20_000e18));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        ( , , uint256 bought) = _lastPumped(logs);
        assertGt(bought, 0, "the pump fired on the native-main pool");

        uint256 comp = (bought * 3e17) / 1e18;
        assertEq(pump.programOf(id).carryMain, comp, "the compound leg joined the ETH carry");
        assertEq(pump.parkedDirectOf(id), bought - comp, "the refused rest parked");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "native custody covers it all");
    }

    /// NS4 — A RE-ENTERING RECIPIENT: the delivered rest lands on a contract that immediately calls
    ///       back into the hook. The transient guard bounces it, the delivery still succeeds, and
    ///       the carrying swap lands.
    function test_NS4_reentrantRecipientBounces() public {
        _deployCore();
        MockERC20 secondary = new MockERC20("Sec", "SEC", 18);
        SplitReentrantRecipient hostile = new SplitReentrantRecipient();
        IPoolManagerMin.PoolKey memory key = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: address(secondary), fee: FEE, tickSpacing: SPACING, hooks: address(pump)
        });
        bytes32 id = keccak256(abi.encode(key));
        IPoolManagerMin(POOL_MANAGER).initialize(key, LAUNCH_SQRT);
        pump.initPot(key, ETH, address(hostile));
        hostile.arm(IGlueHook(address(pump)), key);
        vm.deal(address(hostile), 1 ether); // gas money for its re-entry attempt

        _mintTo(address(secondary), address(helper), 20_000_000e18);
        helper.addLiquidity(key, TICK_LO, TICK_HI, _launchLiquidity());
        _mintTo(address(secondary), address(this), 10_000_000e18);
        secondary.approve(address(pump), type(uint256).max);
        pump.addLiquidityAdvanced{value: 60 ether}(
            key, TICK_LO, TICK_HI, 1e21, address(this), _cfg(uint64(2e17), 0)
        );
        pump.donate(key, 50_000e18);

        uint256 hostileBefore = address(hostile).balance;
        vm.recordLogs();
        helper.swap(key, false, -int256(20_000e18)); // the carrying buy of native main
        ( , , uint256 bought) = _lastPumped(vm.getRecordedLogs());
        assertGt(bought, 0, "the swap landed with the hostile recipient in the path");

        uint256 comp = (bought * 2e17) / 1e18;
        // The 30k-stipend send succeeds (the try/catch swallows the guard bounce inside), the
        // re-entry itself never lands
        assertEq(address(hostile).balance - hostileBefore, bought - comp, "the rest was delivered");
        assertFalse(hostile.reentered(), "the re-entry bounced off the guard");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "the venue stays solvent");
    }
}
