// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Vm} from "forge-std/Vm.sol";
import {GlueHookFixture} from "./helpers/GlueHookFixture.sol";
import {IGlueHook} from "../contracts/interfaces/IGlueHook.sol";
import {GluedV4Core, IPoolManagerMin} from "../contracts/libs/GluedV4Core.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/**
 * @title  GlueHookDecimals — mixed-decimals ERC20/ERC20 pools, every mechanic.
 * @notice D1–D6. V4 (and this hook) never read `decimals()` — everything is raw units — but nothing
 *         in the campaign proved it end to end until now. These pools launch at a HUMAN 1:1 price
 *         (the raw sqrtPrice carries the whole decimals gap, e.g. ×10¹² between a 6-dec and an
 *         18-dec side), so every assertion doubles as a magnitude proof: a 100-unit buy must come
 *         out as ~100 units of the other token IN ITS OWN SCALE, fee and impact aside. Covered:
 *         the pump, the shield, the exact harvest split (WAD shares over 6-dec raw fee amounts),
 *         the compound mint, and the reverse role assignment on an 18/8 pair.
 */
contract GlueHookDecimals is GlueHookFixture {
    uint256 constant PRECISION_ = 1e18;
    /// @dev 1,000,000 human units per side at launch.
    uint256 constant HUMAN_SEED = 1_000_000;

    address carol;
    address dave;

    function setUp() public {
        _deployCore();
        carol = makeAddr("carol");
        dave = makeAddr("dave");
    }

    /* ────────────────────────────── mixed-decimals pool builder ─────────────────────────── */

    /// @dev Open a hooked ERC20/ERC20 pool at a HUMAN 1:1 launch price: the raw price is
    ///      10^(dec1−dec0), so the sqrtPrice soaks up the entire decimals gap. Seeds ~1M human
    ///      units per side and funds the trading helper. Decimal deltas must be even (6/8/18 are).
    function _openMixedPool(MockERC20 main, MockERC20 secondary, address recipient)
        internal
        returns (IPoolManagerMin.PoolKey memory key, bytes32 id)
    {
        (address c0, address c1) = address(main) < address(secondary)
            ? (address(main), address(secondary))
            : (address(secondary), address(main));
        uint8 d0 = MockERC20(c0).decimals();
        uint8 d1 = MockERC20(c1).decimals();

        // human parity: raw1/raw0 = 10^(d1−d0) → √ = 10^(Δ/2) on the right side of Q96
        uint160 sqrtP = d1 >= d0
            ? uint160(GluedV4Core.Q96 * (10 ** (uint256(d1 - d0) / 2)))
            : uint160(GluedV4Core.Q96 / (10 ** (uint256(d0 - d1) / 2)));

        key = IPoolManagerMin.PoolKey({
            currency0: c0, currency1: c1, fee: FEE, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
        id = keccak256(abi.encode(key));
        IPoolManagerMin(POOL_MANAGER).initialize(key, sqrtP);
        pump.initPot(key, address(main), recipient);

        // full-range L implied by 1M human units per side at that price
        uint256 amt0 = HUMAN_SEED * (10 ** uint256(d0));
        uint256 amt1 = HUMAN_SEED * (10 ** uint256(d1));
        uint256 l0 = (amt0 * uint256(sqrtP)) / GluedV4Core.Q96;
        uint256 l1 = (amt1 * GluedV4Core.Q96) / (uint256(sqrtP) - GluedV4Core.MIN_SQRT_RATIO);
        uint128 liq = uint128(l0 < l1 ? l0 : l1);

        _mintTo(c0, address(helper), amt0 * 20);
        _mintTo(c1, address(helper), amt1 * 20);
        helper.addLiquidity(key, TICK_LO, TICK_HI, liq);
    }

    /// @dev The delta the helper received on the MAIN side of a swap.
    function _mainDelta(IPoolManagerMin.PoolKey memory key, address main, int256 d0, int256 d1)
        internal pure returns (int256)
    {
        return main == key.currency0 ? d0 : d1;
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

    /* ───────────────────────────────────────── tests ────────────────────────────────────── */

    /// D1 — 6-dec main vs 18-dec secondary: a 100-unit buy delivers ~100 main units IN 6-DEC RAW
    ///      (human parity survives the decimals gap), and the pump fires alongside it, delivering
    ///      6-dec main to the recipient and debiting the pot by exactly what it spent.
    function test_D1_pumpOn6dec18decPool() public {
        MockERC20 usd6 = new MockERC20("Six", "USD6", 6);
        MockERC20 w18 = new MockERC20("Wide", "W18", 18);
        (IPoolManagerMin.PoolKey memory key, bytes32 id) = _openMixedPool(usd6, w18, carol);

        // fund the pot with the 18-dec secondary
        w18.mint(address(this), 100_000e18);
        w18.approve(address(pump), type(uint256).max);
        pump.donate(key, 1_000e18);
        assertEq(pump.potOf(id).balance, 1_000e18, "pot holds the raw 18-dec donation");

        // buy 100 human units of main with 100e18 secondary
        bool secIsZero = address(w18) == key.currency0;
        vm.recordLogs();
        (int256 d0, int256 d1) = helper.swap(key, secIsZero, -int256(100e18));
        int256 got = _mainDelta(key, address(usd6), d0, d1);

        // MAGNITUDE: ~100 units in 6-dec raw — fee (0.30%) + impact (~0.01%) only
        assertGt(got, int256(99e6), "human parity held in 6-dec raw");
        assertLt(got, int256(100e6), "fee was charged");

        (bool pumped, uint256 spent, uint256 bought) = _lastPumped(vm.getRecordedLogs());
        assertTrue(pumped, "the pump fired");
        assertLe(spent, (100e18 * 8) / 10, "spend capped at 80% of the carrying buy");
        assertEq(pump.potOf(id).balance, 1_000e18 - spent, "pot debited exactly its spend");
        assertEq(usd6.balanceOf(carol), bought, "recipient received the bought 6-dec main");
        assertGt(bought, 0, "the pump bought real units");
    }

    /// D2 — same pool, the SELL side: the shield absorbs a 6-dec main sell at the pool's exact
    ///      execution price, the seller's 18-dec proceeds keep human parity, and the absorbed main
    ///      lands with the recipient.
    function test_D2_shieldOn6dec18decPool() public {
        MockERC20 usd6 = new MockERC20("Six", "USD6", 6);
        MockERC20 w18 = new MockERC20("Wide", "W18", 18);
        (IPoolManagerMin.PoolKey memory key, bytes32 id) = _openMixedPool(usd6, w18, carol);

        w18.mint(address(this), 100_000e18);
        w18.approve(address(pump), type(uint256).max);
        pump.donate(key, 5_000e18);

        // sell 100 human units of the 6-dec main
        bool mainIsZero = address(usd6) == key.currency0;
        uint256 potBefore = pump.potOf(id).balance;
        vm.recordLogs();
        (int256 d0, int256 d1) = helper.swap(key, mainIsZero, -int256(100e6));
        int256 gotSec = mainIsZero ? d1 : d0;

        // MAGNITUDE: ~100 units in 18-dec raw
        assertGt(gotSec, int256(99e18), "human parity held in 18-dec raw");
        assertLt(gotSec, int256(100e18), "fee was charged");

        (bool shielded, uint256 absorbed, uint256 paid) = _lastShielded(vm.getRecordedLogs());
        assertTrue(shielded, "the shield absorbed");
        assertGt(absorbed, 0, "absorbed real 6-dec units");
        assertEq(pump.potOf(id).balance, potBefore - paid, "pot debited exactly what it paid");
        assertEq(usd6.balanceOf(carol), absorbed, "recipient received the absorbed main");
    }

    /// D3 — exact harvest split over MIXED-decimals fees: WAD shares over a 6-dec raw fee amount
    ///      must be exactly conservative — burn + recipient legs reassemble the main-side fees
    ///      byte-for-byte, fuel + recipient legs the 18-dec secondary side.
    function test_D3_exactSplitMixedDecimals() public {
        MockERC20 usd6 = new MockERC20("Six", "USD6", 6);
        MockERC20 w18 = new MockERC20("Wide", "W18", 18);
        (IPoolManagerMin.PoolKey memory key, bytes32 id) = _openMixedPool(usd6, w18, carol);

        usd6.mint(address(this), 10_000_000e6);
        w18.mint(address(this), 10_000_000e18);
        usd6.approve(address(pump), type(uint256).max);
        w18.approve(address(pump), type(uint256).max);

        pump.addLiquidityAdvanced(
            key, TICK_LO, TICK_HI, uint128(1e17), address(this),
            IGlueHook.ProgramConfig({
                buybackShareWad: uint64(4e17), // 40% of secondary fees → pot
                burnShareWad: uint64(25e16), // 25% of main fees → cascade (dead, for a mock)
                compoundShareWad: 0,
                potCompoundShareWad: 0,
                potBurnShareWad: 0,
                publicHarvest: false,
                secondaryRecipient: carol,
                mainRecipient: dave,
                minMain: type(uint256).max,
                minSecondary: type(uint256).max
            })
        );

        // trade both directions so BOTH fee sides accrue
        bool mainIsZero = address(usd6) == key.currency0;
        helper.swap(key, !mainIsZero, -int256(5_000e18));
        helper.swap(key, mainIsZero, -int256(4_000e6));

        uint256 potBefore = pump.potOf(id).balance;
        uint256 carolBefore = w18.balanceOf(carol);
        uint256 daveBefore = usd6.balanceOf(dave);
        uint256 deadBefore = usd6.balanceOf(DEAD);

        vm.recordLogs();
        pump.harvest(key);
        (bool found, uint256 fMain, uint256 fSec, uint256 burned, uint256 fueled) =
            _lastHarvested(vm.getRecordedLogs());

        assertTrue(found, "the harvest ran");
        assertGt(fMain, 0, "6-dec main fees accrued");
        assertGt(fSec, 0, "18-dec secondary fees accrued");
        // the WAD split is exact in each side's own raw scale
        assertEq(fueled, (fSec * 4e17) / PRECISION_, "buyback leg exact on the 18-dec side");
        assertEq(burned, (fMain * 25e16) / PRECISION_, "burn leg exact on the 6-dec side");
        assertEq(pump.potOf(id).balance - potBefore, fueled, "pot credited the fuel");
        assertEq(w18.balanceOf(carol) - carolBefore, fSec - fueled, "carol got the exact 18-dec remainder");
        assertEq(usd6.balanceOf(dave) - daveBefore, fMain - burned, "dave got the exact 6-dec remainder");
        assertEq(usd6.balanceOf(DEAD) - deadBefore, burned, "the cascade parked the burn at dead");
    }

    /// D4 — the compound mint on a mixed-decimals pool: the compound share of both raw scales
    ///      funds a real position mint and the program's liquidity grows.
    function test_D4_compoundMixedDecimals() public {
        MockERC20 usd6 = new MockERC20("Six", "USD6", 6);
        MockERC20 w18 = new MockERC20("Wide", "W18", 18);
        (IPoolManagerMin.PoolKey memory key, bytes32 id) = _openMixedPool(usd6, w18, carol);

        usd6.mint(address(this), 10_000_000e6);
        w18.mint(address(this), 10_000_000e18);
        usd6.approve(address(pump), type(uint256).max);
        w18.approve(address(pump), type(uint256).max);

        pump.addLiquidityAdvanced(
            key, TICK_LO, TICK_HI, uint128(1e17), address(this),
            IGlueHook.ProgramConfig({
                buybackShareWad: 0,
                burnShareWad: 0,
                compoundShareWad: uint64(5e17), // 50% of both sides re-invested
                potCompoundShareWad: 0,
                potBurnShareWad: 0,
                publicHarvest: false,
                secondaryRecipient: carol,
                mainRecipient: dave,
                minMain: type(uint256).max,
                minSecondary: type(uint256).max
            })
        );

        bool mainIsZero = address(usd6) == key.currency0;
        helper.swap(key, !mainIsZero, -int256(5_000e18));
        helper.swap(key, mainIsZero, -int256(4_000e6));

        uint128 liqBefore = pump.programOf(id).liquidity;
        vm.recordLogs();
        pump.harvest(key);
        (bool compounded, uint128 minted, uint256 u0, uint256 u1) = _lastCompounded(vm.getRecordedLogs());

        assertTrue(compounded, "the compound minted");
        assertGt(minted, 0, "real liquidity out of mixed-decimals fees");
        assertGt(u0 + u1, 0, "the mint consumed raw fee amounts");
        assertEq(pump.programOf(id).liquidity, liqBefore + minted, "the program's position grew");
    }

    /// D5 — roles reversed on an 18/8 pair: an 18-dec MAIN defended with an 8-dec secondary. The
    ///      pump buys 18-dec main with 8-dec fuel and delivers it; magnitudes hold in both scales.
    function test_D5_reverseRoles18dec8dec() public {
        MockERC20 w18 = new MockERC20("Wide", "W18", 18);
        MockERC20 oct8 = new MockERC20("Oct", "OCT8", 8);
        (IPoolManagerMin.PoolKey memory key, bytes32 id) = _openMixedPool(w18, oct8, carol);

        // the pot holds the 8-dec secondary
        oct8.mint(address(this), 100_000e8);
        oct8.approve(address(pump), type(uint256).max);
        pump.donate(key, 1_000e8);

        // buy 100 human units of the 18-dec main with the 8-dec secondary
        bool secIsZero = address(oct8) == key.currency0;
        vm.recordLogs();
        (int256 d0, int256 d1) = helper.swap(key, secIsZero, -int256(100e8));
        int256 got = _mainDelta(key, address(w18), d0, d1);

        assertGt(got, int256(99e18), "human parity held in 18-dec raw");
        assertLt(got, int256(100e18), "fee was charged");

        (bool pumped, uint256 spent, uint256 bought) = _lastPumped(vm.getRecordedLogs());
        assertTrue(pumped, "the pump fired on the 8-dec fuel");
        assertEq(pump.potOf(id).balance, 1_000e8 - spent, "8-dec pot debited exactly");
        assertEq(w18.balanceOf(carol), bought, "recipient received the 18-dec main");
        assertGt(bought, 0, "the pump bought real 18-dec units");
    }

    /// D6 — pot solvency across a mixed-decimals trading burst: after donations, pumps, shields and
    ///      a harvest, the hook's raw token balance covers the pot ledger exactly (no decimals
    ///      confusion between an 18-dec book and a 6-dec book).
    function test_D6_potSolvencyMixedDecimals() public {
        MockERC20 usd6 = new MockERC20("Six", "USD6", 6);
        MockERC20 w18 = new MockERC20("Wide", "W18", 18);
        (IPoolManagerMin.PoolKey memory key, bytes32 id) = _openMixedPool(usd6, w18, carol);

        usd6.mint(address(this), 10_000_000e6);
        w18.mint(address(this), 10_000_000e18);
        usd6.approve(address(pump), type(uint256).max);
        w18.approve(address(pump), type(uint256).max);
        pump.donate(key, 2_500e18);

        pump.addLiquidityAdvanced(
            key, TICK_LO, TICK_HI, uint128(1e17), address(this),
            IGlueHook.ProgramConfig({
                buybackShareWad: uint64(3e17),
                burnShareWad: uint64(2e17),
                compoundShareWad: uint64(3e17),
                potCompoundShareWad: 0,
                potBurnShareWad: 0,
                publicHarvest: true,
                secondaryRecipient: carol,
                mainRecipient: dave,
                minMain: 1,
                minSecondary: 1
            })
        );

        bool mainIsZero = address(usd6) == key.currency0;
        for (uint256 i; i < 5; ++i) {
            helper.swap(key, !mainIsZero, -int256(2_000e18));
            helper.swap(key, mainIsZero, -int256(1_500e6));
        }
        pump.harvest(key);

        // every raw unit the hook holds in the pot's currency covers the pot ledger
        assertGe(
            w18.balanceOf(address(pump)),
            pump.potOf(id).balance,
            "the 18-dec pot is fully backed by raw balance"
        );
    }
}
