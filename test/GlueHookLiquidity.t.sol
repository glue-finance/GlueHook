// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Vm} from "forge-std/Vm.sol";
import {GlueHookFixture} from "./helpers/GlueHookFixture.sol";
import {IGlueHook} from "../contracts/interfaces/IGlueHook.sol";
import {IPoolManagerMin} from "../contracts/libs/GluedV4Core.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev A native recipient whose mood can flip: refuses the bounded harvest push while sulking, then
///      accepts (and can pull its own backlog through `claim`).
contract SulkyReceiver {
    bool public accepting;

    function setAccepting(bool a) external {
        accepting = a;
    }

    function pull(IGlueHook pump, address asset) external returns (uint256) {
        return pump.claim(asset);
    }

    receive() external payable {
        require(accepting, "sulking");
    }
}

/// @dev A minimal timelock locker built ON TOP of the hook: it OWNS a program and releases the
///      liquidity to its beneficiary only after the unlock time -- custody policy as a layer above,
///      exactly how the two-role design intends it.
contract TimelockLocker {
    error NotBeneficiary();
    error StillLocked();

    IGlueHook immutable pump;
    address public immutable beneficiary;
    uint256 public immutable unlockAt;

    constructor(IGlueHook pump_, address beneficiary_, uint256 unlockAt_) {
        pump = pump_;
        beneficiary = beneficiary_;
        unlockAt = unlockAt_;
    }

    function withdraw(IPoolManagerMin.PoolKey calldata key, uint128 liquidity)
        external returns (uint256, uint256)
    {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (block.timestamp < unlockAt) revert StillLocked();
        return pump.removeProgramLiquidity(key, liquidity, beneficiary);
    }
}

/**
 * @title  GlueHookLiquidity -- the LP PROGRAM layer: entries, rules, harvest split, payouts, roles.
 * @notice L1–L12 and L18–L22 against the real PoolManager. The pool under test is the fixture's ETH
 *         pool: the TOKEN is the defended main, native ETH the secondary -- so the burn share
 *         applies to the token side of the fees and the buyback share fuels the pot with ETH. The
 *         compound leg and its CARRY have their own suite ({GlueHookCompound}, L13–L17 + L23–L27,
 *         same fixture) so neither contract outgrows the compiler's assembler.
 */
contract GlueHookLiquidity is GlueHookFixture {
    MockERC20 token;
    IPoolManagerMin.PoolKey key;
    bytes32 id;
    address alice;
    address bob;
    address carol;
    address dave;

    uint128 constant SEED_LIQ = 1e21;

    function setUp() public {
        _deployCore();
        token = new MockERC20("Main", "MAIN", 18);
        (key, id) = _openEthPool(address(token), address(0));
        token.mint(address(this), 10_000_000e18);
        token.approve(address(pump), type(uint256).max);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        dave = makeAddr("dave");
    }

    /// @dev A config literal.
    function _cfg(uint64 bb, uint64 burn, address secR, address mainR, uint256 mm, uint256 ms)
        internal pure returns (IGlueHook.ProgramConfig memory)
    {
        return IGlueHook.ProgramConfig({
            buybackShareWad: bb,
            burnShareWad: burn,
            compoundShareWad: 0,
            potCompoundShareWad: 0,
            potBurnShareWad: 0,
            publicHarvest: false,
            secondaryRecipient: secR,
            mainRecipient: mainR,
            minMain: mm,
            minSecondary: ms
        });
    }

    /// @dev Trade both directions so BOTH fee sides accrue on the program's position.
    function _genFees() internal {
        helper.swap(key, true, -int256(5 ether));
        helper.swap(key, false, -int256(4_000e18));
    }

    /// @dev The LAST `Harvested` in a recorded window, or `found = false`.
    function _lastHarvested(Vm.Log[] memory logs)
        internal view
        returns (bool found, uint256 fMain, uint256 fSec, uint256 burned, uint256 fueled)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(pump)) continue;
            if (logs[i].topics[0] != keccak256("Harvested(bytes32,uint256,uint256,uint256,uint256)")) continue;
            found = true;
            (fMain, fSec, burned, fueled) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
        }
    }

    /// @dev The LAST `Compounded` in a recorded window, or `found = false`.
    function _lastCompounded(Vm.Log[] memory logs)
        internal view
        returns (bool found, uint128 liq, uint256 u0, uint256 u1)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(pump)) continue;
            if (logs[i].topics[0] != keccak256("Compounded(bytes32,uint128,uint256,uint256)")) continue;
            found = true;
            (liq, u0, u1) = abi.decode(logs[i].data, (uint128, uint256, uint256));
        }
    }

    /// L1 -- the NORMAL entry mints a program with everything off: zero shares, both recipients the
    ///      owner, auto-harvest disarmed. The native leg is funded by the attached value with the
    ///      excess refunded to the wei; the token leg settles EXACTLY from the caller's allowance.
    function test_L1_normalCreate() public {
        uint256 ethBefore = address(this).balance;
        uint256 tokBefore = token.balanceOf(address(this));

        (uint256 a0, uint256 a1) = pump.addLiquidity{value: 50 ether}(key, TICK_LO, TICK_HI, SEED_LIQ, alice);

        assertGt(a0, 0, "the position consumed ETH");
        assertGt(a1, 0, "and token");
        assertEq(ethBefore - address(this).balance, a0, "only the consumed ETH left -- the excess came back");
        assertEq(tokBefore - token.balanceOf(address(this)), a1, "the token leg settled exactly, no refund needed");

        IGlueHook.Program memory g = pump.programOf(id);
        assertTrue(g.exists, "the program exists");
        assertEq(g.owner, alice, "owned by the named owner, not msg.sender");
        assertEq(g.liquidity, SEED_LIQ, "carrying the liquidity");
        assertEq(g.tickLower, TICK_LO, "range fixed");
        assertEq(g.tickUpper, TICK_HI, "forever");
        assertEq(g.buybackShareWad, 0, "no buyback share");
        assertEq(g.burnShareWad, 0, "no burn share");
        assertEq(g.secondaryRecipient, alice, "secondary fees default to the owner");
        assertEq(g.mainRecipient, alice, "main fees default to the owner");
        assertEq(g.minMain, type(uint256).max, "auto-harvest disarmed");
        assertEq(g.minSecondary, type(uint256).max, "on both sides");
    }

    /// L2 -- the `(0,0)` tick sentinel resolves to the pool's own full range at creation, so every
    ///      later read works on REAL ticks.
    function test_L2_fullRangeSentinel() public {
        pump.addLiquidity{value: 50 ether}(key, 0, 0, SEED_LIQ, alice);
        IGlueHook.Program memory g = pump.programOf(id);
        assertEq(g.tickLower, TICK_LO, "sentinel resolved to the spacing's full-range lower");
        assertEq(g.tickUpper, TICK_HI, "and upper");
    }

    /// L3 -- creation gates: pot admin only, one program per pool forever, no program before the pot's
    ///      roles exist, and the normal entry rejects a zero owner (its default recipients ARE the
    ///      owner, and a payable leg needs a live recipient).
    function test_L3_creationGates() public {
        // Not the pot admin
        vm.deal(alice, 60 ether);
        vm.prank(alice);
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.addLiquidity{value: 50 ether}(key, TICK_LO, TICK_HI, SEED_LIQ, alice);

        // The normal entry's defaults route 100% of both sides to the owner, so a zero owner would
        // put a payable leg behind `address(0)` -- the config validation rejects it
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.addLiquidity{value: 50 ether}(key, TICK_LO, TICK_HI, SEED_LIQ, address(0));

        // One program per pool
        pump.addLiquidity{value: 50 ether}(key, TICK_LO, TICK_HI, SEED_LIQ, alice);
        vm.expectRevert(IGlueHook.PotAlreadyReady.selector);
        pump.addLiquidity{value: 50 ether}(key, TICK_LO, TICK_HI, SEED_LIQ, alice);

        // A pool whose pot has no roles yet cannot host a program
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        IPoolManagerMin.PoolKey memory bare = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: address(other), fee: FEE, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
        IPoolManagerMin(POOL_MANAGER).initialize(bare, LAUNCH_SQRT);
        vm.expectRevert(IGlueHook.PotNotReady.selector);
        pump.addLiquidity{value: 50 ether}(bare, TICK_LO, TICK_HI, SEED_LIQ, alice);
    }

    /// L4 -- config validation, every leg: overshooting shares, a burn share on a native main, a dead
    ///      recipient behind a leg that can carry value, and value attached to a pool with no native
    ///      side.
    function test_L4_configValidation() public {
        // Shares must be within 100%
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, alice, _cfg(uint64(PRECISION_ + 1), 0, carol, dave, 0, 0)
        );

        // A leg that can carry value needs a live recipient behind it
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, alice, _cfg(0, 0, address(0), dave, 0, 0)
        );
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, alice, _cfg(0, 0, carol, address(0), 0, 0)
        );

        // A NATIVE-MAIN pool mirrors the pot's rule: the network token cannot be burned
        MockERC20 secondary = new MockERC20("Sec", "SEC", 18);
        IPoolManagerMin.PoolKey memory nativeMain = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: address(secondary), fee: FEE, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
        IPoolManagerMin(POOL_MANAGER).initialize(nativeMain, LAUNCH_SQRT);
        pump.initPot(nativeMain, ETH, carol);
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.addLiquidityAdvanced{value: 50 ether}(
            nativeMain, TICK_LO, TICK_HI, SEED_LIQ, alice, _cfg(0, 1, carol, dave, 0, 0)
        );

        // setProgramConfig runs the SAME validation
        pump.addLiquidity{value: 50 ether}(key, TICK_LO, TICK_HI, SEED_LIQ, address(this));
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.setProgramConfig(id, _cfg(0, uint64(PRECISION_ + 1), carol, dave, 0, 0));
    }

    /// L5 -- MANUAL HARVEST, exact split: the buyback share of the ETH side fuels the pot, the burn
    ///      share of the token side walks the cascade (dead, for a plain ERC20), and each recipient
    ///      receives the EXACT remainder -- the legs sum to the harvest byte-for-byte.
    function test_L5_manualHarvestExactSplit() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfg(uint64(4e17), uint64(25e16), carol, dave, type(uint256).max, type(uint256).max)
        );
        _genFees();

        uint256 potBefore = pump.potOf(id).balance;
        uint256 carolBefore = carol.balance;
        uint256 daveBefore = token.balanceOf(dave);
        uint256 deadBefore = token.balanceOf(DEAD);

        vm.recordLogs();
        pump.harvest(key);
        (bool found, uint256 fMain, uint256 fSec, uint256 burned, uint256 fueled) =
            _lastHarvested(vm.getRecordedLogs());

        assertTrue(found, "the harvest ran");
        assertGt(fMain, 0, "token fees accrued");
        assertGt(fSec, 0, "ETH fees accrued");
        assertEq(fueled, (fSec * 4e17) / 1e18, "the pot's share is the floor of the WAD product");
        assertEq(burned, (fMain * 25e16) / 1e18, "and so is the burn's");
        assertEq(pump.potOf(id).balance - potBefore, fueled, "the pot was credited exactly");
        assertEq(carol.balance - carolBefore, fSec - fueled, "carol got the exact ETH remainder");
        assertEq(token.balanceOf(dave) - daveBefore, fMain - burned, "dave the exact token remainder");
        assertEq(token.balanceOf(DEAD) - deadBefore, burned, "the dead address really holds the burn");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "and the venue stays solvent");
    }

    /// L6 -- AUTO-HARVEST: armed mins fire the harvest inside the carrying swap; disarmed mins keep
    ///      every swap clean. The fees stay safely in the position until either the mins arm or
    ///      somebody harvests manually.
    function test_L6_autoHarvestMins() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfg(uint64(5e17), 0, carol, dave, 1, 1)
        );

        // Armed: the second swap sees the first one's fees pending and harvests them in-flight
        vm.recordLogs();
        _genFees();
        (bool found, , , , ) = _lastHarvested(vm.getRecordedLogs());
        assertTrue(found, "an armed program harvested inside the swap");

        // Disarm and trade again: no harvest fires
        pump.setProgramConfig(id, _cfg(uint64(5e17), 0, carol, dave, type(uint256).max, type(uint256).max));
        vm.recordLogs();
        _genFees();
        (found, , , , ) = _lastHarvested(vm.getRecordedLogs());
        assertFalse(found, "a disarmed program never auto-harvests");
    }

    /// L7 -- HARVEST-FIRST on liquidity ops: adding to a position with pending fees routes the fees
    ///      through the split BEFORE the add, so principal and fees never mix.
    function test_L7_harvestFirstOnAdd() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfg(uint64(5e17), 0, carol, dave, type(uint256).max, type(uint256).max)
        );
        _genFees();

        uint256 potBefore = pump.potOf(id).balance;
        vm.recordLogs();
        pump.addProgramLiquidity{value: 50 ether}(key, SEED_LIQ / 2);
        (bool found, , uint256 fSec, , uint256 fueled) = _lastHarvested(vm.getRecordedLogs());

        assertTrue(found, "the add harvested first");
        assertGt(fSec, 0, "there really were pending fees");
        assertEq(pump.potOf(id).balance - potBefore, fueled, "which fueled the pot through the split");
        assertEq(pump.programOf(id).liquidity, SEED_LIQ + SEED_LIQ / 2, "and the liquidity grew");
    }

    /// L8 -- REMOVE: the owner pulls principal to any target; the books shrink first; a zero target,
    ///      an over-remove, or a stranger are rejected.
    function test_L8_removeLiquidity() public {
        pump.addLiquidity{value: 50 ether}(key, TICK_LO, TICK_HI, SEED_LIQ, address(this));

        vm.prank(alice);
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.removeProgramLiquidity(key, SEED_LIQ / 2, alice);

        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.removeProgramLiquidity(key, SEED_LIQ + 1, carol);
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.removeProgramLiquidity(key, 0, carol);
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.removeProgramLiquidity(key, SEED_LIQ / 2, address(0));

        (uint256 a0, uint256 a1) = pump.removeProgramLiquidity(key, SEED_LIQ / 2, carol);
        assertGt(a0, 0, "principal ETH came out");
        assertGt(a1, 0, "and principal token");
        assertEq(carol.balance, a0, "to the named target");
        assertEq(token.balanceOf(carol), a1, "both legs");
        assertEq(pump.programOf(id).liquidity, SEED_LIQ - SEED_LIQ / 2, "the books shrank first");
    }

    /// L9 -- REFUSED PUSHES BOOK AND FOLD: a recipient that bounces the bounded push is booked in the
    ///      owed ledger (counted in the obligation), folded into the next successful push
    ///      automatically, and can always pull its own backlog with full gas through `claim`.
    function test_L9_owedBacklogAndClaim() public {
        SulkyReceiver sulky = new SulkyReceiver();
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfg(0, 0, address(sulky), dave, type(uint256).max, type(uint256).max)
        );

        // 1. The push bounces: booked, attributed, nothing lost
        _genFees();
        pump.harvest(key);
        uint256 owed = pump.owedOf(address(sulky), ETH);
        assertGt(owed, 0, "the refused ETH leg was booked");
        assertGe(pump.obligationOf(ETH), owed, "and counted in the obligation");

        // 2. The next successful push folds the backlog in
        sulky.setAccepting(true);
        _genFees();
        pump.harvest(key);
        assertEq(pump.owedOf(address(sulky), ETH), 0, "the backlog folded into the next push");
        assertGt(address(sulky).balance, owed, "the receiver holds backlog + the fresh leg");

        // 3. And the pull path: book again, then claim with full gas
        sulky.setAccepting(false);
        _genFees();
        pump.harvest(key);
        uint256 owed2 = pump.owedOf(address(sulky), ETH);
        assertGt(owed2, 0, "booked again");
        sulky.setAccepting(true);
        uint256 balBefore = address(sulky).balance;
        uint256 pulled = sulky.pull(pump, ETH);
        assertEq(pulled, owed2, "claim drained the booking");
        assertEq(address(sulky).balance - balBefore, owed2, "for real");
        assertEq(pump.owedOf(address(sulky), ETH), 0, "and cleared it");
    }

    /// L10 -- OPERATOR RENOUNCE: zeroing the operator is one-way and freezes the RULES ONLY. The
    ///       owner keeps the property -- add, remove, harvest all still work -- because the hook is
    ///       not an LP locker.
    function test_L10_operatorRenounce() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfg(uint64(5e17), 0, carol, dave, type(uint256).max, type(uint256).max)
        );
        pump.setProgramOperator(id, address(0));
        assertEq(pump.programOf(id).operator, address(0), "operator renounced");
        assertEq(pump.programOf(id).owner, address(this), "the owner is untouched");

        // The rules are frozen forever: no edits, no new operator
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.setProgramConfig(id, _cfg(0, 0, carol, dave, 0, 0));
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.setProgramOperator(id, address(this));

        // ...but the property keeps working: the frozen rules execute and the liquidity moves
        _genFees();
        uint256 potBefore = pump.potOf(id).balance;
        pump.harvest(key);
        assertGt(pump.potOf(id).balance, potBefore, "the frozen buyback share still fuels the pot");
        pump.addProgramLiquidity{value: 30 ether}(key, SEED_LIQ / 2);
        pump.removeProgramLiquidity(key, SEED_LIQ / 2, carol);
        assertEq(pump.programOf(id).liquidity, SEED_LIQ, "the owner still moves the liquidity freely");
    }

    /// L11 -- SURRENDERED AT BIRTH: the advanced entry with `owner == address(0)` ships rules nobody
    ///       can ever edit AND liquidity nobody can ever pull (100% shares need no recipients), with
    ///       the manual harvest forced public and the pot fueled from block one.
    function test_L11_surrenderedAtBirth() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(0),
            _cfg(uint64(PRECISION_), uint64(PRECISION_), address(0), address(0), 1, 1)
        );
        assertEq(pump.programOf(id).owner, address(0), "no owner");
        assertEq(pump.programOf(id).operator, address(0), "no operator");
        assertTrue(pump.programOf(id).publicHarvest, "the harvest gate is forced open");

        // Nobody edits, nobody pulls: both roles match no live caller
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.setProgramConfig(id, _cfg(0, 0, carol, dave, 0, 0));
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.removeProgramLiquidity(key, SEED_LIQ / 2, carol);
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.transferProgramOwnership(id, alice);

        uint256 deadBefore = token.balanceOf(DEAD);
        vm.recordLogs();
        _genFees(); // auto-harvest is armed from birth
        (bool found, uint256 fMain, uint256 fSec, uint256 burned, uint256 fueled) =
            _lastHarvested(vm.getRecordedLogs());

        assertTrue(found, "harvested inside the swaps");
        assertEq(fueled, fSec, "100% of the ETH side fuels the pot");
        assertEq(burned, fMain, "100% of the token side burns");
        // The freshly fueled pot immediately pumps on the buy and its burn-intent delivery ALSO goes
        // to dead, so the dead balance carries at least the harvest's burn leg
        assertGe(token.balanceOf(DEAD) - deadBefore, burned, "the burn landed");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "and the venue stays solvent");
    }

    /// L12 -- SOLVENCY through the whole dance: after entries, trades, harvests, refusals and a
    ///       removal, the hook's balances cover the obligation ledger on BOTH assets.
    function test_L12_solvencyAcrossTheDance() public {
        SulkyReceiver sulky = new SulkyReceiver();
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfg(uint64(3e17), uint64(2e17), address(sulky), dave, 1, 1)
        );
        _donateEth(key, 5 ether);

        _genFees();
        pump.harvest(key);
        _genFees();
        pump.removeProgramLiquidity(key, SEED_LIQ / 4, carol);
        _genFees();

        assertGe(address(pump).balance, pump.obligationOf(ETH), "ETH custody covers the ETH obligation");
        assertGe(
            token.balanceOf(address(pump)),
            pump.obligationOf(address(token)),
            "token custody covers the token obligation"
        );
    }

    /// L18 -- HARVEST GATE: manual harvest is owner-only by default; the owner opens it to the
    ///       public with `publicHarvest`, and can close it again.
    function test_L18_harvestGate() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfg(uint64(5e17), 0, carol, dave, type(uint256).max, type(uint256).max)
        );
        _genFees();

        // A stranger cannot harvest a closed program
        vm.prank(alice);
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.harvest(key);

        // The owner always can
        pump.harvest(key);

        // The owner opens it; now anyone harvests, same split
        IGlueHook.ProgramConfig memory open =
            _cfg(uint64(5e17), 0, carol, dave, type(uint256).max, type(uint256).max);
        open.publicHarvest = true;
        pump.setProgramConfig(id, open);
        assertTrue(pump.programOf(id).publicHarvest, "opened");

        _genFees();
        uint256 potBefore = pump.potOf(id).balance;
        vm.prank(alice);
        pump.harvest(key);
        assertGt(pump.potOf(id).balance, potBefore, "the public harvest ran the same split");

        // And closes it again
        open.publicHarvest = false;
        pump.setProgramConfig(id, open);
        _genFees();
        vm.prank(alice);
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.harvest(key);
    }

    /// L19 -- ROLE SEPARATION: the operator edits the rules but cannot touch the liquidity or
    ///       harvest; the owner moves the liquidity and harvests but cannot edit the rules once the
    ///       operator role moved away.
    function test_L19_ownerOperatorSeparation() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfg(uint64(5e17), 0, carol, dave, type(uint256).max, type(uint256).max)
        );

        // Only the operator can move the operator role
        vm.prank(alice);
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.setProgramOperator(id, alice);

        // Hand the settings to bob: the owner (this) loses config rights, bob gains ONLY them
        pump.setProgramOperator(id, bob);
        assertEq(pump.programOf(id).operator, bob, "operator moved");
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.setProgramConfig(id, _cfg(0, 0, carol, dave, 0, 0));
        vm.prank(bob);
        pump.setProgramConfig(id, _cfg(uint64(3e17), 0, carol, dave, type(uint256).max, type(uint256).max));

        // Bob edits rules but holds no property: no add, no remove, no closed-gate harvest
        vm.deal(bob, 30 ether);
        vm.startPrank(bob);
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.addProgramLiquidity{value: 30 ether}(key, SEED_LIQ / 2);
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.removeProgramLiquidity(key, SEED_LIQ / 2, bob);
        vm.stopPrank();
        _genFees();
        vm.prank(bob);
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.harvest(key);

        // The owner keeps the position: add, harvest, remove all still work
        pump.harvest(key);
        pump.addProgramLiquidity{value: 30 ether}(key, SEED_LIQ / 2);
        uint256 carolBefore = token.balanceOf(carol);
        pump.removeProgramLiquidity(key, SEED_LIQ / 2, carol);
        assertGt(token.balanceOf(carol), carolBefore, "the removal paid out");
        assertEq(pump.programOf(id).liquidity, SEED_LIQ, "back to the seed");
    }

    /// L20 -- OWNERSHIP TRANSFER: the property moves whole to a new holder (a locker contract plugs
    ///       in exactly here); the operator role does not travel with it; and `address(0)` is the
    ///       explicit surrender -- liquidity locked forever, harvest forced public.
    function test_L20_ownershipTransfer() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfg(uint64(5e17), 0, carol, dave, type(uint256).max, type(uint256).max)
        );

        // Only the owner moves the property
        vm.prank(alice);
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.transferProgramOwnership(id, alice);

        pump.transferProgramOwnership(id, alice);
        assertEq(pump.programOf(id).owner, alice, "property moved");
        assertEq(pump.programOf(id).operator, address(this), "the operator role did NOT travel");

        // The old owner lost the property rights; the new owner exercises them
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.removeProgramLiquidity(key, SEED_LIQ / 2, carol);
        _genFees();
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.harvest(key);
        vm.startPrank(alice);
        pump.harvest(key);
        uint256 carolBefore = token.balanceOf(carol);
        pump.removeProgramLiquidity(key, SEED_LIQ / 2, carol);
        vm.stopPrank();
        assertGt(token.balanceOf(carol), carolBefore, "the new owner's removal paid out");

        // The un-travelled operator still edits the rules under the new owner
        pump.setProgramConfig(id, _cfg(uint64(3e17), 0, carol, dave, type(uint256).max, type(uint256).max));

        // The new owner surrenders: liquidity locks forever, the harvest gate opens for good
        vm.prank(alice);
        pump.transferProgramOwnership(id, address(0));
        assertEq(pump.programOf(id).owner, address(0), "surrendered");
        assertTrue(pump.programOf(id).publicHarvest, "the surrender forced the gate open");
        vm.prank(alice);
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.removeProgramLiquidity(key, SEED_LIQ / 4, carol);
        _genFees();
        uint256 potBefore = pump.potOf(id).balance;
        vm.prank(bob);
        pump.harvest(key);
        assertGt(pump.potOf(id).balance, potBefore, "anyone still harvests the surrendered program");
        // The still-live operator keeps editing rules over the locked liquidity
        pump.setProgramConfig(id, _cfg(uint64(4e17), 0, carol, dave, type(uint256).max, type(uint256).max));
        assertTrue(pump.programOf(id).publicHarvest, "and cannot close the gate of an ownerless program");
    }

    /// L21 -- LOCKER ON TOP: a timelock contract becomes the OWNER and enforces its own release
    ///       schedule -- the composition the two-role design exists for. The hook itself stays
    ///       policy-free; the lock lives entirely in the layer above.
    function test_L21_lockerOnTop() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfg(uint64(5e17), 0, carol, dave, type(uint256).max, type(uint256).max)
        );

        TimelockLocker locker = new TimelockLocker(pump, alice, block.timestamp + 30 days);
        pump.transferProgramOwnership(id, address(locker));
        assertEq(pump.programOf(id).owner, address(locker), "the locker owns the program");

        // The creator lost the property; the locker's own policy now rules the liquidity
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.removeProgramLiquidity(key, SEED_LIQ / 2, carol);
        vm.prank(bob);
        vm.expectRevert(TimelockLocker.NotBeneficiary.selector);
        locker.withdraw(key, SEED_LIQ / 2);
        vm.prank(alice);
        vm.expectRevert(TimelockLocker.StillLocked.selector);
        locker.withdraw(key, SEED_LIQ / 2);

        // ...and honours it: after the unlock, the beneficiary pulls straight to itself
        vm.warp(block.timestamp + 30 days);
        uint256 aliceTokenBefore = token.balanceOf(alice);
        vm.prank(alice);
        locker.withdraw(key, SEED_LIQ / 2);
        assertGt(token.balanceOf(alice), aliceTokenBefore, "the timelocked principal released");
        assertEq(pump.programOf(id).liquidity, SEED_LIQ / 2, "half stays in the position");

        // The un-travelled operator (the creator) still edits the split under the locker's custody
        pump.setProgramConfig(id, _cfg(uint64(3e17), 0, carol, dave, type(uint256).max, type(uint256).max));
    }

    /// L22 -- FROZEN RULES TRAVEL: an operator-zeroed config stays frozen across an ownership
    ///       transfer -- the new owner gets the property, never the pen.
    function test_L22_frozenRulesTravel() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfg(uint64(5e17), 0, carol, dave, type(uint256).max, type(uint256).max)
        );
        pump.setProgramOperator(id, address(0));
        pump.transferProgramOwnership(id, alice);

        // The new owner holds the property...
        vm.startPrank(alice);
        uint256 carolBefore = token.balanceOf(carol);
        pump.removeProgramLiquidity(key, SEED_LIQ / 2, carol);
        assertGt(token.balanceOf(carol), carolBefore, "the new owner moves the liquidity");

        // ...but the rules stayed frozen: no config edit, no operator revival, from anyone
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.setProgramConfig(id, _cfg(0, 0, carol, dave, 0, 0));
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.setProgramOperator(id, alice);
        vm.stopPrank();
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.setProgramConfig(id, _cfg(0, 0, carol, dave, 0, 0));

        // The frozen split still executes for the new owner
        _genFees();
        uint256 potBefore = pump.potOf(id).balance;
        vm.prank(alice);
        pump.harvest(key);
        assertGt(pump.potOf(id).balance, potBefore, "the frozen buyback share still fuels the pot");
    }

    uint256 constant PRECISION_ = 1e18;
}
