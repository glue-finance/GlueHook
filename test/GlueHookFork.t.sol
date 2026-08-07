// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {GlueHook} from "../contracts/GlueHook.sol";
import {IGlueHook} from "../contracts/interfaces/IGlueHook.sol";
import {GluedV4Core, IPoolManagerMin} from "../contracts/libs/GluedV4Core.sol";
import {V4PoolHelper} from "./helpers/V4PoolHelper.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/**
 * @title  GlueHookFork — the whole machine against the REAL, LIVE Uniswap V4 PoolManager.
 * @notice FK1–FK4. Every other suite etches the PoolManager bytecode into a fresh chain; this one
 *         forks a real network and drives the hook through the PoolManager that actually holds
 *         billions — real deployed code, real storage layout, real gas accounting, real tick maps
 *         shared with every live pool on the chain. The hook and its library are placed at their
 *         permission-correct addresses on the fork, a fresh hooked pool is initialised on the live
 *         singleton, and the pump, the shield, the delivery cascade and the LP program's
 *         harvest/compound split are all exercised end to end.
 *
 *         GATED: set `FORK_RPC_URL` to run (any chain with a canonical V4 PoolManager; override the
 *         manager's address with `FORK_POOL_MANAGER` if the chain uses a non-mainnet address). The
 *         suite is skipped silently when the variable is absent, so the default campaign stays
 *         offline-deterministic.
 */
contract GlueHookFork is Test {
    /// @dev The canonical Ethereum-mainnet V4 PoolManager (the default; env-overridable per chain).
    address constant MAINNET_PM = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    /// @dev An address carrying EXACTLY `beforeInitialize | beforeSwap | afterSwap | beforeSwapReturnsDelta`.
    address constant HOOK_ADDR = 0x91110000000000000000000000000000000020c8;
    /// @dev The sentinel the hook artifact is statically linked against (foundry.toml).
    address constant LIQ_LIB = 0xb0B0000000000000000000000000000000000B0B;
    address constant ETH = address(0);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint24 constant FEE = 3000;
    int24 constant SPACING = 120;
    int24 constant TICK_LO = -887160;
    int24 constant TICK_HI = 887160;
    /// @dev √(1000)·2^96 — 1000 token per ETH at launch.
    uint160 constant LAUNCH_SQRT = 2505413655765166104291548792414;

    bool forked;
    address PM;
    GlueHook pump;
    V4PoolHelper helper;
    MockERC20 token;
    IPoolManagerMin.PoolKey key;
    bytes32 id;
    address carol;
    address dave;

    function setUp() public {
        string memory url = vm.envOr("FORK_RPC_URL", string(""));
        if (bytes(url).length == 0) return; // every test below self-skips
        vm.createSelectFork(url);
        PM = vm.envOr("FORK_POOL_MANAGER", MAINNET_PM);
        require(PM.code.length > 0, "no PoolManager on this fork");
        forked = true;

        // The hook and its delegatecall library at their permission-correct addresses, on the fork
        vm.etch(LIQ_LIB, vm.getDeployedCode("GlueLiquidity.sol:GlueLiquidity"));
        deployCodeTo("GlueHook.sol:GlueHook", abi.encode(PM), HOOK_ADDR);
        pump = GlueHook(payable(HOOK_ADDR));
        helper = new V4PoolHelper(PM);

        // A fresh hooked pool on the LIVE singleton: ETH secondary, a mock main
        token = new MockERC20("Main", "MAIN", 18);
        key = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: address(token), fee: FEE, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
        id = keccak256(abi.encode(key));
        IPoolManagerMin(PM).initialize(key, LAUNCH_SQRT);
        pump.initPot(key, address(token), address(0));

        token.mint(address(helper), 20_000_000e18);
        token.mint(address(this), 10_000_000e18);
        token.approve(address(pump), type(uint256).max);
        vm.deal(address(this), 10_000 ether);
        vm.deal(address(helper), 5_000 ether);
        uint256 l0 = (100e18 * uint256(LAUNCH_SQRT)) / GluedV4Core.Q96;
        uint256 l1 = (100_000e18 * GluedV4Core.Q96) / (LAUNCH_SQRT - GluedV4Core.MIN_SQRT_RATIO);
        helper.addLiquidity(key, TICK_LO, TICK_HI, uint128(l0 < l1 ? l0 : l1));

        carol = makeAddr("forkCarol");
        dave = makeAddr("forkDave");
    }

    /// FK1 — a donated pot pumps behind a real buy on the live PoolManager, and the bought main walks
    ///       the delivery cascade to `0xdead`; the venue stays solvent throughout.
    function test_FK1_pumpOnLiveManager() public {
        vm.skip(!forked);
        pump.donate{value: 20 ether}(key, 20 ether);
        uint256 potBefore = pump.potOf(id).balance;
        uint256 deadBefore = token.balanceOf(DEAD);

        vm.recordLogs();
        helper.swap(key, true, -int256(3 ether));
        (bool pumped, uint256 spent, uint256 bought) = _lastPumped(vm.getRecordedLogs());

        assertTrue(pumped, "the pump fired inside the live swap");
        assertGt(spent, 0, "spent pot ETH");
        assertLe(spent, potBefore, "never more than the pot");
        assertGt(bought, 0, "bought main");
        assertEq(pump.potOf(id).balance, potBefore - spent, "the pot debited exactly its spend");
        assertGe(token.balanceOf(DEAD) - deadBefore, bought, "the buy landed at dead");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "the venue stays solvent");
    }

    /// FK2 — a fully-absorbed sell never touches the live pool's price: the pot takes the tokens at
    ///       the pool-equivalent quote and the seller is paid in real ETH.
    function test_FK2_shieldOnLiveManager() public {
        vm.skip(!forked);
        pump.donate{value: 50 ether}(key, 50 ether);
        uint160 priceBefore = _sqrtPrice(id);
        uint256 sellerEthBefore = address(helper).balance;

        vm.recordLogs();
        helper.swap(key, false, -int256(1_000e18));
        (bool shielded, uint256 absorbed, uint256 paid) = _lastShielded(vm.getRecordedLogs());

        assertTrue(shielded, "the shield absorbed on the live manager");
        assertEq(absorbed, 1_000e18, "the whole sell");
        assertEq(_sqrtPrice(id), priceBefore, "and the live pool's price never moved");
        assertEq(address(helper).balance - sellerEthBefore, paid, "the seller was paid the quote");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "the venue stays solvent");
    }

    /// FK3 — the LP program end to end on the live manager: advanced creation, real fee accrual, a
    ///       manual harvest running the full split (compound mint + pot fuel + burn + recipients),
    ///       every leg landing exactly.
    function test_FK3_programHarvestOnLiveManager() public {
        vm.skip(!forked);
        pump.addLiquidityAdvanced{value: 60 ether}(
            key, TICK_LO, TICK_HI, 1e21, address(this),
            IGlueHook.ProgramConfig({
                buybackShareWad: 4e17,
                burnShareWad: 25e16,
                compoundShareWad: 3e17,
                potCompoundShareWad: 0,
                potBurnShareWad: 0,
                publicHarvest: false,
                secondaryRecipient: carol,
                mainRecipient: dave,
                minMain: type(uint256).max,
                minSecondary: type(uint256).max
            })
        );
        helper.swap(key, true, -int256(5 ether));
        helper.swap(key, false, -int256(4_000e18));

        uint256 liqBefore = pump.programOf(id).liquidity;
        uint256 potBefore = pump.potOf(id).balance;
        uint256 deadBefore = token.balanceOf(DEAD);
        // DELTA, not absolute: some chains pre-fund every account's native balance with a sentinel
        // (Tempo pays gas in fee tokens and pins native balances to a constant), so a fresh EOA is
        // not zero everywhere. The conservation claim is about what the harvest PAID, not what the
        // recipient happens to hold.
        uint256 carolBefore = carol.balance;
        vm.recordLogs();
        pump.harvest(key);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (bool found, uint256 fMain, uint256 fSec, , ) = _lastHarvested(logs);
        (bool cFound, uint128 liq, uint256 u0, uint256 u1) = _lastCompounded(logs);

        assertTrue(found, "the harvest ran on the live manager");
        assertGt(fMain, 0, "real token fees");
        assertGt(fSec, 0, "real ETH fees");
        assertTrue(cFound, "the compound minted into the live position");
        assertEq(pump.programOf(id).liquidity - liqBefore, liq, "the position grew by the mint");
        // Conservation across the live split, both sides to the wei (the mint's unplaced budget
        // sits in the CARRY, waiting for the next harvest)
        assertEq(
            (pump.potOf(id).balance - potBefore) + (carol.balance - carolBefore) + u0
                + pump.programOf(id).carrySecondary,
            fSec, "ETH conserved"
        );
        assertEq(
            (token.balanceOf(DEAD) - deadBefore) + token.balanceOf(dave) + u1 + pump.programOf(id).carryMain,
            fMain, "token conserved"
        );
        assertGe(address(pump).balance, pump.obligationOf(ETH), "the venue stays solvent");
    }

    /// FK4 — the auto-harvest fires inside a real swap on the live manager once the armed minimum is
    ///       met, and the carrying swap itself still lands.
    function test_FK4_autoHarvestOnLiveManager() public {
        vm.skip(!forked);
        pump.addLiquidityAdvanced{value: 60 ether}(
            key, TICK_LO, TICK_HI, 1e21, address(this),
            IGlueHook.ProgramConfig({
                buybackShareWad: 5e17,
                burnShareWad: 0,
                compoundShareWad: 0,
                potCompoundShareWad: 0,
                potBurnShareWad: 0,
                publicHarvest: false,
                secondaryRecipient: carol,
                mainRecipient: dave,
                minMain: 1,
                minSecondary: 1
            })
        );

        uint256 potBefore = pump.potOf(id).balance;
        vm.recordLogs();
        helper.swap(key, true, -int256(5 ether)); // accrues fees
        helper.swap(key, false, -int256(4_000e18)); // meets the min -> auto-harvests in-swap
        (bool found, , uint256 fSec, , uint256 fueled) = _lastHarvested(vm.getRecordedLogs());

        assertTrue(found, "the auto-harvest fired inside a live swap");
        assertEq(fueled, (fSec * 5e17) / 1e18, "with the exact split");
        assertGt(pump.potOf(id).balance, potBefore, "and the pot got its fuel");
        assertGe(address(pump).balance, pump.obligationOf(ETH), "the venue stays solvent");
    }

    /// FK5 — the BUYBACK SPLIT on the live manager: a pump's output is carved between the program's
    ///       compound carry (25%), the burn cascade (25%) and the pot's live recipient (the exact
    ///       rest), wei-exactly, inside a real swap that still lands; custody covers every ledger.
    function test_FK5_buybackSplitOnLiveManager() public {
        vm.skip(!forked);
        address recip = makeAddr("forkRecip");
        pump.setRecipient(id, recip);
        pump.addLiquidityAdvanced{value: 60 ether}(
            key, TICK_LO, TICK_HI, 1e21, address(this),
            IGlueHook.ProgramConfig({
                buybackShareWad: 0,
                burnShareWad: 0,
                compoundShareWad: 0,
                potCompoundShareWad: 25e16,
                potBurnShareWad: 25e16,
                publicHarvest: false,
                secondaryRecipient: carol,
                mainRecipient: dave,
                minMain: type(uint256).max,
                minSecondary: type(uint256).max
            })
        );
        pump.donate{value: 20 ether}(key, 20 ether);

        uint256 deadBefore = token.balanceOf(DEAD);
        uint256 recipBefore = token.balanceOf(recip);
        uint256 carryBefore = pump.programOf(id).carryMain;

        vm.recordLogs();
        helper.swap(key, true, -int256(3 ether));
        (bool pumped, , uint256 bought) = _lastPumped(vm.getRecordedLogs());

        assertTrue(pumped, "the pump fired inside the live swap");
        uint256 comp = (bought * 25e16) / 1e18;
        uint256 burnLeg = (bought * 25e16) / 1e18;
        assertEq(pump.programOf(id).carryMain - carryBefore, comp, "a quarter joined the compound carry");
        assertEq(token.balanceOf(DEAD) - deadBefore, burnLeg, "a quarter burned through the cascade");
        assertEq(
            token.balanceOf(recip) - recipBefore, bought - comp - burnLeg, "the exact rest delivered"
        );
        assertGe(
            token.balanceOf(address(pump)),
            pump.obligationOf(address(token)),
            "main custody covers the carry"
        );
        assertGe(address(pump).balance, pump.obligationOf(ETH), "the venue stays solvent");
    }

    // ── shared log decoding ─────────────────────────────────────────────────────────

    function _lastPumped(Vm.Log[] memory logs)
        private view returns (bool found, uint256 spent, uint256 bought)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(pump)) continue;
            if (logs[i].topics[0] != keccak256("Pumped(bytes32,uint256,uint256)")) continue;
            found = true;
            (spent, bought) = abi.decode(logs[i].data, (uint256, uint256));
        }
    }

    function _lastShielded(Vm.Log[] memory logs)
        private view returns (bool found, uint256 absorbed, uint256 paid)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(pump)) continue;
            if (logs[i].topics[0] != keccak256("Shielded(bytes32,uint256,uint256)")) continue;
            found = true;
            (absorbed, paid) = abi.decode(logs[i].data, (uint256, uint256));
        }
    }

    function _lastHarvested(Vm.Log[] memory logs)
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

    function _lastCompounded(Vm.Log[] memory logs)
        private view returns (bool found, uint128 liq, uint256 u0, uint256 u1)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(pump)) continue;
            if (logs[i].topics[0] != keccak256("Compounded(bytes32,uint128,uint256,uint256)")) continue;
            found = true;
            (liq, u0, u1) = abi.decode(logs[i].data, (uint128, uint256, uint256));
        }
    }

    function _sqrtPrice(bytes32 poolId) private view returns (uint160 p) {
        bytes32 slot = keccak256(abi.encodePacked(poolId, bytes32(uint256(6))));
        p = uint160(uint256(IPoolManagerMin(PM).extsload(slot)));
    }

    receive() external payable {}
}
