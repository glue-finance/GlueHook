// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {console2} from "forge-std/console2.sol";
import {GlueHookFixture} from "./helpers/GlueHookFixture.sol";
import {IGlueHook} from "../contracts/interfaces/IGlueHook.sol";
import {IPoolManagerMin} from "../contracts/libs/GluedV4Core.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/**
 * @title  GlueHookGas -- deterministic gas measurements for the audit's cost table.
 * @notice G1-G4 measure every user-facing entry and the swap overhead under each circumstance the
 *         hook can add work to a trade: idle, pump firing, shield firing, and the full in-swap
 *         auto-harvest + compound. Every number is a `gasleft()` delta around the external call
 *         (so it includes calldata and call overhead -- what a caller actually pays on top of the
 *         venue), printed for transcription into `audit/AUDIT.md` section 11. The assertions are
 *         generous ceilings so a regression that doubles a path fails loudly while normal compiler
 *         jitter never does.
 */
contract GlueHookGas is GlueHookFixture {
    MockERC20 token;
    address alice;

    function setUp() public {
        _deployCore();
        token = new MockERC20("Main", "MAIN", 18);
        alice = makeAddr("alice");
        vm.deal(alice, 2_000 ether);
        token.mint(alice, 2_000_000e18);
        token.mint(address(helper), 20_000_000e18);
        vm.prank(alice);
        token.approve(address(pump), type(uint256).max);
    }

    function _key() internal view returns (IPoolManagerMin.PoolKey memory key) {
        key = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: address(token), fee: FEE, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
    }

    function _cfg(uint256 minMain, uint256 minSec) internal view returns (IGlueHook.ProgramConfig memory) {
        return IGlueHook.ProgramConfig({
            buybackShareWad: 0.2e18,
            burnShareWad: 0.2e18,
            compoundShareWad: 0.3e18,
            potCompoundShareWad: 0,
            potBurnShareWad: 0,
            publicHarvest: true,
            secondaryRecipient: alice,
            mainRecipient: alice,
            minMain: minMain,
            minSecondary: minSec
        });
    }

    /// @dev G1 -- the ONE-TRANSACTION launch vs the three-step path, byte-identical outcome.
    function test_G1_launchPaths() public {
        // One transaction
        IPoolManagerMin.PoolKey memory key = _key();
        uint128 seed = _launchLiquidity();
        vm.prank(alice);
        uint256 g = gasleft();
        pump.launchPool{value: 150 ether}(
            key, LAUNCH_SQRT, address(token), address(0), TICK_LO, TICK_HI, seed, alice, _cfg(type(uint256).max, type(uint256).max)
        );
        uint256 oneTx = g - gasleft();
        console2.log("launchPool (init + roles + program + seed):", oneTx);

        // Three steps, second token / fresh key
        MockERC20 t2 = new MockERC20("M2", "M2", 18);
        t2.mint(alice, 2_000_000e18);
        vm.startPrank(alice);
        t2.approve(address(pump), type(uint256).max);
        IPoolManagerMin.PoolKey memory k2 = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: address(t2), fee: FEE, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
        g = gasleft();
        IPoolManagerMin(POOL_MANAGER).initialize(k2, LAUNCH_SQRT);
        uint256 stepInit = g - gasleft();
        g = gasleft();
        pump.initPot(k2, address(t2), address(0));
        uint256 stepPot = g - gasleft();
        g = gasleft();
        pump.addLiquidityAdvanced{value: 150 ether}(k2, TICK_LO, TICK_HI, seed, alice, _cfg(type(uint256).max, type(uint256).max));
        uint256 stepAdd = g - gasleft();
        vm.stopPrank();
        console2.log("  vs initialize:", stepInit);
        console2.log("  +  initPot:", stepPot);
        console2.log("  +  addLiquidityAdvanced:", stepAdd);
        console2.log("  =  three-step total:", stepInit + stepPot + stepAdd);
        console2.log("  all-in incl. 21k base per tx -- one tx:", oneTx + 21_000);
        console2.log("                       three txs:", stepInit + stepPot + stepAdd + 63_000);

        assertLt(oneTx, 1_000_000, "launch ceiling");
        // The real comparison includes the 21,000-gas base cost of each transaction
        assertLt(oneTx + 21_000, stepInit + stepPot + stepAdd + 63_000, "one tx cheaper all-in");
    }

    /// @dev G2 -- swap overhead per circumstance: hookless baseline, hooked idle, pump, shield.
    function test_G2_swapCircumstances() public {
        // Hookless twin: the pure V4 baseline
        IPoolManagerMin.PoolKey memory twin = _openTwinPool(address(token));
        uint256 g = gasleft();
        helper.swap(twin, true, -int256(1 ether));
        uint256 baseBuy = g - gasleft();
        g = gasleft();
        helper.swap(twin, false, -int256(500e18));
        uint256 baseSell = g - gasleft();
        console2.log("V4 baseline buy / sell:", baseBuy, baseSell);

        // Hooked pool, pot EMPTY, no program: the idle overhead
        (IPoolManagerMin.PoolKey memory key, ) = _openEthPool(address(token), makeAddr("treasury"));
        g = gasleft();
        helper.swap(key, true, -int256(1 ether));
        uint256 idleBuy = g - gasleft();
        g = gasleft();
        helper.swap(key, false, -int256(500e18));
        uint256 idleSell = g - gasleft();
        console2.log("hooked idle buy / sell:", idleBuy, idleSell);
        console2.log("  idle overhead buy / sell:", idleBuy - baseBuy, idleSell - baseSell);

        // Pot funded: the pump fires on a buy, the shield on a sell
        _donateEth(key, 20 ether);
        g = gasleft();
        helper.swap(key, true, -int256(1 ether));
        uint256 pumpBuy = g - gasleft();
        g = gasleft();
        helper.swap(key, false, -int256(500e18));
        uint256 shieldSell = g - gasleft();
        console2.log("pump-firing buy:", pumpBuy);
        console2.log("shield-firing sell:", shieldSell);

        assertLt(idleBuy - baseBuy, 40_000, "idle overhead ceiling");
        assertLt(pumpBuy, baseBuy + 400_000, "pump ceiling");
        assertLt(shieldSell, baseSell + 400_000, "shield ceiling");
    }

    /// @dev G3 -- the heaviest circumstance: armed auto-harvest + compound inside the carrying swap.
    function test_G3_inSwapHarvestCompound() public {
        IPoolManagerMin.PoolKey memory key = _key();
        // Armed mins (1 wei each side), compound share live: every swap that finds pending fees
        // runs the whole harvest + split + compound mint inside the carrying transaction
        vm.prank(alice);
        pump.launchPool{value: 150 ether}(
            key, LAUNCH_SQRT, address(token), address(0), TICK_LO, TICK_HI, _launchLiquidity(), alice, _cfg(1, 1)
        );

        // Accrue fees on both sides (these two swaps also harvest, leaving a fresh pending window)
        helper.swap(key, true, -int256(5 ether));
        helper.swap(key, false, -int256(2_000e18));

        // The measured swap carries the auto-harvest of the fees the two above just accrued
        uint256 g = gasleft();
        helper.swap(key, true, -int256(1 ether));
        uint256 harvestSwap = g - gasleft();
        console2.log("swap carrying auto-harvest + compound:", harvestSwap);

        assertLt(harvestSwap, 1_200_000, "in-swap harvest ceiling");
    }

    /// @dev G4 -- steady-state entries: donate, manual harvest, add, remove, claim-shaped ops.
    function test_G4_steadyStateEntries() public {
        IPoolManagerMin.PoolKey memory key = _key();
        vm.startPrank(alice);
        pump.launchPool{value: 150 ether}(
            key, LAUNCH_SQRT, address(token), address(0), TICK_LO, TICK_HI, _launchLiquidity(), alice, _cfg(type(uint256).max, type(uint256).max)
        );

        uint256 g = gasleft();
        pump.donate{value: 5 ether}(key, 5 ether);
        uint256 gDonate = g - gasleft();
        console2.log("donate (native):", gDonate);
        vm.stopPrank();

        // Fees on both sides
        helper.swap(key, true, -int256(5 ether));
        helper.swap(key, false, -int256(2_000e18));

        vm.startPrank(alice);
        g = gasleft();
        pump.harvest(key);
        uint256 gHarvest = g - gasleft();
        console2.log("manual harvest (split + compound + payouts):", gHarvest);

        g = gasleft();
        pump.addProgramLiquidity{value: 10 ether}(key, 1e20);
        uint256 gAdd = g - gasleft();
        console2.log("addProgramLiquidity:", gAdd);

        g = gasleft();
        pump.removeProgramLiquidity(key, 1e20, alice);
        uint256 gRemove = g - gasleft();
        console2.log("removeProgramLiquidity:", gRemove);
        vm.stopPrank();

        assertLt(gDonate, 120_000, "donate ceiling");
        assertLt(gHarvest, 900_000, "harvest ceiling");
    }
}
