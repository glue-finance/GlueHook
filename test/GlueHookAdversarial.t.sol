// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Vm} from "forge-std/Vm.sol";
import {GlueHookFixture} from "./helpers/GlueHookFixture.sol";
import {IGlueHook} from "../contracts/interfaces/IGlueHook.sol";
import {IPoolManagerMin} from "../contracts/libs/GluedV4Core.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeeOnTransferERC20} from "./mocks/MockFeeOnTransferERC20.sol";
import {BlockingERC20, ReentrantDonorERC20} from "./mocks/HostileTokens.sol";

/**
 * @title  GlueHookAdversarial — every attack shape the design claims to close, attempted.
 * @notice A1–A11. The two mechanics move donors' money inside strangers' swaps, so each test here IS
 *         one of the ways a stranger would try to make that money theirs: price the shield against a
 *         hookless twin pool (the only honest yardstick), sandwich the pump, manipulate the spot
 *         before dumping into the pot, wedge hostile tokens and recipients into the delivery path,
 *         and re-enter the funding path from inside its own token pull.
 */
contract GlueHookAdversarial is GlueHookFixture {
    MockERC20 token;
    IPoolManagerMin.PoolKey key;
    bytes32 id;

    function setUp() public {
        _deployCore();
        token = new MockERC20("Main", "MAIN", 18);
        (key, id) = _openEthPool(address(token), address(0));
    }

    /// A1 — THE PARITY PROOF. The same sell, priced by the shield (rich pot, full absorb), pays the
    ///      seller the IDENTICAL amount a hookless twin pool would — same currencies, fee, spacing,
    ///      price and liquidity. Each size is measured under a state snapshot and reverted, so both
    ///      pools are always at a bit-identical launch price when they trade. "Pool-equivalent price"
    ///      is a wei-exact equality across the two pools, not an approximation.
    function test_A1_shieldPaysPoolEquivalent() public {
        IPoolManagerMin.PoolKey memory twin = _openTwinPool(address(token));
        _donateEth(key, 100 ether);

        uint256[3] memory sizes = [uint256(500e18), 7_777e18, 42_000e18];
        for (uint256 i; i < sizes.length; ++i) {
            // Path A: the shield absorbs the sell in full, from the launch price
            uint256 snap = vm.snapshotState();
            uint256 ethBefore = address(helper).balance;
            uint160 priceBefore = _sqrtPrice(id);
            vm.recordLogs();
            helper.swap(key, false, -int256(sizes[i]));
            (bool shielded, uint256 absorbed, ) = _lastShielded(vm.getRecordedLogs());
            uint256 shieldPayout = address(helper).balance - ethBefore;
            assertTrue(shielded, "the pot absorbed");
            assertEq(absorbed, sizes[i], "the whole sell");
            assertEq(_sqrtPrice(id), priceBefore, "without moving the pool at all");
            vm.revertToState(snap);

            // Path B: the identical sell against the hookless twin, from the identical launch price
            ethBefore = address(helper).balance;
            helper.swap(twin, false, -int256(sizes[i]));
            uint256 twinPayout = address(helper).balance - ethBefore;
            vm.revertToState(snap);

            assertEq(shieldPayout, twinPayout, "the shield paid exactly what the pool would have");
        }
    }

    /// A2 — THE PUMP CANNOT BE SANDWICHED ON ITS OWN. The attacker's OWN buy triggers the pump; the
    ///      attacker then sells the whole bag back, trying to farm the pump's price impact. This is the
    ///      attack the fee ceiling `V ≤ f·R` closes: the pump spends at most `0.8·f·R`, so the price
    ///      impact the attacker can recapture is strictly less than the fees they paid to open and
    ///      close the position. Across attacker sizes from dust to pool-scale, the round trip LOSES.
    /// @dev Two related surfaces live OUTSIDE this test and are written up in AUDIT.md (GH-1):
    ///      (a) a third-party sandwich of an UNRELATED large buy captures a bounded slice of the
    ///      pump's buy pressure — that victim was sandwichable with or without the hook; and
    ///      (b) a self-sandwicher who buys big and dumps through a PARTIALLY-absorbing shield can
    ///      extract bounded ETH from the pot — but the pot pays pool-equivalent price for main it
    ///      exists to buy and burn, the extraction never exceeds the pot's own spend, and the
    ///      attacker carries open sandwich-able inventory to do it (fuzzed as FM10). What is
    ///      provably closed is farming the pump ITSELF with a full round trip, below.
    function test_A2_pumpNotSelfSandwichable() public {
        _donateEth(key, 200 ether); // fat pot, so the fee ceiling (not the pot) binds the pump

        uint256[5] memory legs = [uint256(0.05 ether), 0.5 ether, 2 ether, 8 ether, 40 ether];
        for (uint256 i; i < legs.length; ++i) {
            uint256 snap = vm.snapshotState();

            uint256 ethBefore = address(helper).balance;
            uint256 tokBefore = token.balanceOf(address(helper));

            // The attacker buys — their OWN buy is what carries the pump
            (, int256 gotTok) = helper.swap(key, true, -int256(legs[i]));
            // …then dumps the entire bag back, trying to sell into the pump's price bump
            helper.swap(key, false, -gotTok);

            assertEq(token.balanceOf(address(helper)), tokBefore, "attacker is token-flat");
            assertLe(address(helper).balance, ethBefore,
                "farming the pump with your own buy must lose to fees, at every size");

            vm.revertToState(snap);
        }
    }

    /// A3 — spot manipulation before dumping into the pot buys the attacker nothing: with the price
    ///      pushed up first, the shield still prices the dump at the manipulated pool's OWN execution
    ///      terms. Measured the same snapshot way — shield fill vs the pool executing the identical
    ///      dump from the identical manipulated price.
    function test_A3_spotManipulationNoExcessPayout() public {
        IPoolManagerMin.PoolKey memory twin = _openTwinPool(address(token));

        // Manipulate BOTH pools identically BEFORE funding the pot — an empty pot means the hooked
        // buy fires no pump, so the 30 ETH manipulation moves both pools to the same price.
        helper.swap(key, true, -int256(30 ether));
        helper.swap(twin, true, -int256(30 ether));
        assertEq(_sqrtPrice(id), _sqrtPrice(keccak256(abi.encode(twin))), "pools aligned post-manipulation");

        // Now fund the pot for the shield
        _donateEth(key, 100 ether);

        uint256 snap = vm.snapshotState();
        uint256 ethBefore = address(helper).balance;
        vm.recordLogs();
        helper.swap(key, false, -int256(10_000e18));
        (bool shielded, , ) = _lastShielded(vm.getRecordedLogs());
        uint256 shieldPayout = address(helper).balance - ethBefore;
        assertTrue(shielded, "the pot absorbed the manipulated dump");
        vm.revertToState(snap);

        // The identical dump against the hookless twin, from the identical manipulated price
        ethBefore = address(helper).balance;
        helper.swap(twin, false, -int256(10_000e18));
        uint256 twinPayout = address(helper).balance - ethBefore;
        vm.revertToState(snap);

        assertEq(shieldPayout, twinPayout, "at exactly the manipulated pool's own execution price");
    }

    /// A4 — a hostile RECIPIENT cannot brick the venue: a token that blocks the named recipient makes
    ///      the delivery park on the hook (accounted), and the carrying swap still succeeds.
    function test_A4_hostileRecipientParks() public {
        BlockingERC20 blocky = new BlockingERC20();
        (IPoolManagerMin.PoolKey memory k2, bytes32 id2) = _openEthPool(address(blocky), address(0));
        address treasury = makeAddr("treasury");
        pump.setRecipient(id2, treasury);
        blocky.setBlocked(treasury, true);

        pump.donate{value: 10 ether}(k2, 10 ether);

        vm.recordLogs();
        helper.swap(k2, true, -int256(1 ether)); // the swap must survive the failed delivery
        Vm.Log[] memory logs = vm.getRecordedLogs();

        (bool pumped, , uint256 bought) = _lastPumped(logs);
        (bool delivered, address to, uint256 amount, IGlueHook.Delivery mode) = _lastDelivered(logs);
        assertTrue(pumped && delivered, "the pump ran and the delivery resolved");
        assertEq(to, address(pump), "onto the hook itself");
        assertEq(uint8(mode), uint8(IGlueHook.Delivery.PARKED), "as a park");
        assertEq(pump.parkedOf(address(blocky)), amount, "fully accounted");
        assertEq(pump.parkedDirectOf(id2), amount, "booked per-pool, retryable via flushDirect");
        assertEq(pump.heldOf(address(blocky)), 0, "but NOT as a burn-park (the intent was delivery)");
        assertEq(blocky.balanceOf(address(pump)), bought, "and the hook really holds it");
    }

    /// A5 — re-entering `donate` from inside the donation's own token pull bounces off the transient
    ///      guard, so a hostile secondary cannot double-credit itself.
    function test_A5_reentrantDonateBlocked() public {
        MockERC20 main2 = new MockERC20("Main2", "MN2", 18);
        ReentrantDonorERC20 rnt = new ReentrantDonorERC20();
        (IPoolManagerMin.PoolKey memory k2, bytes32 id2) =
            _openErc20Pool(address(main2), address(rnt), address(0), false);

        rnt.mint(address(this), 100e18);
        rnt.approve(address(pump), type(uint256).max);
        rnt.arm(address(pump), abi.encodeCall(IGlueHook.donate, (k2, 1e18)));

        uint256 credited = pump.donate(k2, 10e18);

        assertTrue(rnt.reentered(), "the token really did attempt the re-entry");
        assertFalse(rnt.reentrySucceeded(), "and the guard rejected it");
        assertEq(credited, 10e18, "the outer donation credited once");
        assertEq(pump.potOf(id2).balance, 10e18, "and the pot booked it once");
    }

    /// A6 — a zero-fee pool can never host a pump: with `f = 0` the sandwich break-even `V > f·R`
    ///      is every V, so the fee ceiling collapses to nothing and the pot simply never spends.
    function test_A6_zeroFeePoolNeverPumps() public {
        MockERC20 zf = new MockERC20("ZeroFee", "ZRF", 18);
        IPoolManagerMin.PoolKey memory k2 = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: address(zf), fee: 0, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
        bytes32 id2 = keccak256(abi.encode(k2));
        IPoolManagerMin(POOL_MANAGER).initialize(k2, LAUNCH_SQRT);
        pump.initPot(k2, address(zf), address(0));
        zf.mint(address(helper), 20_000_000e18);
        helper.addLiquidity(k2, TICK_LO, TICK_HI, _launchLiquidity());

        pump.donate{value: 10 ether}(k2, 10 ether);

        (uint256 spend, ) = pump.quotePump(k2, 5 ether);
        assertEq(spend, 0, "the quote refuses a zero-fee pool");

        vm.recordLogs();
        helper.swap(k2, true, -int256(5 ether));
        (bool pumped, , ) = _lastPumped(vm.getRecordedLogs());
        assertFalse(pumped, "and so does the live path");
        assertEq(pump.potOf(id2).balance, 10 ether, "the pot never spends into a sandwich-open pool");
    }

    /// A7 — a donation that arrives as NOTHING (a 100% fee-on-transfer) is refused outright: no
    ///      zero-credit entries pollute the books.
    function test_A7_hundredPercentFoTDonationRefused() public {
        MockERC20 main2 = new MockERC20("Main2", "MN2", 18);
        MockFeeOnTransferERC20 vampire = new MockFeeOnTransferERC20("Vampire", "VMP", 18, 10_000);
        (IPoolManagerMin.PoolKey memory k2, ) =
            _openErc20Pool(address(main2), address(vampire), address(0), false);

        vampire.mint(address(this), 100e18);
        vampire.approve(address(pump), type(uint256).max);
        vm.expectRevert(IGlueHook.BadDonation.selector);
        pump.donate(k2, 10e18);
    }

    /// A8 — direction discipline: a BUY never fires the shield and a SELL never fires the pump. The
    ///      wrong-direction mechanic staying silent is what keeps each pot spendable only as designed.
    function test_A8_directionDiscipline() public {
        _donateEth(key, 20 ether);

        // A buy: pump may fire, shield must not
        vm.recordLogs();
        helper.swap(key, true, -int256(1 ether));
        (bool shieldedOnBuy, , ) = _lastShielded(vm.getRecordedLogs());
        assertFalse(shieldedOnBuy, "no shield on a buy");

        // A sell: shield may fire, pump must not
        vm.recordLogs();
        helper.swap(key, false, -int256(1_000e18));
        (bool pumpedOnSell, , ) = _lastPumped(vm.getRecordedLogs());
        assertFalse(pumpedOnSell, "no pump on a sell");
    }

    /// A9 — pot isolation: two pools sharing the SAME secondary cannot see each other's money. One
    ///      pot spending to zero leaves the other's balance and the global obligation intact.
    function test_A9_potIsolation() public {
        MockERC20 tokenB = new MockERC20("MainB", "MNB", 18);
        (IPoolManagerMin.PoolKey memory kB, bytes32 idB) = _openEthPool(address(tokenB), address(0));

        _donateEth(key, 0.05 ether); // pot A: thin, will be drained
        _donateEth(kB, 30 ether);    // pot B: fat, must be untouched

        // Drain pot A with a sell it cannot fully absorb
        helper.swap(key, false, -int256(60_000e18));
        assertEq(pump.potOf(id).balance, 0, "pot A spent itself");

        assertEq(pump.potOf(idB).balance, 30 ether, "pot B never moved");
        assertEq(pump.obligationOf(ETH), 30 ether, "and the obligation ledger agrees");
        assertGe(address(pump).balance, 30 ether, "with the ETH really there");
    }

    /// A10 — the pump degrades to a no-op, never to a griefing vector: with pool liquidity so thin the
    ///       pump's own swap would be worthless, the buy still lands and the pot is not corrupted.
    function test_A10_pumpFailureNeverBreaksTheBuy() public {
        // A fresh pool with dust liquidity and a pot far larger than the venue
        MockERC20 thin = new MockERC20("Thin", "THN", 18);
        IPoolManagerMin.PoolKey memory k2 = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: address(thin), fee: FEE, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
        bytes32 id2 = keccak256(abi.encode(k2));
        IPoolManagerMin(POOL_MANAGER).initialize(k2, LAUNCH_SQRT);
        pump.initPot(k2, address(thin), address(0));
        thin.mint(address(helper), 20_000_000e18);
        helper.addLiquidity(k2, TICK_LO, TICK_HI, 1e6); // dust depth

        pump.donate{value: 50 ether}(k2, 50 ether);

        // The buy must land regardless of what the pump does with a dust pool
        helper.swap(k2, true, -int256(0.001 ether));

        // Whatever happened inside, the books close: balance covers obligation, pot never overdrawn
        assertLe(pump.potOf(id2).balance, 50 ether, "the pot cannot grow from a failed pump");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "the hook covers everything it owes");
    }

    /// A11 — a HARVEST RECIPIENT that re-enters during its own bounded push gets nowhere: the guard
    ///       rejects the re-entry, its receive reverts, the leg books as owed (state was final before
    ///       the send), and the carrying harvest lands. The backlog stays claimable afterwards.
    function test_A11_reentrantHarvestRecipientBooked() public {
        ReentrantHarvester evil = new ReentrantHarvester(pump, key);
        token.mint(address(this), 1_000_000e18);
        token.approve(address(pump), type(uint256).max);
        pump.addLiquidityAdvanced{value: 50 ether}(
            key, TICK_LO, TICK_HI, 1e21, address(this),
            IGlueHook.ProgramConfig({
                buybackShareWad: 0,
                burnShareWad: 0,
                compoundShareWad: 0,
                potCompoundShareWad: 0,
                potBurnShareWad: 0,
                publicHarvest: false,
                secondaryRecipient: address(evil),
                mainRecipient: address(this),
                minMain: type(uint256).max,
                minSecondary: type(uint256).max
            })
        );
        helper.swap(key, true, -int256(5 ether));
        helper.swap(key, false, -int256(4_000e18));

        pump.harvest(key); // the push into `evil` re-enters, reverts, books
        uint256 owed = pump.owedOf(address(evil), ETH);
        assertGt(owed, 0, "the re-entering recipient was booked, not paid");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "and the books cover it");

        // Disarmed, the backlog comes out through the pull path like anybody else's
        evil.disarm();
        vm.prank(address(evil));
        uint256 pulled = pump.claim(ETH);
        assertEq(pulled, owed, "claimable once it behaves");
        assertEq(address(evil).balance, owed, "for real");
    }
}

/// @dev A harvest recipient that re-enters the hook from inside its 30k-gas push stipend.
contract ReentrantHarvester {
    IGlueHook immutable pump;
    IPoolManagerMin.PoolKey key;
    bool armed = true;

    constructor(IGlueHook p, IPoolManagerMin.PoolKey memory k) {
        pump = p;
        key = k;
    }

    function disarm() external {
        armed = false;
    }

    receive() external payable {
        if (armed) {
            // Any of these would let it double-dip if the guard were absent
            pump.harvest(key);
        }
    }
}
