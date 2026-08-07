// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Vm} from "forge-std/Vm.sol";
import {GlueHookFixture} from "./helpers/GlueHookFixture.sol";
import {IGlueHook} from "../contracts/interfaces/IGlueHook.sol";
import {IPoolManagerMin} from "../contracts/libs/GluedV4Core.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/**
 * @title  GlueHookLaunch -- the ONE-TRANSACTION pool launch ({launchPool}).
 * @notice LA1-LA10. One call initialises the pool on the PoolManager, declares the pot's roles and
 *         creates the LP program with its seed liquidity -- and every gate of the three standalone
 *         steps still holds: the launcher becomes the pot admin (not the hook, which is the
 *         initialiser the PoolManager reports), the roles pass {initPot}'s full validation, the
 *         config passes the split legality rules, and the seed settles from the launcher with the
 *         native excess refunded. A hook-driven initialise OUTSIDE the launch window is rejected,
 *         so the transient launcher hand-off can never be spoofed into an orphaned pot.
 */
contract GlueHookLaunch is GlueHookFixture {
    MockERC20 token;
    address alice;
    address bob;

    function setUp() public {
        _deployCore();
        token = new MockERC20("Main", "MAIN", 18);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        vm.deal(alice, 1_000 ether);
        token.mint(alice, 1_000_000e18);
        vm.prank(alice);
        token.approve(address(pump), type(uint256).max);
    }

    /// @dev The ETH/token key every native-side test launches.
    function _ethKey() internal view returns (IPoolManagerMin.PoolKey memory key) {
        key = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: address(token), fee: FEE, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
    }

    /// @dev A config literal.
    function _cfg(uint64 bb, uint64 burn, uint64 comp, address secR, address mainR)
        internal pure returns (IGlueHook.ProgramConfig memory)
    {
        return IGlueHook.ProgramConfig({
            buybackShareWad: bb,
            burnShareWad: burn,
            compoundShareWad: comp,
            potCompoundShareWad: 0,
            potBurnShareWad: 0,
            publicHarvest: false,
            secondaryRecipient: secR,
            mainRecipient: mainR,
            // Auto-harvest disarmed, so the suite's manual harvests always have fees to split
            minMain: type(uint256).max,
            minSecondary: type(uint256).max
        });
    }

    /// @dev LA1 -- the happy path: one call creates the pool, the pot and the program; the LAUNCHER
    ///      is the pot admin (not the hook), the pool sits at the requested price, the seed is the
    ///      program's liquidity and the unused native excess comes straight back.
    function test_LA1_singleTransactionLaunch() public {
        IPoolManagerMin.PoolKey memory key = _ethKey();
        bytes32 id = keccak256(abi.encode(key));
        uint128 seed = _launchLiquidity();
        uint256 balBefore = alice.balance;

        vm.recordLogs();
        vm.prank(alice);
        (uint256 a0, uint256 a1) = pump.launchPool{value: 150 ether}(
            key, LAUNCH_SQRT, address(token), address(0), TICK_LO, TICK_HI, seed, alice,
            _cfg(0.2e18, 0.3e18, 0, alice, alice)
        );

        // The pool exists at the requested price
        assertEq(_sqrtPrice(id), LAUNCH_SQRT, "pool price");

        // The POT: admin is the LAUNCHER, roles declared, burn intent stored
        IGlueHook.Pot memory p = pump.potOf(id);
        assertEq(p.admin, alice, "admin is the launcher");
        assertTrue(p.configured, "pot configured");
        assertEq(p.main, address(token), "main");
        assertEq(p.secondary, ETH, "secondary");
        assertEq(p.recipient, address(0), "burn intent");

        // The PROGRAM: owned, configured, seeded
        IGlueHook.Program memory g = pump.programOf(id);
        assertTrue(g.exists, "program exists");
        assertEq(g.owner, alice, "owner");
        assertEq(g.operator, alice, "operator");
        assertEq(g.liquidity, seed, "seed liquidity");
        assertEq(g.buybackShareWad, 0.2e18, "buyback share");
        assertEq(g.burnShareWad, 0.3e18, "burn share");

        // Funding: the seed consumed both sides and refunded the untouched native excess exactly
        assertGt(a0, 0, "native leg consumed");
        assertGt(a1, 0, "token leg consumed");
        assertEq(alice.balance, balBefore - a0, "excess refunded to the wei");

        // PotOpened carries the LAUNCHER as admin -- the transient hand-off resolved correctly
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(pump)) continue;
            if (logs[i].topics[0] != keccak256("PotOpened(bytes32,address)")) continue;
            seen = true;
            assertEq(address(uint160(uint256(logs[i].topics[2]))), alice, "PotOpened admin");
        }
        assertTrue(seen, "PotOpened emitted");
    }

    /// @dev LA2 -- ERC20/ERC20 launch: both legs settle from the launcher's allowances, and any
    ///      attached value on a pool with no native side is rejected.
    function test_LA2_erc20PairLaunch() public {
        MockERC20 a = new MockERC20("A", "A", 18);
        MockERC20 b = new MockERC20("B", "B", 18);
        (address c0, address c1) = address(a) < address(b) ? (address(a), address(b)) : (address(b), address(a));
        IPoolManagerMin.PoolKey memory key = IPoolManagerMin.PoolKey({
            currency0: c0, currency1: c1, fee: FEE, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
        bytes32 id = keccak256(abi.encode(key));

        a.mint(alice, 1_000_000e18);
        b.mint(alice, 1_000_000e18);
        vm.startPrank(alice);
        a.approve(address(pump), type(uint256).max);
        b.approve(address(pump), type(uint256).max);

        // A pool with no native side must carry no value
        vm.expectRevert(IGlueHook.BadDonation.selector);
        pump.launchPool{value: 1 ether}(
            key, PAR_SQRT, c0, alice, TICK_LO, TICK_HI, uint128(100_000e18), alice,
            _cfg(0, 0, 0, alice, alice)
        );

        (uint256 a0, uint256 a1) = pump.launchPool(
            key, PAR_SQRT, c0, alice, TICK_LO, TICK_HI, uint128(100_000e18), alice,
            _cfg(0, 0, 0, alice, alice)
        );
        vm.stopPrank();

        assertEq(_sqrtPrice(id), PAR_SQRT, "pool price");
        assertGt(a0, 0, "leg 0 settled");
        assertGt(a1, 0, "leg 1 settled");
        assertEq(pump.potOf(id).admin, alice, "admin");
        assertEq(pump.programOf(id).liquidity, uint128(100_000e18), "seed");
    }

    /// @dev LA3 -- a key naming another hook (or none) is rejected before anything happens.
    function test_LA3_foreignHookKeyRejected() public {
        IPoolManagerMin.PoolKey memory key = _ethKey();
        key.hooks = address(0);
        vm.prank(alice);
        vm.expectRevert(IGlueHook.BadRoles.selector);
        pump.launchPool{value: 150 ether}(
            key, LAUNCH_SQRT, address(token), address(0), TICK_LO, TICK_HI, _launchLiquidity(), alice,
            _cfg(0, 0, 0, alice, alice)
        );
    }

    /// @dev LA4 -- a pool that already exists cannot be launched again: the PoolManager's own
    ///      one-initialise rule holds through the hook path.
    function test_LA4_existingPoolRejected() public {
        IPoolManagerMin.PoolKey memory key = _ethKey();
        IPoolManagerMin(POOL_MANAGER).initialize(key, LAUNCH_SQRT);

        vm.prank(alice);
        vm.expectRevert();
        pump.launchPool{value: 150 ether}(
            key, LAUNCH_SQRT, address(token), address(0), TICK_LO, TICK_HI, _launchLiquidity(), alice,
            _cfg(0, 0, 0, alice, alice)
        );
    }

    /// @dev LA5 -- the roles pass {initPot}'s full validation: a main outside the pair reverts, and
    ///      the WHOLE launch rolls back atomically (no pool, no pot, nothing half-created).
    function test_LA5_badMainRollsEverythingBack() public {
        IPoolManagerMin.PoolKey memory key = _ethKey();
        bytes32 id = keccak256(abi.encode(key));

        vm.prank(alice);
        vm.expectRevert(IGlueHook.BadRoles.selector);
        pump.launchPool{value: 150 ether}(
            key, LAUNCH_SQRT, makeAddr("stranger"), address(0), TICK_LO, TICK_HI, _launchLiquidity(), alice,
            _cfg(0, 0, 0, alice, alice)
        );

        // Atomic: the failed launch left NO pool and NO pot behind
        assertEq(_sqrtPrice(id), 0, "no pool");
        assertEq(pump.potOf(id).admin, address(0), "no pot");
    }

    /// @dev LA6 -- a native main can never point at burn, launch path included.
    function test_LA6_nativeMainBurnRejected() public {
        IPoolManagerMin.PoolKey memory key = _ethKey();
        vm.prank(alice);
        vm.expectRevert(IGlueHook.BadRoles.selector);
        pump.launchPool{value: 150 ether}(
            key, LAUNCH_SQRT, ETH, address(0), TICK_LO, TICK_HI, _launchLiquidity(), alice,
            _cfg(0, 0, 0, alice, alice)
        );
    }

    /// @dev LA7 -- the config passes the split legality rules and the seed must be real: shares
    ///      summing above 100% revert, and so does a zero-liquidity launch.
    function test_LA7_badConfigAndZeroSeedRejected() public {
        IPoolManagerMin.PoolKey memory key = _ethKey();

        vm.prank(alice);
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.launchPool{value: 150 ether}(
            key, LAUNCH_SQRT, address(token), address(0), TICK_LO, TICK_HI, _launchLiquidity(), alice,
            _cfg(0.7e18, 0, 0.4e18, alice, alice) // compound + buyback > 100% on the secondary side
        );

        vm.prank(alice);
        vm.expectRevert(IGlueHook.BadConfig.selector);
        pump.launchPool{value: 150 ether}(
            key, LAUNCH_SQRT, address(token), address(0), TICK_LO, TICK_HI, 0, alice,
            _cfg(0, 0, 0, alice, alice)
        );
    }

    /// @dev LA8 -- the admin hand-off cannot be spoofed: the PoolManager skips hook callbacks when
    ///      the hook itself is the caller, so a hook-driven initialise OUTSIDE {launchPool} (possible
    ///      only in a test, since the hook never calls initialize elsewhere) leaves an INERT pot --
    ///      admin never set, {initPot} permanently refused -- rather than one the hook itself owns.
    function test_LA8_hookInitialisedPoolStaysInert() public {
        IPoolManagerMin.PoolKey memory key = _ethKey();
        bytes32 id = keccak256(abi.encode(key));
        vm.prank(address(pump));
        IPoolManagerMin(POOL_MANAGER).initialize(key, LAUNCH_SQRT);

        assertEq(pump.potOf(id).admin, address(0), "no admin recorded");
        vm.prank(alice);
        vm.expectRevert(IGlueHook.PotNotReady.selector);
        pump.initPot(key, address(token), address(0));
    }

    /// @dev LA9 -- a launched pool is a fully working machine: the pot takes donations, the shield
    ///      absorbs a sell, and the owner's manual harvest splits real fees.
    function test_LA9_launchedPoolFullyOperational() public {
        IPoolManagerMin.PoolKey memory key = _ethKey();
        bytes32 id = keccak256(abi.encode(key));
        vm.prank(alice);
        pump.launchPool{value: 150 ether}(
            key, LAUNCH_SQRT, address(token), address(0), TICK_LO, TICK_HI, _launchLiquidity(), alice,
            _cfg(0.2e18, 0.3e18, 0, alice, alice)
        );

        // The pot funds
        vm.prank(alice);
        pump.donate{value: 5 ether}(key, 5 ether);
        assertEq(pump.potOf(id).balance, 5 ether, "pot funded");

        // Trades run and the shield fires on the sell
        token.mint(address(helper), 20_000_000e18);
        vm.recordLogs();
        helper.swap(key, true, -int256(3 ether));
        helper.swap(key, false, -int256(2_000e18));
        (bool shielded, , ) = _lastShieldedFound();
        assertTrue(shielded, "shield fired");

        // The owner's manual harvest splits real fees
        vm.prank(alice);
        (uint256 fMain, uint256 fSec) = pump.harvest(key);
        assertTrue(fMain > 0 || fSec > 0, "fees harvested");
    }

    /// @dev LA10 -- surrendered at birth: `owner == address(0)` with both sides fully claimed ships
    ///      a program nobody can edit or pull, with the manual harvest forced public.
    function test_LA10_surrenderedAtBirth() public {
        IPoolManagerMin.PoolKey memory key = _ethKey();
        bytes32 id = keccak256(abi.encode(key));
        vm.prank(alice);
        pump.launchPool{value: 150 ether}(
            key, LAUNCH_SQRT, address(token), address(0), TICK_LO, TICK_HI, _launchLiquidity(), address(0),
            _cfg(1e18, 1e18, 0, address(0), address(0)) // 100% per side: no recipient needed
        );

        IGlueHook.Program memory g = pump.programOf(id);
        assertEq(g.owner, address(0), "no owner");
        assertEq(g.operator, address(0), "no operator");
        assertTrue(g.publicHarvest, "harvest forced public");

        // Nobody can edit or pull
        vm.prank(alice);
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.setProgramConfig(id, _cfg(0, 0, 0, alice, alice));
        vm.prank(alice);
        vm.expectRevert(IGlueHook.NotAllowed.selector);
        pump.removeProgramLiquidity(key, 1e18, alice);

        // But ANYONE can harvest
        token.mint(address(helper), 20_000_000e18);
        helper.swap(key, true, -int256(3 ether));
        helper.swap(key, false, -int256(2_000e18));
        vm.prank(bob);
        pump.harvest(key);
    }

    /// @dev Wrapper around the fixture's log scanner (records were started by the caller).
    function _lastShieldedFound() internal returns (bool found, uint256 absorbed, uint256 paid) {
        return _lastShielded(vm.getRecordedLogs());
    }
}
