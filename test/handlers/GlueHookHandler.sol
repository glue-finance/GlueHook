// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {GlueHook} from "../../contracts/GlueHook.sol";
import {IPoolManagerMin} from "../../contracts/libs/GluedV4Core.sol";
import {V4PoolHelper} from "../helpers/V4PoolHelper.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/**
 * @title  GlueHookHandler — bounded swap-and-donate surface for the pump's stateful fuzzer.
 * @notice Drives the REAL {GlueHook} against the REAL Uniswap V4 PoolManager on a real hooked pool:
 *         donations in random sizes from five actors, buys that trigger the pump, and sells in both
 *         swap modes that trigger the shield, all interleaved in whatever order the fuzzer picks.
 * @dev    The hook's mechanics are settled inside somebody else's swap, which is exactly the situation
 *         where an accounting slip is invisible to a unit test: the swap succeeds, the swapper is happy,
 *         and the hook's books quietly stop matching its balances. So this handler keeps a ghost ledger
 *         of every wei that entered a pot and every wei a pump or a shield spent out of one, reading the
 *         amounts from the hook's OWN events rather than inferring them from balances — an inferred
 *         number would be measuring the thing it is supposed to be checking.
 *
 *         It also records the two properties that can only be observed at the moment of a fill: that a
 *         FULLY absorbed sell leaves the pool's price untouched, and that a pump never spends more
 *         secondary than the buy that carried it. Both are latched into flags the invariants assert.
 *
 *         Every action swallows its own revert, so the counters below are what prove the surface is live
 *         rather than silently fuzzing an empty world.
 */
contract GlueHookHandler is Test {
    /// @dev Native currency sentinel, matching the hook's own.
    address internal constant ETH = address(0);

    GlueHook public immutable pump;
    address public immutable poolManager;
    MockERC20 public immutable token;
    V4PoolHelper public immutable helper;
    bytes32 public immutable poolId;

    /// @dev The hooked pool this campaign trades. Stored piecewise: a struct in immutable storage is not
    ///      a thing, and the key is needed as calldata on every action.
    address private immutable c0;
    address private immutable c1;
    uint24 private immutable feeTier;
    int24 private immutable spacing;
    address private immutable hooks;

    address[5] public actors;

    // ── ghost ledger: the secondary conservation identity's two sides ──
    /// @dev Σ credited into the pot across every donation (measured, from the hook's event).
    uint256 public ghostDonated;
    /// @dev Σ secondary the shield ever paid a seller.
    uint256 public ghostShieldPaid;
    /// @dev Σ secondary the pump ever spent.
    uint256 public ghostPumpSpent;
    /// @dev Σ main the pump ever bought.
    uint256 public ghostPumpBought;
    /// @dev Σ main the shield ever absorbed.
    uint256 public ghostAbsorbed;
    /// @dev Σ secondary a program harvest ever credited to the pot (the buyback leg of {Harvested}).
    uint256 public ghostFueled;
    /// @dev Σ main a program harvest ever routed through the burn cascade (the burn leg of {Harvested}).
    uint256 public ghostBurned;
    /// @dev Σ main the BUYBACK SPLIT credited to the program's compound carry (the COMPOUNDED
    ///      deliveries): pot output that became LP budget instead of reaching dead/parked/held.
    uint256 public ghostPotCompounded;

    // ── latched violations, asserted by the invariants rather than here ──
    /// @dev True if a sell the pot absorbed IN FULL still moved the pool's price.
    bool public fullAbsorbMovedPrice;
    /// @dev True if a pump ever spent more secondary than the buy it rode on.
    bool public pumpOutranBuy;
    /// @dev True if the pool's LP program liquidity EVER decreased — the handler never removes, so
    ///      with the auto-compound armed the position may only grow or stand still.
    bool public liquidityShrank;
    /// @dev High-water mark behind {liquidityShrank}.
    uint128 private lastLiquidity;

    // ── landed-action counters ──
    uint256 public donations;
    uint256 public buys;
    uint256 public sells;
    uint256 public pumps;
    uint256 public shields;
    uint256 public fullAbsorbs;
    uint256 public partialAbsorbs;
    uint256 public exactOutSells;
    uint256 public harvests;

    constructor(GlueHook _pump, MockERC20 _token, V4PoolHelper _helper, IPoolManagerMin.PoolKey memory _key) {
        pump = _pump;
        poolManager = _helper.PM();
        token = _token;
        helper = _helper;
        (c0, c1, feeTier, spacing, hooks) = (_key.currency0, _key.currency1, _key.fee, _key.tickSpacing, _key.hooks);
        poolId = keccak256(abi.encode(_key));

        actors[0] = makeAddr("pump_alice");
        actors[1] = makeAddr("pump_bob");
        actors[2] = makeAddr("pump_carol");
        actors[3] = makeAddr("pump_dave");
        actors[4] = makeAddr("pump_erin");
        for (uint256 i; i < actors.length; ++i) vm.deal(actors[i], 5_000 ether);
    }

    // ─────────────────────────── helpers ───────────────────────────

    function key() public view returns (IPoolManagerMin.PoolKey memory k) {
        k = IPoolManagerMin.PoolKey({
            currency0: c0, currency1: c1, fee: feeTier, tickSpacing: spacing, hooks: hooks
        });
    }

    /// @dev True when the pot's main is currency0, which fixes both mechanics' directions.
    function mainIsZero() public view returns (bool) {
        return pump.potOf(poolId).main == c0;
    }

    function potBalance() public view returns (uint256) {
        return pump.potOf(poolId).balance;
    }

    /// @dev The pool's live sqrt price, straight out of PoolManager storage.
    function sqrtPrice() public view returns (uint160 p) {
        bytes32 slot = keccak256(abi.encodePacked(poolId, bytes32(uint256(6))));
        p = uint160(uint256(IPoolManagerMin(poolManager).extsload(slot)));
    }

    /**
     * @dev Drain the hook's own events out of a recorded log window and fold them into the ghost ledger.
     *      `carriedBy` is the secondary the triggering buy supplied, or zero on a sell — the yardstick the
     *      pump's spend must not exceed.
     *
     *      `landed` is not optional: the recorder keeps logs emitted inside a call that later REVERTED, so
     *      an action the fuzzer bounced would otherwise book a pump or a fill the chain never kept, and
     *      every ledger identity below would drift by exactly the amount of the trade that did not happen.
     *      The window is drained either way, so a bounced action cannot leak into the next one.
     */
    function _accountLogs(bool landed, uint256 carriedBy, uint160 priceBefore, uint256 sellSize) private {
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // The monotone-liquidity latch reads live chain state, so it is valid whether or not the
        // action landed: an auto-compound may only ever grow the program's position
        uint128 liqNow = pump.programOf(poolId).liquidity;
        if (liqNow < lastLiquidity) liquidityShrank = true;
        lastLiquidity = liqNow;

        if (!landed) return;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(pump)) continue;

            if (logs[i].topics[0] == keccak256("Pumped(bytes32,uint256,uint256)")) {
                (uint256 spent, uint256 bought) = abi.decode(logs[i].data, (uint256, uint256));
                ghostPumpSpent += spent;
                ghostPumpBought += bought;
                ++pumps;
                // The pump must never outrun the demand that triggered it
                if (spent > carriedBy) pumpOutranBuy = true;
            } else if (logs[i].topics[0] == keccak256("Shielded(bytes32,uint256,uint256)")) {
                (uint256 absorbed, uint256 paid) = abi.decode(logs[i].data, (uint256, uint256));
                ghostAbsorbed += absorbed;
                ghostShieldPaid += paid;
                ++shields;
                if (sellSize != 0 && absorbed == sellSize) {
                    ++fullAbsorbs;
                    // The pot took the WHOLE sell, so the pool never traded and cannot have moved
                    if (sqrtPrice() != priceBefore) fullAbsorbMovedPrice = true;
                } else if (sellSize != 0) {
                    ++partialAbsorbs;
                }
            } else if (logs[i].topics[0] == keccak256("Donated(bytes32,address,uint256)")) {
                ghostDonated += abi.decode(logs[i].data, (uint256));
                ++donations;
            } else if (
                logs[i].topics[0] == keccak256("Harvested(bytes32,uint256,uint256,uint256,uint256)")
            ) {
                (,, uint256 burned, uint256 fueled) =
                    abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                ghostBurned += burned;
                ghostFueled += fueled;
                ++harvests;
            } else if (logs[i].topics[0] == keccak256("Delivered(bytes32,address,uint256,uint8)")) {
                (uint256 amt, uint8 mode) = abi.decode(logs[i].data, (uint256, uint8));
                // Delivery.COMPOUNDED: the buyback split's carry credit
                if (mode == 5) ghostPotCompounded += amt;
            }
        }
    }

    // ─────────────────────────── actions ───────────────────────────

    /// @notice Fund the pot with native secondary from one of the actors.
    function donate(uint256 seed, uint256 amount) public {
        address a = actors[bound(seed, 0, actors.length - 1)];
        amount = bound(amount, 1, 50 ether);
        if (a.balance < amount) return;

        bool landed;
        vm.recordLogs();
        vm.prank(a);
        try pump.donate{value: amount}(key(), amount) { landed = true; } catch {}
        _accountLogs(landed, 0, 0, 0);
    }

    /// @notice Buy main, which is what a pump rides on.
    function buy(uint256 amount) public {
        amount = bound(amount, 1e12, 20 ether);
        bool zeroForOne = !mainIsZero();
        // The helper settles from its own purse, so it must be able to cover the leg
        if (_helperBalance(zeroForOne ? c0 : c1) < amount) return;

        bool landed;
        vm.recordLogs();
        try helper.swap(key(), zeroForOne, -int256(amount)) { landed = true; ++buys; } catch {}
        // Buying main pays secondary, so the buy's own size IS the yardstick for the pump's spend
        _accountLogs(landed, amount, 0, 0);
    }

    /// @notice Sell main, which is what the shield absorbs.
    function sell(uint256 amount) public {
        amount = bound(amount, 1e12, 60_000e18);
        bool zeroForOne = mainIsZero();
        if (_helperBalance(zeroForOne ? c0 : c1) < amount) return;

        bool landed;
        uint160 before = sqrtPrice();
        vm.recordLogs();
        try helper.swap(key(), zeroForOne, -int256(amount)) { landed = true; ++sells; } catch {}
        _accountLogs(landed, 0, before, amount);
    }

    /// @notice Sell main in EXACT-OUTPUT mode, the shield's inverted branch.
    function sellExactOut(uint256 amount) public {
        amount = bound(amount, 1e9, 20 ether);
        bool zeroForOne = mainIsZero();
        // The output is the secondary side, and the input the helper must be able to cover is the main
        if (_helperBalance(zeroForOne ? c0 : c1) == 0) return;

        bool landed;
        vm.recordLogs();
        try helper.swap(key(), zeroForOne, int256(amount)) {
            landed = true;
            ++exactOutSells;
        } catch {}
        // Size is not pinned on this branch, so no full-absorb price claim is made
        _accountLogs(landed, 0, 0, 0);
    }

    /// @dev The helper's spendable balance in a currency.
    function _helperBalance(address currency) private view returns (uint256) {
        return currency == ETH ? address(helper).balance : token.balanceOf(address(helper));
    }

    // ─────────────────────────── views for the invariants ───────────────────────────

    /// @dev Everything the hook says it owes in the secondary.
    function secondaryOwed() external view returns (uint256) {
        return pump.obligationOf(pump.potOf(poolId).secondary);
    }

    /// @dev Everything the hook actually holds in the secondary.
    function secondaryHeld() external view returns (uint256) {
        address s = pump.potOf(poolId).secondary;
        return s == ETH ? address(pump).balance : MockERC20(s).balanceOf(address(pump));
    }
}
