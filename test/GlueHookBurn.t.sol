// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Vm} from "forge-std/Vm.sol";
import {GlueHookFixture} from "./helpers/GlueHookFixture.sol";
import {IGlueHook} from "../contracts/interfaces/IGlueHook.sol";
import {IPoolManagerMin} from "../contracts/libs/GluedV4Core.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {BurnableERC20, FakeBurnERC20, BlockingERC20} from "./mocks/HostileTokens.sol";

/// @dev A native receiver whose mood can flip: models a treasury that reverts, then recovers.
contract MoodyReceiver {
    bool public accepting = true;

    function setAccepting(bool a) external {
        accepting = a;
    }

    receive() external payable {
        require(accepting, "not today");
    }
}

/**
 * @title  GlueHookBurn — the delivery/burn cascade, every leg.
 * @notice B1–B9. A burn-intent pot (recipient == address(0)) runs the cascade in its cheap-first
 *         order: the token's own burn (verified by a balance drop), then the dead address, then —
 *         for a token that refuses both — the amount is HELD on the hook FOREVER (no withdrawal path
 *         exists, so custody is the burn) and the asset is flagged unburnable so the probes never run
 *         again. A live recipient is a literal target whose refusal parks per-pool and retries
 *         through {flushDirect}; a native-main pot can never be burn-intent.
 */
contract GlueHookBurn is GlueHookFixture {
    /// @dev Run a buy that carries a pump and return what the pump's delivery did.
    function _pumpAndReadDelivery(IPoolManagerMin.PoolKey memory key)
        internal
        returns (uint256 bought, address to, IGlueHook.Delivery mode)
    {
        vm.recordLogs();
        helper.swap(key, true, -int256(1 ether)); // ETH -> main = a buy
        Vm.Log[] memory logs = vm.getRecordedLogs();
        ( , , bought) = _lastPumped(logs);
        ( , to, , mode) = _lastDelivered(logs);
    }

    /// B1 — HELD FOREVER: a burn-intent token that is neither burnable nor dead-sendable is held on
    ///      the hook itself, booked in {heldOf} and counted in {obligationOf}. There is no function
    ///      that can ever move it, so custody IS the burn.
    function test_B1_heldForever() public {
        BlockingERC20 main = new BlockingERC20();
        main.setBlocked(DEAD, true); // no burn() and no dead route: the terminal hold must carry it

        _deployCore();
        (IPoolManagerMin.PoolKey memory key, ) = _openEthPool(address(main), address(0));
        _donateEth(key, 20 ether);

        (uint256 bought, address to, IGlueHook.Delivery mode) = _pumpAndReadDelivery(key);

        assertGt(bought, 0, "the pump bought main");
        assertEq(to, address(pump), "delivery settled on the hook itself");
        assertEq(uint8(mode), uint8(IGlueHook.Delivery.HELD), "as a terminal hold");
        assertEq(main.balanceOf(address(pump)), bought, "the hook custodies the raw");
        assertEq(pump.heldOf(address(main)), bought, "booked in the held ledger");
        assertEq(pump.parkedOf(address(main)), 0, "never as a retryable park");
        assertEq(pump.obligationOf(address(main)), bought, "and attributed in the obligation");
    }

    /// B2 — NATIVE BURN: the main token has a working `burn(uint256)`. The cascade calls it and
    ///      accepts it only because the hook's balance actually fell.
    function test_B2_nativeBurn() public {
        BurnableERC20 main = new BurnableERC20();
        _deployCore();
        (IPoolManagerMin.PoolKey memory key, ) = _openEthPool(address(main), address(0));
        _donateEth(key, 20 ether);

        uint256 supplyBefore = main.totalSupply();
        (uint256 bought, address to, IGlueHook.Delivery mode) = _pumpAndReadDelivery(key);

        assertGt(bought, 0, "bought main");
        assertEq(to, address(main), "delivery names the token itself");
        assertEq(uint8(mode), uint8(IGlueHook.Delivery.BURNED), "as a native burn");
        assertEq(main.totalSupply(), supplyBefore - bought, "supply fell");
        assertEq(main.balanceOf(address(pump)), 0, "nothing stuck");
    }

    /// B3 — FAKE BURN FALLS THROUGH: a token whose `burn` returns success but destroys nothing is
    ///      caught by the balance-drop check and the cascade moves on to the dead address.
    function test_B3_fakeBurnFallsToDead() public {
        FakeBurnERC20 main = new FakeBurnERC20();
        _deployCore();
        (IPoolManagerMin.PoolKey memory key, ) = _openEthPool(address(main), address(0));
        _donateEth(key, 20 ether);

        (uint256 bought, address to, IGlueHook.Delivery mode) = _pumpAndReadDelivery(key);

        assertGt(bought, 0, "bought main");
        assertEq(to, DEAD, "the lying burn was rejected and the main went to dead");
        assertEq(uint8(mode), uint8(IGlueHook.Delivery.DEAD), "as a dead delivery");
        assertEq(main.balanceOf(DEAD), bought, "which actually holds it");
    }

    /// B4 — THE FLAG IS FOREVER: the first fall-through marks the asset unburnable, and from then on
    ///      every burn of it settles straight to the held ledger — even if the token would now accept
    ///      the dead route. The probes never run again.
    function test_B4_unburnableFlagShortCircuits() public {
        BlockingERC20 main = new BlockingERC20();
        main.setBlocked(DEAD, true);

        _deployCore();
        (IPoolManagerMin.PoolKey memory key, ) = _openEthPool(address(main), address(0));
        _donateEth(key, 40 ether);

        // First pump: both probes fail, the asset is flagged, the amount is held
        (uint256 first, , IGlueHook.Delivery mode1) = _pumpAndReadDelivery(key);
        assertEq(uint8(mode1), uint8(IGlueHook.Delivery.HELD), "first fall-through held");
        assertEq(pump.heldOf(address(main)), first, "and booked");

        // The token relents — the dead route WOULD now work. The flag doesn't care.
        main.setBlocked(DEAD, false);

        (uint256 second, address to, IGlueHook.Delivery mode2) = _pumpAndReadDelivery(key);
        assertGt(second, 0, "the second pump bought main");
        assertEq(to, address(pump), "and still settled on the hook");
        assertEq(uint8(mode2), uint8(IGlueHook.Delivery.HELD), "straight to held, probes skipped");
        assertEq(pump.heldOf(address(main)), first + second, "the held ledger accumulates");
        assertEq(main.balanceOf(DEAD), 0, "the dead address never saw a wei of it");
    }

    /// B5 — THE FLAG IS PER-ASSET: one weird token being held forever changes nothing for any other
    ///      pool — a burnable main elsewhere still burns natively.
    function test_B5_flagIsPerAsset() public {
        BlockingERC20 weird = new BlockingERC20();
        weird.setBlocked(DEAD, true);
        BurnableERC20 sane = new BurnableERC20();

        _deployCore();
        (IPoolManagerMin.PoolKey memory kWeird, ) = _openEthPool(address(weird), address(0));
        (IPoolManagerMin.PoolKey memory kSane, ) = _openEthPool(address(sane), address(0));
        _donateEth(kWeird, 20 ether);
        _donateEth(kSane, 20 ether);

        ( , , IGlueHook.Delivery modeWeird) = _pumpAndReadDelivery(kWeird);
        assertEq(uint8(modeWeird), uint8(IGlueHook.Delivery.HELD), "the weird token held");

        uint256 supplyBefore = sane.totalSupply();
        (uint256 bought, , IGlueHook.Delivery modeSane) = _pumpAndReadDelivery(kSane);
        assertEq(uint8(modeSane), uint8(IGlueHook.Delivery.BURNED), "the sane one still burns");
        assertEq(sane.totalSupply(), supplyBefore - bought, "for real");
    }

    /// B6 — flushDirect is a no-op guard, not a footgun: it reverts when nothing is parked for the
    ///      pool, and the held ledger has no retry entry at all (held is terminal by design).
    function test_B6_flushDirectGuard() public {
        MockERC20 main = new MockERC20("Main", "MN", 18);
        _deployCore();
        ( , bytes32 poolId) = _openEthPool(address(main), address(0));

        // Nothing direct-parked for the pool
        vm.expectRevert(IGlueHook.PotNotReady.selector);
        pump.flushDirect(poolId);
    }

    /// B7 — a NATIVE-MAIN pot can never be burn-intent: the network token cannot be burned, so both
    ///      the declaration and every later move of the recipient reject `address(0)`.
    function test_B7_nativeMainCannotBurn() public {
        MockERC20 secondary = new MockERC20("Sec", "SEC", 18);
        _deployCore();

        IPoolManagerMin.PoolKey memory key = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: address(secondary), fee: FEE, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
        bytes32 poolId = keccak256(abi.encode(key));
        IPoolManagerMin(POOL_MANAGER).initialize(key, LAUNCH_SQRT);

        // Declaring native main with burn intent is rejected outright
        vm.expectRevert(IGlueHook.BadRoles.selector);
        pump.initPot(key, ETH, address(0));

        // A live recipient declares fine…
        address treasury = makeAddr("treasury");
        pump.initPot(key, ETH, treasury);

        // …and can move to another live target, but never to burn
        vm.expectRevert(IGlueHook.BadRoles.selector);
        pump.setRecipient(poolId, address(0));
        pump.setRecipient(poolId, makeAddr("otherTreasury"));
    }

    /// B8 — a refused ERC20 delivery parks PER-POOL and retries: the recipient's blocklist bounces
    ///      the direct transfer (park, booked in {parkedDirectOf}), `flushDirect` reverts while the
    ///      refusal stands, and delivers the whole park once it lifts.
    function test_B8_refusedDeliveryParksAndRetries() public {
        BlockingERC20 main = new BlockingERC20();
        address treasury = makeAddr("treasury");
        main.setBlocked(treasury, true);

        _deployCore();
        (IPoolManagerMin.PoolKey memory key, bytes32 poolId) = _openEthPool(address(main), treasury);
        _donateEth(key, 20 ether);

        (uint256 bought, address to, IGlueHook.Delivery mode) = _pumpAndReadDelivery(key);
        assertEq(to, address(pump), "the refused delivery parked on the hook");
        assertEq(uint8(mode), uint8(IGlueHook.Delivery.PARKED), "as a park");
        assertEq(pump.parkedDirectOf(poolId), bought, "booked per-pool for the retry");
        assertEq(pump.parkedOf(address(main)), bought, "and in the asset ledger");
        assertEq(pump.heldOf(address(main)), 0, "but never as a hold (the intent was delivery)");

        // Still refused: the retry reverts and the park stays intact
        vm.expectRevert(IGlueHook.PotNotReady.selector);
        pump.flushDirect(poolId);
        assertEq(pump.parkedDirectOf(poolId), bought, "untouched");

        // The refusal lifts: the retry delivers the whole park and clears both ledgers
        main.setBlocked(treasury, false);
        vm.expectEmit(true, true, false, true, address(pump));
        emit IGlueHook.FlushedDirect(poolId, treasury, bought);
        uint256 delivered = pump.flushDirect(poolId);

        assertEq(delivered, bought, "the whole park delivered");
        assertEq(main.balanceOf(treasury), bought, "and the treasury really holds it");
        assertEq(pump.parkedDirectOf(poolId), 0, "per-pool ledger cleared");
        assertEq(pump.parkedOf(address(main)), 0, "asset ledger cleared");
        assertEq(main.balanceOf(address(pump)), 0, "nothing stuck to the hook");
    }

    /// B9 — NATIVE MAIN delivers as a bounded-gas send: a receiving treasury is paid inside the
    ///      carrying swap; a reverting one parks the ETH per-pool, and `flushDirect` pays it out the
    ///      moment the treasury recovers. The carrying swap lands either way.
    function test_B9_nativeMainDeliveryAndRetry() public {
        MockERC20 secondary = new MockERC20("Sec", "SEC", 18);
        MoodyReceiver treasury = new MoodyReceiver();
        _deployCore();

        // A pool whose MAIN is the network token: currency0 = ETH is defended, the ERC20 funds the pot
        IPoolManagerMin.PoolKey memory key = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: address(secondary), fee: FEE, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
        bytes32 poolId = keccak256(abi.encode(key));
        IPoolManagerMin(POOL_MANAGER).initialize(key, LAUNCH_SQRT);
        pump.initPot(key, ETH, address(treasury));
        secondary.mint(address(helper), 20_000_000e18);
        helper.addLiquidity(key, TICK_LO, TICK_HI, _launchLiquidity());

        // Fund the pot with the ERC20 secondary
        secondary.mint(address(this), 40_000 ether);
        secondary.approve(address(pump), 40_000 ether);
        pump.donate(key, 40_000 ether);

        // 1. A willing treasury is paid directly, inside the carrying buy (secondary -> ETH)
        vm.recordLogs();
        helper.swap(key, false, -int256(1_000 ether));
        ( , address to, uint256 amount, IGlueHook.Delivery mode) = _lastDelivered(vm.getRecordedLogs());
        assertEq(to, address(treasury), "the ETH went straight to the treasury");
        assertEq(uint8(mode), uint8(IGlueHook.Delivery.DIRECT), "as a direct delivery");
        assertEq(address(treasury).balance, amount, "who really holds it");

        // 2. The treasury turns hostile: the send bounces, the ETH parks per-pool, the swap still lands
        treasury.setAccepting(false);
        vm.recordLogs();
        helper.swap(key, false, -int256(1_000 ether));
        uint256 parkedAmt;
        ( , to, parkedAmt, mode) = _lastDelivered(vm.getRecordedLogs());
        assertEq(to, address(pump), "the refused ETH parked on the hook");
        assertEq(uint8(mode), uint8(IGlueHook.Delivery.PARKED), "as a park");
        assertEq(pump.parkedDirectOf(poolId), parkedAmt, "booked per-pool");
        assertEq(pump.parkedOf(ETH), parkedAmt, "and in the asset ledger");

        // 3. The treasury recovers: the retry pays the whole park out
        treasury.setAccepting(true);
        uint256 balBefore = address(treasury).balance;
        uint256 delivered = pump.flushDirect(poolId);
        assertEq(delivered, parkedAmt, "the whole park delivered");
        assertEq(address(treasury).balance, balBefore + parkedAmt, "the treasury holds it");
        assertEq(pump.parkedDirectOf(poolId), 0, "per-pool ledger cleared");
        assertEq(pump.parkedOf(ETH), 0, "asset ledger cleared");
    }
}
