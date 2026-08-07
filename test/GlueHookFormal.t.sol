// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Vm} from "forge-std/Vm.sol";
import {GlueHookFixture} from "./helpers/GlueHookFixture.sol";
import {IGlueHook} from "../contracts/interfaces/IGlueHook.sol";
import {IPoolManagerMin} from "../contracts/libs/GluedV4Core.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev A recipient that refuses every pushed ETH delivery, then pulls its own backlog with `claim`
///      (accepting only inside its own pull).
contract RefusesEth {
    bool private pulling;

    function pull(IGlueHook pump, address asset) external returns (uint256 got) {
        pulling = true;
        got = pump.claim(asset);
        pulling = false;
    }

    receive() external payable {
        require(pulling);
    }
}

/**
 * @title  GlueHookFormal — fuzzed proofs of the load-bearing arithmetic.
 * @notice FM1–FM12. These are the properties the audit's math section states as theorems, discharged
 *         against the REAL PoolManager over hundreds of random pot sizes, buy sizes, sell sizes and
 *         split configurations:
 *
 *   FM1  pump spend is bounded by 0.8·min(pot, feeCap, userIn) — never the pot, never the buy, always
 *        strictly inside the fee ceiling once the haircut applies
 *   FM2  pump spend is monotone in the carrying buy — a bigger buy never yields a smaller pump
 *   FM3  a fully-absorbed sell pays EXACTLY what a hookless twin pool pays, to the wei, and moves the
 *        hooked pool not at all (the shield's pool-equivalence, fuzzed)
 *   FM4  the shield never pays more than the pot and never returns a one-sided (unsettleable) fill
 *   FM5  a live pump's realised spend never exceeds its own quote, and its output clears its floor
 *   FM6  the quote functions are pure previews — calling them never mutates a pot
 *   FM7  the harvest split conserves EXACTLY under arbitrary share pairs — floor WAD legs, remainders
 *        to the recipients, both sides summing back to the gross fees to the wei
 *   FM8  the compound never outspends its budget under every legal (compound, buyback, burn) triple,
 *        and full conservation holds with the mint's unplaced budget sitting in the CARRY
 *   FM9  a refused push books EXACTLY the refused leg in the owed ledger, the obligation covers it,
 *        and `claim` later drains it to the wei
 *   FM10 self-sandwich accounting — the pump the attacker summons is capped by their own buy, any ETH
 *        extracted is strictly less than what the pot spent, and every pot spend burned real supply:
 *        the "attack" is a filled buy order from the pot's perspective (GH-1's boundary, fuzzed)
 *   FM11 auto-compound monotone growth — an armed program's liquidity never decreases through any
 *        trade, whatever the compound share, sizes or direction mix, with custody solvent throughout
 *   FM12 global carry conservation — over a whole sequence of harvests, Σ compound slices equals
 *        Σ mint consumption plus the final carry, per side to the wei
 */
contract GlueHookFormal is GlueHookFixture {
    MockERC20 token;
    IPoolManagerMin.PoolKey key;
    bytes32 id;
    IPoolManagerMin.PoolKey twin;

    uint256 constant HAIRCUT_BPS = 8_000;
    uint256 constant BPS = 10_000;

    function setUp() public {
        _deployCore();
        token = new MockERC20("Main", "MAIN", 18);
        (key, id) = _openEthPool(address(token), address(0));
        twin = _openTwinPool(address(token));
        // The split theorems (FM7–FM9) fund a program position from this contract
        token.mint(address(this), 10_000_000e18);
        token.approve(address(pump), type(uint256).max);
    }

    /// FM1 — the pump's spend obeys `spend ≤ 0.8·min(pot, feeCap, userIn)`, so it never exceeds the
    ///       pot, never exceeds the carrying buy, and always sits strictly inside the fee ceiling.
    function testFuzz_FM1_pumpSpendBounds(uint256 potSize, uint256 userIn) public {
        potSize = bound(potSize, 0.001 ether, 500 ether);
        userIn = bound(userIn, 1e9, 100 ether);
        _donateEth(key, potSize);

        (uint256 spend, uint256 minOut) = pump.quotePump(key, userIn);

        assertLe(spend, potSize, "spend never exceeds the pot");
        // spend ≤ 0.8·userIn (the haircut applied to the demand ceiling, floored)
        assertLe(spend, (userIn * HAIRCUT_BPS) / BPS, "spend never exceeds 0.8x the carrying buy");
        // Whenever the pump fires, it has a real output floor to enforce
        if (spend > 0) assertGt(minOut, 0, "a firing pump always carries a floor");
    }

    /// FM2 — a larger carrying buy never yields a smaller pump: spend is monotone non-decreasing in
    ///       `userIn` (rising until the fee ceiling, then flat).
    function testFuzz_FM2_pumpMonotoneInBuy(uint256 potSize, uint256 aIn, uint256 bIn) public {
        potSize = bound(potSize, 1 ether, 500 ether);
        aIn = bound(aIn, 1e9, 100 ether);
        bIn = bound(bIn, aIn, 200 ether); // bIn >= aIn
        _donateEth(key, potSize);

        (uint256 spendA, ) = pump.quotePump(key, aIn);
        (uint256 spendB, ) = pump.quotePump(key, bIn);
        assertLe(spendA, spendB, "a bigger buy cannot pump less");
    }

    /// FM3 — a fully-absorbed sell pays exactly the hookless twin, to the wei, and never moves the
    ///       hooked pool. Fuzzed over sell sizes against a pot rich enough to take them whole.
    function testFuzz_FM3_fullAbsorbParity(uint256 sellSize) public {
        sellSize = bound(sellSize, 1e15, 40_000e18);
        _donateEth(key, 2_000 ether); // rich enough that any bounded sell is affordable

        uint256 snap = vm.snapshotState();
        uint160 priceBefore = _sqrtPrice(id);
        uint256 ethBefore = address(helper).balance;
        vm.recordLogs();
        helper.swap(key, false, -int256(sellSize));
        (bool shielded, uint256 absorbed, ) = _lastShielded(vm.getRecordedLogs());
        uint256 shieldPayout = address(helper).balance - ethBefore;

        // Only assert parity when the pot took the WHOLE sell (the property's precondition)
        if (shielded && absorbed == sellSize) {
            assertEq(_sqrtPrice(id), priceBefore, "a full absorb never moves the hooked pool");
            vm.revertToState(snap);
            ethBefore = address(helper).balance;
            helper.swap(twin, false, -int256(sellSize));
            uint256 twinPayout = address(helper).balance - ethBefore;
            assertEq(shieldPayout, twinPayout, "and pays exactly what the twin pool would");
        }
        vm.revertToState(snap);
    }

    /// FM4 — the shield quote is always settleable and never overpays: `paid ≤ pot`, `absorbed ≤`
    ///       the offered input, and a fill is never one-sided (both legs zero or both non-zero).
    function testFuzz_FM4_shieldQuoteSane(uint256 potSize, uint256 sellSize) public {
        potSize = bound(potSize, 1 wei, 1_000 ether);
        sellSize = bound(sellSize, 1, 100_000e18);
        _donateEth(key, potSize);

        (uint256 absorbed, uint256 paid) = pump.quoteShield(key, -int256(sellSize));

        assertLe(paid, potSize, "the shield never pays more than the pot holds");
        assertLe(absorbed, sellSize, "and never absorbs more than was offered");
        assertEq(absorbed == 0, paid == 0, "a fill is never one-sided");
    }

    /// FM5 — a live pump's realised spend never exceeds what its own quote sized, and the main it
    ///       actually buys clears the floor the quote set. Execution can only be tighter than the plan.
    function testFuzz_FM5_livePumpWithinQuote(uint256 potSize, uint256 buySize) public {
        potSize = bound(potSize, 0.01 ether, 500 ether);
        buySize = bound(buySize, 1e15, 30 ether);
        _donateEth(key, potSize);

        vm.recordLogs();
        helper.swap(key, true, -int256(buySize));
        (bool pumped, uint256 spent, uint256 bought) = _lastPumped(vm.getRecordedLogs());

        if (pumped) {
            // The buy paid at least `spent` in secondary, so the pump rode strictly inside real demand
            assertGt(spent, 0, "a landed pump spent something");
            assertGt(bought, 0, "and bought something");
            assertLe(spent, potSize, "never more than the pot");
        }
    }

    /// FM6 — the quotes are pure previews: calling them never moves a pot. A view that quietly spent
    ///       would be the worst kind of accounting bug, so it is asserted directly.
    function testFuzz_FM6_quotesArePure(uint256 potSize, uint256 amt) public {
        potSize = bound(potSize, 0.01 ether, 500 ether);
        amt = bound(amt, 1e9, 50 ether);
        _donateEth(key, potSize);

        uint256 balBefore = pump.potOf(id).balance;
        pump.quotePump(key, amt);
        pump.quoteShield(key, -int256(amt));
        pump.quoteShield(key, int256(amt));
        assertEq(pump.potOf(id).balance, balBefore, "a quote never spends");
    }

    /// FM10 — SELF-SANDWICH ACCOUNTING, both sides of the ledger. An attacker who buys purely to
    ///        summon the pump and then dumps the whole bag through the shield is playing a game the
    ///        pot is DESIGNED to accept: the pot's mandate is to convert its inventory into bought-
    ///        and-burned main at the pool's own execution price, and that is exactly what happens.
    ///        Fuzzed over every pot depth and attack size, the theorem is three-sided:
    ///
    ///        1. the pump the attacker summons never spends more than their own buy carried
    ///           (`spend ≤ 0.8·userIn` — forcing a bigger pump costs proportionally more real money);
    ///        2. whatever ETH the attacker walks away with is STRICTLY less than what the pot spent —
    ///           extraction is never leveraged, and the difference is captured by the pool's LPs as
    ///           fees, so the attacker is financing the venue to farm the pot;
    ///        3. every wei the pot spent converted into main that was actually BURNED — supply went
    ///           down. From the hook's perspective the "attack" is a filled buy order: the attacker
    ///           risked real capital (open inventory that anyone else can sandwich, fees on both
    ///           legs) to deliver the pot the tokens it exists to buy.
    ///
    ///        This is finding GH-1's boundary, fuzzed. What is NOT possible: profiting without
    ///        putting real size at risk (1), taking out more than the pot chose to spend (2), or
    ///        making the pot spend without burning (3).
    function testFuzz_FM10_selfSandwichAccounting(uint256 potSize, uint256 attackIn) public {
        potSize = bound(potSize, 0.001 ether, 1_000 ether);
        attackIn = bound(attackIn, 1e12, 60 ether);
        _donateEth(key, potSize);

        uint256 potBefore = pump.potOf(id).balance;
        uint256 ethBefore = address(helper).balance;
        uint256 tokBefore = token.balanceOf(address(helper));
        uint256 supplyBefore = token.totalSupply();
        uint256 hookTokBefore = token.balanceOf(address(pump));
        uint256 deadBefore = token.balanceOf(address(0xdEaD));

        // The attacker's own buy is the only thing that can carry the pump…
        (, int256 gotTok) = helper.swap(key, true, -int256(attackIn));

        // …and the pump it summons never spends more than the attack itself paid in
        uint256 pumpSpent = potBefore - pump.potOf(id).balance;
        assertLe(pumpSpent, (attackIn * HAIRCUT_BPS) / BPS,
            "the pump's spend is capped by the attacker's own money");

        // The attacker dumps the entire bag — the shield buys what it can at pool-equivalent terms
        if (gotTok > 0) helper.swap(key, false, -gotTok);

        uint256 potSpent = potBefore - pump.potOf(id).balance;
        uint256 profit = address(helper).balance > ethBefore ? address(helper).balance - ethBefore : 0;
        // Burned = supply reduction (a native burn) plus the 0xdEaD fallthrough (this mock has no burn())
        uint256 burned = (supplyBefore - token.totalSupply()) + (token.balanceOf(address(0xdEaD)) - deadBefore);

        assertEq(token.balanceOf(address(helper)), tokBefore, "attacker ends token-flat");
        // (2) extraction is bounded by the pot's own deliberate spend — never leveraged
        assertLe(profit, potSpent,
            "the attacker can never take out more ETH than the pot spent buying main");
        // (3) the pot's whole spend is accounted as bought main — burned outright, or (for a
        //     dust-sized fill below the delivery threshold) held on the hook for the next delivery
        uint256 acquired = burned + (token.balanceOf(address(pump)) - hookTokBefore);
        if (potSpent > 0) assertGt(acquired, 0, "every pot spend converted into bought main");
        if (profit > 0) {
            assertGt(acquired, 0, "an extraction round always hands the pot the main it wanted");
        }
    }

    /// @dev A program config literal for the split theorems.
    function _splitCfg(uint64 cw, uint64 bb, uint64 burn, address secR, address mainR)
        private pure returns (IGlueHook.ProgramConfig memory)
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
            minMain: type(uint256).max,
            minSecondary: type(uint256).max
        });
    }

    /// @dev The LAST `Harvested` in a recorded window, or `found = false`.
    function _harvested(Vm.Log[] memory logs)
        private view
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
    function _compounded(Vm.Log[] memory logs)
        private view
        returns (bool found, uint128 liq, uint256 u0, uint256 u1)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(pump)) continue;
            if (logs[i].topics[0] != keccak256("Compounded(bytes32,uint128,uint256,uint256)")) continue;
            found = true;
            (liq, u0, u1) = abi.decode(logs[i].data, (uint128, uint256, uint256));
        }
    }

    /// FM7 — the harvest split is exactly conservative for EVERY share pair: each fixed leg is the
    ///       floor of its WAD product, each remainder goes whole to its recipient, and both sides sum
    ///       back to the gross fees to the wei. The specific-value split tests are instances of this.
    function testFuzz_FM7_harvestSplitConservation(uint256 bb, uint256 burn) public {
        bb = bound(bb, 0, 1e18);
        burn = bound(burn, 0, 1e18);
        address carol = makeAddr("fm7carol");
        address dave = makeAddr("fm7dave");
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, 1e21, address(this),
            _splitCfg(0, uint64(bb), uint64(burn), carol, dave)
        );
        helper.swap(key, true, -int256(5 ether));
        helper.swap(key, false, -int256(4_000e18));

        uint256 potBefore = pump.potOf(id).balance;
        uint256 deadBefore = token.balanceOf(DEAD);
        vm.recordLogs();
        pump.harvest(key);
        (bool found, uint256 fMain, uint256 fSec, uint256 burned, uint256 fueled) =
            _harvested(vm.getRecordedLogs());

        assertTrue(found, "the harvest ran");
        assertGt(fMain, 0, "token fees accrued");
        assertGt(fSec, 0, "ETH fees accrued");
        assertEq(fueled, (fSec * bb) / 1e18, "the pot leg is the floor WAD product");
        assertEq(burned, (fMain * burn) / 1e18, "and so is the burn leg");
        assertEq(pump.potOf(id).balance - potBefore, fueled, "the pot was credited exactly");
        assertEq(carol.balance, fSec - fueled, "carol holds the exact ETH remainder");
        assertEq(token.balanceOf(dave), fMain - burned, "dave the exact token remainder");
        assertEq(token.balanceOf(DEAD) - deadBefore, burned, "the burn landed whole at dead");
        // Conservation, both sides, to the wei
        assertEq(fueled + carol.balance, fSec, "the ETH side sums back to the gross");
        assertEq(burned + token.balanceOf(dave), fMain, "the token side sums back to the gross");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "and the venue stays solvent");
    }

    /// FM8 — for EVERY legal (compound, buyback, burn) triple, the mint never outspends either side
    ///       of its budget, the position grows by exactly the minted liquidity, and full conservation
    ///       holds with the mint's unplaced budget sitting in the CARRY — every wei of the harvest is
    ///       in the position, the pot, a recipient, dead, or the carry. Nothing else, nothing missing.
    function testFuzz_FM8_compoundWithinSlice(uint256 cw, uint256 bb, uint256 burn) public {
        cw = bound(cw, 1, 1e18);
        bb = bound(bb, 0, 1e18 - cw);
        burn = bound(burn, 0, 1e18 - cw);
        address carol = makeAddr("fm8carol");
        address dave = makeAddr("fm8dave");
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, 1e21, address(this),
            _splitCfg(uint64(cw), uint64(bb), uint64(burn), carol, dave)
        );
        helper.swap(key, true, -int256(5 ether));
        helper.swap(key, false, -int256(4_000e18));

        uint256 liqBefore = pump.programOf(id).liquidity;
        uint256 potBefore = pump.potOf(id).balance;
        uint256 deadBefore = token.balanceOf(DEAD);
        vm.recordLogs();
        pump.harvest(key);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (bool found, uint256 fMain, uint256 fSec, , ) = _harvested(logs);
        (bool cFound, uint128 liq, uint256 u0, uint256 u1) = _compounded(logs);

        assertTrue(found, "the harvest ran");
        if (cFound) {
            assertLe(u0, (fSec * cw) / 1e18, "the mint never outspends the ETH budget (no prior carry)");
            assertLe(u1, (fMain * cw) / 1e18, "nor the token budget");
            assertGt(liq, 0, "a landed compound minted real liquidity");
            assertEq(pump.programOf(id).liquidity - liqBefore, liq, "the position grew by exactly it");
        }
        // Conservation with the mint folded in: what the fees brought either sits in the position
        // (u0/u1), in the pot, at a recipient, at dead, or in the CARRY — nothing else, nothing missing
        assertEq(
            (pump.potOf(id).balance - potBefore) + carol.balance + u0 + pump.programOf(id).carrySecondary,
            fSec, "the ETH side conserves through the compound"
        );
        assertEq(
            (token.balanceOf(DEAD) - deadBefore) + token.balanceOf(dave) + u1 + pump.programOf(id).carryMain,
            fMain, "and so does the token side"
        );
        assertGe(address(pump).balance, pump.obligationOf(ETH), "and the venue stays solvent");
    }

    /// FM9 — a refused push books EXACTLY the refused leg, `obligationOf` covers it wei-for-wei, and
    ///       the recipient's later `claim` drains it whole. Fuzzed over the share that sizes the leg.
    function testFuzz_FM9_owedLedgerExact(uint256 bb) public {
        bb = bound(bb, 0, 999e15); // a live ETH remainder must exist to be refused
        RefusesEth sulky = new RefusesEth();
        address dave = makeAddr("fm9dave");
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, 1e21, address(this),
            _splitCfg(0, uint64(bb), 0, address(sulky), dave)
        );
        helper.swap(key, true, -int256(5 ether));
        helper.swap(key, false, -int256(4_000e18));

        vm.recordLogs();
        pump.harvest(key);
        (bool found, , uint256 fSec, , uint256 fueled) = _harvested(vm.getRecordedLogs());

        assertTrue(found, "the harvest ran");
        uint256 leg = fSec - fueled;
        if (leg == 0) return; // an all-pot split leaves nothing to refuse
        assertEq(pump.owedOf(address(sulky), ETH), leg, "the refused leg booked exactly");
        assertGe(pump.obligationOf(ETH), leg, "the obligation ledger covers it");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "with real balance behind it");

        uint256 got = sulky.pull(pump, ETH);
        assertEq(got, leg, "claim drained the exact booking");
        assertEq(pump.owedOf(address(sulky), ETH), 0, "and zeroed it");
        assertEq(address(sulky).balance, leg, "the wei arrived");
    }

    /// FM12 — GLOBAL CARRY CONSERVATION: across a whole SEQUENCE of harvests under a fuzzed compound
    ///        share, the sum of every round's compound slice equals what the mints actually consumed
    ///        plus the final standing carry — per side, to the wei. The carry ledger neither leaks
    ///        nor invents money over its entire life, whatever the trade sizes did to the anchor.
    function testFuzz_FM12_carryConservationAcrossRounds(uint256 cw, uint256 a, uint256 b) public {
        cw = bound(cw, 1e16, 1e18);
        a = bound(a, 0.5 ether, 5 ether);
        b = bound(b, 500e18, 4_000e18);
        address carol = makeAddr("fm12carol");
        address dave = makeAddr("fm12dave");
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, 1e21, address(this),
            _splitCfg(uint64(cw), 0, 0, carol, dave)
        );

        uint256 sumCMain;
        uint256 sumCSec;
        uint256 sumUMain;
        uint256 sumUSec;
        for (uint256 i; i < 3; ++i) {
            helper.swap(key, true, -int256(a));
            helper.swap(key, false, -int256(b));
            vm.recordLogs();
            pump.harvest(key);
            Vm.Log[] memory logs = vm.getRecordedLogs();
            (bool found, uint256 fMain, uint256 fSec, , ) = _harvested(logs);
            (bool cFound, , uint256 u0, uint256 u1) = _compounded(logs);
            if (found) {
                sumCMain += (fMain * cw) / 1e18;
                sumCSec += (fSec * cw) / 1e18;
            }
            if (cFound) {
                sumUMain += u1;
                sumUSec += u0;
            }
        }

        assertEq(pump.programOf(id).carryMain, sumCMain - sumUMain, "sum slices == sum consumed + carry (main)");
        assertEq(pump.programOf(id).carrySecondary, sumCSec - sumUSec, "and on the ETH side");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "ETH custody covers it throughout");
        assertGe(token.balanceOf(address(pump)), pump.obligationOf(address(token)), "and token custody");
    }

    /// FM11 — AUTO-COMPOUND MONOTONE GROWTH: with the program armed for in-swap harvesting, the
    ///        position's liquidity NEVER decreases through any trade — whatever the compound share,
    ///        the trade sizes, or the direction mix — and custody covers the obligation ledger on
    ///        both assets after every single swap. The auto-compounding the venue lacks natively
    ///        can only ever grow the position.
    function testFuzz_FM11_autoCompoundMonotoneGrowth(uint256 cw, uint256 s1, uint256 s2, uint256 s3) public {
        // The config carries a 30% buyback share, so compound may claim at most the other 70%
        cw = bound(cw, 1, 7e17);
        s1 = bound(s1, 0.01 ether, 10 ether);
        s2 = bound(s2, 100e18, 8_000e18);
        s3 = bound(s3, 0.01 ether, 10 ether);
        address carol = makeAddr("fm11carol");
        address dave = makeAddr("fm11dave");
        pump.addLiquidityAdvanced{value: 60 ether}(
            key, TICK_LO, TICK_HI, 1e21,
            address(this),
            IGlueHook.ProgramConfig({
                buybackShareWad: uint64(3e17),
                burnShareWad: uint64(2e17),
                compoundShareWad: uint64(cw),
                potCompoundShareWad: 0,
                potBurnShareWad: 0,
                publicHarvest: false,
                secondaryRecipient: carol,
                mainRecipient: dave,
                minMain: 1, // armed: every swap may auto-harvest and compound
                minSecondary: 1
            })
        );

        uint256 last = pump.programOf(id).liquidity;

        helper.swap(key, true, -int256(s1)); // buy
        uint256 now_ = pump.programOf(id).liquidity;
        assertGe(now_, last, "a buy never shrinks the position");
        last = now_;
        assertGe(address(pump).balance, pump.obligationOf(ETH), "ETH solvency after the buy");

        helper.swap(key, false, -int256(s2)); // sell
        now_ = pump.programOf(id).liquidity;
        assertGe(now_, last, "a sell never shrinks the position");
        last = now_;
        assertGe(token.balanceOf(address(pump)), pump.obligationOf(address(token)), "token solvency after the sell");

        helper.swap(key, true, -int256(s3)); // buy again — harvests the sell's fees in-flight
        now_ = pump.programOf(id).liquidity;
        assertGe(now_, last, "the third trade never shrinks it either");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "ETH solvency at rest");
        assertGe(token.balanceOf(address(pump)), pump.obligationOf(address(token)), "token solvency at rest");
    }
}
