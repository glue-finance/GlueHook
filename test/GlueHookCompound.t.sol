// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Vm} from "forge-std/Vm.sol";
import {GlueHookFixture} from "./helpers/GlueHookFixture.sol";
import {IGlueHook} from "../contracts/interfaces/IGlueHook.sol";
import {IPoolManagerMin} from "../contracts/libs/GluedV4Core.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/**
 * @title  GlueHookCompound -- the AUTO-COMPOUND and its CARRY: budgets, mints, retries, conservation.
 * @notice L13–L17 and L23–L27 against the real PoolManager, split out of {GlueHookLiquidity} (same
 *         fixture, same pool: the TOKEN is the defended main, native ETH the secondary). Everything
 *         here is about the compound leg of the flat split: the gross-referenced budget, the mint
 *         that never outspends it, and the CARRY that saves whatever could not be placed and retries
 *         it at every next harvest without ever leaking to the pot or a recipient.
 */
contract GlueHookCompound is GlueHookFixture {
    MockERC20 token;
    IPoolManagerMin.PoolKey key;
    bytes32 id;
    address alice;
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
        carol = makeAddr("carol");
        dave = makeAddr("dave");
    }

    /// @dev A config literal with a compound share.
    function _cfgC(uint64 cw, uint64 bb, uint64 burn, address secR, address mainR, uint256 mm, uint256 ms)
        internal pure returns (IGlueHook.ProgramConfig memory)
    {
        return IGlueHook.ProgramConfig({
            buybackShareWad: bb,
            burnShareWad: burn,
            compoundShareWad: cw,
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

    /// L13 -- COMPOUND, manual harvest, exact conservation: EVERY share reads off the GROSS of its
    ///       side (compound budget, buyback, burn), the recipients take the exact remainders, the
    ///       mint's real deltas grow the position, and whatever the mint could not place lands in
    ///       the CARRY -- never in the pot or a recipient. Every wei accounted byte-for-byte.
    function test_L13_compoundExactSplit() public {
        // 50% compound + 40% buyback (0.9 total) on the ETH side; 50% compound + 25% burn on the token side
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfgC(uint64(5e17), uint64(4e17), uint64(25e16), carol, dave, type(uint256).max, type(uint256).max)
        );
        _genFees();

        uint256 liqBefore = pump.programOf(id).liquidity;
        uint256 potBefore = pump.potOf(id).balance;
        uint256 carolBefore = carol.balance;
        uint256 daveBefore = token.balanceOf(dave);
        uint256 deadBefore = token.balanceOf(DEAD);

        vm.recordLogs();
        pump.harvest(key);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (bool found, uint256 fMain, uint256 fSec, uint256 burned, uint256 fueled) = _lastHarvested(logs);
        (bool cFound, uint128 liq, uint256 u0, uint256 u1) = _lastCompounded(logs);

        assertTrue(found, "the harvest ran");
        assertTrue(cFound, "and the compound minted");
        assertGt(liq, 0, "real liquidity");
        assertGt(u0, 0, "consuming ETH (currency0)");
        assertGt(u1, 0, "and token (currency1) -- the position is in range");

        // Every leg off the gross, floor math exactly as the contract computes it
        uint256 cMain = (fMain * 5e17) / 1e18;
        uint256 cSec = (fSec * 5e17) / 1e18;
        assertLe(u1, cMain, "the mint never outspends the main budget (no prior carry)");
        assertLe(u0, cSec, "nor the secondary budget");

        uint256 buyLeg = (fSec * 4e17) / 1e18;
        uint256 burnLeg = (fMain * 25e16) / 1e18;
        assertEq(fueled, buyLeg, "the pot takes exactly the buyback share of the gross");
        assertEq(burned, burnLeg, "the burn takes exactly the burn share of the gross");

        assertEq(pump.programOf(id).liquidity - liqBefore, liq, "the position grew by the minted liquidity");
        assertEq(pump.potOf(id).balance - potBefore, fueled, "the pot was credited exactly");
        assertEq(carol.balance - carolBefore, fSec - cSec - buyLeg, "carol: the exact ETH remainder of the gross");
        assertEq(token.balanceOf(dave) - daveBefore, fMain - cMain - burnLeg, "dave: the exact token remainder");
        assertEq(token.balanceOf(DEAD) - deadBefore, burnLeg, "the burn landed at dead");

        // What the mint could not place is CARRIED, not leaked
        assertEq(pump.programOf(id).carryMain, cMain - u1, "the unplaced main budget sits in the carry");
        assertEq(pump.programOf(id).carrySecondary, cSec - u0, "and the unplaced ETH budget too");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "ETH custody covers the obligation (carry included)");
        assertGe(token.balanceOf(address(pump)), pump.obligationOf(address(token)), "token custody too");
    }

    /// L14 -- COMPOUND inside the carrying swap: an armed program with a compound share re-mints in
    ///       the SAME transaction as the trade that produced the fees -- no keeper, no executor.
    function test_L14_compoundInSwap() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfgC(uint64(3e17), uint64(5e17), 0, carol, dave, 1, 1)
        );

        vm.recordLogs();
        _genFees(); // the second swap harvests (and compounds) the first one's fees in-flight
        (bool cFound, uint128 liq, , ) = _lastCompounded(vm.getRecordedLogs());

        assertTrue(cFound, "the compound ran inside the swap");
        assertEq(pump.programOf(id).liquidity, uint256(SEED_LIQ) + liq, "and the position grew by it");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "solvent");
    }

    /// L15 -- 100% COMPOUND: the whole harvest is LP budget; nobody else sees a wei -- not the pot,
    ///       not the recipients -- and whatever the mint could not place waits in the CARRY for the
    ///       next harvest to retry.
    function test_L15_fullCompound() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfgC(uint64(PRECISION_), 0, 0, carol, dave, type(uint256).max, type(uint256).max)
        );
        _genFees();

        uint256 carolBefore = carol.balance;
        uint256 daveBefore = token.balanceOf(dave);
        uint256 potBefore = pump.potOf(id).balance;
        vm.recordLogs();
        pump.harvest(key);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (, uint256 fMain, uint256 fSec, uint256 burned, uint256 fueled) = _lastHarvested(logs);
        (bool cFound, , uint256 u0, uint256 u1) = _lastCompounded(logs);

        assertTrue(cFound, "the compound minted");
        assertEq(carol.balance, carolBefore, "no secondary leg exists at 100% compound");
        assertEq(token.balanceOf(dave), daveBefore, "and no main leg either");
        assertEq(fueled, 0, "the pot takes nothing");
        assertEq(pump.potOf(id).balance, potBefore, "not a wei");
        assertEq(burned, 0, "no burn share");
        assertEq(pump.programOf(id).carrySecondary, fSec - u0, "the unplaced ETH waits in the carry");
        assertEq(pump.programOf(id).carryMain, fMain - u1, "and the unplaced token too");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "solvent with the carry accounted");
    }

    /// L16 -- SHARE validation and the disabled default: each side's two gross shares must sum to at
    ///       most 100% (`compound + buyback` and `compound + burn`), a side at exactly 100% may drop
    ///       its recipient, and both entries ship with the compound off.
    function test_L16_compoundValidation() public {
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, alice,
            _cfgC(uint64(PRECISION_ + 1), 0, 0, carol, dave, 0, 0)
        );

        // The SUM binds, not the individual shares: 60% + 50% overflows either side
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, alice,
            _cfgC(uint64(6e17), uint64(5e17), 0, carol, dave, 0, 0)
        );
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, alice,
            _cfgC(uint64(6e17), 0, uint64(5e17), carol, dave, 0, 0)
        );

        pump.addLiquidity{value: 50 ether}(key, TICK_LO, TICK_HI, SEED_LIQ, address(this));
        assertEq(pump.programOf(id).compoundShareWad, 0, "the normal entry ships with the compound off");

        // The owner can turn it on later, same validation
        pump.setProgramConfig(id, _cfgC(uint64(2e17), 0, 0, carol, dave, 1, 1));
        assertEq(pump.programOf(id).compoundShareWad, uint64(2e17), "and arm it afterwards");
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.setProgramConfig(id, _cfgC(uint64(PRECISION_ + 1), 0, 0, carol, dave, 1, 1));

        // A side whose shares sum below 100% must name a live recipient...
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.setProgramConfig(id, _cfgC(uint64(2e17), uint64(3e17), uint64(3e17), address(0), dave, 1, 1));
        // ...and a side at exactly 100% may drop it (no remainder can exist there)
        pump.setProgramConfig(id, _cfgC(uint64(5e17), uint64(5e17), uint64(5e17), address(0), dave, 1, 1));
        assertEq(pump.programOf(id).secondaryRecipient, address(0), "recipient-less at a 100% claim");
    }

    /// L17 -- SOLVENCY with the compound in the dance: entries, trades, auto-compounds, a manual
    ///       harvest and a removal later, custody still covers the obligation ledger on both assets.
    function test_L17_compoundSolvencyDance() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfgC(uint64(25e16), uint64(3e17), uint64(2e17), carol, dave, 1, 1)
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
        assertGt(pump.programOf(id).liquidity, SEED_LIQ - SEED_LIQ / 4, "and the auto-compounds really grew the position");
    }

    /// L23 -- COMPOUND GROWTH ACROSS ROUNDS: with auto-harvest armed, every round of trades grows
    ///       the position monotonically -- liquidity never shrinks through a harvest, compounds
    ///       stack across rounds, and solvency holds at every step. This is the "auto-compounding
    ///       the venue lacks natively" claim, exercised as a lifecycle rather than a single shot.
    function test_L23_compoundGrowsAcrossRounds() public {
        pump.addLiquidityAdvanced{value: 60 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfgC(uint64(6e17), uint64(2e17), uint64(1e17), carol, dave, 1, 1)
        );

        uint256 last = pump.programOf(id).liquidity;
        uint256 compounds;
        for (uint256 round; round < 5; ++round) {
            vm.recordLogs();
            _genFees(); // both directions; the in-swap auto-harvest compounds the accrued fees
            (bool cFound, uint128 liq, , ) = _lastCompounded(vm.getRecordedLogs());
            uint256 now_ = pump.programOf(id).liquidity;

            assertGe(now_, last, "liquidity never shrinks through a harvest round");
            if (cFound) {
                ++compounds;
                assertGt(liq, 0, "a landed compound minted real liquidity");
            }
            assertGe(address(pump).balance, pump.obligationOf(ETH), "ETH solvency every round");
            assertGe(
                token.balanceOf(address(pump)), pump.obligationOf(address(token)),
                "token solvency every round"
            );
            last = now_;
        }

        assertGt(compounds, 0, "the rounds actually compounded (anti-vacuity)");
        assertGt(pump.programOf(id).liquidity, SEED_LIQ, "and the position ends strictly larger than seeded");
    }

    /// L24 -- THE CARRY ACCUMULATES AND RETRIES: what one mint cannot place joins the NEXT harvest's
    ///       compound budget -- the carry is drawn down (or grown) by exactly the next mint's
    ///       arithmetic, wei-for-wei, and custody covers it the whole way through.
    function test_L24_carryAccumulatesAndRetries() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfgC(uint64(5e17), uint64(3e17), uint64(2e17), carol, dave, type(uint256).max, type(uint256).max)
        );

        // ROUND 1: skewed one-way flow so the mint binds on one side and leaves a real carry
        helper.swap(key, true, -int256(4 ether));
        helper.swap(key, true, -int256(4 ether));

        vm.recordLogs();
        pump.harvest(key);
        (, uint256 fMain1, uint256 fSec1, , ) = _lastHarvested(vm.getRecordedLogs());
        uint256 carryMain1 = pump.programOf(id).carryMain;
        uint256 carrySec1 = pump.programOf(id).carrySecondary;
        assertGt(carryMain1 | carrySec1, 0, "the skewed round left a real carry (anti-vacuity)");
        assertLe(carryMain1, (fMain1 * 5e17) / 1e18, "the carry never exceeds the round's own budget");
        assertLe(carrySec1, (fSec1 * 5e17) / 1e18, "on either side");

        // ROUND 2: balanced flow -- the next mint spends this round's slice PLUS the carry
        _genFees();
        vm.recordLogs();
        pump.harvest(key);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (, uint256 fMain2, uint256 fSec2, , ) = _lastHarvested(logs);
        (bool cFound, , uint256 u0, uint256 u1) = _lastCompounded(logs);
        assertTrue(cFound, "the retry minted");

        // The new carry is EXACTLY (slice + old carry) - what the mint consumed, per side
        uint256 budgetMain = (fMain2 * 5e17) / 1e18 + carryMain1;
        uint256 budgetSec = (fSec2 * 5e17) / 1e18 + carrySec1;
        assertEq(pump.programOf(id).carryMain, budgetMain - u1, "main carry drawn down by the mint exactly");
        assertEq(pump.programOf(id).carrySecondary, budgetSec - u0, "secondary carry too");

        assertGe(address(pump).balance, pump.obligationOf(ETH), "ETH custody covers the carry throughout");
        assertGe(token.balanceOf(address(pump)), pump.obligationOf(address(token)), "and token custody");
    }

    /// L25 -- ONE-SIDED FEES NEVER BLOCK: fees accrued in ONE direction only (a starved compound
    ///       side) must never revert the harvest -- the compound takes what the live price lets it
    ///       place (or abandons cleanly into the carry), the split conserves, and custody stays
    ///       solvent. This is the anchored-mint's shortfall branch under the worst skew.
    function test_L25_oneSidedFeesCompound() public {
        pump.addLiquidityAdvanced{value: 60 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfgC(uint64(7e17), uint64(2e17), uint64(2e17), carol, dave, type(uint256).max, type(uint256).max)
        );
        // ALL flow in one direction: only the ETH (secondary) side accrues meaningful fees
        helper.swap(key, true, -int256(3 ether));
        helper.swap(key, true, -int256(3 ether));
        helper.swap(key, true, -int256(3 ether));

        uint256 liqBefore = pump.programOf(id).liquidity;
        vm.recordLogs();
        pump.harvest(key); // must not revert, whatever the skew did to the anchor
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (bool found, uint256 fMain, uint256 fSec, , ) = _lastHarvested(logs);
        (bool cFound, uint128 liq, uint256 u0, uint256 u1) = _lastCompounded(logs);

        assertTrue(found, "the harvest ran");
        assertGt(fSec, 0, "the traded side accrued");

        if (cFound) {
            // Whatever the anchor chose, the mint stayed inside both slices
            assertLe(u0, (fSec * 7e17) / 1e18, "never outspent the secondary slice");
            assertLe(u1, (fMain * 7e17) / 1e18, "never outspent the main slice");
            assertEq(pump.programOf(id).liquidity, liqBefore + liq, "and the position grew by the mint");
        } else {
            assertEq(pump.programOf(id).liquidity, liqBefore, "an abandoned compound leaves the position untouched");
        }

        assertGe(address(pump).balance, pump.obligationOf(ETH), "ETH solvency");
        assertGe(token.balanceOf(address(pump)), pump.obligationOf(address(token)), "token solvency");
    }

    /// L26 -- ZERO-FEE CARRY RETRY: a manual harvest with NO fresh fees still retries a standing
    ///       carry -- the retry path is not gated on new income -- and conserves it exactly: the
    ///       carry only ever shrinks by what the mint consumed, and no other ledger moves.
    function test_L26_zeroFeeHarvestRetriesCarry() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfgC(uint64(PRECISION_), 0, 0, carol, dave, type(uint256).max, type(uint256).max)
        );
        _genFees();
        pump.harvest(key); // builds the carry (100% compound, the mint binds on one side)
        uint256 carryMain1 = pump.programOf(id).carryMain;
        uint256 carrySec1 = pump.programOf(id).carrySecondary;
        assertGt(carryMain1 | carrySec1, 0, "a real carry stands (anti-vacuity)");

        uint256 potBefore = pump.potOf(id).balance;
        uint256 carolBefore = carol.balance;
        uint256 daveBefore = token.balanceOf(dave);

        // NO new swaps: the second harvest collects zero fees and must still attempt the carry
        vm.recordLogs();
        pump.harvest(key);
        (bool cFound, , uint256 u0, uint256 u1) = _lastCompounded(vm.getRecordedLogs());

        uint256 uMain = cFound ? u1 : 0;
        uint256 uSec = cFound ? u0 : 0;
        assertEq(pump.programOf(id).carryMain, carryMain1 - uMain, "carry shrank by exactly the mint's main");
        assertEq(pump.programOf(id).carrySecondary, carrySec1 - uSec, "and by exactly the mint's ETH");
        assertEq(pump.potOf(id).balance, potBefore, "the pot never sees a carry retry");
        assertEq(carol.balance, carolBefore, "neither does the secondary recipient");
        assertEq(token.balanceOf(dave), daveBefore, "nor the main recipient");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "solvent throughout");
    }

    /// L27 -- THE CARRY SURVIVES A CONFIG EDIT: changing the shares only shapes FUTURE harvests. A
    ///       standing carry is untouched by the edit and keeps retrying under the new rules -- even
    ///       when the new compound share is ZERO, what was already earmarked for LP stays earmarked.
    function test_L27_carrySurvivesConfigEdit() public {
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            _cfgC(uint64(PRECISION_), 0, 0, carol, dave, type(uint256).max, type(uint256).max)
        );
        _genFees();
        pump.harvest(key);
        uint256 carryMain1 = pump.programOf(id).carryMain;
        uint256 carrySec1 = pump.programOf(id).carrySecondary;
        assertGt(carryMain1 | carrySec1, 0, "a real carry stands (anti-vacuity)");

        // The operator turns the compound OFF entirely; the standing carry must not be released
        pump.setProgramConfig(id, _cfgC(0, uint64(3e17), uint64(2e17), carol, dave, type(uint256).max, type(uint256).max));
        assertEq(pump.programOf(id).carryMain, carryMain1, "the edit did not touch the main carry");
        assertEq(pump.programOf(id).carrySecondary, carrySec1, "nor the ETH carry");

        // The next harvest splits fresh fees per the NEW shares and still retries the OLD carry
        _genFees();
        vm.recordLogs();
        pump.harvest(key);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (, uint256 fMain2, uint256 fSec2, uint256 burned2, uint256 fueled2) = _lastHarvested(logs);
        (bool cFound, , uint256 u0, uint256 u1) = _lastCompounded(logs);

        assertEq(fueled2, (fSec2 * 3e17) / 1e18, "fresh fees split per the new buyback share");
        assertEq(burned2, (fMain2 * 2e17) / 1e18, "and the new burn share");
        // With compound now 0%, the whole budget IS the old carry — drawn down by the mint only
        uint256 uMain = cFound ? u1 : 0;
        uint256 uSec = cFound ? u0 : 0;
        assertEq(pump.programOf(id).carryMain, carryMain1 - uMain, "the old carry kept retrying");
        assertEq(pump.programOf(id).carrySecondary, carrySec1 - uSec, "on both sides");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "ETH solvency");
        assertGe(token.balanceOf(address(pump)), pump.obligationOf(address(token)), "token solvency");
    }

    /// @dev PRECISION mirror (the contract's constant is private).
    uint256 constant PRECISION_ = 1e18;
}
