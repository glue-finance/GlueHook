// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {GlueHook} from "../contracts/GlueHook.sol";
import {GluedV4Core, IPoolManagerMin} from "../contracts/libs/GluedV4Core.sol";
import {V4PoolHelper} from "./helpers/V4PoolHelper.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {GlueHookHandler} from "./handlers/GlueHookHandler.sol";

/**
 * @title  GlueHookInvariant — stateful fuzzing of the buyback hook against a REAL Uniswap V4 pool.
 * @notice The hook's two mechanics both settle inside somebody else's swap, and both move value that
 *         belongs to donors. That combination is what makes a stateful campaign worth running: a unit
 *         test sees a successful swap and a happy swapper, and cannot see that the hook's books stopped
 *         matching its balances three fills ago. So this campaign interleaves donations, buys and sells
 *         (exact-input and exact-output) in arbitrary order and asserts:
 *
 *   PP1 POT SOLVENCY        the hook's balance of the secondary covers everything it says it owes
 *   PP2 CONSERVATION        pot + Σ shield payouts + Σ pump spends == Σ donations, exactly. Every wei
 *                           that ever entered a pot is either still there or was spent by a mechanic
 *                           that logged it — the hook cannot lose or invent secondary.
 *   PP3 PRICE UNTOUCHED     a sell the pot absorbed IN FULL left the pool's price bit-identical. This is
 *                           the shield's whole purpose: supply that never reaches the pool
 *   PP4 PUMP BOUNDED        no pump ever spent more secondary than the buy that carried it, so the pot
 *                           can never be drained faster than real demand arrives
 *   PP5 MAIN ATTRIBUTED     every unit of main the hook holds is parked and accounted for; nothing the
 *                           two mechanics acquired is sitting on the hook unowned
 *   PP6 DELIVERY IDENTITY   Σ main acquired == Σ main delivered: burned, dead-sent, held, or parked
 *
 * Plus a deterministic anti-vacuity walk, since the handler swallows reverts and every invariant above
 * is trivially true over an empty world.
 *
 * @dev The real PoolManager is etched from the same Sepolia runtime bytecode the Hardhat fixture injects,
 *      so both layers fuzz the identical venue. The hook itself is deployed to an address carrying the
 *      four permission bits the PoolManager reads out of a hook's address, which is what a real
 *      deployment mines a CREATE2 salt for.
 */
contract GlueHookInvariant is StdInvariant, Test {
    /// @dev The Sepolia PoolManager slot the Hardhat fixture also uses.
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    /// @dev An address carrying EXACTLY `beforeInitialize | beforeSwap | afterSwap | beforeSwapReturnsDelta`.
    address constant HOOK_ADDR = 0x91110000000000000000000000000000000020c8;
    address constant ETH = address(0);
    uint24 constant FEE = 3000;
    int24 constant SPACING = 120;
    int24 constant TICK_LO = -887160;
    int24 constant TICK_HI = 887160;
    /// @dev √(1000)·2^96 — a launch price of 1000 token per ETH, matching the Hardhat fixture.
    uint160 constant LAUNCH_SQRT = 2505413655765166104291548792414;

    GlueHook pump;
    MockERC20 token;
    V4PoolHelper helper;
    GlueHookHandler handler;
    bytes32 poolId;

    function setUp() public {
        // The real venue, etched from the same bytecode the Hardhat fixture injects.
        vm.etch(POOL_MANAGER, _poolManagerRuntime());

        // The linked GlueLiquidity library, at the foundry.toml sentinel the artifact points to.
        vm.etch(
            0xb0B0000000000000000000000000000000000B0B,
            vm.getDeployedCode("GlueLiquidity.sol:GlueLiquidity")
        );

        // The hook, at an address whose low bits ARE its permissions. `deployCodeTo` runs the real
        // constructor, so the immutables are baked in exactly as a mined CREATE2 deployment would.
        deployCodeTo("GlueHook.sol:GlueHook", abi.encode(POOL_MANAGER), HOOK_ADDR);
        pump = GlueHook(payable(HOOK_ADDR));
        assertEq(uint160(HOOK_ADDR) & GluedV4Core.ALL_HOOK_MASK, pump.REQUIRED_HOOK_FLAGS(), "hook bits");

        token = new MockERC20("PumpMain", "PMN", 18);
        helper = new V4PoolHelper(POOL_MANAGER);

        // THIS contract initialises the pool, so it is the pot's admin and can declare the roles:
        // the token is the defended main, native ETH the secondary the pot spends.
        IPoolManagerMin.PoolKey memory key = _key();
        poolId = keccak256(abi.encode(key));
        IPoolManagerMin(POOL_MANAGER).initialize(key, LAUNCH_SQRT);
        pump.initPot(key, address(token), address(0));

        // Seed the pool and stock the helper deeply enough that it is never the binding constraint.
        vm.deal(address(this), 20_000 ether);
        vm.deal(address(helper), 5_000 ether);
        token.mint(address(helper), 20_000_000e18);
        helper.addLiquidity(key, TICK_LO, TICK_HI, _launchLiquidity());

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
        // ETH is address(0), so it is always currency0 and the token is always currency1
        k = IPoolManagerMin.PoolKey({
            currency0: ETH, currency1: address(token), fee: FEE, tickSpacing: SPACING, hooks: HOOK_ADDR
        });
    }

    /**
     * @dev Full-range liquidity implied by 100 ETH against 100_000 token at the launch price. Over a range
     *      this wide the upper bound is effectively infinite, so the token-0 leg collapses to `x·√P` and
     *      the token-1 leg to `y/√P` — the exact V3/V4 formulas with the negligible `1/√P_upper` term
     *      dropped, which only ever under-states liquidity and so can never over-draw the seeder.
     */
    function _launchLiquidity() internal pure returns (uint128) {
        uint256 l0 = (100e18 * uint256(LAUNCH_SQRT)) / GluedV4Core.Q96;
        uint256 l1 = (100_000e18 * GluedV4Core.Q96) / (LAUNCH_SQRT - GluedV4Core.MIN_SQRT_RATIO);
        return uint128(l0 < l1 ? l0 : l1);
    }

    /**
     * @dev The PoolManager's runtime bytecode, read out of the SAME fixture the Hardhat suites use so the
     *      two layers can never drift onto different venues. The file is a TypeScript module whose only
     *      quoted string is the bytecode, so splitting on the quote character extracts it exactly.
     */
    function _poolManagerRuntime() internal view returns (bytes memory) {
        string[] memory parts = vm.split(
            vm.readFile("test/fixtures/v4PoolManagerBytecode.ts"), "\""
        );
        require(parts.length >= 2, "pm bytecode fixture");
        return vm.parseBytes(parts[1]);
    }

    // ── INVARIANTS ──────────────────────────────────────────────────────────────────────────────

    // PP1 — the hook can always honour every pot it hosts. Nothing else it does is meaningful if a
    // donor's secondary is not actually there.
    function invariant_PP1_potSolvency() public view {
        assertGe(handler.secondaryHeld(), handler.secondaryOwed(), "PP1: the hook owes more than it holds");
    }

    // PP2 — the secondary ledger closes exactly. Both mechanics debit the pot before they move anything,
    // so a fill that failed halfway would show up here as a shortfall or a surplus. The pot's only
    // inflows are donations and harvest fuel (zero in this program-less campaign; the program-armed
    // campaign asserts the same identity with real fuel).
    function invariant_PP2_conservation() public view {
        assertEq(
            handler.potBalance() + handler.ghostShieldPaid() + handler.ghostPumpSpent(),
            handler.ghostDonated() + handler.ghostFueled(),
            "PP2: pot + payouts + pump spends != donations + harvest fuel"
        );
    }

    // PP3 — the shield's reason to exist: supply it absorbs in full never touches the pool, so the price
    // cannot move. A violation would mean part of an "absorbed" sell reached the pool anyway.
    function invariant_PP3_priceUntouchedOnFullAbsorb() public view {
        assertFalse(handler.fullAbsorbMovedPrice(), "PP3: a fully absorbed sell still moved the price");
    }

    // PP4 — the pump is demand-following by construction. Spending more than the buy that triggered it
    // is the shape every pot-draining attack has to take.
    function invariant_PP4_pumpBoundedByItsBuy() public view {
        assertFalse(handler.pumpOutranBuy(), "PP4: a pump spent more than the buy that carried it");
    }

    // PP5 — main is never held loose. Whatever the cascade could not deliver is parked, and parked is
    // exactly what the hook's balance is: no residue, no rounding crumbs, nothing unowned.
    function invariant_PP5_mainAttributed() public view {
        assertEq(
            token.balanceOf(address(pump)),
            pump.parkedOf(address(token)) + pump.heldOf(address(token)),
            "PP5: the hook holds main it has not accounted for"
        );
    }

    // PP6 — delivery identity: every unit of main the two mechanics acquired left through the cascade,
    // to the burn address, or sits attributed on the hook (held or parked). None of it evaporates.
    function invariant_PP6_deliveryIdentity() public view {
        uint256 acquired = handler.ghostPumpBought() + handler.ghostAbsorbed();
        uint256 delivered = token.balanceOf(0x000000000000000000000000000000000000dEaD)
            + pump.parkedOf(address(token)) + pump.heldOf(address(token));
        assertEq(delivered, acquired, "PP6: acquired main != delivered main");
    }

    // ── ANTI-VACUITY ────────────────────────────────────────────────────────────────────────────

    /// @notice Drive every action once and prove each landed, so the invariants above are asserted over a
    ///         world that contains real donations, real pumps and real shield fills.
    function test_coverage_handlerActionsLand() public {
        handler.donate(0, 40 ether);
        assertEq(handler.donations(), 1, "the donation landed");
        assertEq(handler.potBalance(), 40 ether, "and credited the pot");

        handler.buy(3 ether);
        assertEq(handler.buys(), 1, "the buy landed");
        assertGt(handler.pumps(), 0, "and it pumped");
        assertGt(handler.ghostPumpBought(), 0, "which bought main");

        handler.sell(2_000e18);
        assertEq(handler.sells(), 1, "the sell landed");
        assertGt(handler.shields(), 0, "and it shielded");
        assertGt(handler.fullAbsorbs(), 0, "the pot took the whole sell");

        handler.sellExactOut(1 ether);
        assertGt(handler.exactOutSells(), 0, "the exact-output branch landed");

        // The two mechanics have now both moved value, and every ledger still closes
        assertGt(handler.ghostShieldPaid(), 0, "the shield paid a seller");
        assertGt(handler.ghostPumpSpent(), 0, "the pump spent from the pot");
        invariant_PP1_potSolvency();
        invariant_PP2_conservation();
        invariant_PP3_priceUntouchedOnFullAbsorb();
        invariant_PP4_pumpBoundedByItsBuy();
        invariant_PP5_mainAttributed();
        invariant_PP6_deliveryIdentity();
    }

    /// @notice A pot far smaller than the sell it faces must absorb what it can afford, hand the rest to
    ///         the pool, and end EMPTY — never overdrawn, never stuck holding an unspendable remainder.
    ///         Walk it explicitly rather than hoping the fuzzer lands on the boundary.
    function test_coverage_thinPotAbsorbsPartiallyAndEmpties() public {
        handler.donate(1, 0.05 ether);
        uint256 funded = handler.potBalance();
        assertGt(funded, 0, "the pot is funded");

        handler.sell(60_000e18);
        assertGt(handler.shields(), 0, "the thin pot still filled what it could");
        assertEq(handler.potBalance(), 0, "and spent itself to the wei");
        assertEq(handler.ghostShieldPaid(), funded, "paying out exactly what it held");
        assertGt(handler.partialAbsorbs(), 0, "the pool took the remainder");
        invariant_PP1_potSolvency();
        invariant_PP2_conservation();
        invariant_PP6_deliveryIdentity();
    }

    /// @notice An UNFUNDED pot must be completely invisible: both mechanics stand aside and the pool
    ///         behaves as though the hook were not there. This is the passthrough guarantee every pool
    ///         adopting the hook relies on before anybody has donated.
    function test_coverage_emptyPotIsInvisible() public {
        assertEq(handler.potBalance(), 0, "starting empty");
        uint160 before = handler.sqrtPrice();

        handler.buy(2 ether);
        handler.sell(1_000e18);

        assertEq(handler.pumps(), 0, "no pump without a pot");
        assertEq(handler.shields(), 0, "no shield without a pot");
        assertTrue(handler.sqrtPrice() != before, "and both swaps went through the pool");
        assertEq(token.balanceOf(0x000000000000000000000000000000000000dEaD), 0, "nothing was burned");
    }
}
