// SPDX-License-Identifier: BUSL-1.1
//
// Licensed Work: GlueHook
// The Licensed Work is (c) 2026 gluefinance.eth and is owned exclusively by Glue Labs Inc. (Delaware).
// Licensor: Glue Labs Inc. (Delaware)
// Change Date: the earlier of 2030-08-05 or a date specified at gluehook-license-date.gluefinance.eth
// Change License: GNU General Public License v2.0 or later
// Full licence text: https://github.com/glue-finance/GlueHook/blob/main/LICENCE.txt

pragma solidity ^0.8.35;

import {GluedV4Core, GluedV4Callback, IPoolManagerMin} from "./libs/GluedV4Core.sol";
import {GluedMath} from "./libs/GluedMath.sol";
import {GlueLiquidity} from "./libs/GlueLiquidity.sol";
import {IGlueHook} from "./interfaces/IGlueHook.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/**
 *  ██████╗ ██╗     ██╗   ██╗███████╗██╗  ██╗ ██████╗  ██████╗ ██╗  ██╗
 * ██╔════╝ ██║     ██║   ██║██╔════╝██║  ██║██╔═══██╗██╔═══██╗██║ ██╔╝
 * ██║  ███╗██║     ██║   ██║█████╗  ███████║██║   ██║██║   ██║█████╔╝
 * ██║   ██║██║     ██║   ██║██╔══╝  ██╔══██║██║   ██║██║   ██║██╔═██╗
 * ╚██████╔╝███████╗╚██████╔╝███████╗██║  ██║╚██████╔╝╚██████╔╝██║  ██╗
 *  ╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝
 *
 * @title  GlueHook - Uniswap V4 buyback-and-burn hook with auto-compounding LP fee programs
 * @author @lalilulel0x - La Li Lu Le Lo
 * @notice One hook singleton hosting a permissionless donation POT for every pool that adopts it: the
 *         pot pumps on buys and shields on sells, and everything it buys is delivered to the pot's
 *         recipient — `address(0)` means BURN, so the default configuration is buy-and-burn. Each pool
 *         may additionally run one LP PROGRAM: a hook-held liquidity position whose trading fees are
 *         auto-harvested inside swaps and split off the GROSS of each side — a COMPOUND share re-minted
 *         into the position (the auto-compounding concentrated-liquidity venues lack natively), a
 *         buyback share fuelling the pot, a burn share through the cascade, the rest to one recipient
 *         per side; what the compound mint cannot place is carried and retried at every next harvest.
 * @dev    ROLES. A hooked pool names one of its two currencies MAIN (the asset being defended, bought
 *         back and delivered) and the other becomes SECONDARY (the buyback currency, the only asset the
 *         pot holds and the only asset {donate} accepts). Either side may be main and either may be
 *         native, so the hook is pair-agnostic — a token quoted in ETH is one configuration, not a rule.
 *
 *         ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 *         │  PUMP — afterSwap, on a SECONDARY → MAIN buy                                             │
 *         │                                                                                          │
 *         │  The pot buys main in the buyer's own transaction and delivers it. The spend is capped at│
 *         │  `fee·depth` — the size below which sandwiching the pump costs more in fees than the     │
 *         │  price move is worth, whatever the attacker's own size — and at the secondary the buy    │
 *         │  itself just paid, so a dust buy unlocks only a dust pump. The swap runs in a self-call, │
 *         │  so a pool state that would make the pump revert skips the pump instead of breaking the  │
 *         │  buyer's swap.                                                                           │
 *         ├──────────────────────────────────────────────────────────────────────────────────────────┤
 *         │  SHIELD — beforeSwap, on a MAIN → SECONDARY sell                                         │
 *         │                                                                                          │
 *         │  The pot absorbs the sell at the EXACT price the pool would have executed it at — LP fee │
 *         │  and tick impact included, computed with {GluedV4Core.computeSwapStep}, the pool's own   │
 *         │  arithmetic. The seller is therefore indifferent between the pot and the pool, the pool's│
 *         │  price does not move, and the absorbed main is delivered instead of hitting the pool.    │
 *         │  A pot that cannot cover the whole sell absorbs the slice it can afford and the remainder│
 *         │  swaps through the pool in the same call.                                                │
 *         └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 *         WHY THE SHIELD CANNOT BE PLAYED. Pricing the fill at the pool's own execution price is the
 *         whole security model. An internal fill priced at spot (no fee, no impact) would be strictly
 *         better than the pool, so an attacker could move spot inside their own transaction and drain
 *         the pot at an artificial price; pricing at pool execution removes the edge entirely, with no
 *         oracle and no TWAP. Three further guards come with it:
 *
 *           1. Zero-rounding — if either leg of the fill rounds to zero the fill is skipped, because a
 *              one-sided settlement is not something the hook can balance.
 *           2. Direction pinning — the fill is bounded by the next initialized tick in the direction of
 *              travel, never by the swapper's own `sqrtPriceLimitX96`, so a supplied limit can never
 *              flip the inferred direction and swap the roles of the two legs.
 *           3. Reserve bound — the fill is skipped unless the PoolManager actually holds the main being
 *              taken, so a pot far larger than its pool can never brick that pool's swaps.
 *
 *         The swapper's own `sqrtPriceLimitX96` and their router's minimum-output check still apply to
 *         the total, so the shield can only ever add to what a sell receives, never subtract.
 *
 *         WHY THE PUMP CANNOT BE PLAYED. A pump is a market buy that somebody else's transaction
 *         triggers, which is the exact shape of a sandwich victim: buy in front of it, let it lift the
 *         price, sell behind it. That attack earns `2·X·V/R` and costs `2·f·X` in fees (`X` the
 *         attacker's size, `V` the pump's spend, `R` the pool's depth, `f` its fee), so the attacker's
 *         own size cancels and the attack pays if and only if `V > f·R`. The pump therefore refuses to
 *         spend more than `f·R` in a single pass, which closes the attack for every attacker size, pot
 *         depth and price at once. A second, softer cap keeps the spend inside the secondary the carrying
 *         buy actually paid, so the pot tracks real demand rather than arriving all at once. See
 *         {_pumpSize}.
 *
 *         DELIVERY & THE BUYBACK SPLIT. A pot names a recipient for the main it buys and absorbs;
 *         `address(0)` means BURN. When the pool carries an LP PROGRAM, the pot's output first runs
 *         the BUYBACK SPLIT (operator-set in the program config, both shares zero by default):
 *         `potCompoundShareWad` joins the program's main-side compound carry — buy pressure becoming
 *         the pool's own liquidity at the next harvest's mint — `potBurnShareWad` joins the burn
 *         cascade, and the EXACT rest follows the pot's recipient as an unsplit delivery would. A
 *         live recipient is delivered to directly — a bounded-gas send for native main, a plain
 *         transfer for an ERC20 — and a refusal parks the main here, retryable any time through
 *         {flushDirect}. A pot whose main is the NETWORK TOKEN must always name a live recipient,
 *         because the network token cannot be burned ({initPot}/{setRecipient} enforce it, and the
 *         split's burn share is rejected on it too). A burn runs a cascade that can never revert a
 *         swap: the token's own `burn` (verified by a balance drop), then a transfer to `0xdead`,
 *         then — for a token that is neither burnable nor dead-sendable — the amount is HELD on the
 *         hook FOREVER. There is no withdrawal path, so custody IS the burn: a held balance is out of
 *         circulation as surely as a `0xdead` balance. The first fall-through flags the asset
 *         {unburnable}, so later burns of it skip the probes and settle straight to the held ledger.
 *
 *         LP PROGRAM & AUTO-COMPOUNDING. The pot admin may create the pool's single hook-held liquidity
 *         position ({addLiquidity} plain, {addLiquidityAdvanced} with full rules at creation). Its fees
 *         are harvested automatically inside `afterSwap` once they reach the configured minimums (a
 *         try/catch self-call — a heavy harvest never reverts the carrying swap) or manually through
 *         {harvest}. Every share is a fraction of the GROSS fees of its side (`compound + buyback` and
 *         `compound + burn` each capped at 100% at set-time): the buyback share fuels the pot, the burn
 *         share runs the cascade, and the exact remainder of each side goes to its one recipient. The
 *         COMPOUND budget — `compoundShareWad` of both sides PLUS whatever earlier mints could not
 *         place — is re-minted into the position at the live price, the auto-compounding V3/V4 never
 *         gave LPs natively, powered by the same no-keeper, no-oracle, traffic-driven trigger as the
 *         buyback. Whichever side binds caps the mint, and the unplaced rest goes back into the CARRY,
 *         retried at every next harvest — it never leaks to the pot or a recipient. A failed mint
 *         abandons the compound alone; a config edit only shapes future harvests.
 *         Two independent roles govern it — the OWNER holds the property (liquidity, harvest, transfer),
 *         the OPERATOR edits the rules — and either surrenders to `address(0)` without dragging the
 *         other down. The engine lives in the {GlueLiquidity} delegatecall library.
 *
 *         ACCOUNTING. Every unit the hook holds is attributed: {obligationOf} sums every pot denominated
 *         in an asset plus anything parked, held, or owed in it, and the hook's balance of that asset is
 *         always at least that sum. There is no withdrawal path for any of them.
 */
contract GlueHook is GluedV4Callback, IGlueHook {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTANTS & IMMUTABLES
    // ═══════════════════════════════════════════════════════════════════════════════

    /// @dev Native currency sentinel — V4 keys the network token as `address(0)`.
    address private constant ETH_ADDRESS = address(0);

    /// @notice The permission bits a GlueHook address must carry: `beforeInitialize`, `beforeSwap`,
    ///         `afterSwap` and the `beforeSwap` delta return.
    /// @dev The PoolManager reads a hook's permissions from the low 14 bits of its address, so the hook
    ///      must be CREATE2-mined to an address whose low bits equal EXACTLY this value.
    uint160 public constant REQUIRED_HOOK_FLAGS = GluedV4Core.BEFORE_INITIALIZE_FLAG
        | GluedV4Core.BEFORE_SWAP_FLAG
        | GluedV4Core.AFTER_SWAP_FLAG
        | GluedV4Core.BEFORE_SWAP_RETURNS_DELTA_FLAG;

    /// @dev Share of the capped spend the pump actually uses (8_000 = 80%). The 20% it leaves behind is
    ///      what puts the spend strictly INSIDE the sandwich break-even rather than exactly on it, plus
    ///      headroom against the sizing quote drifting from real execution.
    uint256 private constant PUMP_HAIRCUT_BPS = 8_000;
    /// @dev Basis-point denominator.
    uint256 private constant BPS = 10_000;
    /// @dev Uniswap's fee denominator: a pool fee is expressed in millionths.
    uint256 private constant FEE_DENOMINATOR = 1_000_000;
    /// @dev The pump's own output floor is its quote shaved by 1 ppm — a rounding allowance, not slippage
    ///      tolerance: the quote is the pool's own arithmetic run in the same transaction.
    uint256 private constant MIN_OUT_SHAVE = 1e6;
    /// @dev Largest fill either leg may carry, since a `BeforeSwapDelta` leg is a signed 128-bit value.
    uint256 private constant MAX_LEG = uint256(uint128(type(int128).max));

    // ═══════════════════════════════════════════════════════════════════════════════
    // STORAGE
    // ═══════════════════════════════════════════════════════════════════════════════

    /// @dev poolId => the pool's buyback pot.
    mapping(bytes32 => Pot) private _pots;
    /// @dev poolId => the pool's LP PROGRAM: the one hook-held liquidity position and its split rules.
    mapping(bytes32 => Program) private _programs;
    /// @dev The delivery and attribution ledgers ({IGlueHook.Ledgers}): pot totals, parked, held,
    ///      unburnable flags, owed backlogs and the compound-carry totals — ONE storage struct so
    ///      the {GlueLiquidity} delivery engine shares them through a single pointer. Every field
    ///      is an {obligationOf} term (or a flag), and none has a withdrawal path beyond its own
    ///      documented exit ({flushDirect}, {claim}, the compound mint).
    Ledgers private _ledgers;

    // ═══════════════════════════════════════════════════════════════════════════════
    // SETUP
    // ═══════════════════════════════════════════════════════════════════════════════

    /// @notice Deploy the hook against a fixed PoolManager.
    /// @dev Must be deployed at an address whose low 14 bits equal {REQUIRED_HOOK_FLAGS}; the
    ///      constructor asserts it, so a mis-mined deployment fails at deploy time rather than at the
    ///      first `initialize`.
    /// @param _poolManager The Uniswap V4 PoolManager on this chain.
    constructor(address _poolManager) GluedV4Callback(_poolManager) {
        // The address itself carries the hook's permissions — a wrong one is unusable
        if (uint160(address(this)) & GluedV4Core.ALL_HOOK_MASK != REQUIRED_HOOK_FLAGS) revert BadRoles();
    }

    /// @dev Transient-storage reentrancy guard, slot derived per deployment.
    modifier guarded() {
        _lockGuard();
        _;
        assembly ("memory-safe") { tstore(GUARD_SLOT, 0) }
    }

    /// @dev The transient reentrancy-guard slot: `keccak256("GlueHook.guard")` (a literal because
    ///      inline assembly only accepts direct number constants).
    bytes32 private constant GUARD_SLOT = 0x165848338463d30c17057f5abfcc323310dd08e72aea99ae6ce410ff3a16adf0;

    /// @dev The guard's entry half, shared by every guarded entry instead of inlined into each.
    function _lockGuard() private {
        assembly ("memory-safe") {
            if tload(GUARD_SLOT) {
                // Reentrancy()
                mstore(0x00, 0xab143c06)
                revert(0x1c, 0x04)
            }
            tstore(GUARD_SLOT, 1)
        }
    }

    /// @notice Accept native currency so the hook can hold a native pot and be paid by `PoolManager.take`.
    receive() external payable {}

    // ═══════════════════════════════════════════════════════════════════════════════
    // HOOK CALLBACKS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Record the pool's initialiser as its pot admin.
     * @dev The only way to become a pot's admin: whoever calls `PoolManager.initialize` on a pool that
     *      names this hook owns that pot's configuration. The roles themselves come later through
     *      {initPot}, because `beforeInitialize` carries no hook data to put them in. A pool launched
     *      through {launchPool} never reaches this callback at all — the PoolManager skips hook calls
     *      when the hook itself is the caller — so {launchPool} records its own caller as the admin.
     * @param sender The address that called `PoolManager.initialize`.
     * @param key The pool being initialised.
     * @return The callback's own selector, as the PoolManager requires.
     */
    function beforeInitialize(address sender, IPoolManagerMin.PoolKey calldata key, uint160)
        external returns (bytes4)
    {
        // Only the PoolManager may drive a hook callback
        if (msg.sender != POOL_MANAGER) revert NotAllowed();

        bytes32 id = _idOf(key);
        // A pool can only be initialised once, so this can only be written once
        _pots[id].admin = sender;
        emit PotOpened(id, sender);
        return this.beforeInitialize.selector;
    }

    /**
     * @notice The shield: absorb a main → secondary sell at the pool's own execution price.
     * @dev Returns a `BeforeSwapDelta` that shrinks the pool leg by the absorbed input and credits the
     *      seller with the pot's payout. Every path that cannot produce a balanced, pool-exact fill
     *      returns a zero delta, which leaves the swap to the pool untouched.
     * @param sender The address that called `PoolManager.swap`.
     * @param key The pool key.
     * @param params The swap parameters.
     * @return selector The callback's own selector.
     * @return hookDelta The packed `BeforeSwapDelta` (zero when the shield does not fire).
     * @return lpFeeOverride Always zero — the hook never overrides the pool's fee.
     */
    function beforeSwap(
        address sender,
        IPoolManagerMin.PoolKey calldata key,
        IPoolManagerMin.SwapParams calldata params,
        bytes calldata
    ) external returns (bytes4 selector, int256 hookDelta, uint24 lpFeeOverride) {
        // Only the PoolManager may drive a hook callback
        if (msg.sender != POOL_MANAGER) revert NotAllowed();
        selector = this.beforeSwap.selector;
        // The pot's own swaps are never shielded (the PoolManager skips them too; belt and braces)
        if (sender == address(this)) return (selector, 0, 0);

        bytes32 id = _idOf(key);
        Pot storage p = _pots[id];
        // An unconfigured or empty pot leaves the pool exactly as it found it
        if (!p.configured || p.balance == 0) return (selector, 0, 0);

        // Selling main means trading it for secondary — the only direction the shield touches
        bool mainIsZero = p.main == key.currency0;
        if (params.zeroForOne != mainIsZero) return (selector, 0, 0);

        (uint256 absorbed, uint256 paid) = _shieldQuote(key, mainIsZero, p.balance, params.amountSpecified);
        // Zero-rounding guard: a one-sided fill cannot be settled
        if (absorbed == 0 || paid == 0) return (selector, 0, 0);
        // A delta leg is a signed 128-bit value
        if (absorbed > MAX_LEG || paid > MAX_LEG) return (selector, 0, 0);

        _fillShield(id, p, absorbed, paid);

        // The specified currency is the swapper's input on an exact-input swap and their output on an
        // exact-output one, so the two legs swap places between the branches.
        hookDelta = params.amountSpecified < 0
            ? GluedV4Core.toBeforeSwapDelta(int128(int256(absorbed)), -int128(int256(paid)))
            : GluedV4Core.toBeforeSwapDelta(-int128(int256(paid)), int128(int256(absorbed)));
    }

    /**
     * @notice After every swap on a configured pool: harvest the LP program if armed, pump on a buy,
     *         then place everything in ONE batched send phase.
     * @dev Order matters and is deliberate:
     *
     *        1. AUTO-HARVEST — when the pool carries a program whose pending fees reach a min, collect
     *           and split them (the compound budget — slice + carry — re-mints into the program's own position in the same
     *           frame). Runs FIRST so the harvest's buyback share is in the pot before the pump sizes
     *           itself — a fresh fee credit is pump-able in the same swap. Behind a try/catch
     *           self-call ({executeHarvest}), so it can never revert the carrying swap.
     *        2. PUMP — on a secondary → main buy, spend pot secondary on more main. The spend is capped
     *           against the carrying buy's own input, so the pump is never large enough to sandwich.
     *           {executePump} BOOKS what it bought instead of delivering it.
     *        3. BATCHED SEND PHASE — the only external sends in the frame, after ALL bookkeeping: the
     *           harvest's burn leg and the pump's burn-intent output merge into ONE cascade walk, the
     *           pump's direct delivery and the harvest's main leg merge into ONE push when they share a
     *           recipient, and the secondary leg goes out last. A refusal parks or books, never reverts.
     *
     *      The whole callback is `guarded`: a recipient re-entering during its bounded send hits the
     *      transient guard on every state-bearing entry, including a nested `afterSwap`.
     * @param sender The address that called `PoolManager.swap`.
     * @param key The pool key.
     * @param params The swap parameters.
     * @param delta The swapper's balance delta for the swap that just executed.
     * @return selector The callback's own selector.
     * @return hookDelta Always zero — the pump is the hook's own swap, not a delta on the buyer's.
     */
    function afterSwap(
        address sender,
        IPoolManagerMin.PoolKey calldata key,
        IPoolManagerMin.SwapParams calldata params,
        int256 delta,
        bytes calldata
    ) external guarded returns (bytes4 selector, int128 hookDelta) {
        // Only the PoolManager may drive a hook callback
        if (msg.sender != POOL_MANAGER) revert NotAllowed();
        selector = this.afterSwap.selector;
        // The pump must never pump its own pump (and a harvest collect never swaps at all)
        if (sender == address(this)) return (selector, 0);

        bytes32 id = _idOf(key);
        Pot storage p = _pots[id];
        // An unconfigured pot has no roles, so neither the harvest split nor the pump can run
        if (!p.configured) return (selector, 0);

        bool mainIsZero = p.main == key.currency0;

        // 1. AUTO-HARVEST — fires on any swap direction; credits the pot before the pump reads it
        (uint256 burnLeg, uint256 mainLeg, uint256 secLeg) = _autoHarvest(id, key, mainIsZero);

        // 2. PUMP — only on a buy of main, only against a funded pot
        uint256 pumpBought;
        if (p.balance != 0 && params.zeroForOne != mainIsZero) {
            // The secondary the buyer just paid is the yardstick the pump is capped against. Both legs
            // are in the delta, so it is read rather than quoted: the main leg must be a credit (they
            // really did receive main) and the secondary leg a debit (they really did pay for it).
            (int128 d0, int128 d1) = _unpackDelta(delta);
            (int128 mainDelta, int128 secondaryDelta) = mainIsZero ? (d0, d1) : (d1, d0);
            if (mainDelta > 0 && secondaryDelta < 0) {
                (uint256 spend, uint256 minOut) =
                    _pumpSize(key, p.main, p.balance, uint256(uint128(-secondaryDelta)));
                if (spend != 0) {
                    // Self-call: a revert in here rolls back the pump alone, never the buyer's swap
                    try this.executePump(id, key, !mainIsZero, spend, minOut) returns (uint256 bought) {
                        pumpBought = bought;
                    } catch {}
                }
            }
        }

        // 3. BATCHED SEND PHASE — nothing above pushed anything; everything below only pushes.
        // The pump's output runs the BUYBACK SPLIT inside {GlueLiquidity.place}: the compound leg
        // joins the program's carry, the burn leg and the harvest's merge into ONE cascade walk,
        // and the exact rest follows the pot's recipient.
        GlueLiquidity.place(p, _programs[id], _ledgers, id, burnLeg, mainLeg, secLeg, pumpBought);
    }

    /**
     * @notice The pump's swap, isolated in its own call frame.
     * @dev Self-only. Runs inside the buyer's unlock, so it swaps through {_swapInUnlock} rather than
     *      opening an unlock of its own. Reverting here is a valid outcome: it undoes the pot debit and
     *      the swap together and leaves the carrying transaction alone. The bought main stays on the
     *      hook — {afterSwap}'s batched send phase places it, merged with the harvest legs.
     * @param id The pool identifier.
     * @param key The pool key.
     * @param zeroForOne Direction of the pump's buy.
     * @param spend Secondary to spend.
     * @param minOut Output floor derived from the pool's own arithmetic.
     * @return bought Main acquired, held here for the caller's send phase.
     */
    function executePump(
        bytes32 id,
        IPoolManagerMin.PoolKey calldata key,
        bool zeroForOne,
        uint256 spend,
        uint256 minOut
    ) external returns (uint256 bought) {
        // Only reachable from {afterSwap}
        if (msg.sender != address(this)) revert NotAllowed();

        Pot storage p = _pots[id];
        address secondary = p.secondary;
        // Debit before spending, so nothing re-entered can see the money twice
        p.balance -= spend;
        _ledgers.potTotal[secondary] -= spend;

        uint256 used;
        (used, bought) = _swapInUnlock(key, zeroForOne, spend);

        // Return anything the pool did not take
        if (used < spend) {
            uint256 back = spend - used;
            p.balance += back;
            _ledgers.potTotal[secondary] += back;
        }

        // The floor is the pool's own quote minus a rounding allowance; missing it means the quote and
        // the execution disagree, so the whole pump is abandoned.
        if (bought < minOut) revert QuoteMismatch();

        emit Pumped(id, used, bought);
    }

    /**
     * @notice The auto-harvest's collect-and-split, isolated in its own call frame.
     * @dev Self-only, delegating to {GlueLiquidity}. Runs inside the swapper's unlock, so it
     *      collects with a direct zero-delta `modifyLiquidity` rather than opening an unlock of its
     *      own. Splits the fees off the gross of each side — buyback share into the pot, the
     *      compound budget (this slice + the carry) re-minted into the program's position, burn
     *      share and the two recipient legs RETURNED for the caller's batched send phase — but
     *      sends nothing itself. Reverting here skips the harvest and leaves the carrying swap
     *      alone; the fees stay safely uncollected in the position.
     * @param id The pool identifier.
     * @param key The pool key.
     * @param mainIsZero True when the pot's main is `currency0`.
     * @return burnLeg Main-side slice for the burn cascade.
     * @return mainLeg Main-side slice for the program's main recipient.
     * @return secLeg Secondary-side slice for the program's secondary recipient.
     */
    function executeHarvest(bytes32 id, IPoolManagerMin.PoolKey calldata key, bool mainIsZero)
        external returns (uint256 burnLeg, uint256 mainLeg, uint256 secLeg)
    {
        // Only reachable from {afterSwap}
        if (msg.sender != address(this)) revert NotAllowed();

        Program storage g = _programs[id];
        (uint256 f0, uint256 f1) = GlueLiquidity.collectInSwap(POOL_MANAGER, g, key);
        (uint256 fMain, uint256 fSec) = mainIsZero ? (f0, f1) : (f1, f0);
        return GlueLiquidity.splitHarvest(_pots[id], g, _ledgers, id, key, fMain, fSec, true);
    }

    /**
     * @notice The harvest's compound mint, isolated in its own call frame.
     * @dev Self-only, delegating to {GlueLiquidity-compound}. Converts the compound budget (this
     *      harvest's slice + the standing carry) into liquidity at the LIVE price across the
     *      program's own fixed range — anchored on whichever side binds — and mints it into the
     *      program's position, settled from the hook's own balance (the fees the harvest frame just
     *      took plus the carried funds it already held). The mint may NEVER consume more than the
     *      budget put on the table: a round-up edge abandons the whole compound (the split's
     *      try/catch leaves the budget in the carry) rather than touching a wei of pot, parked,
     *      held or owed money.
     * @param id The pool identifier.
     * @param key The pool key.
     * @param amount0 Currency0 budget (the compound slice + carry on that side).
     * @param amount1 Currency1 budget.
     * @param inUnlock True when the PoolManager is already unlocked (the in-swap frame).
     * @return used0 Currency0 the mint actually consumed.
     * @return used1 Currency1 the mint actually consumed.
     */
    function executeCompound(
        bytes32 id,
        IPoolManagerMin.PoolKey calldata key,
        uint256 amount0,
        uint256 amount1,
        bool inUnlock
    ) external returns (uint256 used0, uint256 used1) {
        // Only reachable from a harvest split
        if (msg.sender != address(this)) revert NotAllowed();
        return GlueLiquidity.compound(_programs[id], POOL_MANAGER, id, key, amount0, amount1, inUnlock);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Declare a hooked pool's roles. One-shot, and only the pool's initialiser may call it.
     * @dev Until this runs the hook does nothing on the pool: no shield, no pump, and {donate}
     *      reverts. `main` must be one of the key's two currencies; the other becomes `secondary`
     *      automatically. When `main` is the NETWORK TOKEN the recipient must be a live address —
     *      the network token cannot be burned, so burn intent (`address(0)`) is rejected. The body
     *      lives in {GlueLiquidity.initPot} (delegatecall: same storage, same `msg.sender`, so the
     *      admin gate is unchanged).
     * @param key The pool key (must already be initialised through this hook).
     * @param main The currency to defend, buy back and deliver.
     * @param recipient Where bought / absorbed main goes; `address(0)` means burn (ERC20 main only).
     */
    function initPot(IPoolManagerMin.PoolKey calldata key, address main, address recipient) external {
        bytes32 id = _idOf(key);
        GlueLiquidity.initPot(_pots[id], key, id, main, recipient);
    }

    /**
     * @notice Launch a hooked pool in ONE transaction: initialise the pool on the PoolManager,
     *         declare the pot's roles and create the LP program with its seed liquidity.
     * @dev The caller becomes the pot admin, exactly as if they had called `PoolManager.initialize`
     *      themselves. The capture is sound because the PoolManager SKIPS hook callbacks when the
     *      hook itself is the caller: `beforeInitialize` never runs here, a successful initialise
     *      proves the pool was fresh (so the admin slot is provably virgin — only the callback, one
     *      shot per pool, could ever have written it), and this entry records its own caller
     *      instead. The {initPot} and {addLiquidityAdvanced} bodies then run with the same
     *      validation, events and funding rules as the standalone entries: `main` must be one of
     *      the key's two currencies, a native-main pot must name a live recipient, the config's
     *      per-side shares must fit, and the seed settles from the caller — an ERC20 side from
     *      their allowance to this hook, a native side (always `currency0`) from `msg.value` with
     *      the unused excess refunded. Reverts if the pool already exists, and a failure anywhere
     *      rolls the WHOLE launch back (no pool, no pot, nothing half-created). Pools that want the
     *      three steps separately (or no program at all) can still run them individually.
     * @param key The pool key (must name this hook).
     * @param sqrtPriceX96 The pool's initial sqrt price, Q64.96.
     * @param main The currency to defend, buy back and deliver.
     * @param recipient Where bought / absorbed main goes; `address(0)` means burn (ERC20 main only).
     * @param tickLower Lower tick, `(0,0)` = full range.
     * @param tickUpper Upper tick.
     * @param liquidity Liquidity units to mint as the program's seed.
     * @param owner The program's owner and first operator (`address(0)` = surrendered at birth).
     * @param config The split rules (see {IGlueHook.ProgramConfig}).
     * @return amount0 Currency0 the position consumed.
     * @return amount1 Currency1 the position consumed.
     */
    function launchPool(
        IPoolManagerMin.PoolKey calldata key,
        uint160 sqrtPriceX96,
        address main,
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        address owner,
        ProgramConfig calldata config
    ) external payable guarded returns (uint256 amount0, uint256 amount1) {
        // The key must name this hook, or the initialise below would create a pool the hook never sees
        if (key.hooks != address(this)) revert BadRoles();

        // A successful initialise proves the pool is FRESH — and since the PoolManager skips hook
        // callbacks when the hook itself is the caller, `beforeInitialize` never ran and the pot's
        // admin slot is still virgin: record the launcher directly, exactly what the callback would
        // have recorded had they initialised the pool themselves
        IPoolManagerMin(POOL_MANAGER).initialize(key, sqrtPriceX96);
        bytes32 id = _idOf(key);
        _pots[id].admin = msg.sender;
        emit PotOpened(id, msg.sender);

        // Declare the roles with the library's full one-shot validation — inside the delegatecall
        // `msg.sender` is the launcher, the admin just recorded
        GlueLiquidity.initPot(_pots[id], key, id, main, recipient);

        // Create the program and seed its liquidity, exactly as {addLiquidityAdvanced} would
        return GlueLiquidity.createProgram(
            _pots[id], _programs[id], POOL_MANAGER, id, key, tickLower, tickUpper, liquidity, owner, config
        );
    }

    /**
     * @notice Move where a pot delivers the main it buys.
     * @dev Admin-only. `address(0)` means burn (runs the burn cascade); any other value is a
     *      literal delivery target. A native-main pot can never be pointed at burn. The body lives
     *      in {GlueLiquidity.setRecipient}.
     * @param poolId The pool identifier.
     * @param recipient The new recipient (`address(0)` = burn).
     */
    function setRecipient(bytes32 poolId, address recipient) external {
        GlueLiquidity.setRecipient(_pots[poolId], poolId, recipient);
    }

    /**
     * @notice Retry the delivery of main that was parked because the pot's live recipient refused it.
     *         Permissionless.
     * @dev Sends the pool's whole direct-parked balance to the pot's CURRENT recipient (the admin may
     *      have moved it since the park — the pot's recipient is always the source of truth). Reverts if
     *      there is nothing parked for the pool, the pot has since been pointed at burn, or the recipient
     *      refuses again (the park is left intact for a later attempt).
     * @param poolId The pool whose direct-parked main is retried.
     * @return delivered The amount delivered to the pot's recipient.
     */
    function flushDirect(bytes32 poolId) external guarded returns (uint256 delivered) {
        return GlueLiquidity.flushDirect(_pots[poolId], _ledgers, poolId);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // FUNDING
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Fund a pot with its SECONDARY currency. Permissionless.
     * @dev Native secondary: attach the donation as value and pass `amount == msg.value`. ERC20
     *      secondary: attach no value and approve this hook first — the credit is the measured
     *      balance delta, so a fee-on-transfer token credits exactly what arrived. The pot's main
     *      can never be donated: the credit is always denominated in secondary.
     * @param key The pool key whose pot is funded.
     * @param amount The donation amount.
     * @return credited The amount actually added to the pot.
     */
    function donate(IPoolManagerMin.PoolKey calldata key, uint256 amount)
        external payable guarded returns (uint256 credited)
    {
        bytes32 id = _idOf(key);
        Pot storage p = _pots[id];
        // Nothing can be funded before the roles exist — otherwise there is no "secondary" to credit
        if (!p.configured) revert PotNotReady();

        address secondary = p.secondary;
        // A native pot is funded with value, an ERC20 pot with an allowance — never both, never neither
        if (secondary == ETH_ADDRESS ? msg.value != amount : msg.value != 0) revert BadDonation();

        // Measured credit, so a fee-on-transfer secondary books exactly what arrived
        credited = _pullToken(secondary, msg.sender, address(this), amount);
        if (credited == 0) revert BadDonation();

        p.balance += credited;
        _ledgers.potTotal[secondary] += credited;
        emit Donated(id, msg.sender, credited);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // LP PROGRAM — LIQUIDITY
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Create the pool's LP program with EVERYTHING OFF and seed its liquidity. Pot-admin
     *         only.
     * @dev The normal entry: shares at zero, both recipients defaulting to `owner`, auto-harvest
     *      disarmed — a plain hook-held position whose {harvest} simply pays the owner. The owner
     *      can turn any rule on later with {setProgramConfig}. ONE program per pool; the tick range
     *      is fixed here forever (pass `(0,0)` for full range).
     *
     *      FUNDING. `liquidity` is in the pool's own liquidity units. An ERC20 side settles the
     *      EXACT amount the position needs straight from the caller's allowance to this hook; a
     *      native side (always `currency0`) is prepaid with `msg.value` and the unused excess
     *      refunded — the attached value is a hard cap, since the hook's own inventory is pot money
     *      and never funds a position. The body lives in {GlueLiquidity.createProgram}.
     * @param key The pool key (pot must be configured — the roles define the split's two sides).
     * @param tickLower Lower tick, `(0,0)` = full range.
     * @param tickUpper Upper tick.
     * @param liquidity Liquidity units to mint.
     * @param owner The program's owner and first operator (must be live here: this entry's default
     *              recipients ARE the owner, and a payable leg needs a live recipient).
     * @return amount0 Currency0 the position consumed.
     * @return amount1 Currency1 the position consumed.
     */
    function addLiquidity(
        IPoolManagerMin.PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        address owner
    ) external payable guarded returns (uint256 amount0, uint256 amount1) {
        bytes32 id = _idOf(key);
        return GlueLiquidity.createProgram(
            _pots[id], _programs[id], POOL_MANAGER, id, key, tickLower, tickUpper, liquidity, owner,
            // Everything off: no shares (the buyback split included — the pot's output keeps
            // following the pot's own recipient, where `address(0)` means burn), both recipients
            // the owner, auto-harvest disarmed
            ProgramConfig({
                buybackShareWad: 0,
                burnShareWad: 0,
                compoundShareWad: 0,
                potCompoundShareWad: 0,
                potBurnShareWad: 0,
                publicHarvest: false,
                secondaryRecipient: owner,
                mainRecipient: owner,
                minMain: type(uint256).max,
                minSecondary: type(uint256).max
            })
        );
    }

    /**
     * @notice Create the pool's LP program with FULL RULES at creation and seed its liquidity.
     *         Pot-admin only.
     * @dev Same mechanics as {addLiquidity} plus the split config, validated here. The owner is
     *      also the first operator. `owner == address(0)` ships the program fully surrendered from
     *      birth: rules nobody can ever edit, liquidity nobody can ever pull, manual harvest forced
     *      public. For frozen rules WITHOUT giving up the pool, name a live owner and zero the
     *      operator afterwards ({setProgramOperator}). The body lives in
     *      {GlueLiquidity.createProgram}.
     * @param key The pool key (pot must be configured).
     * @param tickLower Lower tick, `(0,0)` = full range.
     * @param tickUpper Upper tick.
     * @param liquidity Liquidity units to mint.
     * @param owner The program's owner and first operator (`address(0)` = surrendered at birth).
     * @param config The split rules (see {IGlueHook.ProgramConfig}).
     * @return amount0 Currency0 the position consumed.
     * @return amount1 Currency1 the position consumed.
     */
    function addLiquidityAdvanced(
        IPoolManagerMin.PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        address owner,
        ProgramConfig calldata config
    ) external payable guarded returns (uint256 amount0, uint256 amount1) {
        bytes32 id = _idOf(key);
        return GlueLiquidity.createProgram(
            _pots[id], _programs[id], POOL_MANAGER, id, key, tickLower, tickUpper, liquidity, owner, config
        );
    }

    /**
     * @notice Add liquidity to an existing program. Owner only.
     * @dev Pending fees are harvested FIRST — through the program's own split — so the add settles
     *      pure principal. Same funding mechanics as {addLiquidity}; the tick range is the
     *      program's own. The mint lives in {GlueLiquidity.mintLiquidity}.
     * @param key The pool key.
     * @param liquidity Liquidity units to mint.
     * @return amount0 Currency0 the position consumed.
     * @return amount1 Currency1 the position consumed.
     */
    function addProgramLiquidity(IPoolManagerMin.PoolKey calldata key, uint128 liquidity)
        external payable guarded returns (uint256 amount0, uint256 amount1)
    {
        bytes32 id = _idOf(key);
        Program storage g = _ownedProgram(id);

        // Harvest first, so the add settles pure principal and the fees route through the split
        _harvestInto(id, key);
        return GlueLiquidity.mintLiquidity(g, POOL_MANAGER, id, key, liquidity);
    }

    /**
     * @notice Remove liquidity from the program and send the principal to `to`. Owner only — a
     *         live owner can ALWAYS withdraw; an ownerless program's liquidity is locked forever.
     * @dev Pending fees are harvested FIRST through the split, so the removal delta is pure
     *      principal. Never lockable: the property always has a live holder or nobody at all.
     * @param key The pool key.
     * @param liquidity Liquidity units to remove.
     * @param to Receives both principal legs.
     * @return amount0 Currency0 principal returned.
     * @return amount1 Currency1 principal returned.
     */
    function removeProgramLiquidity(IPoolManagerMin.PoolKey calldata key, uint128 liquidity, address to)
        external guarded returns (uint256 amount0, uint256 amount1)
    {
        bytes32 id = _idOf(key);
        // Owner-gated and NEVER lockable: the property always has a live holder
        Program storage g = _ownedProgram(id);
        if (liquidity == 0 || liquidity > g.liquidity || to == address(0)) revert BadConfig();

        // Harvest first, so the removal delta is pure principal and the fees route through the split
        _harvestInto(id, key);

        // Book before moving: nothing re-entered can see the liquidity twice
        g.liquidity -= liquidity;
        GluedV4Core.RemoveLiquidityResult memory res =
            _removeLiquidityV4(key, liquidity, address(this), to, g.tickLower, g.tickUpper);
        emit ProgramLiquidityRemoved(id, liquidity, res.ethReceived, res.tokenReceived, to);
        return (res.ethReceived, res.tokenReceived);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // LP PROGRAM — RULES
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Replace the program's split rules. Operator only (impossible once the operator role
     *         was set to `address(0)`).
     * @dev Validated like the advanced entry ({GlueLiquidity.applyConfig}): each side's shares sum
     *      to at most 100%, no burn share on a native main, a live recipient behind every leg that
     *      can carry value. An edit only shapes FUTURE harvests — nothing already split or carried
     *      is re-touched, and the standing compound carry keeps retrying under the new rules.
     * @param poolId The pool identifier.
     * @param config The new split rules.
     */
    function setProgramConfig(bytes32 poolId, ProgramConfig calldata config) external {
        Program storage g = _programs[poolId];
        if (!g.exists) revert PotNotReady();
        // The OPERATOR edits the rules; a zeroed operator role means frozen forever, since
        // `msg.sender` is never zero
        if (msg.sender != g.operator) revert NotAllowed();
        GlueLiquidity.applyConfig(g, _pots[poolId].main, config);
        emit ProgramConfigured(poolId, config);
    }

    /**
     * @notice Move the operator role — the settings editor. Operator only.
     * @dev `address(0)` freezes the split rules FOREVER without touching the owner's property: the
     *      owner keeps adding, removing and harvesting under rules nobody can ever change. This is
     *      the immutable-rules promise; there is deliberately no way back, and deliberately no
     *      liquidity lock attached to it. The body lives in {GlueLiquidity.setOperator}.
     * @param poolId The pool identifier.
     * @param newOperator The new settings editor (`address(0)` = frozen forever).
     */
    function setProgramOperator(bytes32 poolId, address newOperator) external {
        GlueLiquidity.setOperator(_programs[poolId], poolId, newOperator);
    }

    /**
     * @notice Transfer the program's ownership — the property itself. Owner only.
     * @dev The new owner takes the liquidity rights (add/remove/harvest); the operator role does
     *      NOT travel with it. `address(0)` surrenders the property: the liquidity locks forever
     *      and the manual harvest is forced public so an ownerless program never strands its fees.
     *      Richer custody policy — timelocks, vesting, DAO control — is built ON TOP by
     *      transferring ownership to a contract that implements it (a locker simply becomes the
     *      owner). The body lives in {GlueLiquidity.transferOwnership}.
     * @param poolId The pool identifier.
     * @param newOwner The new property holder (`address(0)` = liquidity locked forever).
     */
    function transferProgramOwnership(bytes32 poolId, address newOwner) external {
        GlueLiquidity.transferOwnership(_programs[poolId], poolId, newOwner);
    }

    /// @dev The pool's program, gated to its live owner (the property holder).
    function _ownedProgram(bytes32 poolId) private view returns (Program storage g) {
        g = _programs[poolId];
        if (!g.exists) revert PotNotReady();
        if (msg.sender != g.owner) revert NotAllowed();
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // LP PROGRAM — HARVEST & PAYOUTS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Collect the program's accrued LP fees and run the split. Owner-only unless the
     *         config's `publicHarvest` opens it to anyone.
     * @dev The SAME path the auto-harvest runs — every share off the gross of its side: buyback to
     *      the pot, burn through the cascade, the compound budget (slice + carry) into the
     *      position, remainders pushed to the recipients (refusals booked for {claim} or the next
     *      push) — so the rules apply whether or not the auto-trigger is armed. Runs with the
     *      caller's full gas, which also makes it the natural path for heavy tokens. The
     *      auto-harvest stays inherently public whatever this gate says: any swap that meets the
     *      mins triggers it.
     * @param key The pool key.
     * @return mainFees Fees collected on the main side.
     * @return secondaryFees Fees collected on the secondary side.
     */
    function harvest(IPoolManagerMin.PoolKey calldata key)
        external guarded returns (uint256 mainFees, uint256 secondaryFees)
    {
        bytes32 id = _idOf(key);
        Program storage g = _programs[id];
        // Nothing staked: nothing to collect
        if (g.liquidity == 0) revert PotNotReady();
        // Owner-only unless the config opened it to anyone
        if (!g.publicHarvest && msg.sender != g.owner) revert NotAllowed();
        return _harvestInto(id, key);
    }

    /**
     * @notice Pull everything booked to the caller in `asset`. Full-gas, reverting delivery.
     * @dev The claimer chose to be here, so a refusal reverts and leaves the book intact — unlike
     *      the harvest's bounded pushes, which never revert and book refusals here.
     * @param asset The asset to claim.
     * @return amount The amount delivered.
     */
    function claim(address asset) external guarded returns (uint256 amount) {
        amount = _ledgers.owed[msg.sender][asset];
        if (amount == 0) revert PotNotReady();

        // Book first; the send below reverts on failure and undoes it
        delete _ledgers.owed[msg.sender][asset];
        _ledgers.owedTotal[asset] -= amount;
        // Full-gas, reverting delivery: the claimer chose to be here
        _sendToken(asset, msg.sender, amount);
        emit Claimed(msg.sender, asset, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // VIEWS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// @notice A pool's pot.
    /// @param poolId The pool identifier.
    /// @return pot The full pot record.
    function potOf(bytes32 poolId) external view returns (Pot memory pot) {
        return _pots[poolId];
    }

    /// @notice A pool's LP program.
    /// @param poolId The pool identifier.
    /// @return program The full program record.
    function programOf(bytes32 poolId) external view returns (Program memory program) {
        return _programs[poolId];
    }

    /// @notice Harvest legs booked to `to` in `asset` after refused pushes, claimable via {claim}.
    /// @param to The recipient.
    /// @param asset The asset.
    /// @return amount The claimable backlog.
    function owedOf(address to, address asset) external view returns (uint256 amount) {
        return _ledgers.owed[to][asset];
    }

    /// @notice Main that a live recipient refused and that therefore sits on the hook, retryable
    ///         through {flushDirect}.
    /// @param asset The main currency.
    /// @return amount Parked amount, summed across pools.
    function parkedOf(address asset) external view returns (uint256 amount) {
        return _ledgers.parked[asset];
    }

    /// @notice Burn-intent main that is neither burnable nor dead-sendable, held here FOREVER.
    /// @dev The hook's terminal sink: there is no withdrawal path, so custody IS the burn — the
    ///      amount is out of circulation as surely as a `0xdead` balance. Once an asset lands here
    ///      it is flagged unburnable and its burn probes are never run again.
    /// @param asset The main currency.
    /// @return amount Held amount.
    function heldOf(address asset) external view returns (uint256 amount) {
        return _ledgers.held[asset];
    }

    /// @notice The subset of {parkedOf} (in the pool's main) that a live recipient refused and that
    ///         is retryable through {flushDirect}.
    /// @param poolId The pool identifier.
    /// @return amount Parked refused-delivery amount.
    function parkedDirectOf(bytes32 poolId) external view returns (uint256 amount) {
        return _ledgers.parkedDirect[poolId];
    }

    /// @notice Everything the hook owes on an asset: every pot holding it, anything parked or held
    ///         in it, every harvest leg booked in it for a recipient, and every program's compound
    ///         carry denominated in it.
    /// @dev The hook's balance of `asset` is always at least this — every unit it holds is
    ///      attributed. There is no withdrawal path for any term.
    /// @param asset The asset to account.
    /// @return amount Total obligation.
    function obligationOf(address asset) external view returns (uint256 amount) {
        Ledgers storage L = _ledgers;
        return L.potTotal[asset] + L.parked[asset] + L.held[asset] + L.owedTotal[asset] + L.carryTotal[asset];
    }

    /**
     * @notice Preview what the shield would do to a sell right now.
     * @dev Mirrors the live `beforeSwap` decision, so a UI or a test can quote the pot's fill
     *      without executing a swap. Returns zeros when the pot is unconfigured, empty, or the sell
     *      is not in the shielded direction.
     * @param key The pool key.
     * @param amountSpecified The swap amount in V4's convention: negative for exact input, positive
     *        for exact output.
     * @return absorbed Main the pot would take out of the sell.
     * @return paid Secondary the pot would pay for it.
     */
    function quoteShield(IPoolManagerMin.PoolKey calldata key, int256 amountSpecified)
        external view returns (uint256 absorbed, uint256 paid)
    {
        Pot storage p = _pots[_idOf(key)];
        // Mirror the live gate: an unconfigured or empty pot fills nothing
        if (!p.configured || p.balance == 0) return (0, 0);
        return _shieldQuote(key, p.main == key.currency0, p.balance, amountSpecified);
    }

    /**
     * @notice Preview the pump a buy of this size would trigger right now.
     * @dev Mirrors the live `afterSwap` sizing ({_pumpSize}): the fee ceiling `f·R`, the demand
     *      ceiling of the carrying buy, the haircut, and the pool-exact output floor.
     * @param key The pool key.
     * @param userAmountIn The secondary the carrying buy pays, which is the pump's demand ceiling.
     * @return spend Secondary the pot would spend.
     * @return minOut The output floor the pump would enforce on itself.
     */
    function quotePump(IPoolManagerMin.PoolKey calldata key, uint256 userAmountIn)
        external view returns (uint256 spend, uint256 minOut)
    {
        Pot storage p = _pots[_idOf(key)];
        // Mirror the live gate: an unconfigured or empty pot buys nothing
        if (!p.configured || p.balance == 0) return (0, 0);
        return _pumpSize(key, p.main, p.balance, userAmountIn);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // INTERNAL — LP PROGRAM
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @dev The auto-harvest trigger, run on every swap of a configured pool. Cheap when idle: one
     *      program read gates everything, and the pending-fee computation only runs on pools that
     *      actually carry liquidity. Fires when either side's pending fees reach its armed min, and
     *      routes through the {executeHarvest} self-call so a failure skips the harvest silently
     *      rather than reverting the carrying swap.
     * @param id The pool identifier.
     * @param key The pool key.
     * @param mainIsZero True when the pot's main is `currency0`.
     * @return burnLeg Main-side slice for the burn cascade (placed by the caller).
     * @return mainLeg Main-side slice for the program's main recipient (placed by the caller).
     * @return secLeg Secondary-side slice for the program's secondary recipient (placed by the caller).
     */
    function _autoHarvest(bytes32 id, IPoolManagerMin.PoolKey calldata key, bool mainIsZero)
        private returns (uint256 burnLeg, uint256 mainLeg, uint256 secLeg)
    {
        Program storage g = _programs[id];
        // No program, or a program with nothing staked: nothing to collect
        if (g.liquidity == 0) return (0, 0, 0);

        (uint256 f0, uint256 f1) = GluedV4Core.getPendingV4Fees(
            POOL_MANAGER, id, address(this), g.tickLower, g.tickUpper, GluedV4Core.positionSalt(address(this))
        );
        (uint256 fMain, uint256 fSec) = mainIsZero ? (f0, f1) : (f1, f0);
        // Nothing pending, or neither side has reached its armed min
        if ((fMain | fSec) == 0) return (0, 0, 0);
        if (fMain < g.minMain && fSec < g.minSecondary) return (0, 0, 0);

        // Self-call: a revert in here skips the harvest alone, never the carrying swap
        try this.executeHarvest(id, key, mainIsZero) returns (uint256 b, uint256 m, uint256 s) {
            return (b, m, s);
        } catch {}
    }

    /**
     * @dev The outside-unlock harvest: collect through the hook's own unlock, split (compound
     *      included), place. The shared body of the public {harvest} and the harvest-first rule of
     *      the liquidity ops. A program with nothing staked is a silent no-op so the liquidity ops
     *      can call it blindly.
     * @param id The pool identifier.
     * @param key The pool key.
     * @return fMain Fees collected on the main side.
     * @return fSec Fees collected on the secondary side.
     */
    function _harvestInto(bytes32 id, IPoolManagerMin.PoolKey calldata key)
        private returns (uint256 fMain, uint256 fSec)
    {
        Program storage g = _programs[id];
        if (g.liquidity == 0) return (0, 0);

        // Collect to the hook through its own unlock (we are NOT inside a swap here)
        (uint256 f0, uint256 f1) = GlueLiquidity.collectOwnUnlock(POOL_MANAGER, g, key);

        Pot storage p = _pots[id];
        (fMain, fSec) = p.main == key.currency0 ? (f0, f1) : (f1, f0);
        (uint256 burnLeg, uint256 mainLeg, uint256 secLeg) =
            GlueLiquidity.splitHarvest(p, g, _ledgers, id, key, fMain, fSec, false);

        // Placement: the SAME send phase as the in-swap frame, with no pot output to place
        GlueLiquidity.place(p, g, _ledgers, id, burnLeg, mainLeg, secLeg, 0);
    }

    /// @dev The transient PAYER slot: `keccak256("GlueHook.payer")` (a literal because inline
    ///      assembly only accepts direct number constants). Set by the library's mint around its
    ///      unlock — the literal there MUST match this one.
    bytes32 private constant PAYER_SLOT = 0x1bde310958327eb1c8a9046a2bb97d1e21ae8a0e23960bbeb793bdf7f87b6f8b;

    /// @dev Read the transient payer.
    function _getPayer() private view returns (address payer) {
        assembly ("memory-safe") { payer := tload(PAYER_SLOT) }
    }

    /// @dev The canonical V4 pool identifier: `keccak256(abi.encode(key))`, shared by every entry.
    function _idOf(IPoolManagerMin.PoolKey calldata key) private pure returns (bytes32 id) {
        return keccak256(abi.encode(key));
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // INTERNAL — PRICING
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @dev Price a sell against the pool's own arithmetic and decide how much of it the pot takes.
     *
     *      EXACT INPUT. Quote the sell as one pool-exact step. If the pot can pay for it, the pot takes
     *      the entire step — which may itself be less than the sell when the step is bounded by a tick,
     *      leaving the remainder to the pool. If the pot cannot pay for it, flip the question around and
     *      ask what input the pool would have demanded to pay out the whole pot: that input is the slice
     *      the pot absorbs, priced exactly as the pool would have priced it.
     *
     *      EXACT OUTPUT. The pot pays at most what the swapper asked for and at most what it holds, and
     *      the absorbed input is what the pool would have demanded for that output.
     *
     *      Both branches are capped by the main currency actually sitting in the PoolManager, because
     *      settling the fill takes that currency out of it. The cap is applied to the INPUT side before
     *      quoting so the payout stays the pool's own arithmetic for the slice actually absorbed — a pot
     *      richer than the pool it defends shields as much as the venue can hand over and lets the rest
     *      through, rather than declining the whole sell.
     *
     *      Every branch returns zeros rather than a fill it cannot price, and no branch can pay more
     *      than the pool would have paid for the same input.
     * @param key The pool key.
     * @param mainIsZero True when main is `currency0` (so the sell moves the price down).
     * @param pot The pot's secondary inventory.
     * @param amountSpecified The swap amount in V4's convention.
     * @return absorbed Main the pot takes out of the sell.
     * @return paid Secondary the pot pays for it.
     */
    function _shieldQuote(
        IPoolManagerMin.PoolKey calldata key,
        bool mainIsZero,
        uint256 pot,
        int256 amountSpecified
    ) private view returns (uint256 absorbed, uint256 paid) {
        // Selling main is `zeroForOne` exactly when main is currency0
        bool sellZero = mainIsZero;
        // Main the fill could actually be settled out of
        uint256 cap = _balanceOf(mainIsZero ? key.currency0 : key.currency1, POOL_MANAGER);
        // Nothing to take: nothing to shield
        if (cap == 0) return (0, 0);

        if (amountSpecified < 0) {
            uint256 offered = uint256(-amountSpecified);
            // Quote no more input than the venue can settle
            (absorbed, paid) =
                GluedV4Core.quoteSwapStep(POOL_MANAGER, key, sellZero, -int256(offered < cap ? offered : cap));
            if (absorbed == 0 || paid == 0) return (0, 0);
            // Affordable: take the step as quoted
            if (paid <= pot) return (absorbed, paid);

            // Pot-limited: the pot pays everything it has, for the input the pool would have demanded
            (absorbed, paid) = GluedV4Core.quoteSwapStep(POOL_MANAGER, key, sellZero, int256(pot));
            // A fill can never consume more input than the swapper offered or than the venue holds
            if (absorbed == 0 || paid == 0 || absorbed > offered || absorbed > cap) return (0, 0);
            return (absorbed, paid);
        }

        // Exact output: bounded by the swapper's request and by the pot
        uint256 want = uint256(amountSpecified);
        (absorbed, paid) = GluedV4Core.quoteSwapStep(POOL_MANAGER, key, sellZero, int256(want < pot ? want : pot));
        // The fill can never hand over more output than was asked for
        if (absorbed == 0 || paid == 0 || paid > want) return (0, 0);
        // Too large to settle: re-ask as an exact input of everything the venue holds
        if (absorbed > cap) {
            (absorbed, paid) = GluedV4Core.quoteSwapStep(POOL_MANAGER, key, sellZero, -int256(cap));
            if (absorbed == 0 || paid == 0 || paid > want || paid > pot || absorbed > cap) return (0, 0);
        }
    }

    /**
     * @dev Size the pump and derive its own output floor.
     *
     *      TWO independent ceilings, and the pump takes the smaller.
     *
     *      1. THE FEE CEILING — what makes the pump unsandwichable, and the only bound that actually
     *      has to hold. A pump is a market buy somebody else's transaction triggers, which is exactly
     *      the shape of a victim in a sandwich: buy in front of it, let it push the price up, sell
     *      behind it. Run that on a constant-product pool of depth `R` with an attacker leg `X` and a
     *      pump of `V`, and the gross profit is exactly `R·u·v·(2+u+v)/((1+u)² + u·v)` for `u = X/R`,
     *      `v = V/R` — that is `2·X·V/R` at leading order. The attacker's fees are `f·X` on the way in
     *      and `f·X`-worth on the way out, so the attack pays if and only if `2·X·V/R > 2·f·X`, i.e.
     *      `V > f·R`. The attacker's own size cancels out entirely: one bound on the pump's spend closes
     *      the attack for every attacker size, pot depth and price at once. `R` is the pool's tangent
     *      depth at its live price ({GluedV4Core-tangentReserve}) and `f` its live composed fee, so a
     *      deeper pool or a fatter fee tier earns a proportionally larger pump and nothing is hardcoded.
     *
     *      2. THE DEMAND CEILING — gradualism, not safety. The pump never spends more secondary than the
     *      carrying buy just paid, so a dust buy unlocks a dust pump and the pot is spent in step with
     *      real demand instead of all at once. The buy's own input is the yardstick because it is a
     *      MEASURED quantity out of the swap's delta: converting the buy's main output back into
     *      secondary would need a quote, and a quote of a pot-sized swap divides by an average execution
     *      price rather than the marginal one — which reads a fat pot's own price impact as extra demand
     *      and would let the pump outrun the buy that triggered it by exactly that factor.
     *
     *      {PUMP_HAIRCUT_BPS} then applies to whichever ceiling won, which puts the spend strictly
     *      inside the fee ceiling rather than exactly on it.
     *
     *      The output floor is quoted with the pool-exact step quoter, which never over-states, so a real
     *      swap cannot trip a floor the pool itself produced.
     * @param key The pool key.
     * @param main The defended currency.
     * @param pot The pot's secondary inventory.
     * @param userIn Secondary the carrying buy paid.
     * @return spend Secondary to spend on the pump.
     * @return minOut Output floor for the pump's own swap.
     */
    function _pumpSize(
        IPoolManagerMin.PoolKey calldata key,
        address main,
        uint256 pot,
        uint256 userIn
    ) private view returns (uint256 spend, uint256 minOut) {
        // No pot, or no buy to size against
        if (pot == 0 || userIn == 0) return (0, 0);
        // Buying main means selling secondary, so the direction is the mirror of the shield's
        bool zeroForOne = main != key.currency0;

        // 1. The fee ceiling: f·R on the side the pot spends
        {
            bytes32 id = _idOf(key);
            GluedV4Core.Slot0 memory slot0 = GluedV4Core.getSlot0(POOL_MANAGER, id);
            // The secondary is the input, so it is currency0 exactly when the pump swaps zeroForOne
            uint256 depth = GluedV4Core.tangentReserve(
                slot0.sqrtPriceX96, GluedV4Core.getPoolLiquidity(POOL_MANAGER, id), zeroForOne
            );
            uint256 feeCap = GluedMath.md512(
                depth, GluedV4Core.swapFee(slot0.protocolFee, key.fee, zeroForOne), FEE_DENOMINATOR
            );
            // A pool with no depth, or a zero-fee pool, can never host a pump that cannot be sandwiched
            if (feeCap == 0) return (0, 0);
            spend = pot < feeCap ? pot : feeCap;
        }

        // 2. The demand ceiling: never outrun the buy that carried us
        if (userIn < spend) spend = userIn;

        // Strictly inside whichever ceiling won
        spend = GluedMath.md512(spend, PUMP_HAIRCUT_BPS, BPS);
        if (spend == 0) return (0, 0);

        ( , minOut) = GluedV4Core.quoteSwapStep(POOL_MANAGER, key, zeroForOne, -int256(spend));
        // Without a pool-exact quote there is no floor to enforce, so there is no pump
        if (minOut == 0) return (0, 0);
        // Rounding allowance on a same-transaction quote of the pool's own arithmetic
        minOut -= minOut / MIN_OUT_SHAVE;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // INTERNAL — EXECUTION
    // ═══════════════════════════════════════════════════════════════════════════════

    /// @dev Settle the shield's side of a swap: debit the pot, take the absorbed main out of the
    ///      PoolManager, pay the seller's secondary into it, then place the main through the
    ///      delivery engine — the BUYBACK SPLIT runs on the absorbed main exactly as on a pump's
    ///      output. State first, then movement, then delivery — so nothing re-entered can see the
    ///      pot's money twice.
    /// @param id The pool identifier.
    /// @param p The pool's pot.
    /// @param absorbed Main taken out of the sell.
    /// @param paid Secondary paid for it.
    function _fillShield(bytes32 id, Pot storage p, uint256 absorbed, uint256 paid) private {
        p.balance -= paid;
        _ledgers.potTotal[p.secondary] -= paid;

        IPoolManagerMin(POOL_MANAGER).take(p.main, address(this), absorbed);
        _settleV4(p.secondary, paid);

        emit Shielded(id, absorbed, paid);
        GlueLiquidity.place(p, _programs[id], _ledgers, id, 0, 0, 0, absorbed);
    }

    /// @dev Reverting send of the native currency or an ERC20 — the strict outgoing primitive for the
    ///      caller's own transaction (claims, refunds, liquidity principal).
    function _sendToken(address token, address to, uint256 amount) private {
        if (amount == 0) return;
        if (token == ETH_ADDRESS) {
            // A self-send is a no-op: the value is already here
            if (to == address(this)) return;
            Address.sendValue(payable(to), amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /// @dev Measured pull of the native currency (validated against `msg.value`) or an ERC20 (returns
    ///      the recipient's real balance delta, so a fee-on-transfer currency credits what ARRIVED).
    function _pullToken(address token, address from, address to, uint256 amount)
        private returns (uint256 actualAmount)
    {
        if (amount == 0) return 0;
        if (token == ETH_ADDRESS) {
            // The caller must have attached the value; it already sits on this contract
            if (msg.value < amount) revert BadDonation();
            if (to != address(this)) Address.sendValue(payable(to), amount);
            return amount;
        }
        uint256 balanceBefore = IERC20(token).balanceOf(to);
        IERC20(token).safeTransferFrom(from, to, amount);
        uint256 balanceAfter = IERC20(token).balanceOf(to);
        return balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0;
    }

    /// @dev Balance of the native currency or an ERC20.
    function _balanceOf(address token, address account) private view returns (uint256) {
        return token == ETH_ADDRESS ? account.balance : IERC20(token).balanceOf(account);
    }

    /// @notice How the V4 callback frame ({GluedV4Callback}) moves an ERC20 into the PoolManager.
    /// @dev While the transient PAYER is set — only ever inside a liquidity add's unlock — the leg
    ///      is pulled straight from the payer's allowance at the exact amount owed, so a position is
    ///      always funded by its caller and never by the hook's own inventory. With no payer set it
    ///      is a plain reverting send from the hook's own balance (the pump/shield settle paths).
    function _transferToken(address token, address to, uint256 amount) internal override {
        address payer = _getPayer();
        if (payer != address(0)) {
            _pullToken(token, payer, to, amount);
            return;
        }
        _sendToken(token, to, amount);
    }
}
