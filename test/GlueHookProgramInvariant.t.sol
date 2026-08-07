// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {GlueHook} from "../contracts/GlueHook.sol";
import {IGlueHook} from "../contracts/interfaces/IGlueHook.sol";
import {GluedV4Core, IPoolManagerMin} from "../contracts/libs/GluedV4Core.sol";
import {V4PoolHelper} from "./helpers/V4PoolHelper.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {GlueHookHandler} from "./handlers/GlueHookHandler.sol";

/**
 * @title  GlueHookProgramInvariant — the stateful campaign with the LP PROGRAM ARMED.
 * @notice {GlueHookInvariant} fuzzes the pot's two mechanics over a bare pool. This campaign runs the
 *         SAME random walk — donations, buys, sells in both modes, arbitrary order — over a pool whose
 *         LP program is live and armed for in-swap auto-harvest with every split leg switched on at
 *         once: a compound share (with its CARRY), a buyback share fuelling the pot mid-walk, a burn
 *         share walking the cascade, and live per-side recipients being pushed real money inside the
 *         swaps. Everything the program does happens INSIDE the swaps the fuzzer throws, interleaved
 *         with pumps and shields in the same frames — which is exactly where a bookkeeping slip
 *         between the four ledgers (pot, carry, owed, parked/held) would hide from unit tests.
 *
 *   PI1 ETH SOLVENCY        the hook's ETH balance covers `obligationOf(ETH)` — pots + carry + owed
 *   PI2 TOKEN SOLVENCY      the hook's token balance covers `obligationOf(token)`
 *   PI3 MAIN ATTRIBUTED     every unit of main on the hook is parked, held, carried, or owed — sharper
 *                           than PP5 because the program adds two new ways to hold main
 *   PI4 POT CONSERVATION    pot + Σ shield payouts + Σ pump spends == Σ donations + Σ harvest fuel:
 *                           the harvest's buyback leg is a REAL pot inflow and the identity still
 *                           closes exactly
 *   PI5 DELIVERY IDENTITY   Σ main acquired (pump + shield + harvest burn legs) == Σ main delivered
 *                           (dead + parked + held + the buyback split's compound credits)
 *                           (dead + parked + held) — the burn cascade loses nothing under load
 *   PI6 LIQUIDITY MONOTONE  the program's liquidity NEVER decreases: nobody removes, so the armed
 *                           auto-compound may only grow the position or stand still
 *
 * Plus a deterministic anti-vacuity walk proving harvests, compounds, fuel, burns and recipient pushes
 * all actually happened under the invariants.
 *
 * @dev Same real PoolManager bytecode, same mined hook address, same handler as the base campaign —
 *      only the program is new. Recipients are fresh EOAs so pushes land (the bounced-push path has
 *      its own deterministic and fuzz coverage: L9, A11, FM9).
 */
contract GlueHookProgramInvariant is StdInvariant, Test {
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant HOOK_ADDR = 0x91110000000000000000000000000000000020c8;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address constant ETH = address(0);
    uint24 constant FEE = 3000;
    int24 constant SPACING = 120;
    int24 constant TICK_LO = -887160;
    int24 constant TICK_HI = 887160;
    uint160 constant LAUNCH_SQRT = 2505413655765166104291548792414;
    uint128 constant SEED_LIQ = 1e21;

    GlueHook pump;
    MockERC20 token;
    V4PoolHelper helper;
    GlueHookHandler handler;
    bytes32 poolId;
    address carol; // secondary (ETH) recipient
    address dave; // main (token) recipient

    /// @dev The LP entry refunds its excess native leg to the caller.
    receive() external payable {}

    function setUp() public {
        vm.etch(POOL_MANAGER, _poolManagerRuntime());
        vm.etch(
            0xb0B0000000000000000000000000000000000B0B,
            vm.getDeployedCode("GlueLiquidity.sol:GlueLiquidity")
        );
        deployCodeTo("GlueHook.sol:GlueHook", abi.encode(POOL_MANAGER), HOOK_ADDR);
        pump = GlueHook(payable(HOOK_ADDR));

        token = new MockERC20("PumpMain", "PMN", 18);
        helper = new V4PoolHelper(POOL_MANAGER);
        carol = makeAddr("program_carol");
        dave = makeAddr("program_dave");

        IPoolManagerMin.PoolKey memory key = _key();
        poolId = keccak256(abi.encode(key));
        IPoolManagerMin(POOL_MANAGER).initialize(key, LAUNCH_SQRT);
        pump.initPot(key, address(token), address(0));

        vm.deal(address(this), 20_000 ether);
        vm.deal(address(helper), 5_000 ether);
        token.mint(address(helper), 20_000_000e18);
        helper.addLiquidity(key, TICK_LO, TICK_HI, _launchLiquidity());

        // The program, armed to run EVERY leg inside the fuzzer's own swaps: 40% compound on both
        // sides, 30% buyback fuel, 30% burn — the sides sum to 70%, so both recipients also see a
        // real remainder every harvest. minMain/minSecondary of 1 arms the auto-trigger on any fee.
        token.mint(address(this), 10_000_000e18);
        token.approve(address(pump), type(uint256).max);
        pump.addLiquidityAdvanced{value: 100 ether}(
            key, TICK_LO, TICK_HI, SEED_LIQ, address(this),
            IGlueHook.ProgramConfig({
                buybackShareWad: uint64(3e17),
                burnShareWad: uint64(3e17),
                compoundShareWad: uint64(4e17),
                potCompoundShareWad: uint64(25e16),
                potBurnShareWad: uint64(25e16),
                publicHarvest: true,
                secondaryRecipient: carol,
                mainRecipient: dave,
                minMain: 1,
                minSecondary: 1
            })
        );

        handler = new GlueHookHandler(pump, token, helper, key);

        bytes4[] memory sel = new bytes4[](4);
        sel[0] = GlueHookHandler.donate.selector;
        sel[1] = GlueHookHandler.buy.selector;
        sel[2] = GlueHookHandler.sell.selector;
        sel[3] = GlueHookHandler.sellExactOut.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
        targetContract(address(handler));
    }

    function _key() internal view returns (IPoolManagerMin.PoolKey memory k) {
        k = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: address(token), fee: FEE, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
    }

    function _launchLiquidity() internal pure returns (uint128) {
        uint256 l0 = (100e18 * uint256(LAUNCH_SQRT)) / GluedV4Core.Q96;
        uint256 l1 = (100_000e18 * GluedV4Core.Q96) / (LAUNCH_SQRT - GluedV4Core.MIN_SQRT_RATIO);
        return uint128(l0 < l1 ? l0 : l1);
    }

    function _poolManagerRuntime() internal view returns (bytes memory) {
        string[] memory parts = vm.split(
            vm.readFile("test/fixtures/v4PoolManagerBytecode.ts"), "\""
        );
        require(parts.length >= 2, "pm bytecode fixture");
        return vm.parseBytes(parts[1]);
    }

    // ── INVARIANTS ──────────────────────────────────────────────────────────────────────────────

    // PI1 — ETH custody covers the full ETH obligation: the pot, the program's secondary-side carry,
    // and any owed backlog. Solvency is the one claim every other property leans on.
    function invariant_PI1_ethSolvency() public view {
        assertGe(address(pump).balance, pump.obligationOf(ETH), "PI1: ETH balance < ETH obligation");
    }

    // PI2 — same claim on the main side: the token balance covers the main-side carry, parked, held
    // and owed, all of which the armed program feeds during the walk.
    function invariant_PI2_tokenSolvency() public view {
        assertGe(
            token.balanceOf(address(pump)),
            pump.obligationOf(address(token)),
            "PI2: token balance < token obligation"
        );
    }

    // PI3 — main is never held loose, with the program's two new holders in the identity: whatever
    // the hook has in main is EXACTLY parked + held + the compound carry + the owed backlog.
    function invariant_PI3_mainAttributed() public view {
        assertEq(
            token.balanceOf(address(pump)),
            pump.parkedOf(address(token)) + pump.heldOf(address(token))
                + pump.programOf(poolId).carryMain + pump.owedOf(dave, address(token)),
            "PI3: the hook holds main it has not attributed"
        );
    }

    // PI4 — the pot's ledger closes exactly with the harvest fuel counted as an inflow: donations and
    // buyback legs in, shield payouts and pump spends out, the rest still sitting in the pot.
    function invariant_PI4_potConservation() public view {
        assertEq(
            handler.potBalance() + handler.ghostShieldPaid() + handler.ghostPumpSpent(),
            handler.ghostDonated() + handler.ghostFueled(),
            "PI4: pot + payouts + spends != donations + fuel"
        );
    }

    // PI5 — delivery identity under program load: everything the pump bought, the shield absorbed and
    // the harvests burned is at dead, parked, held, or was credited to the compound carry by the
    // BUYBACK SPLIT (this campaign runs a live 25%/25% pot split, so the compound leg is a real
    // term). The cascade loses nothing when it runs inside the same frames as harvests and compounds.
    function invariant_PI5_deliveryIdentity() public view {
        uint256 acquired = handler.ghostPumpBought() + handler.ghostAbsorbed() + handler.ghostBurned();
        uint256 delivered = token.balanceOf(DEAD) + pump.parkedOf(address(token))
            + pump.heldOf(address(token)) + handler.ghostPotCompounded();
        assertEq(delivered, acquired, "PI5: acquired main != delivered main");
    }

    // PI6 — nobody removes liquidity in this campaign, so the armed auto-compound may only ever grow
    // the position. A single decrease anywhere in the walk latches the flag.
    function invariant_PI6_liquidityMonotone() public view {
        assertFalse(handler.liquidityShrank(), "PI6: the program's liquidity decreased");
    }

    // ── ANTI-VACUITY ────────────────────────────────────────────────────────────────────────────

    /// @notice Drive the walk deterministically and prove every program mechanism actually fired —
    ///         harvests, compounds (liquidity strictly above seed), pot fuel, burn legs, and real
    ///         recipient pushes — so the invariants above are asserted over a loaded world.
    function test_coverage_programMechanismsLand() public {
        // A modest pot, deliberately smaller than the big sell below: a fully-shielded sell never
        // reaches the pool and accrues NO main-side LP fees, so the burn leg needs a partial absorb
        handler.donate(0, 10 ether);
        // Round trips: each swap accrues fees and the NEXT one auto-harvests them (mins are 1 wei)
        handler.buy(5 ether);
        handler.sell(60_000e18); // outsizes the pot -> the pool takes the remainder -> main fees
        handler.buy(4 ether);
        handler.sell(2_000e18);
        handler.buy(3 ether);

        assertGt(handler.harvests(), 0, "auto-harvests fired inside the fuzzed swaps");
        assertGt(handler.ghostFueled(), 0, "the buyback legs really fueled the pot");
        assertGt(handler.ghostBurned(), 0, "the burn legs really ran");
        assertGt(pump.programOf(poolId).liquidity, SEED_LIQ, "the auto-compound grew the position");
        assertGt(carol.balance, 0, "the secondary recipient was paid inside the swaps");
        assertGt(token.balanceOf(dave), 0, "and the main recipient too");
        assertGt(handler.pumps(), 0, "pumps still fire alongside the program");
        assertGt(handler.shields(), 0, "and shields too");
        assertGt(handler.ghostPotCompounded(), 0, "the buyback split's compound leg really fired");

        invariant_PI1_ethSolvency();
        invariant_PI2_tokenSolvency();
        invariant_PI3_mainAttributed();
        invariant_PI4_potConservation();
        invariant_PI5_deliveryIdentity();
        invariant_PI6_liquidityMonotone();
    }
}
