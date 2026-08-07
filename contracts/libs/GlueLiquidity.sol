// SPDX-License-Identifier: BUSL-1.1
//
// Licensed Work: GlueHook
// The Licensed Work is (c) 2026 gluefinance.eth and is owned exclusively by Glue Labs Inc. (Delaware).
// Licensor: Glue Labs Inc. (Delaware)
// Change Date: the earlier of 2030-08-05 or a date specified at gluehook-license-date.gluefinance.eth
// Change License: GNU General Public License v2.0 or later
// Full licence text: https://github.com/glue-finance/GlueHook/blob/main/LICENCE.txt

pragma solidity ^0.8.35;

import {GluedV4Core, IPoolManagerMin} from "./GluedV4Core.sol";
import {GluedMath} from "./GluedMath.sol";
import {IGlueHook} from "../interfaces/IGlueHook.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @dev The one hook entry the engine calls back INTO: the compound mint runs in its own external
///      frame so a revert rolls back the mint alone (the whole budget stays in the carry). Under
///      `delegatecall`, `address(this)` is the hook, so this is a plain self-call.
interface IGlueHookCompound {
    function executeCompound(
        bytes32 id,
        IPoolManagerMin.PoolKey calldata key,
        uint256 amount0,
        uint256 amount1,
        bool inUnlock
    ) external returns (uint256 used0, uint256 used1);
}

/**
 * @title  GlueLiquidity - the LP PROGRAM's harvest and AUTO-COMPOUND engine, extracted for EIP-170.
 * @notice A DELEGATECALL-linked library holding the heavy bodies of the program layer: the two fee
 *         collects (in-swap and own-unlock), the flat gross-referenced harvest split, and the
 *         compound mint itself — the piece that gives a hooked pool the auto-compounding
 *         concentrated-liquidity venues lack natively: a selectable `compoundShareWad` of every
 *         harvest, PLUS whatever earlier mints could not place (the CARRY), is re-minted into the
 *         program's own position at the live price, inside the very swaps that generated the
 *         fees. The resident hook keeps only thin, gate-checked forwarders; every function here
 *         runs in the hook's own storage, address and balance (so `address(this)` is the hook, the
 *         PoolManager callbacks land on the hook, and events are emitted from the hook's address).
 * @dev    State comes in as STORAGE POINTERS from the hook's own declarations - the library declares
 *         no state of its own and the hook's storage layout is untouched by the extraction.
 */
library GlueLiquidity {
    using SafeERC20 for IERC20;

    /// @dev WAD denominator, mirroring the hook's.
    uint256 private constant PRECISION = 1e18;
    /// @dev `GluedV4Callback`'s ADD op code, for the own-unlock mint payload.
    uint8 private constant OP_ADD_LIQUIDITY = 1;
    /// @dev `GluedV4Callback`'s COLLECT op code, for the own-unlock collect payload.
    uint8 private constant OP_COLLECT_FEES = 3;

    /// @dev Mirror of {IGlueHook.Harvested}: emitted from the hook's address under delegatecall.
    event Harvested(bytes32 indexed poolId, uint256 mainFees, uint256 secondaryFees, uint256 burned, uint256 fueled);
    /// @dev Mirror of {IGlueHook.Compounded}: emitted from the hook's address under delegatecall.
    event Compounded(bytes32 indexed poolId, uint128 liquidity, uint256 amount0Used, uint256 amount1Used);
    /// @dev Mirror of {IGlueHook.PotInitialized}: emitted from the hook's address under delegatecall.
    event PotInitialized(bytes32 indexed poolId, address main, address secondary, address recipient);
    /// @dev Mirror of {IGlueHook.RecipientSet}: emitted from the hook's address under delegatecall.
    event RecipientSet(bytes32 indexed poolId, address recipient);
    /// @dev Mirror of {IGlueHook.ProgramCreated}: emitted from the hook's address under delegatecall.
    event ProgramCreated(bytes32 indexed poolId, address indexed owner, int24 tickLower, int24 tickUpper);
    /// @dev Mirror of {IGlueHook.ProgramConfigured}: emitted from the hook's address under delegatecall.
    event ProgramConfigured(bytes32 indexed poolId, IGlueHook.ProgramConfig config);
    /// @dev Mirror of {IGlueHook.ProgramLiquidityAdded}: emitted from the hook's address under delegatecall.
    event ProgramLiquidityAdded(bytes32 indexed poolId, uint128 liquidity, uint256 amount0Used, uint256 amount1Used);
    /// @dev Mirror of {IGlueHook.ProgramOperatorSet}: emitted from the hook's address under delegatecall.
    event ProgramOperatorSet(bytes32 indexed poolId, address indexed newOperator);
    /// @dev Mirror of {IGlueHook.ProgramOwnershipTransferred}: emitted from the hook's address under delegatecall.
    event ProgramOwnershipTransferred(bytes32 indexed poolId, address indexed newOwner);
    /// @dev Mirror of {IGlueHook.Delivered}: emitted from the hook's address under delegatecall.
    event Delivered(bytes32 indexed poolId, address indexed to, uint256 amount, IGlueHook.Delivery mode);
    /// @dev Mirror of {IGlueHook.Paid}: emitted from the hook's address under delegatecall.
    event Paid(address indexed to, address indexed asset, uint256 amount);
    /// @dev Mirror of {IGlueHook.Owed}: emitted from the hook's address under delegatecall.
    event Owed(address indexed to, address indexed asset, uint256 amount);
    /// @dev Mirror of {IGlueHook.FlushedDirect}: emitted from the hook's address under delegatecall.
    event FlushedDirect(bytes32 indexed poolId, address indexed to, uint256 amount);

    /// @dev The canonical dead address, the burn cascade's second leg (mirror of the hook's).
    address private constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /// @dev The hook's transient PAYER slot: `keccak256("GlueHook.payer")`. While set — only ever
    ///      around a liquidity add's unlock — the hook's `_transferToken` settles ERC20 legs straight
    ///      from this address. Transient storage is the hook's own under delegatecall, so the literal
    ///      MUST match the hook's.
    bytes32 private constant PAYER_SLOT = 0x1bde310958327eb1c8a9046a2bb97d1e21ae8a0e23960bbeb793bdf7f87b6f8b;

    // ═══════════════════════════════════════════════════════════════════════════════
    // POT ROLES
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice The one-shot role declaration (the hook's {IGlueHook-initPot} body). Admin-gated
     *         (`msg.sender` is the original caller under delegatecall), one of the pool's own
     *         currencies becomes MAIN and the other SECONDARY; a native main may never point at burn.
     * @param p The pool's pot.
     * @param key The pool key.
     * @param id The pool identifier.
     * @param main The currency to defend.
     * @param recipient The delivery target (`address(0)` = burn).
     */
    function initPot(
        IGlueHook.Pot storage p,
        IPoolManagerMin.PoolKey calldata key,
        bytes32 id,
        address main,
        address recipient
    ) external {
        // A pool that never ran through the hook's `beforeInitialize` has no admin and no pot
        if (p.admin == address(0)) revert IGlueHook.PotNotReady();
        if (msg.sender != p.admin) revert IGlueHook.NotAllowed();
        // Roles are declared once and never move
        if (p.configured) revert IGlueHook.PotAlreadyReady();
        // Main must be one of the pool's own currencies; the other side becomes the buyback currency
        if (main != key.currency0 && main != key.currency1) revert IGlueHook.BadRoles();
        // The network token cannot be burned, so a native-main pot must name a live delivery target
        if (main == address(0) && recipient == address(0)) revert IGlueHook.BadRoles();

        address secondary = main == key.currency0 ? key.currency1 : key.currency0;
        p.main = main;
        p.secondary = secondary;
        // `address(0)` is stored verbatim and MEANS "burn": the burn cascade (native burn → dead →
        // held forever) runs instead of a plain transfer. Any other value is a literal delivery target.
        p.recipient = recipient;
        p.configured = true;

        emit PotInitialized(id, main, secondary, recipient);
    }

    /**
     * @notice Move the pot's delivery target (the hook's {IGlueHook-setRecipient} body).
     *         Admin-gated; a native-main pot can never be pointed at burn.
     * @param p The pool's pot.
     * @param poolId The pool identifier.
     * @param recipient The new target (`address(0)` restores the burn behaviour).
     */
    function setRecipient(IGlueHook.Pot storage p, bytes32 poolId, address recipient) external {
        // Only a live pot has a recipient to move
        if (!p.configured) revert IGlueHook.PotNotReady();
        if (msg.sender != p.admin) revert IGlueHook.NotAllowed();
        // The network token cannot be burned, so a native-main pot can never be pointed at burn
        if (recipient == address(0) && p.main == address(0)) revert IGlueHook.BadRoles();

        p.recipient = recipient;
        emit RecipientSet(poolId, recipient);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONFIG
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Validate a split config and write it into the program. Every share is a fraction of
     *         the GROSS fees of its side, so legality is per side: the two shares that can claim a
     *         side (`compound + buyback` on the secondary, `compound + burn` on the main) must sum
     *         to at most 100%; a native main carries no burn share (the network token cannot be
     *         burned — the mirror of the pot's own rule); and a side whose shares sum below 100%
     *         must name a live recipient, because a remainder can exist there.
     * @dev A config edit only shapes FUTURE harvests: nothing already split or carried is re-touched.
     * @param g The pool's program.
     * @param main The pot's main currency (`address(0)` = native).
     * @param cfg The split rules to validate and store.
     */
    function applyConfig(IGlueHook.Program storage g, address main, IGlueHook.ProgramConfig memory cfg)
        external
    {
        _applyConfig(g, main, cfg);
    }

    /**
     * @notice Hand off or freeze the rules role (the hook's {IGlueHook-setProgramOperator} body).
     *         Operator-gated; `address(0)` freezes the rules forever — the OWNER's property is
     *         untouched either way.
     * @param g The pool's program.
     * @param poolId The pool identifier.
     * @param newOperator The new operator (`address(0)` = frozen forever).
     */
    function setOperator(IGlueHook.Program storage g, bytes32 poolId, address newOperator) external {
        if (!g.exists) revert IGlueHook.PotNotReady();
        // A zeroed operator role means frozen forever, since `msg.sender` is never zero
        if (msg.sender != g.operator) revert IGlueHook.NotAllowed();
        g.operator = newOperator;
        emit ProgramOperatorSet(poolId, newOperator);
    }

    /**
     * @notice Move the property role (the hook's {IGlueHook-transferProgramOwnership} body).
     *         Owner-gated. Surrendering the property (`address(0)`) locks the liquidity forever by
     *         construction — `msg.sender` matches nobody — so the harvest gate opens for good: an
     *         ownerless program must never be manually unharvestable.
     * @param g The pool's program.
     * @param poolId The pool identifier.
     * @param newOwner The new owner (`address(0)` = surrendered).
     */
    function transferOwnership(IGlueHook.Program storage g, bytes32 poolId, address newOwner) external {
        if (!g.exists) revert IGlueHook.PotNotReady();
        if (msg.sender != g.owner) revert IGlueHook.NotAllowed();
        g.owner = newOwner;
        if (newOwner == address(0)) g.publicHarvest = true;
        emit ProgramOwnershipTransferred(poolId, newOwner);
    }

    /// @dev {applyConfig}'s body, shared with {createProgram}.
    function _applyConfig(IGlueHook.Program storage g, address main, IGlueHook.ProgramConfig memory cfg)
        private
    {
        uint256 secClaim = uint256(cfg.compoundShareWad) + cfg.buybackShareWad;
        uint256 mainClaim = uint256(cfg.compoundShareWad) + cfg.burnShareWad;
        if (secClaim > PRECISION || mainClaim > PRECISION) revert IGlueHook.BadConfig();
        if (cfg.burnShareWad != 0 && main == address(0)) revert IGlueHook.BadConfig();
        if (secClaim < PRECISION && cfg.secondaryRecipient == address(0)) revert IGlueHook.BadConfig();
        if (mainClaim < PRECISION && cfg.mainRecipient == address(0)) revert IGlueHook.BadConfig();

        // THE BUYBACK SPLIT: the pot's output is carved like a fee side — compound + burn ≤ 100%,
        // the exact rest following the pot's recipient — and a native main still can never burn.
        // No recipient rule here: the remainder's destination is the POT's recipient, which always
        // has defined semantics (a live address delivers, `address(0)` burns — and a native-main
        // pot can never carry `address(0)`, so a native remainder is always deliverable).
        uint256 potClaim = uint256(cfg.potCompoundShareWad) + cfg.potBurnShareWad;
        if (potClaim > PRECISION) revert IGlueHook.BadConfig();
        if (cfg.potBurnShareWad != 0 && main == address(0)) revert IGlueHook.BadConfig();

        g.buybackShareWad = cfg.buybackShareWad;
        g.burnShareWad = cfg.burnShareWad;
        g.compoundShareWad = cfg.compoundShareWad;
        g.potCompoundShareWad = cfg.potCompoundShareWad;
        g.potBurnShareWad = cfg.potBurnShareWad;
        // An ownerless program stays force-opened whatever the stored config says: with no owner to
        // pass the gate, a closed manual harvest would strand fees the auto-trigger never reaches
        g.publicHarvest = cfg.publicHarvest || g.owner == address(0);
        g.secondaryRecipient = cfg.secondaryRecipient;
        g.mainRecipient = cfg.mainRecipient;
        g.minMain = cfg.minMain;
        g.minSecondary = cfg.minSecondary;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PROGRAM CREATION & LIQUIDITY
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Create a pool's program and seed its liquidity (the shared body of the hook's
     *         {IGlueHook-addLiquidity}, {IGlueHook-addLiquidityAdvanced} and {IGlueHook-launchPool}).
     *         Gated to the pot admin (`msg.sender` is the original caller under delegatecall), one
     *         program per pool, config validated here. The tick range is resolved (sentinel `(0,0)`
     *         = full range) and fixed forever: the position's identity in the PoolManager is
     *         (hook, ticks, salt), so a moving range would orphan the fees.
     * @param p The pool's pot.
     * @param g The pool's program slot.
     * @param pm The PoolManager.
     * @param id The pool identifier.
     * @param key The pool key.
     * @param tickLower Lower tick, `(0,0)` = full range.
     * @param tickUpper Upper tick.
     * @param liquidity Liquidity units to mint.
     * @param owner The program's owner and first operator (`address(0)` = surrendered at birth).
     * @param cfg The split rules to store.
     * @return amount0 Currency0 the position consumed.
     * @return amount1 Currency1 the position consumed.
     */
    function createProgram(
        IGlueHook.Pot storage p,
        IGlueHook.Program storage g,
        address pm,
        bytes32 id,
        IPoolManagerMin.PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        address owner,
        IGlueHook.ProgramConfig memory cfg
    ) external returns (uint256 amount0, uint256 amount1) {
        // The pot's roles ARE the split's two sides, so a program cannot precede them
        if (!p.configured) revert IGlueHook.PotNotReady();
        // The pot admin owns the pool's one program slot — nobody can front-run the split rules
        if (msg.sender != p.admin) revert IGlueHook.NotAllowed();
        // ONE program per pool, forever
        if (g.exists) revert IGlueHook.PotAlreadyReady();

        // Resolve the sentinel before storing: every later read uses the REAL ticks
        if (tickLower == 0 && tickUpper == 0) {
            (tickLower, tickUpper) = GluedV4Core.fullRangeTicks(key.tickSpacing);
        }

        g.exists = true;
        g.owner = owner;
        // The owner starts as its own settings editor; hand off or zero it with setProgramOperator
        g.operator = owner;
        g.tickLower = tickLower;
        g.tickUpper = tickUpper;
        _applyConfig(g, p.main, cfg);

        emit ProgramCreated(id, owner, tickLower, tickUpper);
        emit ProgramConfigured(id, cfg);
        return _mint(g, pm, id, key, liquidity);
    }

    /**
     * @notice Mint `liquidity` units into an EXISTING program's position, funded by the caller (the
     *         hook's {IGlueHook-addProgramLiquidity} body — the owner gate and the harvest-first rule
     *         run in the resident hook before this).
     * @param g The pool's program.
     * @param pm The PoolManager.
     * @param id The pool identifier.
     * @param key The pool key.
     * @param liquidity Liquidity units to mint.
     * @return amount0 Currency0 the position consumed.
     * @return amount1 Currency1 the position consumed.
     */
    function mintLiquidity(
        IGlueHook.Program storage g,
        address pm,
        bytes32 id,
        IPoolManagerMin.PoolKey calldata key,
        uint128 liquidity
    ) external returns (uint256 amount0, uint256 amount1) {
        return _mint(g, pm, id, key, liquidity);
    }

    /**
     * @dev The mint itself. The unlock runs the hook's own ADD handler; while it settles, the
     *      transient PAYER is set so an ERC20 leg is pulled straight from the caller to the
     *      PoolManager at the EXACT amount owed — no estimate, no refund, and never a wei of the
     *      hook's own inventory. A native leg (always `currency0`) is prepaid by the attached value
     *      (preserved by delegatecall), checked as a hard cap afterwards and the excess returned; a
     *      pool with no native side must attach none.
     * @param g The pool's program.
     * @param pm The PoolManager.
     * @param id The pool identifier.
     * @param key The pool key.
     * @param liquidity Liquidity units to mint.
     * @return amount0 Currency0 the position consumed.
     * @return amount1 Currency1 the position consumed.
     */
    function _mint(
        IGlueHook.Program storage g,
        address pm,
        bytes32 id,
        IPoolManagerMin.PoolKey calldata key,
        uint128 liquidity
    ) private returns (uint256 amount0, uint256 amount1) {
        if (liquidity == 0) revert IGlueHook.BadConfig();
        // A pool with no native side must carry no value — the hook's own ETH is pot money
        bool nativeSide = key.currency0 == address(0);
        if (!nativeSide && msg.value != 0) revert IGlueHook.BadDonation();

        // ERC20 legs settle straight from the caller while the payer is set
        assembly ("memory-safe") { tstore(PAYER_SLOT, caller()) }
        bytes memory ret = IPoolManagerMin(pm).unlock(
            abi.encode(
                OP_ADD_LIQUIDITY,
                key,
                int256(uint256(liquidity)),
                GluedV4Core.positionSalt(address(this)),
                g.tickLower,
                g.tickUpper
            )
        );
        assembly ("memory-safe") { tstore(PAYER_SLOT, 0) }

        (int128 d0, int128 d1) = abi.decode(ret, (int128, int128));
        amount0 = d0 < 0 ? uint256(uint128(-d0)) : 0;
        amount1 = d1 < 0 ? uint256(uint128(-d1)) : 0;

        // Book before the refund — the only external call left in the frame
        g.liquidity += liquidity;
        emit ProgramLiquidityAdded(id, liquidity, amount0, amount1);

        // The attached value is a hard cap on the native leg; the unused excess goes back
        if (nativeSide) {
            if (amount0 > msg.value) revert IGlueHook.BadDonation();
            if (msg.value > amount0) Address.sendValue(payable(msg.sender), msg.value - amount0);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // COLLECTS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Collect the program's accrued fees while the PoolManager is ALREADY unlocked (the
     *         in-swap frame): a direct zero-delta `modifyLiquidity`, then take both sides here.
     * @param pm The PoolManager.
     * @param g The pool's program (its fixed ticks identify the position).
     * @param key The pool key.
     * @return f0 Currency0 fees taken to the hook.
     * @return f1 Currency1 fees taken to the hook.
     */
    function collectInSwap(address pm, IGlueHook.Program storage g, IPoolManagerMin.PoolKey calldata key)
        external returns (uint256 f0, uint256 f1)
    {
        (int256 callerDelta, ) = IPoolManagerMin(pm).modifyLiquidity(
            key,
            IPoolManagerMin.ModifyLiquidityParams({
                tickLower: g.tickLower,
                tickUpper: g.tickUpper,
                liquidityDelta: 0,
                salt: GluedV4Core.positionSalt(address(this))
            }),
            ""
        );
        (int128 d0, int128 d1) = _unpack(callerDelta);
        if (d0 > 0) {
            f0 = uint256(uint128(d0));
            IPoolManagerMin(pm).take(key.currency0, address(this), f0);
        }
        if (d1 > 0) {
            f1 = uint256(uint128(d1));
            IPoolManagerMin(pm).take(key.currency1, address(this), f1);
        }
    }

    /**
     * @notice Collect the program's accrued fees OUTSIDE any unlock (manual harvest, liquidity ops):
     *         opens the hook's own COLLECT unlock, whose callback takes both sides to the hook.
     * @param pm The PoolManager.
     * @param g The pool's program.
     * @param key The pool key.
     * @return f0 Currency0 fees taken to the hook.
     * @return f1 Currency1 fees taken to the hook.
     */
    function collectOwnUnlock(address pm, IGlueHook.Program storage g, IPoolManagerMin.PoolKey calldata key)
        external returns (uint256 f0, uint256 f1)
    {
        // The callback lands on the hook's own `unlockCallback` (address preserved by delegatecall);
        // with no transient recipient set, its takes default to the hook - exactly where fees belong
        bytes memory ret = IPoolManagerMin(pm).unlock(
            abi.encode(
                OP_COLLECT_FEES,
                key,
                int256(0),
                GluedV4Core.positionSalt(address(this)),
                g.tickLower,
                g.tickUpper
            )
        );
        (int128 d0, int128 d1) = abi.decode(ret, (int128, int128));
        f0 = d0 > 0 ? uint256(uint128(d0)) : 0;
        f1 = d1 > 0 ? uint256(uint128(d1)) : 0;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // SPLIT
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Split freshly collected fees by the program's rules. EVERY leg is a fraction of the
     *         GROSS of its side: the compound budget and the buyback/burn shares are computed from
     *         the same base, and each recipient leg is the exact remainder
     *         (`gross − compound − share`), never a second multiplication — the legs sum to the
     *         harvest byte-for-byte. The compound then mints against its budget PLUS everything an
     *         earlier mint could not place (the CARRY): what this mint does not consume is saved
     *         back into the carry and retried at every next harvest, never leaking to the pot or a
     *         recipient. The pot's buyback share is credited HERE — bookkeeping only — and the
     *         outbound legs are returned for the hook's send phase, so every send in the frame
     *         happens after every write.
     * @param p The pool's pot (credited with the buyback share).
     * @param g The pool's program.
     * @param L The hook's delivery/attribution ledgers.
     * @param id The pool identifier.
     * @param key The pool key (the compound mints into the program's position).
     * @param fMain Fees collected on the main side.
     * @param fSec Fees collected on the secondary side.
     * @param inUnlock True when the PoolManager is already unlocked (the in-swap frame).
     * @return burnLeg Main-side slice for the burn cascade.
     * @return mainLeg Main-side slice for the program's main recipient.
     * @return secLeg Secondary-side slice for the program's secondary recipient.
     */
    function splitHarvest(
        IGlueHook.Pot storage p,
        IGlueHook.Program storage g,
        IGlueHook.Ledgers storage L,
        bytes32 id,
        IPoolManagerMin.PoolKey calldata key,
        uint256 fMain,
        uint256 fSec,
        bool inUnlock
    ) external returns (uint256 burnLeg, uint256 mainLeg, uint256 secLeg) {
        // A zero-fee harvest still retries a standing carry; with neither there is nothing to do
        if ((fMain | fSec) == 0 && (g.carryMain | g.carrySecondary) == 0) return (0, 0, 0);

        // Every leg off the GROSS of its side (floor); the recipients take the exact remainders
        uint256 cMain = GluedMath.md512(fMain, g.compoundShareWad, PRECISION);
        uint256 cSec = GluedMath.md512(fSec, g.compoundShareWad, PRECISION);
        uint256 buyLeg = GluedMath.md512(fSec, g.buybackShareWad, PRECISION);
        burnLeg = GluedMath.md512(fMain, g.burnShareWad, PRECISION);
        secLeg = fSec - cSec - buyLeg;
        mainLeg = fMain - cMain - burnLeg;

        // COMPOUND: this harvest's budget plus everything carried from earlier mints. Whatever the
        // mint does not place goes back into the carry — LP-ing is retried forever, never rerouted.
        uint256 budgetMain = cMain + g.carryMain;
        uint256 budgetSec = cSec + g.carrySecondary;
        if ((budgetMain | budgetSec) != 0) {
            (uint256 uMain, uint256 uSec) =
                _compoundSlice(p.main == key.currency0, id, key, budgetMain, budgetSec, inUnlock);
            L.carryTotal[p.main] = L.carryTotal[p.main] + (budgetMain - uMain) - g.carryMain;
            L.carryTotal[p.secondary] = L.carryTotal[p.secondary] + (budgetSec - uSec) - g.carrySecondary;
            g.carryMain = budgetMain - uMain;
            g.carrySecondary = budgetSec - uSec;
        }

        if (buyLeg != 0) {
            p.balance += buyLeg;
            L.potTotal[p.secondary] += buyLeg;
        }

        emit Harvested(id, fMain, fSec, burnLeg, buyLeg);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PLACEMENT — the delivery engine (buyback split, cascade, payouts)
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Place every outbound leg of a frame — the ONLY sends, after ALL bookkeeping. The
     *         pot's output (`potOut` — pump-bought or shield-absorbed main) runs the BUYBACK SPLIT
     *         first: `potCompoundShareWad` joins the program's main-side compound carry (buy
     *         pressure becoming the pool's own liquidity at the next harvest's mint),
     *         `potBurnShareWad` joins the burn cascade, and the EXACT rest follows the pot's
     *         recipient exactly as an unsplit delivery would — a live address is delivered to
     *         (park-with-retry on refusal), `address(0)` merges it into the frame's single cascade
     *         walk. A pool with NO program has zero shares by construction (a non-existent
     *         program's storage is zero), so its pot output is always delivered whole.
     * @dev Nothing here can revert the carrying swap: pushes are bounded and report, refusals park
     *      or book, the carry credit is pure bookkeeping, and the burn cascade falls through to
     *      the terminal hold.
     * @param p The pool's pot.
     * @param g The pool's program (zero-initialised when no program exists).
     * @param L The hook's delivery/attribution ledgers.
     * @param id The pool identifier.
     * @param burnLeg Main-side harvest slice for the burn cascade.
     * @param mainLeg Main-side harvest slice for the program's main recipient.
     * @param secLeg Secondary-side harvest slice for the program's secondary recipient.
     * @param potOut The pot's output: main the pump just bought or the shield just absorbed.
     */
    function place(
        IGlueHook.Pot storage p,
        IGlueHook.Program storage g,
        IGlueHook.Ledgers storage L,
        bytes32 id,
        uint256 burnLeg,
        uint256 mainLeg,
        uint256 secLeg,
        uint256 potOut
    ) external {
        // Nothing to place
        if ((burnLeg | mainLeg | secLeg | potOut) == 0) return;
        address main = p.main;

        if (potOut != 0) {
            // THE BUYBACK SPLIT — floors on the shares, so the remainder is exact and the dust
            // stays with the pot's own delivery
            uint256 comp = GluedMath.md512(potOut, g.potCompoundShareWad, PRECISION);
            uint256 potBurn = GluedMath.md512(potOut, g.potBurnShareWad, PRECISION);
            if (comp != 0) {
                // Pure bookkeeping: the leg joins the compound carry and is re-minted as the
                // pool's own liquidity by the next harvest's compound attempt — it can never leak
                // (the carry only ever becomes liquidity) and custody covers it ({obligationOf})
                g.carryMain += comp;
                L.carryTotal[main] += comp;
                emit Delivered(id, address(this), comp, IGlueHook.Delivery.COMPOUNDED);
                potOut -= comp;
            }
            if (potBurn != 0) {
                burnLeg += potBurn;
                potOut -= potBurn;
            }
            // A burn-intent pot merges the exact rest into the frame's single cascade walk (a
            // native main can never be here — its pot always names a live recipient)
            if (p.recipient == address(0)) {
                burnLeg += potOut;
                potOut = 0;
            }
        }

        // The pot's live-recipient delivery: park-with-retry on refusal
        if (potOut != 0) _deliver(p, L, id, main, potOut);
        // ONE cascade walk for every burn-intent leg of the frame
        if (burnLeg != 0) _burn(L, id, main, burnLeg);
        // The program's own harvest legs
        if (mainLeg != 0) _payRecipient(L, g.mainRecipient, main, mainLeg);
        if (secLeg != 0) _payRecipient(L, g.secondaryRecipient, p.secondary, secLeg);
    }

    /**
     * @notice Retry the delivery of main that a pot's live recipient refused (the hook's
     *         {IGlueHook-flushDirect} body). Permissionless; the pot's CURRENT recipient is always
     *         the source of truth.
     * @param p The pool's pot.
     * @param L The hook's delivery/attribution ledgers.
     * @param id The pool whose direct-parked main is retried.
     * @return amount The amount delivered.
     */
    function flushDirect(IGlueHook.Pot storage p, IGlueHook.Ledgers storage L, bytes32 id)
        external returns (uint256 amount)
    {
        amount = L.parkedDirect[id];
        if (amount == 0) revert IGlueHook.PotNotReady();

        address recipient = p.recipient;
        // A pot moved to burn since the park has no direct target any more
        if (recipient == address(0)) revert IGlueHook.PotNotReady();

        address asset = p.main;
        // Still refusing: leave it parked for a later attempt
        if (!_pushRaw(recipient, asset, amount)) revert IGlueHook.PotNotReady();

        L.parked[asset] -= amount;
        L.parkedDirect[id] = 0;
        emit FlushedDirect(id, recipient, amount);
    }

    /**
     * @dev Place main with a LIVE recipient, without ever being able to revert the swap that
     *      produced it: a bounded-gas ETH send when main is the network token, a non-reverting
     *      `transfer` otherwise; a refusal parks the main, booked per pool for {flushDirect}.
     */
    function _deliver(
        IGlueHook.Pot storage p,
        IGlueHook.Ledgers storage L,
        bytes32 id,
        address asset,
        uint256 amount
    ) private {
        if (_pushRaw(p.recipient, asset, amount)) {
            emit Delivered(id, p.recipient, amount, IGlueHook.Delivery.DIRECT);
            return;
        }
        L.parked[asset] += amount;
        L.parkedDirect[id] += amount;
        emit Delivered(id, address(this), amount, IGlueHook.Delivery.PARKED);
    }

    /**
     * @dev The burn cascade, never able to revert the carrying swap. In order: the token's own
     *      `burn(amount)` (accepted only on a verified balance drop), a transfer to `0xdead`, then
     *      the amount is HELD on the hook FOREVER — no withdrawal path exists, so custody IS the
     *      burn. The first fall-through flags the asset unburnable, so later burns of it skip the
     *      probes and settle straight to the held ledger.
     */
    function _burn(IGlueHook.Ledgers storage L, bytes32 id, address asset, uint256 amount) private {
        // A known non-burnable skips the probes: straight to the terminal hold
        if (!L.unburnable[asset]) {
            // 1. The token's own burn (cheapest true supply reduction), verified by a balance drop
            if (_tryBurn(asset, amount)) {
                emit Delivered(id, asset, amount, IGlueHook.Delivery.BURNED);
                return;
            }

            // 2. Dead route
            if (_tryTransfer(asset, DEAD_ADDRESS, amount)) {
                emit Delivered(id, DEAD_ADDRESS, amount, IGlueHook.Delivery.DEAD);
                return;
            }

            // Both probes failed: never run them again for this asset
            L.unburnable[asset] = true;
        }

        // 3. Held forever — the terminal sink
        L.held[asset] += amount;
        emit Delivered(id, address(this), amount, IGlueHook.Delivery.HELD);
    }

    /**
     * @dev Push a harvest leg to its recipient, folding in any backlog owed to the same pair. A
     *      success clears the backlog; a refusal books the NEW amount on top of it (the backlog
     *      was already booked) and never reverts.
     */
    function _payRecipient(IGlueHook.Ledgers storage L, address to, address asset, uint256 amount)
        private
    {
        uint256 backlog = L.owed[to][asset];
        if (_pushRaw(to, asset, amount + backlog)) {
            if (backlog != 0) {
                delete L.owed[to][asset];
                L.owedTotal[asset] -= backlog;
            }
            emit Paid(to, asset, amount + backlog);
        } else {
            L.owed[to][asset] += amount;
            L.owedTotal[asset] += amount;
            emit Owed(to, asset, amount);
        }
    }

    /// @dev One bounded, non-reverting push: the gas-capped native send or the tolerant ERC20 transfer.
    function _pushRaw(address to, address asset, uint256 amount) private returns (bool ok) {
        if (amount == 0) return true;
        return asset == address(0) ? _sendEth(to, amount) : _tryTransfer(asset, to, amount);
    }

    /// @dev Bounded-gas native send, reporting failure instead of reverting so a delivery can be
    ///      parked and retried. The 30,000-gas stipend covers a plain `receive()` but denies a
    ///      hostile recipient enough gas to do anything that could brick the carrying swap.
    function _sendEth(address to, uint256 amount) private returns (bool ok) {
        (ok, ) = to.call{value: amount, gas: 30_000}("");
    }

    /// @dev The token's own `burn(uint256)`, accepted only when the hook's balance really fell by
    ///      `amount` — a token that reports success without moving anything falls through.
    function _tryBurn(address token, uint256 amount) private returns (bool ok) {
        uint256 balBefore = IERC20(token).balanceOf(address(this));
        if (balBefore < amount) return false;
        (bool success, ) = token.call(abi.encodeWithSignature("burn(uint256)", amount));
        if (!success) return false;
        return IERC20(token).balanceOf(address(this)) <= balBefore - amount;
    }

    /// @dev ERC20 transfer that reports failure instead of reverting, so the cascade can move on.
    function _tryTransfer(address token, address to, uint256 amount) private returns (bool ok) {
        (bool success, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        // A token may return nothing, or a boolean that must be true
        ok = success && (data.length == 0 || (data.length >= 32 && abi.decode(data, (bool))));
    }

    /**
     * @dev Run the compound budget through the hook's {IGlueHookCompound-executeCompound} self-call.
     *      A failed compound (any revert in the mint) is a valid outcome: nothing was consumed, the
     *      whole budget stays in the carry, and the harvest never blocks on the compound.
     * @param mainIsZero True when the pot's main is `currency0`.
     * @param id The pool identifier.
     * @param key The pool key.
     * @param budgetMain Main-side compound budget (this harvest's slice + the carry).
     * @param budgetSec Secondary-side compound budget (this harvest's slice + the carry).
     * @param inUnlock True when the PoolManager is already unlocked.
     * @return uMain Main the mint actually consumed.
     * @return uSec Secondary the mint actually consumed.
     */
    function _compoundSlice(
        bool mainIsZero,
        bytes32 id,
        IPoolManagerMin.PoolKey calldata key,
        uint256 budgetMain,
        uint256 budgetSec,
        bool inUnlock
    ) private returns (uint256 uMain, uint256 uSec) {
        (uint256 a0, uint256 a1) = mainIsZero ? (budgetMain, budgetSec) : (budgetSec, budgetMain);

        // Self-call (address(this) is the hook): a revert in the mint abandons the compound alone
        try IGlueHookCompound(address(this)).executeCompound(id, key, a0, a1, inUnlock)
            returns (uint256 u0, uint256 u1)
        {
            (uMain, uSec) = mainIsZero ? (u0, u1) : (u1, u0);
        } catch {}
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // COMPOUND MINT
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice The compound mint's body (the hook's {executeCompound} is a thin self-gated forwarder).
     * @dev Converts the compound budget (this harvest's slice + the standing carry) into liquidity
     *      at the LIVE price across the program's own fixed range - anchored on whichever side
     *      binds ({_liquidityForFees}) - and mints it into the program's position. Inside a swap
     *      (`inUnlock`) the PoolManager is already unlocked, so the mint is a direct
     *      `modifyLiquidity` settled from the hook's own balance (the fees this frame just took
     *      plus the carried funds it already held); outside, it opens the hook's ADD unlock with
     *      the transient PAYER unset, which settles from the hook's balance the same way. Either
     *      way the mint may NEVER consume more than the budget put on the table: a round-up edge
     *      abandons the whole compound (the split's try/catch leaves the budget in the carry)
     *      rather than touching a wei of pot, parked, held or owed money.
     * @param g The pool's program.
     * @param pm The PoolManager.
     * @param id The pool identifier.
     * @param key The pool key.
     * @param amount0 Currency0 budget (the compound slice + carry on that side).
     * @param amount1 Currency1 budget.
     * @param inUnlock True when the PoolManager is already unlocked (the in-swap frame).
     * @return used0 Currency0 the mint actually consumed.
     * @return used1 Currency1 the mint actually consumed.
     */
    function compound(
        IGlueHook.Program storage g,
        address pm,
        bytes32 id,
        IPoolManagerMin.PoolKey calldata key,
        uint256 amount0,
        uint256 amount1,
        bool inUnlock
    ) external returns (uint256 used0, uint256 used1) {
        uint128 liquidity = _liquidityForFees(pm, g, id, amount0, amount1);
        // A budget too small (or one-sided against an in-range position) compounds nothing —
        // it stays in the carry and retries next harvest
        if (liquidity == 0) return (0, 0);

        int128 d0;
        int128 d1;
        if (inUnlock) {
            // Already unlocked (the in-swap frame): mint directly and settle what the mint owes
            (int256 callerDelta, ) = IPoolManagerMin(pm).modifyLiquidity(
                key,
                IPoolManagerMin.ModifyLiquidityParams({
                    tickLower: g.tickLower,
                    tickUpper: g.tickUpper,
                    liquidityDelta: int256(uint256(liquidity)),
                    salt: GluedV4Core.positionSalt(address(this))
                }),
                ""
            );
            (d0, d1) = _unpack(callerDelta);
            // The frame collected the position's fees before splitting, so a positive leg is
            // impossible - anything else means the delta is not a pure mint, so abandon
            if (d0 > 0 || d1 > 0) revert IGlueHook.QuoteMismatch();
            if (d0 < 0) _settle(pm, key.currency0, uint256(uint128(-d0)));
            if (d1 < 0) _settle(pm, key.currency1, uint256(uint128(-d1)));
        } else {
            // Outside any unlock (manual harvest, liquidity ops): the hook's ADD unlock. The
            // transient PAYER is unset here, so the ERC20 legs settle from the hook's own balance -
            // exactly the fees this compound is spending.
            bytes memory ret = IPoolManagerMin(pm).unlock(
                abi.encode(
                    OP_ADD_LIQUIDITY,
                    key,
                    int256(uint256(liquidity)),
                    GluedV4Core.positionSalt(address(this)),
                    g.tickLower,
                    g.tickUpper
                )
            );
            (d0, d1) = abi.decode(ret, (int128, int128));
        }

        used0 = d0 < 0 ? uint256(uint128(-d0)) : 0;
        used1 = d1 < 0 ? uint256(uint128(-d1)) : 0;
        // The mint may never outspend the budget; a 1-wei round-up edge abandons the compound
        if (used0 > amount0 || used1 > amount1) revert IGlueHook.QuoteMismatch();

        g.liquidity += liquidity;
        emit Compounded(id, liquidity, used0, used1);
    }

    /**
     * @dev Liquidity the compound budget can fund across the program's fixed range at the live
     *      price, per the standard three cases: below the range only currency0 funds it, above it
     *      only currency1, inside it whichever side binds (the minimum). Floor math end to end, so
     *      the amounts the mint then rounds up stay within the budget in all but 1-wei edge cases -
     *      which {compound}'s budget check catches.
     * @param pm The PoolManager.
     * @param g The pool's program.
     * @param id The pool identifier.
     * @param amount0 Currency0 budget.
     * @param amount1 Currency1 budget.
     * @return liquidity Liquidity units the budget funds (0 = nothing to compound).
     */
    function _liquidityForFees(
        address pm,
        IGlueHook.Program storage g,
        bytes32 id,
        uint256 amount0,
        uint256 amount1
    ) private view returns (uint128 liquidity) {
        uint160 sqrtLower = GluedV4Core.getSqrtRatioAtTick(g.tickLower);
        uint160 sqrtUpper = GluedV4Core.getSqrtRatioAtTick(g.tickUpper);
        uint160 sqrtP = GluedV4Core.getSlot0(pm, id).sqrtPriceX96;

        if (sqrtP <= sqrtLower) {
            // Price below the range: the position is all currency0
            return GluedV4Core.getLiquidityForAmount0(sqrtLower, sqrtUpper, amount0);
        }
        if (sqrtP >= sqrtUpper) {
            // Price above the range: the position is all currency1
            return GluedV4Core.getLiquidityForAmount1(sqrtLower, sqrtUpper, amount1);
        }
        // In range: both sides fund it and the smaller one binds
        return GluedV4Core.getLiquidityForAmounts(sqrtP, sqrtLower, sqrtUpper, amount0, amount1);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PRIMITIVES (library-local copies of the callback contract's internals)
    // ═══════════════════════════════════════════════════════════════════════════════

    /// @dev Pay a negative delta into the PoolManager: value-settle for native, sync → transfer →
    ///      settle for an ERC20. Runs under delegatecall, so the value and the tokens are the
    ///      hook's own - the fees the frame just collected.
    function _settle(address pm, address currency, uint256 amount) private {
        if (currency == address(0)) {
            IPoolManagerMin(pm).settle{value: amount}();
        } else {
            IPoolManagerMin(pm).sync(currency);
            IERC20(currency).safeTransfer(pm, amount);
            IPoolManagerMin(pm).settle();
        }
    }

    /// @dev Split a packed `BalanceDelta` into its two signed 128-bit legs.
    function _unpack(int256 delta) private pure returns (int128 amount0, int128 amount1) {
        assembly ("memory-safe") {
            amount0 := sar(128, delta)
            amount1 := signextend(15, delta)
        }
    }
}
