// SPDX-License-Identifier: MIT
// https://github.com/glue-finance/GlueHook/blob/main/LICENCE.txt
//
// License: MIT — this library is intentionally MIT-licensed for ecosystem reuse.
// It has no dependency on Glue-specific logic and can be used standalone by any
// project that needs minimal Uniswap V4 integration — native or ERC20/ERC20 pools,
// any decimals, full-range or custom tick ranges.

pragma solidity ^0.8.35;

import {GluedMath} from "./GluedMath.sol";

/// @notice Single protocol-wide failure error (selector 0x82b42900). File-level so both the
///         `GluedV4Core` library and the `GluedV4Callback` base revert with one selector,
///         matching the rest of the codebase. Named imports keep it from leaking to consumers.
error Unauthorized();

/**
 * ██╗   ██╗██╗  ██╗    ███╗   ███╗██╗███╗   ██╗
 * ██║   ██║██║  ██║    ████╗ ████║██║████╗  ██║
 * ██║   ██║███████║    ██╔████╔██║██║██╔██╗ ██║
 * ╚██╗ ██╔╝╚════██║    ██║╚██╔╝██║██║██║╚██╗██║
 *  ╚████╔╝      ██║    ██║ ╚═╝ ██║██║██║ ╚████║
 *   ╚═══╝       ╚═╝    ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝
 *
 * @title GluedV4Core - Minimal Uniswap V4 Library
 * @author La-Li-Lu-Le-Lo (@lalilulel0x) - Glue Finance
 *
 * @notice Standalone library + abstract callback contract for interacting with
 *         Uniswap V4 PoolManager. Provides full-range and custom-range liquidity,
 *         fee collection, exact-input swaps, and on-chain price/fee reading —
 *         as a compact single-file V4 integration.
 *
 * @dev
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │                    PURPOSE & DESIGN                                             │
 * │                                                                                 │
 * │  GluedV4Core is a minimal, self-contained V4 integration. The core primitives   │
 * │  (tick math, liquidity math, swap-step quoting, extsload state reads, the       │
 * │  settle/take callback) are PAIR-AGNOSTIC: they operate on whatever PoolKey the  │
 * │  caller supplies — native or ERC20/ERC20, any token decimals (V4 itself never   │
 * │  reads `decimals()`; everything is raw units). Only the `createPoolKey`         │
 * │  convenience wrapper builds a native/TOKEN key (native pinned as currency0 by   │
 * │  V4's own sorting rule) — consumers with ERC20/ERC20 pools construct their own  │
 * │  sorted keys, exactly as GlueHook does. The library omits:                      │
 * │                                                                                 │
 * │    ✗ Multi-hop routing                                                          │
 * │    ✗ Position NFTs (uses salt-based ownership instead)                          │
 * │                                                                                 │
 * │  In exchange, the entire V4 surface fits in ~490 lines of library + ~340 lines  │
 * │  of callback contract, with no external dependencies beyond GluedMath.          │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │                    TWO COMPONENTS                                               │
 * │                                                                                 │
 * │  1. library GluedV4Core                                                         │
 * │     Pure/view functions — no state, no inheritance needed.                      │
 * │     Pool key construction, liquidity math, price/fee reading via extsload.      │
 * │                                                                                 │
 * │  2. abstract contract GluedV4Callback                                           │
 * │     Must be inherited by the contract that owns V4 positions.                   │
 * │     Handles the unlock→callback→settle/take pattern.                            │
 * │     Requires implementing `_transferToken(token, to, amount)`.                  │
 * │                                                                                 │
 * │  ┌─────────────────────────────────┐   ┌──────────────────────────────────────┐ │
 * │  │  library GluedV4Core            │   │  abstract GluedV4Callback            │ │
 * │  │                                 │   │                                      │ │
 * │  │  Pool state reading:            │   │  • _addLiquidityV4()                 │ │
 * │  │  • getSlot0()                   │   │  • _removeLiquidityV4()              │ │
 * │  │  • isPoolInitialized()          │   │  • _collectFeesV4()                  │ │
 * │  │  • getPoolLiquidity()           │   │  • _swapV4()                         │ │
 * │  │                                 │   │  • unlockCallback()                  │ │
 * │  │  Fee reading:                   │   │  • _transferToken() [abstract]       │ │
 * │  │  • getFeeGrowthGlobals()        │   └──────────────────────────────────────┘ │
 * │  │  • getFeeGrowthInside()         │                                          │ │
 * │  │  • getPositionInfo()            │                                          │ │
 * │  │  • getPendingV4Fees()           │                                          │ │
 * │  │                                 │                                          │ │
 * │  │  Price helpers:                 │                                          │ │
 * │  │  • sqrtPriceToPrice()           │                                          │ │
 * │  │  • sqrtPriceToInversePrice()    │                                          │ │
 * │  │                                 │                                          │ │
 * │  │  Tick math:                     │                                          │ │
 * │  │  • getSqrtRatioAtTick()         │                                          │ │
 * │  │                                 │                                          │ │
 * │  │  Liquidity math:                │                                          │ │
 * │  │  • getLiquidityForAmounts()     │                                          │ │
 * │  │  • getAmountsForLiquidity()     │                                          │ │
 * │  │                                 │                                          │ │
 * │  │  Pool key / utils:              │                                          │ │
 * │  │  • createPoolKey()              │                                          │ │
 * │  │  • positionSalt()               │                                          │ │
 * │  │  • toUint128()                  │                                          │ │
 * │  │  • singleArray()                │                                          │ │
 * │  └────────────────────────────────────────────────────────────────────────────┘ │                                          
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │                    V4 UNLOCK CALLBACK PATTERN                                   │
 * │                                                                                 │
 * │  All V4 operations follow the same lifecycle:                                   │
 * │                                                                                 │
 * │    YourContract                  PoolManager                                    │
 * │         │                            │                                          │
 * │         │── unlock(encodedData) ────→│                                          │
 * │         │                            │── unlockCallback(data) ──→│              │
 * │         │                            │                           │              │
 * │         │                            │   decode opType           │              │
 * │         │                            │   ├─ ADD_LIQUIDITY        │              │
 * │         │                            │   │  modifyLiquidity(+)   │              │
 * │         │                            │   │  settle (pay tokens)  │              │
 * │         │                            │   │                       │              │
 * │         │                            │   ├─ REMOVE_LIQUIDITY     │              │
 * │         │                            │   │  modifyLiquidity(-)   │              │
 * │         │                            │   │  take (receive tokens)│              │
 * │         │                            │   │                       │              │
 * │         │                            │   ├─ COLLECT_FEES         │              │
 * │         │                            │   │  modifyLiquidity(0)   │              │
 * │         │                            │   │  take (receive fees)  │              │
 * │         │                            │   │                       │              │
 * │         │                            │   └─ SWAP                 │              │
 * │         │                            │      swap()               │              │
 * │         │                            │      settle + take        │              │
 * │         │                            │                           │              │
 * │         │←── return encoded deltas ──│←──────────────────────────│              │
 * │         │                            │                                          │
 * │    decode deltas                     │                                          │
 * │    (ethUsed, tokenUsed, etc.)        │                                          │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │                    SETTLEMENT RULES                                             │
 * │                                                                                 │
 * │  After modifyLiquidity or swap, PoolManager tracks a balance delta.             │
 * │  Negative delta = you owe tokens → call settle.                                 │
 * │  Positive delta = PM owes you   → call take.                                    │
 * │                                                                                 │
 * │  For native ETH:   settle{value: amount}()                                      │
 * │  For ERC20:         sync(currency) → transfer → settle()                        │
 * │                     (sync snapshots balance, transfer moves tokens,             │
 * │                      settle verifies the delta matches)                         │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │                    PER-USER POSITION ISOLATION                                  │
 * │                                                                                 │
 * │  V4 identifies positions by (poolKey, tickLower, tickUpper, owner, salt).       │
 * │  This library uses:                                                             │
 * │    - tickLower/tickUpper = MIN_TICK/MAX_TICK by default (full-range)            │
 * │      Custom tick ranges are supported via tickLower/tickUpper parameters.       │
 * │    - owner = address(this) (the inheriting contract)                            │
 * │    - salt = bytes32(uint160(userAddress)) (unique per user)                     │
 * │                                                                                 │
 * │  This means each user gets an isolated V4 position within the same pool.        │
 * │  Fee accrual is tracked per-position by V4 itself, so fee collection            │
 * │  returns only THAT user's earned fees. No cross-user leakage is possible.       │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │                    PRICE READING (via extsload)                                 │
 * │                                                                                 │
 * │  Pool state is read directly from PoolManager storage using extsload            │
 * │  (EIP-2330), matching the StateLibrary pattern from v4-core.                    │
 * │                                                                                 │
 * │  Slot layout for Pool.State:                                                    │
 * │    base+0 (Slot0): sqrtPriceX96 | tick | protocolFee | lpFee                    │
 * │    base+3: liquidity (uint128)                                                  │
 * │                                                                                 │
 * │  sqrtPriceX96 → price conversion:                                               │
 * │    priceTokenPerEth = (sqrtPrice / 2^96)^2 * 1e18                               │
 * │    priceEthPerToken = 2^192 * 1e18 / sqrtPrice^2                                │
 * │  Both use GluedMath.md512 for 512-bit intermediate precision.                   │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │                    USAGE EXAMPLE                                                │
 * │                                                                                 │
 * │  contract MyLP is GluedV4Callback {                                             │
 * │                                                                                 │
 * │      constructor(address pm) GluedV4Callback(pm) {}                             │
 * │                                                                                 │
 * │      function _transferToken(                                                   │
 * │          address token, address to, uint256 amount                              │
 * │      ) internal override {                                                      │
 * │          IERC20(token).transfer(to, amount);                                    │
 * │      }                                                                          │
 * │                                                                                 │
 * │      function addLP(address token, uint256 ethAmt, uint256 tokAmt) external {   │
 * │          (IPoolManagerMin.PoolKey memory key, ) =                               │
 * │              GluedV4Core.createPoolKey(token, 3000);                            │
 * │          _addLiquidityV4(key, ethAmt, tokAmt, msg.sender, 0, 0);                │
 * │      }                                                                          │
 * │                                                                                 │
 * │      function removeLP(address token, uint128 liq) external {                   │
 * │          (IPoolManagerMin.PoolKey memory key, ) =                               │
 * │              GluedV4Core.createPoolKey(token, 3000);                            │
 * │          _removeLiquidityV4(key, liq, msg.sender, msg.sender, 0, 0);            │
 * │      }                                                                          │
 * │                                                                                 │
 * │      function collectFees(address token) external {                             │
 * │          (IPoolManagerMin.PoolKey memory key, ) =                               │
 * │              GluedV4Core.createPoolKey(token, 3000);                            │
 * │          _collectFeesV4(key, msg.sender, msg.sender, 0, 0);                     │
 * │      }                                                                          │
 * │                                                                                 │
 * │      function getPrice(address token) external view returns (uint256) {         │
 * │          (, bytes32 poolId) = GluedV4Core.createPoolKey(token, 3000);           │
 * │          GluedV4Core.Slot0 memory s = GluedV4Core.getSlot0(PM, poolId);         │
 * │          return GluedV4Core.sqrtPriceToPrice(s.sqrtPriceX96);                   │
 * │      }                                                                          │
 * │  }                                                                              │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * Features:
 * - Full-range liquidity by default (custom tick ranges supported)
 * - Pair-agnostic primitives: any PoolKey — native or ERC20/ERC20, any decimals
 *   (`createPoolKey` is a native/TOKEN convenience: V4 sorts native as currency0)
 * - Add/Remove liquidity via unlock callback
 * - Per-user isolated positions via salt-based ownership
 * - Fee collection (per-position, no cross-user leakage)
 * - Exact-input swaps with external slippage control
 * - On-chain price reading via extsload (no oracle needed)
 * - 512-bit precision for all price conversions (GluedMath.md512)
 */

// ═══════════════════════════════════════════════════════════════════════════════
// MINIMAL V4 INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

/// @notice Minimal PoolManager interface for V4 operations
interface IPoolManagerMin {
    /// @dev V4 PoolKey uniquely identifies a pool. The poolId is keccak256(abi.encode(key)).
    struct PoolKey {
        // Lower-address currency (native = address(0) always sorts first)
        address currency0;
        // Higher-address currency
        address currency1;
        // Pool fee tier (e.g. 3000 = 0.3%)
        uint24 fee;
        // Minimum tick movement; must match the fee tier convention
        int24 tickSpacing;
        // Hook contract address (address(0) = no hooks)
        address hooks;
    }
    
    /// @dev Parameters for PoolManager.modifyLiquidity(). Positive liquidityDelta = add, negative = remove.
    struct ModifyLiquidityParams {
        // Lower tick boundary for the LP position
        int24 tickLower;
        // Upper tick boundary for the LP position
        int24 tickUpper;
        // Liquidity to add (positive) or remove (negative); 0 = collect fees only
        int256 liquidityDelta;
        // Position identifier to isolate positions per user within the same pool
        bytes32 salt;
    }
    
    /// @dev Parameters for PoolManager.swap(). amountSpecified < 0 = exact input, > 0 = exact output.
    struct SwapParams {
        // true = sell currency0 (ETH) for currency1 (token), false = reverse
        bool zeroForOne;
        // Input amount (negative = exact-input, positive = exact-output)
        int256 amountSpecified;
        // Price boundary: swap stops here if reached (slippage limit)
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Initialize the pool
    /// @param key The pool key
    /// @param sqrtPriceX96 The initial sqrt price
    /// @dev Returns the tick of the pool
    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick);
    
    /// @notice Unlock the pool and execute the callback
    /// @param data The data to unlock the pool
    /// @dev Returns the data returned from the callback
    function unlock(bytes calldata data) external returns (bytes memory);
    
    /// @notice Modify the liquidity of the pool
    /// @param key The pool key
    /// @param params The parameters for the modify liquidity operation
    /// @param hookData The data to pass to the hook
    /// @dev Returns (BalanceDelta callerDelta, BalanceDelta feesAccrued) as (int256, int256)
    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params, bytes calldata hookData) external returns (int256 callerDelta, int256 feesAccrued);
    
    /// @notice Swap the pool
    /// @param key The pool key
    /// @param params The parameters for the swap operation
    /// @param hookData The data to pass to the hook
    /// @dev Returns BalanceDelta swapDelta as int256
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256 swapDelta);
    
    /// @notice Settle the pool
    /// @dev For native ETH: settle{value: amount}(). For ERC20: sync(currency) + transfer + settle()
    function settle() external payable returns (uint256);
    
    /// @notice Sync the ERC20 balance before transfer
    /// @param currency The ERC20 token to sync
    /// @dev Checkpoint ERC20 balance before transfer. Required before settle() for ERC20.
    function sync(address currency) external;
    
    /// @notice Take the tokens from the pool
    /// @param currency The ERC20 token to take
    /// @param to The address to receive the tokens
    /// @param amount The amount of tokens to take
    function take(address currency, address to, uint256 amount) external;
    
    /// @notice Read the raw storage slot
    /// @param slot The slot to read
    /// @dev Read raw storage slot (EIP-2330). Used for reading Slot0 via StateLibrary pattern.
    function extsload(bytes32 slot) external view returns (bytes32);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN LIBRARY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @title GluedV4Core
 * @notice Minimal V4 operations library for Glue LP integration
 */
library GluedV4Core {
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════════
    
    // Default tick spacing (callers may override in the PoolKey for custom pools)
    int24 internal constant TICK_SPACING = 120;
    // Lowest valid tick aligned to default TICK_SPACING (full range, spacing 120)
    int24 internal constant MIN_TICK = -887160;
    // Highest valid tick aligned to default TICK_SPACING (full range, spacing 120)
    int24 internal constant MAX_TICK = 887160;
    // Absolute V4 TickMath max tick (before spacing alignment); used by fullRangeTicks()
    int24 internal constant MAX_USABLE_TICK = 887272;
    
    // V4 constants from TickMath.sol
    // Minimum sqrtPriceX96 (tick = MIN_TICK)
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    // Maximum sqrtPriceX96 (tick = MAX_TICK)
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;
    
    // 2^96, the fixed-point scaling factor for Q64.96 representations
    uint256 internal constant Q96 = 0x1000000000000000000000000;
    // Default fee tier: 0.3% (3000 millionths)
    uint24 internal constant DEFAULT_FEE = 3000;
    
    /// @dev Index of the pools mapping in V4 PoolManager storage (StateLibrary.POOLS_SLOT = 6)
    bytes32 internal constant POOLS_SLOT = bytes32(uint256(6));
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /// @dev Decoded V4 Pool Slot0: price, tick, and fee settings for a pool.
    ///      Unpacked from PoolManager storage via extsload in getSlot0().
    struct Slot0 {
        // Current sqrt(price) in Q64.96 format (0 = pool not initialized)
        uint160 sqrtPriceX96;
        // Current tick corresponding to sqrtPriceX96 (discrete price level)
        int24 tick;
        // Protocol fee setting (packed: lower 12 bits = fee0, upper 12 bits = fee1)
        uint24 protocolFee;
        // LP fee tier (e.g. 3000 = 0.3%)
        uint24 lpFee;
    }
    
    /// @dev Result of an _addLiquidityV4 call: how much liquidity was minted and what was consumed.
    ///      ethFees/tokenFees are non-zero when adding to an existing position that had accrued fees.
    struct AddLiquidityResult {
        // V4 LP liquidity units minted for this deposit
        uint128 liquidity;
        // ETH (currency0) consumed by the new or expanded position
        uint256 ethUsed;
        // Token (currency1) consumed by the new or expanded position
        uint256 tokenUsed;
        // ETH fees auto-collected from existing position during this add (if any)
        uint256 ethFees;
        // Token fees auto-collected from existing position during this add (if any)
        uint256 tokenFees;
    }
    
    /// @dev Result of a _removeLiquidityV4 call: how much ETH and tokens were returned.
    struct RemoveLiquidityResult {
        // ETH (currency0) returned from the removed position (principal + fees)
        uint256 ethReceived;
        // Token (currency1) returned from the removed position (principal + fees)
        uint256 tokenReceived;
    }
    
    /// @dev Result of a _swapV4 call: the exact amounts consumed and received.
    struct SwapResult {
        // Amount of input currency consumed by the swap
        uint256 amountIn;
        // Amount of output currency received from the swap
        uint256 amountOut;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // POOL STATE READING (via extsload - matches StateLibrary)
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Read Slot0 from PoolManager via extsload (matches V4 StateLibrary.getSlot0)
     * @dev Reads a single 32-byte storage slot from PoolManager containing sqrtPriceX96, tick,
     *      protocolFee, and lpFee packed together. Uses bit-shifting to unpack each field.
     * @param poolManager Address of the Uniswap V4 PoolManager contract
     * @param poolId keccak256 hash of the PoolKey for this pool
     * @return slot0 Decoded Slot0 struct containing price, tick, and fee data
     */
    function getSlot0(address poolManager, bytes32 poolId) internal view returns (Slot0 memory slot0) {
        // Compute the storage slot for this pool's Slot0 (pools mapping base + poolId)
        bytes32 stateSlot = keccak256(abi.encodePacked(poolId, POOLS_SLOT));
        // Read raw 32-byte slot from PoolManager's storage via EIP-2330
        bytes32 data = IPoolManagerMin(poolManager).extsload(stateSlot);
        
        assembly {
            // Extract bottom 160 bits → sqrtPriceX96
            mstore(slot0, and(data, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF))
            // Extract bits 160-183 → tick (sign-extended from 24 bits)
            mstore(add(slot0, 0x20), signextend(2, shr(160, data)))
            // Extract bits 184-207 → protocolFee (unsigned 24 bits)
            mstore(add(slot0, 0x40), and(shr(184, data), 0xFFFFFF))
            // Extract bits 208-231 → lpFee (unsigned 24 bits)
            mstore(add(slot0, 0x60), and(shr(208, data), 0xFFFFFF))
        }
    }
    
    /**
     * @notice Check if a V4 pool has been initialized by reading its sqrtPriceX96 from Slot0
     * @dev A pool is initialized if and only if sqrtPriceX96 != 0. Uninitialized pools return
     *      sqrtPriceX96 = 0 because no price has been set via PoolManager.initialize().
     * @param poolManager Address of the Uniswap V4 PoolManager contract
     * @param poolId keccak256 hash of the PoolKey for this pool
     * @return True if the pool has been initialized, false otherwise
     */
    function isPoolInitialized(address poolManager, bytes32 poolId) internal view returns (bool) {
        // Read the pool's Slot0 to check if price has been set
        Slot0 memory slot0 = getSlot0(poolManager, poolId);
        // Non-zero sqrtPrice means the pool has been initialized
        return slot0.sqrtPriceX96 != 0;
    }

    /**
     * @notice Read a pool's total active liquidity from PoolManager via extsload
     * @dev Liquidity is stored at slot offset +3 from the pool's base storage slot
     *      in V4's Pool.State struct layout (matches StateLibrary.getLiquidity).
     * @param poolManager Address of the Uniswap V4 PoolManager contract
     * @param poolId keccak256 hash of the PoolKey for this pool
     * @return liquidity Total active liquidity in the pool (sum of all in-range positions)
     */
    function getPoolLiquidity(address poolManager, bytes32 poolId) internal view returns (uint128 liquidity) {
        // Compute base storage slot for this pool
        bytes32 stateSlot = keccak256(abi.encodePacked(poolId, POOLS_SLOT));
        // Liquidity lives at base + 3 in V4's Pool.State struct layout
        bytes32 liquiditySlot = bytes32(uint256(stateSlot) + 3);
        // Read raw 32-byte value from PoolManager storage
        bytes32 data = IPoolManagerMin(poolManager).extsload(liquiditySlot);
        // Cast lower 128 bits to uint128 (liquidity is stored as uint128)
        liquidity = uint128(uint256(data));
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // V4 LP FEE READING (via extsload - matches StateLibrary)
    // ═══════════════════════════════════════════════════════════════════════════════

    /// @dev Slot offset from Pool.State base to feeGrowthGlobal0X128 (V4 Pool.State slot layout)
    uint256 private constant FEE_GROWTH_GLOBAL0_OFFSET = 1;
    /// @dev Slot offset from Pool.State base to the ticks mapping (V4 Pool.State slot layout)
    uint256 private constant TICKS_OFFSET = 4;
    /// @dev Slot offset from Pool.State base to the positions mapping (V4 Pool.State slot layout)
    uint256 private constant POSITIONS_OFFSET = 6;
    /// @dev 2^128, used as the fixed-point denominator in V4 fee growth calculations
    uint256 private constant Q128 = 0x100000000000000000000000000000000;

    /**
     * @notice Read global fee growth accumulators from PoolManager
     * @param poolManager V4 PoolManager address
     * @param poolId Pool identifier
     * @return feeGrowthGlobal0 Global fee growth for currency0 (ETH)
     * @return feeGrowthGlobal1 Global fee growth for currency1 (token)
     */
    function getFeeGrowthGlobals(
        address poolManager, bytes32 poolId
    ) internal view returns (uint256 feeGrowthGlobal0, uint256 feeGrowthGlobal1) {
        // Compute pool's base storage slot
        bytes32 stateSlot = keccak256(abi.encodePacked(poolId, POOLS_SLOT));
        // Advance to feeGrowthGlobal0 (slot+1)
        bytes32 feeSlot = bytes32(uint256(stateSlot) + FEE_GROWTH_GLOBAL0_OFFSET);
        // Read currency0 global accumulator
        feeGrowthGlobal0 = uint256(IPoolManagerMin(poolManager).extsload(feeSlot));
        // Read currency1 global accumulator (slot+2)
        feeGrowthGlobal1 = uint256(IPoolManagerMin(poolManager).extsload(bytes32(uint256(feeSlot) + 1)));
    }

    /**
     * @notice Read tick fee growth outside values
     * @param poolManager V4 PoolManager address
     * @param poolId Pool identifier
     * @param tick Tick to read
     * @return feeGrowthOutside0 Fee growth outside for currency0
     * @return feeGrowthOutside1 Fee growth outside for currency1
     */
    function getTickFeeGrowthOutside(
        address poolManager, bytes32 poolId, int24 tick
    ) internal view returns (uint256 feeGrowthOutside0, uint256 feeGrowthOutside1) {
        // Pool's base storage slot
        bytes32 stateSlot = keccak256(abi.encodePacked(poolId, POOLS_SLOT));
        // Advance to the ticks mapping (slot+4)
        bytes32 ticksSlot = bytes32(uint256(stateSlot) + TICKS_OFFSET);
        // Hash tick key into mapping slot
        bytes32 tickSlot = keccak256(abi.encodePacked(int256(tick), ticksSlot));
        // V4 TickInfo struct layout per slot:
        //   slot+0: liquidityGross (128 bits) | liquidityNet (128 bits)
        //   slot+1: feeGrowthOutside0 (full 256 bits)
        //   slot+2: feeGrowthOutside1 (full 256 bits)
        // Read currency0 fee-outside accumulator
        feeGrowthOutside0 = uint256(IPoolManagerMin(poolManager).extsload(bytes32(uint256(tickSlot) + 1)));
        // Read currency1 fee-outside accumulator
        feeGrowthOutside1 = uint256(IPoolManagerMin(poolManager).extsload(bytes32(uint256(tickSlot) + 2)));
    }

    /**
     * @notice Calculate fee growth inside a tick range
     * @dev Matches V4 StateLibrary.getFeeGrowthInside logic
     * @param poolManager V4 PoolManager address
     * @param poolId Pool identifier
     * @param tickLower Lower tick bound
     * @param tickUpper Upper tick bound
     * @return feeGrowthInside0 Fee growth inside for currency0
     * @return feeGrowthInside1 Fee growth inside for currency1
     */
    function getFeeGrowthInside(
        address poolManager, bytes32 poolId, int24 tickLower, int24 tickUpper
    ) internal view returns (uint256 feeGrowthInside0, uint256 feeGrowthInside1) {
        // Read current tick to determine below/above regions
        Slot0 memory slot0 = getSlot0(poolManager, poolId);
        // Read global fee accumulators (monotonically increasing)
        (uint256 fg0, uint256 fg1) = getFeeGrowthGlobals(poolManager, poolId);
        // Fee growth outside the lower tick boundary
        (uint256 lowerOut0, uint256 lowerOut1) = getTickFeeGrowthOutside(poolManager, poolId, tickLower);
        // Fee growth outside the upper tick boundary
        (uint256 upperOut0, uint256 upperOut1) = getTickFeeGrowthOutside(poolManager, poolId, tickUpper);

        // Compute "fee growth below": fees accumulated below the lower tick.
        // V4 convention: feeGrowthOutside is stored relative to the current tick crossing direction.
        // If current tick >= tickLower, lowerOut directly represents "below"; otherwise mirror via global.
        // Fee growth below the lower tick boundary (currency0)
        uint256 feeGrowthBelow0;
        // Fee growth below the lower tick boundary (currency1)
        uint256 feeGrowthBelow1;
        if (slot0.tick >= tickLower) {
            // Current price is above (or at) lower tick: lowerOut = below
            feeGrowthBelow0 = lowerOut0;
            feeGrowthBelow1 = lowerOut1;
        } else {
            // Current price is below lower tick: mirror via global
            feeGrowthBelow0 = fg0 - lowerOut0;
            feeGrowthBelow1 = fg1 - lowerOut1;
        }

        // Compute "fee growth above": fees accumulated above the upper tick.
        // If current tick < tickUpper, upperOut directly represents "above"; otherwise mirror via global.
        uint256 feeGrowthAbove0;
        uint256 feeGrowthAbove1;
        if (slot0.tick < tickUpper) {
            // Current price is below upper tick: upperOut = above
            feeGrowthAbove0 = upperOut0;
            feeGrowthAbove1 = upperOut1;
        } else {
            // Current price is above upper tick: mirror via global
            feeGrowthAbove0 = fg0 - upperOut0;
            feeGrowthAbove1 = fg1 - upperOut1;
        }

        unchecked {
            // Fee growth inside = global − below − above (wrapping arithmetic intentional per V4 spec)
            feeGrowthInside0 = fg0 - feeGrowthBelow0 - feeGrowthAbove0;
            feeGrowthInside1 = fg1 - feeGrowthBelow1 - feeGrowthAbove1;
        }
    }

    /**
     * @notice Read position's last recorded fee growth snapshot
     * @param poolManager V4 PoolManager address
     * @param poolId Pool identifier
     * @param owner Position owner contract (typically address(this))
     * @param tickLower Lower tick bound
     * @param tickUpper Upper tick bound
     * @param salt Position salt (user address as bytes32)
     * @return liquidity Position liquidity
     * @return feeGrowthInside0Last Last recorded fee growth inside for currency0
     * @return feeGrowthInside1Last Last recorded fee growth inside for currency1
     */
    function getPositionInfo(
        address poolManager, bytes32 poolId, address owner,
        int24 tickLower, int24 tickUpper, bytes32 salt
    ) internal view returns (uint128 liquidity, uint256 feeGrowthInside0Last, uint256 feeGrowthInside1Last) {
        // Derive V4 position key (matches Position.calculatePositionKey)
        bytes32 positionKey = keccak256(abi.encodePacked(owner, tickLower, tickUpper, salt));
        // Pool's base storage slot
        bytes32 stateSlot = keccak256(abi.encodePacked(poolId, POOLS_SLOT));
        // Advance to positions mapping (slot+6)
        bytes32 positionsSlot = bytes32(uint256(stateSlot) + POSITIONS_OFFSET);
        // Hash position key into mapping slot
        bytes32 posSlot = keccak256(abi.encodePacked(positionKey, positionsSlot));
        // V4 Position.State struct layout:
        //   slot+0: liquidity (uint128, packed in lower 128 bits)
        //   slot+1: feeGrowthInside0LastX128 (uint256) — last recorded fee growth for currency0
        //   slot+2: feeGrowthInside1LastX128 (uint256) — last recorded fee growth for currency1
        // Extract lower 128 bits as liquidity
        liquidity = uint128(uint256(IPoolManagerMin(poolManager).extsload(posSlot)));
        // Last fee growth snapshot for currency0
        feeGrowthInside0Last = uint256(IPoolManagerMin(poolManager).extsload(bytes32(uint256(posSlot) + 1)));
        // Last fee growth snapshot for currency1
        feeGrowthInside1Last = uint256(IPoolManagerMin(poolManager).extsload(bytes32(uint256(posSlot) + 2)));
    }

    /**
     * @notice Calculate pending V4 LP fees for a position (view-only, no collection)
     * @dev Computes: liquidity * (currentFeeGrowthInside - lastFeeGrowthInside) / Q128
     * @param poolManager V4 PoolManager address
     * @param poolId Pool identifier
     * @param owner Position owner contract
     * @param tickLower Lower tick bound (0 = MIN_TICK)
     * @param tickUpper Upper tick bound (0 = MAX_TICK)
     * @param salt Position salt (user address as bytes32)
     * @return pendingFees0 Pending fees for currency0 (ETH)
     * @return pendingFees1 Pending fees for currency1 (token)
     */
    function getPendingV4Fees(
        address poolManager, bytes32 poolId, address owner,
        int24 tickLower, int24 tickUpper, bytes32 salt
    ) internal view returns (uint256 pendingFees0, uint256 pendingFees1) {
        // Resolve sentinel (0,0) to full-range tick bounds.
        // NOTE: this view uses the default-spacing bounds (±887160). For Glue (spacing 120) this
        // matches the bounds the liquidity ops resolve via fullRangeTicks(120). Callers using a
        // non-default tickSpacing must pass explicit ticks here to match their actual position key.
        if (tickLower == 0 && tickUpper == 0) {
            // Use full-range lower tick when no custom range specified
            tickLower = MIN_TICK;
            // Use full-range upper tick when no custom range specified
            tickUpper = MAX_TICK;
        }

        // Read the position's liquidity and last recorded fee growth snapshots from V4 storage
        (uint128 liq, uint256 fg0Last, uint256 fg1Last) = getPositionInfo(
            poolManager, poolId, owner, tickLower, tickUpper, salt
        );
        // No liquidity → no fees to collect
        if (liq == 0) return (0, 0);

        // Read the current fee growth inside the tick range (computed from global and tick data)
        (uint256 fg0Inside, uint256 fg1Inside) = getFeeGrowthInside(
            poolManager, poolId, tickLower, tickUpper
        );

        unchecked {
            // Fee delta = current inside − last snapshot (wrapping subtract, per V4 spec)
            // Growth in currency0 fees since last position interaction
            uint256 delta0 = fg0Inside - fg0Last;
            // Growth in currency1 fees since last position interaction
            uint256 delta1 = fg1Inside - fg1Last;
            // Fees earned = liquidity * feeGrowthDelta / Q128 (matches V4 Position.calculatePositionFees)
            // Currency0 (ETH) fees pending collection
            pendingFees0 = GluedMath.md512(uint256(liq), delta0, Q128);
            // Currency1 (token) fees pending collection
            pendingFees1 = GluedMath.md512(uint256(liq), delta1, Q128);
        }
    }

    /**
     * @notice Convert a V4 sqrtPriceX96 to human-readable token-per-ETH price (scaled by 1e18)
     * @dev price = (sqrtPriceX96 / 2^96)^2 = sqrtPriceX96^2 / 2^192
     *      Computed using two sequential GluedMath.md512 calls to maintain 512-bit precision.
     * @param sqrtPriceX96 The raw V4 sqrt price in Q64.96 format
     * @return priceTokenPerEth How many tokens equal 1 ETH, scaled to 18 decimals
     */
    function sqrtPriceToPrice(uint160 sqrtPriceX96) internal pure returns (uint256 priceTokenPerEth) {
        // Widen to uint256 for math
        uint256 sqrtPrice = uint256(sqrtPriceX96);
        // Step 1: sqrtPrice^2 / Q96 using 512-bit precision (avoids overflow)
        uint256 sqrtPriceSq = GluedMath.md512(sqrtPrice, sqrtPrice, Q96);
        // Step 2: scale to 1e18 by multiplying by 1e18 / Q96
        priceTokenPerEth = GluedMath.md512(sqrtPriceSq, 1e18, Q96);
    }

    /**
     * @notice Convert a V4 sqrtPriceX96 to human-readable ETH-per-token price (scaled by 1e18)
     * @dev inversePrice = Q96^2 * 1e18 / sqrtPriceX96^2
     *      Computed as two sequential divisions by sqrtPriceX96 to avoid squaring (which overflows
     *      uint256 for most real token prices where sqrtPriceX96 > 2^128).
     * @param sqrtPriceX96 The raw V4 sqrt price in Q64.96 format
     * @return priceEthPerToken How much ETH equals 1 token, scaled to 18 decimals
     */
    function sqrtPriceToInversePrice(uint160 sqrtPriceX96) internal pure returns (uint256 priceEthPerToken) {
        // Widen to uint256 for math
        uint256 sqrtPrice = uint256(sqrtPriceX96);
        // Guard: uninitialised pool
        if (sqrtPrice == 0) return 0;
        // Goal: priceEthPerToken = Q96^2 * 1e18 / sqrtPrice^2
        // Split into two divisions by sqrtPrice to avoid squaring (which can overflow
        // uint256 for sqrtPriceX96 > 2^128, i.e. most real token prices).
        // Step 1: Q96 * 1e18 / sqrtPrice (max product = 2^96 * 2^60 = 2^156, fits uint256)
        uint256 step1 = GluedMath.md512(Q96, 1e18, sqrtPrice);
        // Step 2: Q96 * step1 / sqrtPrice = Q96^2 * 1e18 / sqrtPrice^2
        priceEthPerToken = GluedMath.md512(Q96, step1, sqrtPrice);
    }

    /**
     * @notice Encode an initial sqrtPriceX96 from a pair of raw token amounts.
     * @dev Pure inverse of {sqrtPriceToPrice}: used to BOOTSTRAP a brand-new pool, where the
     *      first liquidity provider's deposit ratio defines the launch price. The price is
     *      `amount1 / amount0` in raw token1-per-token0 units (exactly Uniswap's sqrtPriceX96
     *      definition), so the result is decimals-agnostic — it simply encodes the ratio the
     *      caller deposits. Computed as `sqrt((amount1/amount0) · 2^96) · 2^48` to keep the
     *      intermediate inside uint256 (md512 reverts on overflow), then clamped into the valid
     *      [MIN_SQRT_RATIO, MAX_SQRT_RATIO] band. Callers MUST pass both amounts non-zero — a
     *      launch price cannot be derived from a one-sided deposit (amount0 == 0 panics in md512).
     * @param amount0 Raw amount of token0 (the lower-sorted currency).
     * @param amount1 Raw amount of token1 (the higher-sorted currency).
     * @return sqrtPriceX96 The Q64.96 sqrt price encoding the amount0:amount1 ratio.
     */
    function encodePriceSqrt(uint256 amount0, uint256 amount1) internal pure returns (uint160 sqrtPriceX96) {
        // ratioX96 = (amount1 / amount0) · 2^96, in 512-bit precision (reverts on overflow).
        uint256 ratioX96 = GluedMath.md512(amount1, Q96, amount0);
        // sqrt(ratioX96) = sqrt(amount1/amount0) · 2^48; shift left 48 to land on Q64.96.
        uint256 s = _sqrt(ratioX96) << 48;
        // Clamp into the valid price band. MIN_SQRT_RATIO is INCLUSIVE but MAX_SQRT_RATIO is
        // EXCLUSIVE in both V3 and V4 TickMath (`initialize` reverts on `== MAX`), so cap one below.
        if (s < MIN_SQRT_RATIO) s = MIN_SQRT_RATIO;
        else if (s >= MAX_SQRT_RATIO) s = MAX_SQRT_RATIO - 1;
        sqrtPriceX96 = uint160(s);
    }

    /// @dev Babylonian integer square root (floor). Pure, no storage.
    function _sqrt(uint256 x) private pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // SWAP QUOTING (single-step, active liquidity)
    // ═══════════════════════════════════════════════════════════════════════════════
    //
    // The functions in this section let an off-chain or on-chain caller predict the
    // EXACT output of a Uniswap V4 exact-input swap WITHOUT executing the swap. They
    // implement the same math the PoolManager runs internally (SqrtPriceMath +
    // SwapMath), so the prediction matches the actual swap output bit-for-bit when
    // the swap stays inside the current tick's active liquidity.
    //
    //   ┌─────────────────────────────────────────────────────────────────────────┐
    //   │  Why this matters                                                       │
    //   │                                                                         │
    //   │  Reading sqrtPriceX96 alone (sqrtPriceToPrice) gives the MARGINAL price │
    //   │  — what an infinitesimal swap would clear. The real swap differs by:    │
    //   │     1. The LP fee (deducted from amountIn before the curve walk)        │
    //   │     2. The swap's own price impact (sqrtPrice moves during the swap)    │
    //   │  For a 0.3% fee pool, a marginal-price estimate overstates the actual   │
    //   │  output by AT LEAST 0.3% even on an infinitesimally small swap. Slippage│
    //   │  tolerances built on top of that estimate must absorb the fee + impact, │
    //   │  inflating them well beyond what's needed for MEV protection alone.     │
    //   │                                                                         │
    //   │  This quoter returns the EXACT output the swap will deliver. Callers can│
    //   │  then set extremely tight slippage tolerances (single-digit basis points│
    //   │  for V4 rounding) without false reverts.                                │
    //   └─────────────────────────────────────────────────────────────────────────┘
    //
    // SCOPE: Single-step within the active liquidity at the current tick. This is
    // EXACT for full-range pools (where all LP sits at MIN_TICK/MAX_TICK — the swap
    // can't cross an initialized tick boundary without draining the pool) and
    // accurate for any swap that doesn't traverse a tick crossing. For concentrated
    // pools where a large swap would cross initialized ticks, callers should split
    // the swap or use V4's official Quoter contract.
    // ═══════════════════════════════════════════════════════════════════════════════

    /// @dev V4 swap fee denominator. PoolKey.fee is expressed in millionths (e.g. 3000 = 0.30%, 500 = 0.05%).
    uint256 internal constant FEE_DENOMINATOR = 1_000_000;

    /**
     * @notice Compute the sqrtPrice that results from adding `amount0` of currency0 (rounded up)
     * @dev Direct port of Uniswap V4 SqrtPriceMath.getNextSqrtPriceFromAmount0RoundingUp (the `add=true` branch).
     *      Exact formula: sqrtQ = (L * Q96 * sqrtP) / (L * Q96 + amount0 * sqrtP)
     *      Two-path implementation:
     *        Fast path  — overflow-safe direct multiply-divide-up of the formula above.
     *        Slow path  — algebraic rearrangement to avoid the inner overflow at the cost of one extra divide.
     *      Rounding UP matches V4's exact behaviour and is conservative for input accounting.
     * @param sqrtPX96  Current sqrtPrice in Q64.96 (must be > 0; behaviour matches V4 when sqrtPX96 = 0)
     * @param liquidity Active liquidity at the current tick (must be > 0)
     * @param amount0   Currency0 amount (post-fee) entering the pool
     * @return sqrtQX96 New sqrtPrice after adding `amount0`
     */
    function getNextSqrtPriceFromAmount0RoundingUp(
        uint160 sqrtPX96,
        uint128 liquidity,
        uint256 amount0
    ) internal pure returns (uint160 sqrtQX96) {
        // No input → price unchanged
        if (amount0 == 0) return sqrtPX96;
        // L * Q96 (fits in 256 bits: L is 128-bit, Q96 is 2^96)
        uint256 numerator1 = uint256(liquidity) << 96;

        unchecked {
            // amount0 * sqrtP — may overflow
            uint256 product = amount0 * uint256(sqrtPX96);
            // Overflow check: did the multiply round-trip?
            if (product / amount0 == uint256(sqrtPX96)) {
                // L * Q96 + amount0 * sqrtP
                uint256 denominator = numerator1 + product;
                // Addition didn't overflow
                if (denominator >= numerator1) {
                    // sqrtQ = numerator1 * sqrtP / denominator, rounded up — V4's preferred path
                    // L * Q96 * sqrtP / denom (rounded up)
                    uint256 q = GluedMath.md512Up(numerator1, uint256(sqrtPX96), denominator);
                    // sqrtPrice must fit in uint160 per V4 invariant
                    if (q > type(uint160).max) revert Unauthorized();
                    return uint160(q);
                }
            }
            // Slow path (rearranged to avoid the inner overflow):
            //   sqrtQ = L * Q96 / ((L * Q96) / sqrtP + amount0), rounded up
            // (L*Q96)/sqrtP + amount0
            uint256 denom = (numerator1 / uint256(sqrtPX96)) + amount0;
            // Floor-divide first…
            uint256 result = numerator1 / denom;
            // …then bump up if there's a remainder (round up)
            if (numerator1 % denom != 0) result += 1;
            // Same sqrtPrice fit-check as the fast path
            if (result > type(uint160).max) revert Unauthorized();
            return uint160(result);
        }
    }

    /**
     * @notice Compute the sqrtPrice that results from adding `amount1` of currency1 (rounded down)
     * @dev Direct port of Uniswap V4 SqrtPriceMath.getNextSqrtPriceFromAmount1RoundingDown (the `add=true` branch).
     *      Exact formula: sqrtQ = sqrtP + (amount1 * Q96) / L
     *      The internal quotient division rounds DOWN, which matches V4 and is conservative for input accounting.
     * @param sqrtPX96  Current sqrtPrice in Q64.96 (must be > 0)
     * @param liquidity Active liquidity at the current tick (must be > 0)
     * @param amount1   Currency1 amount (post-fee) entering the pool
     * @return sqrtQX96 New sqrtPrice after adding `amount1`
     */
    function getNextSqrtPriceFromAmount1RoundingDown(
        uint160 sqrtPX96,
        uint128 liquidity,
        uint256 amount1
    ) internal pure returns (uint160 sqrtQX96) {
        // No input → price unchanged
        if (amount1 == 0) return sqrtPX96;

        // quotient = amount1 * Q96 / L (rounded down). Fast-path uses a single shift when amount1 is small enough.
        uint256 quotient = (amount1 <= type(uint160).max)
            // Fast: shift+divide stays in 256 bits
            ? (amount1 << 96) / uint256(liquidity)
            // Slow: 512-bit precision for huge amount1
            : GluedMath.md512(amount1, Q96, uint256(liquidity));

        // sqrtQ = sqrtP + quotient
        uint256 result = uint256(sqrtPX96) + quotient;
        // sqrtPrice must fit in uint160 per V4 invariant
        if (result > type(uint160).max) revert Unauthorized();
        return uint160(result);
    }

    /**
     * @notice Quote the exact output of a V4 exact-input swap (read-only, single-step)
     * @dev Replicates the math that PoolManager.swap() runs inside its current-tick active liquidity:
     *
     *        amountInLessFee = amountIn * (FEE_DENOMINATOR - key.fee) / FEE_DENOMINATOR
     *
     *      Then, depending on direction:
     *        zeroForOne  (selling currency0, price decreases):
     *          sqrtP_after = getNextSqrtPriceFromAmount0RoundingUp(sqrtP_before, L, amountInLessFee)
     *          amountOut    = L * (sqrtP_before - sqrtP_after) / Q96            (rounded DOWN, matches V4 output)
     *
     *        oneForZero  (selling currency1, price increases):
     *          sqrtP_after = getNextSqrtPriceFromAmount1RoundingDown(sqrtP_before, L, amountInLessFee)
     *          amountOut    = L * Q96 * (sqrtP_after - sqrtP_before) / (sqrtP_after * sqrtP_before)   (rounded DOWN)
     *
     *      This is the bit-for-bit output the actual swap would deliver, PROVIDED the swap stays inside
     *      the current tick's active liquidity. For pools where all LPs are full-range
     *      (Glue's pattern: MIN_TICK..MAX_TICK), no swap can cross an initialized tick without draining
     *      the pool — the single-step quote is therefore exact.
     *
     *      Callers integrating with concentrated-liquidity pools can compare `sqrtPriceAfter` against
     *      the next initialized tick (via tick bitmap reads) to detect whether a multi-step quote is needed.
     *
     * @param poolManager Address of the V4 PoolManager
     * @param key         Pool key identifying the target pool
     * @param zeroForOne  true = sell currency0 for currency1 (price decreases); false = sell currency1 for currency0 (price increases)
     * @param amountIn    Exact input amount INCLUDING the LP fee (the function deducts the fee internally)
     * @return amountOut       Exact output amount the swap would deliver (0 if pool uninitialised, has no liquidity, or amountIn = 0)
     * @return sqrtPriceAfter  Pool sqrtPrice after the simulated swap (caller can compare to a tick boundary to detect crossing)
     */
    function quoteExactInputSingle(
        address poolManager,
        IPoolManagerMin.PoolKey memory key,
        bool zeroForOne,
        uint256 amountIn
    ) internal view returns (uint256 amountOut, uint160 sqrtPriceAfter) {
        // No input → no output (consistent with V4)
        if (amountIn == 0) return (0, 0);

        // Derive poolId from key
        bytes32 poolId = keccak256(abi.encode(key));
        // Snapshot current price + tick
        Slot0 memory slot0 = getSlot0(poolManager, poolId);
        // Pool not initialised
        if (slot0.sqrtPriceX96 == 0) return (0, 0);

        // Active liquidity at current tick
        uint128 liquidity = getPoolLiquidity(poolManager, poolId);
        // No liquidity → swap would revert anyway
        if (liquidity == 0) return (0, 0);

        // Deduct LP fee from input. V4 fee is in millionths: e.g. 3000 = 0.30%, 500 = 0.05%.
        // amountInLessFee = amountIn * (1e6 - fee) / 1e6, rounded DOWN (matches V4 — the missing wei stays as fee).
        uint256 amountInLessFee = GluedMath.md512(amountIn, FEE_DENOMINATOR - uint256(key.fee), FEE_DENOMINATOR);

        if (zeroForOne) {
            // Sell currency0 (e.g. ETH for ETH/TOKEN pools): sqrtPrice DECREASES
            sqrtPriceAfter = getNextSqrtPriceFromAmount0RoundingUp(slot0.sqrtPriceX96, liquidity, amountInLessFee);
            // amount1Out = L * (sqrtP_before - sqrtP_after) / Q96, rounded down (V4 output convention)
            amountOut = GluedMath.md512(
                uint256(liquidity),
                uint256(slot0.sqrtPriceX96) - uint256(sqrtPriceAfter),
                Q96
            );
        } else {
            // Sell currency1 (e.g. TOKEN for ETH/TOKEN pools): sqrtPrice INCREASES
            sqrtPriceAfter = getNextSqrtPriceFromAmount1RoundingDown(slot0.sqrtPriceX96, liquidity, amountInLessFee);
            // amount0Out = L * Q96 * (sqrtP_after - sqrtP_before) / (sqrtP_after * sqrtP_before), rounded down
            // Split into two md512 calls to keep intermediates in 256 bits:
            //   step1  = L * Q96 / sqrtP_after
            //   result = step1 * (sqrtP_after - sqrtP_before) / sqrtP_before
            // L * Q96 / sqrtP_after
            uint256 step1 = GluedMath.md512(uint256(liquidity), Q96, uint256(sqrtPriceAfter));
            // step1 * delta / sqrtP_before
            amountOut = GluedMath.md512(step1, uint256(sqrtPriceAfter) - uint256(slot0.sqrtPriceX96), uint256(slot0.sqrtPriceX96));
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // HOOK PERMISSION FLAGS
    // ═══════════════════════════════════════════════════════════════════════════════
    //
    // Uniswap V4 encodes a hook's permissions in the LOW 14 BITS OF ITS ADDRESS. The
    // PoolManager reads those bits to decide which callbacks to invoke, so a hook must be
    // deployed (CREATE2 salt-mined) at an address whose low bits match EXACTLY the set of
    // callbacks it implements: a missing bit skips a callback the hook needs, an extra bit
    // makes the PoolManager call a function the hook does not have (the call reverts).
    // ═══════════════════════════════════════════════════════════════════════════════

    /// @dev `beforeInitialize` is invoked on `PoolManager.initialize`.
    uint160 internal constant BEFORE_INITIALIZE_FLAG = 1 << 13;
    /// @dev `afterInitialize` is invoked on `PoolManager.initialize`.
    uint160 internal constant AFTER_INITIALIZE_FLAG = 1 << 12;
    /// @dev `beforeAddLiquidity` is invoked on a positive `modifyLiquidity`.
    uint160 internal constant BEFORE_ADD_LIQUIDITY_FLAG = 1 << 11;
    /// @dev `afterAddLiquidity` is invoked on a positive `modifyLiquidity`.
    uint160 internal constant AFTER_ADD_LIQUIDITY_FLAG = 1 << 10;
    /// @dev `beforeRemoveLiquidity` is invoked on a negative `modifyLiquidity`.
    uint160 internal constant BEFORE_REMOVE_LIQUIDITY_FLAG = 1 << 9;
    /// @dev `afterRemoveLiquidity` is invoked on a negative `modifyLiquidity`.
    uint160 internal constant AFTER_REMOVE_LIQUIDITY_FLAG = 1 << 8;
    /// @dev `beforeSwap` is invoked on `PoolManager.swap`.
    uint160 internal constant BEFORE_SWAP_FLAG = 1 << 7;
    /// @dev `afterSwap` is invoked on `PoolManager.swap`.
    uint160 internal constant AFTER_SWAP_FLAG = 1 << 6;
    /// @dev `beforeDonate` is invoked on `PoolManager.donate`.
    uint160 internal constant BEFORE_DONATE_FLAG = 1 << 5;
    /// @dev `afterDonate` is invoked on `PoolManager.donate`.
    uint160 internal constant AFTER_DONATE_FLAG = 1 << 4;
    /// @dev `beforeSwap` may return a `BeforeSwapDelta` that resizes the pool swap.
    uint160 internal constant BEFORE_SWAP_RETURNS_DELTA_FLAG = 1 << 3;
    /// @dev `afterSwap` may return a delta on the unspecified currency.
    uint160 internal constant AFTER_SWAP_RETURNS_DELTA_FLAG = 1 << 2;
    /// @dev `afterAddLiquidity` may return a delta.
    uint160 internal constant AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG = 1 << 1;
    /// @dev `afterRemoveLiquidity` may return a delta.
    uint160 internal constant AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG = 1 << 0;
    /// @dev Mask covering every permission bit — `address & ALL_HOOK_MASK` is a hook's full permission set.
    uint160 internal constant ALL_HOOK_MASK = uint160((1 << 14) - 1);

    /**
     * @notice Pack a V4 `BeforeSwapDelta` from its two signed components.
     * @dev Mirrors v4-core `BeforeSwapDeltaLibrary.toBeforeSwapDelta`: the SPECIFIED currency's delta
     *      occupies the UPPER 128 bits and the UNSPECIFIED currency's delta the lower 128. "Specified"
     *      is the currency the swapper pinned an amount on — the INPUT for an exact-input swap and the
     *      OUTPUT for an exact-output swap.
     *
     *      Sign convention (from the hook's point of view): a POSITIVE delta means the hook takes that
     *      much currency out of the swap (the pool leg shrinks by it), a NEGATIVE delta means the hook
     *      owes that much currency to the swapper.
     * @param deltaSpecified   Hook delta on the specified currency.
     * @param deltaUnspecified Hook delta on the unspecified currency.
     * @return packed The `BeforeSwapDelta` as a raw int256, ready to return from `beforeSwap`.
     */
    function toBeforeSwapDelta(int128 deltaSpecified, int128 deltaUnspecified) internal pure returns (int256 packed) {
        assembly ("memory-safe") {
            // Specified in the high word, unspecified sign-extended into the low word
            packed := or(shl(128, deltaSpecified), and(deltaUnspecified, 0xffffffffffffffffffffffffffffffff))
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // BIT-EXACT SWAP STEP (faithful SwapMath / SqrtPriceMath / TickBitmap port)
    // ═══════════════════════════════════════════════════════════════════════════════
    //
    // {quoteExactInputSingle} above is an EXTRAPOLATING estimator: it ignores tick
    // crossings and folds the fee with a single multiply, which makes it ideal for sizing
    // decisions but leaves it a few wei away from the pool's own arithmetic.
    //
    // The functions below are a LINE-FOR-LINE port of the code the PoolManager itself runs
    // for one swap step (`SwapMath.computeSwapStep` + `SqrtPriceMath` + the one-word
    // `TickBitmap` search). They exist for callers that must reproduce the pool's execution
    // price EXACTLY — most importantly a hook that fills part of a swap from its own
    // inventory: paying anything above the pool's own price would let a swapper extract
    // value from the hook, so "close enough" is not an option.
    //
    // The step is bounded by the next initialized tick within one bitmap word, exactly as
    // the pool's own loop bounds it, so the returned amounts are what the pool would have
    // produced for that slice. Amounts beyond the step are simply not quoted (the caller
    // fills what it can and leaves the remainder to the pool).
    // ═══════════════════════════════════════════════════════════════════════════════

    /// @dev Slot offset from Pool.State base to the tickBitmap mapping (V4 Pool.State slot layout)
    uint256 private constant TICK_BITMAP_OFFSET = 5;

    /// @dev Ceil-division of `a` by `b`, matching v4-core `UnsafeMath.divRoundingUp` (no zero-check).
    function _divUp(uint256 a, uint256 b) private pure returns (uint256 r) {
        assembly ("memory-safe") {
            r := add(div(a, b), gt(mod(a, b), 0))
        }
    }

    /**
     * @notice The currency0 amount between two sqrt prices for a given liquidity.
     * @dev Faithful port of v4-core `SqrtPriceMath.getAmount0Delta`. The round-DOWN branch divides by
     *      the UPPER price first and the lower price second (a single fused 512-bit multiply-divide
     *      followed by one plain divide); the two-step form used by {getAmount0ForLiquidity} truncates
     *      earlier and can land a few wei lower, which is why this port exists alongside it.
     * @param sqrtAX96 One sqrt price bound (Q64.96).
     * @param sqrtBX96 The other sqrt price bound (Q64.96).
     * @param liquidity Liquidity in the range.
     * @param roundUp True to round the result up (input accounting), false to round down (output accounting).
     * @return amount0 The currency0 amount.
     */
    function amount0Delta(uint160 sqrtAX96, uint160 sqrtBX96, uint128 liquidity, bool roundUp)
        internal pure returns (uint256 amount0)
    {
        // Order the bounds so the arithmetic below is direction-independent
        if (sqrtAX96 > sqrtBX96) (sqrtAX96, sqrtBX96) = (sqrtBX96, sqrtAX96);
        // L · 2^96 (fits: L is 128-bit)
        uint256 numerator1 = uint256(liquidity) << 96;
        // The price span the amount is measured across
        uint256 numerator2 = uint256(sqrtBX96) - uint256(sqrtAX96);
        // Zero span (or zero liquidity) means zero amount
        if (numerator2 == 0 || liquidity == 0) return 0;

        amount0 = roundUp
            // Ceil both divides: over-report the input the pool would demand
            ? _divUp(GluedMath.md512Up(numerator1, numerator2, uint256(sqrtBX96)), uint256(sqrtAX96))
            // Floor both divides: under-report the output the pool would deliver
            : GluedMath.md512(numerator1, numerator2, uint256(sqrtBX96)) / uint256(sqrtAX96);
    }

    /**
     * @notice The currency1 amount between two sqrt prices for a given liquidity.
     * @dev Faithful port of v4-core `SqrtPriceMath.getAmount1Delta`: `L · (sqrtB − sqrtA) / 2^96`.
     * @param sqrtAX96 One sqrt price bound (Q64.96).
     * @param sqrtBX96 The other sqrt price bound (Q64.96).
     * @param liquidity Liquidity in the range.
     * @param roundUp True to round the result up (input accounting), false to round down (output accounting).
     * @return amount1 The currency1 amount.
     */
    function amount1Delta(uint160 sqrtAX96, uint160 sqrtBX96, uint128 liquidity, bool roundUp)
        internal pure returns (uint256 amount1)
    {
        // Order the bounds so the arithmetic below is direction-independent
        if (sqrtAX96 > sqrtBX96) (sqrtAX96, sqrtBX96) = (sqrtBX96, sqrtAX96);
        // The price span the amount is measured across
        uint256 span = uint256(sqrtBX96) - uint256(sqrtAX96);
        amount1 = roundUp
            // Ceil: over-report the input the pool would demand
            ? GluedMath.md512Up(uint256(liquidity), span, Q96)
            // Floor: under-report the output the pool would deliver
            : GluedMath.md512(uint256(liquidity), span, Q96);
    }

    /// @dev Faithful port of v4-core `SqrtPriceMath.getNextSqrtPriceFromAmount0RoundingUp`, `add == false`
    ///      (currency0 LEAVES the pool). `sqrtQ = ceil(L·2^96·sqrtP / (L·2^96 − amount0·sqrtP))`.
    ///      Returns 0 when the amount is not withdrawable at this liquidity (the caller treats that as
    ///      "cannot quote" rather than reverting mid-swap).
    function _nextSqrtRemoveAmount0(uint160 sqrtPX96, uint128 liquidity, uint256 amount0)
        private pure returns (uint160 sqrtQX96)
    {
        // No withdrawal → price unchanged
        if (amount0 == 0) return sqrtPX96;
        // L · 2^96
        uint256 numerator1 = uint256(liquidity) << 96;
        // amount0 · sqrtP must not overflow, and must be strictly inside the reserve
        uint256 product = amount0 * uint256(sqrtPX96);
        if (amount0 != 0 && product / amount0 != uint256(sqrtPX96)) return 0;
        if (numerator1 <= product) return 0;
        // sqrtQ = ceil(numerator1 · sqrtP / (numerator1 − product))
        uint256 q = GluedMath.md512Up(numerator1, uint256(sqrtPX96), numerator1 - product);
        // A sqrt price must fit in uint160 per the V4 invariant
        if (q > type(uint160).max) return 0;
        sqrtQX96 = uint160(q);
    }

    /// @dev Faithful port of v4-core `SqrtPriceMath.getNextSqrtPriceFromAmount1RoundingDown`, `add == false`
    ///      (currency1 LEAVES the pool). `sqrtQ = sqrtP − ceil(amount1·2^96 / L)`.
    ///      Returns 0 when the withdrawal would take the price to or below zero.
    function _nextSqrtRemoveAmount1(uint160 sqrtPX96, uint128 liquidity, uint256 amount1)
        private pure returns (uint160 sqrtQX96)
    {
        // No withdrawal → price unchanged
        if (amount1 == 0) return sqrtPX96;
        // Ceil the quotient so the price move is never under-stated
        uint256 quotient = amount1 <= type(uint160).max
            // Fast path: the shift stays inside 256 bits
            ? _divUp(amount1 << 96, uint256(liquidity))
            // Slow path: 512-bit precision for a huge amount
            : GluedMath.md512Up(amount1, Q96, uint256(liquidity));
        // The move must not reach or pass zero
        if (uint256(sqrtPX96) <= quotient) return 0;
        sqrtQX96 = uint160(uint256(sqrtPX96) - quotient);
    }

    /// @dev Faithful port of v4-core `SqrtPriceMath.getNextSqrtPriceFromInput`.
    function _nextSqrtFromInput(uint160 sqrtPX96, uint128 liquidity, uint256 amountIn, bool zeroForOne)
        private pure returns (uint160)
    {
        // Selling currency0 adds it to the pool (price down); selling currency1 adds it (price up)
        return zeroForOne
            ? getNextSqrtPriceFromAmount0RoundingUp(sqrtPX96, liquidity, amountIn)
            : getNextSqrtPriceFromAmount1RoundingDown(sqrtPX96, liquidity, amountIn);
    }

    /// @dev Faithful port of v4-core `SqrtPriceMath.getNextSqrtPriceFromOutput`. Returns 0 when the
    ///      output is not withdrawable at this liquidity.
    function _nextSqrtFromOutput(uint160 sqrtPX96, uint128 liquidity, uint256 amountOut, bool zeroForOne)
        private pure returns (uint160)
    {
        // Selling currency0 pays out currency1 (price down); selling currency1 pays out currency0 (price up)
        return zeroForOne
            ? _nextSqrtRemoveAmount1(sqrtPX96, liquidity, amountOut)
            : _nextSqrtRemoveAmount0(sqrtPX96, liquidity, amountOut);
    }

    /**
     * @notice Compute ONE swap step exactly as the PoolManager computes it.
     * @dev Faithful port of v4-core `SwapMath.computeSwapStep`. Direction is inferred from the prices
     *      (`sqrtCurrent >= sqrtTarget` means currency0 is being sold), and the step stops at whichever
     *      comes first: the requested amount or `sqrtTargetX96`. The caller pays `amountIn + feeAmount`
     *      and receives `amountOut`.
     * @param sqrtCurrentX96  The pool's live sqrt price.
     * @param sqrtTargetX96   The price the step may not pass (next initialized tick, or a direction extreme).
     * @param liquidity       Active liquidity for the step.
     * @param amountRemaining Negative for exact input, positive for exact output (V4's convention).
     * @param feePips         LP fee in millionths.
     * @return sqrtNextX96 The sqrt price the step ends at.
     * @return amountIn   Net input consumed (fee EXCLUDED).
     * @return amountOut  Output delivered.
     * @return feeAmount  Fee charged on top of `amountIn`.
     */
    function computeSwapStep(
        uint160 sqrtCurrentX96,
        uint160 sqrtTargetX96,
        uint128 liquidity,
        int256 amountRemaining,
        uint24 feePips
    ) internal pure returns (uint160 sqrtNextX96, uint256 amountIn, uint256 amountOut, uint256 feeAmount) {
        // V4 infers direction from the prices, never from a flag
        bool zeroForOne = sqrtCurrentX96 >= sqrtTargetX96;
        // Negative remaining = the swapper pinned the input
        bool exactIn = amountRemaining < 0;

        if (exactIn) {
            // Fee comes off the input before it touches the curve
            uint256 amountRemainingLessFee = GluedMath.md512(
                uint256(-amountRemaining), FEE_DENOMINATOR - uint256(feePips), FEE_DENOMINATOR
            );
            // Input required to walk the whole way to the target (rounded up, pool's favour)
            amountIn = zeroForOne
                ? amount0Delta(sqrtTargetX96, sqrtCurrentX96, liquidity, true)
                : amount1Delta(sqrtCurrentX96, sqrtTargetX96, liquidity, true);

            if (amountRemainingLessFee >= amountIn) {
                // The step reaches the target: the fee is grossed up off the capped input
                sqrtNextX96 = sqrtTargetX96;
                feeAmount = feePips == FEE_DENOMINATOR
                    ? amountIn
                    : GluedMath.md512Up(amountIn, uint256(feePips), FEE_DENOMINATOR - uint256(feePips));
            } else {
                // The amount runs out first: the whole remainder is consumed, price lands short of the target
                amountIn = amountRemainingLessFee;
                sqrtNextX96 = _nextSqrtFromInput(sqrtCurrentX96, liquidity, amountRemainingLessFee, zeroForOne);
                feeAmount = uint256(-amountRemaining) - amountIn;
            }

            // Output is always rounded DOWN (the pool keeps the dust)
            amountOut = zeroForOne
                ? amount1Delta(sqrtNextX96, sqrtCurrentX96, liquidity, false)
                : amount0Delta(sqrtCurrentX96, sqrtNextX96, liquidity, false);
        } else {
            // Output available between the live price and the target
            amountOut = zeroForOne
                ? amount1Delta(sqrtTargetX96, sqrtCurrentX96, liquidity, false)
                : amount0Delta(sqrtCurrentX96, sqrtTargetX96, liquidity, false);

            if (uint256(amountRemaining) >= amountOut) {
                // The step reaches the target and still owes output — caller must continue elsewhere
                sqrtNextX96 = sqrtTargetX96;
            } else {
                // The requested output lands short of the target
                amountOut = uint256(amountRemaining);
                sqrtNextX96 = _nextSqrtFromOutput(sqrtCurrentX96, liquidity, amountOut, zeroForOne);
                // Not withdrawable at this liquidity: report an unquotable step
                if (sqrtNextX96 == 0) return (0, 0, 0, 0);
            }

            // Input is always rounded UP (the pool keeps the dust)
            amountIn = zeroForOne
                ? amount0Delta(sqrtNextX96, sqrtCurrentX96, liquidity, true)
                : amount1Delta(sqrtCurrentX96, sqrtNextX96, liquidity, true);
            // Fee is grossed up on top of the required input
            feeAmount = GluedMath.md512Up(amountIn, uint256(feePips), FEE_DENOMINATOR - uint256(feePips));
        }
    }

    /**
     * @notice The price the pool's next swap step may not pass, read from the live tick bitmap.
     * @dev Faithful port of v4-core `TickBitmap.nextInitializedTickWithinOneWord` (plus the swap loop's
     *      tick clamp), reading the pool's `tickBitmap` mapping straight out of PoolManager storage via
     *      `extsload`. Bounding a quote by this price is what makes {computeSwapStep} exact: no
     *      initialized tick can sit between the live price and the returned one, so liquidity is constant
     *      across the whole step. For a full-range pool (Glue's own pools) the only initialized ticks are
     *      the extremes, so the bound falls a whole bitmap word away and the quotable step is large.
     * @param poolManager The V4 PoolManager.
     * @param poolId      The pool identifier.
     * @param tick        The pool's live tick.
     * @param tickSpacing The pool's tick spacing.
     * @param zeroForOne  True when currency0 is being sold (price moves down).
     * @return sqrtTargetX96 The sqrt price bounding the step.
     * @return initialized True when the bound is a real initialized tick (crossing it changes liquidity)
     *         rather than the edge of the bitmap word (crossing it changes nothing).
     */
    function stepBoundary(
        address poolManager,
        bytes32 poolId,
        int24 tick,
        int24 tickSpacing,
        bool zeroForOne
    ) internal view returns (uint160 sqrtTargetX96, bool initialized) {
        // Compress the tick to a spacing index, flooring toward negative infinity
        int24 compressed = tick / tickSpacing;
        if (tick < 0 && tick % tickSpacing != 0) compressed--;

        int24 next;
        if (zeroForOne) {
            // Search at-or-below the current index inside its word
            (int16 wordPos, uint8 bitPos) = (int16(compressed >> 8), uint8(int8(compressed % 256)));
            // Every bit at or right of the current position
            uint256 masked = _bitmapWord(poolManager, poolId, wordPos) & (type(uint256).max >> (255 - bitPos));
            // An initialized tick inside the word bounds the step; otherwise the word's low edge does
            initialized = masked != 0;
            next = initialized
                ? (compressed - int24(uint24(bitPos - _msb(masked)))) * tickSpacing
                : (compressed - int24(uint24(bitPos))) * tickSpacing;
        } else {
            // The current tick's own state is irrelevant when the price moves up: start one index along
            unchecked { compressed++; }
            (int16 wordPos, uint8 bitPos) = (int16(compressed >> 8), uint8(int8(compressed % 256)));
            // Every bit at or left of the starting position
            uint256 masked = _bitmapWord(poolManager, poolId, wordPos) & ~((uint256(1) << bitPos) - 1);
            // An initialized tick inside the word bounds the step; otherwise the word's high edge does
            initialized = masked != 0;
            next = initialized
                ? (compressed + int24(uint24(_lsb(masked) - bitPos))) * tickSpacing
                : (compressed + int24(uint24(type(uint8).max - bitPos))) * tickSpacing;
        }

        // The swap loop clamps the boundary tick into the absolute TickMath range
        if (next < -MAX_USABLE_TICK) next = -MAX_USABLE_TICK;
        if (next > MAX_USABLE_TICK) next = MAX_USABLE_TICK;
        sqrtTargetX96 = getSqrtRatioAtTick(next);
    }

    /// @dev Read one word of a pool's `tickBitmap` mapping (Pool.State slot + 5) via `extsload`.
    function _bitmapWord(address poolManager, bytes32 poolId, int16 wordPos) private view returns (uint256 word) {
        // Pool.State base slot for this pool
        bytes32 stateSlot = keccak256(abi.encodePacked(poolId, POOLS_SLOT));
        // Advance to the tickBitmap mapping, then hash the (sign-extended) word key into it
        bytes32 slot = keccak256(
            abi.encodePacked(int256(wordPos), bytes32(uint256(stateSlot) + TICK_BITMAP_OFFSET))
        );
        word = uint256(IPoolManagerMin(poolManager).extsload(slot));
    }

    /// @dev Index of the most significant set bit. Port of v4-core `BitMath.mostSignificantBit`.
    function _msb(uint256 x) private pure returns (uint8 r) {
        assembly ("memory-safe") {
            // Fold the search down one power of two at a time
            r := shl(7, lt(0xffffffffffffffffffffffffffffffff, x))
            r := or(r, shl(6, lt(0xffffffffffffffff, shr(r, x))))
            r := or(r, shl(5, lt(0xffffffff, shr(r, x))))
            r := or(r, shl(4, lt(0xffff, shr(r, x))))
            r := or(r, shl(3, lt(0xff, shr(r, x))))
            r := or(r, shl(2, lt(0xf, shr(r, x))))
            r := or(r, shl(1, lt(0x3, shr(r, x))))
            r := or(r, lt(0x1, shr(r, x)))
        }
    }

    /// @dev Index of the least significant set bit. Port of v4-core `BitMath.leastSignificantBit`.
    function _lsb(uint256 x) private pure returns (uint8 r) {
        assembly ("memory-safe") {
            // Isolate the lowest set bit, then locate it
            let isolated := and(x, sub(0, x))
            r := shl(7, lt(0xffffffffffffffffffffffffffffffff, isolated))
            r := or(r, shl(6, lt(0xffffffffffffffff, shr(r, isolated))))
            r := or(r, shl(5, lt(0xffffffff, shr(r, isolated))))
            r := or(r, shl(4, lt(0xffff, shr(r, isolated))))
            r := or(r, shl(3, lt(0xff, shr(r, isolated))))
            r := or(r, shl(2, lt(0xf, shr(r, isolated))))
            r := or(r, shl(1, lt(0x3, shr(r, isolated))))
            r := or(r, lt(0x1, shr(r, isolated)))
        }
    }

    /**
     * @notice Quote one pool-exact swap step against a pool's live state.
     * @dev Reads the price, liquidity and next initialized tick, then runs {computeSwapStep}. The result
     *      is what the pool itself would produce for the quoted slice — the numbers a hook needs when it
     *      fills part of a swap from its own inventory. `amountInTotal` is fee-inclusive (what the
     *      swapper hands over) and may be LESS than a requested exact input when the step is bounded by a
     *      tick: the caller absorbs that much and leaves the rest to the pool.
     * @param poolManager     The V4 PoolManager.
     * @param key             The pool key.
     * @param zeroForOne      True when currency0 is being sold.
     * @param amountRemaining Negative for exact input, positive for exact output.
     * @return amountInTotal Fee-inclusive input for the step (0 when the step is unquotable).
     * @return amountOut     Output for the step (0 when the step is unquotable).
     */
    function quoteSwapStep(
        address poolManager,
        IPoolManagerMin.PoolKey memory key,
        bool zeroForOne,
        int256 amountRemaining
    ) internal view returns (uint256 amountInTotal, uint256 amountOut) {
        // Nothing to quote
        if (amountRemaining == 0) return (0, 0);
        // Derive the pool identifier from the key
        bytes32 poolId = keccak256(abi.encode(key));
        // Live price + tick
        Slot0 memory slot0 = getSlot0(poolManager, poolId);
        // Pool not initialised
        if (slot0.sqrtPriceX96 == 0) return (0, 0);
        // Active liquidity for the step
        uint128 liquidity = getPoolLiquidity(poolManager, poolId);
        // Without liquidity there is no price to match
        if (liquidity == 0) return (0, 0);

        // Bound the step at the next initialized tick, exactly as the pool's own loop does
        (uint160 target, bool initialized) =
            stepBoundary(poolManager, poolId, slot0.tick, key.tickSpacing, zeroForOne);
        if (target == slot0.sqrtPriceX96) {
            // The price sits exactly on the bound. An initialized bound would change liquidity on the
            // crossing, so the step really is empty; a bare word edge changes nothing, and the pool's loop
            // would step past it and keep going at the same liquidity — so the quote does too.
            if (initialized || !zeroForOne) return (0, 0);
            (target, ) = stepBoundary(poolManager, poolId, slot0.tick - 1, key.tickSpacing, zeroForOne);
            // Still nowhere to go: unquotable
            if (target >= slot0.sqrtPriceX96) return (0, 0);
        }

        (, uint256 amountIn, uint256 out, uint256 fee) = computeSwapStep(
            slot0.sqrtPriceX96, target, liquidity, amountRemaining, swapFee(slot0.protocolFee, key.fee, zeroForOne)
        );
        // The swapper pays input plus fee
        return (amountIn + fee, out);
    }

    /**
     * @notice The pool's marginal depth on one side: the constant-product reserve tangent to its live
     *         price at its live liquidity.
     * @dev A concentrated-liquidity position behaves locally like a constant-product pool holding
     *      `x = L/√P` of currency0 and `y = L·√P` of currency1. Those are the numbers every
     *      leading-order impact formula is written in, which is what makes them the right yardstick for
     *      a size limit derived from impact — a hook that must stay small relative to the depth it is
     *      trading against cannot use the token balances (they include every out-of-range position) and
     *      cannot use liquidity directly (it is not denominated in either currency).
     * @param sqrtPriceX96 The pool's live sqrt price.
     * @param liquidity The pool's live active liquidity.
     * @param zeroSide True for currency0's depth, false for currency1's.
     * @return reserve The tangent reserve, in that currency's own units.
     */
    function tangentReserve(uint160 sqrtPriceX96, uint128 liquidity, bool zeroSide)
        internal pure returns (uint256 reserve)
    {
        // An empty or uninitialised pool has no depth
        if (sqrtPriceX96 == 0 || liquidity == 0) return 0;
        reserve = zeroSide
            ? GluedMath.md512(liquidity, Q96, sqrtPriceX96)   // x = L / √P
            : GluedMath.md512(liquidity, sqrtPriceX96, Q96);  // y = L · √P
    }

    /**
     * @notice The total fee a pool charges a swap, LP fee and protocol fee composed.
     * @dev Faithful port of v4-core `ProtocolFeeLibrary.calculateSwapFee` plus the directional unpacking
     *      of `Slot0.protocolFee` (currency0's fee in the low 12 bits, currency1's in the high 12). The
     *      protocol fee is charged on the input before the LP fee, so the two compose as
     *      `protocol + lp·(1 − protocol)` rather than simply adding. With no protocol fee set — the usual
     *      case — this is just the pool's LP fee.
     * @param packedProtocolFee The `protocolFee` field of the pool's Slot0.
     * @param lpFee The pool's LP fee in millionths.
     * @param zeroForOne True when currency0 is the input.
     * @return fee The composed fee in millionths.
     */
    function swapFee(uint24 packedProtocolFee, uint24 lpFee, bool zeroForOne) internal pure returns (uint24 fee) {
        // The input currency's own half of the packed field
        uint256 protocolFee = zeroForOne ? (packedProtocolFee & 0xfff) : (packedProtocolFee >> 12);
        // Nothing to compose
        if (protocolFee == 0) return lpFee;
        // protocol + lp · (1 − protocol)
        fee = uint24(protocolFee + lpFee - ((protocolFee * lpFee) / FEE_DENOMINATOR));
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // POOL KEY HELPERS
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Construct a V4 PoolKey and derive the poolId for an ETH/TOKEN pair
     * @dev ETH is always currency0 (address(0)) and the token is always currency1.
     *      No hooks are registered (address(0) hooks).
     *      Tick spacing defaults to TICK_SPACING (120). Callers that need a custom spacing
     *      (e.g. when a hook provides an override via rsHasPoolConfig) should mutate
     *      key.tickSpacing after this call and recompute poolId = keccak256(abi.encode(key)).
     *      poolId = keccak256(abi.encode(key)), matching V4's PoolIdLibrary.toId().
     * @param token The ERC20 token address (currency1); must be non-zero
     * @param fee The pool fee tier (0 resolves to DEFAULT_FEE 3000 = 0.3%)
     * @return key The constructed V4 PoolKey struct (tickSpacing = 120 by default, mutable)
     * @return poolId The keccak256 hash of the PoolKey — must be recomputed if key is mutated
     */
    function createPoolKey(
        address token,
        uint24 fee
    ) internal pure returns (IPoolManagerMin.PoolKey memory key, bytes32 poolId) {
        // Token address must be non-zero
        if (token == address(0)) revert Unauthorized();
        
        // Construct the V4 pool key: ETH is always currency0, token is always currency1
        key = IPoolManagerMin.PoolKey({
            // Native ETH
            currency0: address(0),
            // The ERC20 token
            currency1: token,
            // Use default 0.3% if no fee specified
            fee: fee == 0 ? DEFAULT_FEE : fee,
            // Default tick spacing (120); caller may override for custom pools
            tickSpacing: TICK_SPACING,
            // No hooks for Glue pools
            hooks: address(0)
        });
        
        // Derive the unique poolId from the key
        poolId = keccak256(abi.encode(key));
    }

    
    /**
     * @notice Generate a unique V4 position salt from a user address
     * @dev The salt distinguishes positions owned by different users within the same pool.
     *      Casting the address to bytes32 ensures each user gets an isolated, non-colliding slot.
     * @param owner The user address whose position salt is being computed
     * @return salt The bytes32 salt derived from the owner address
     */
    function positionSalt(address owner) internal pure returns (bytes32 salt) {
        // Widen address (160 bits) to bytes32 (256 bits) as unique position salt
        salt = bytes32(uint256(uint160(owner)));
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // TICK MATH
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Compute the widest spacing-aligned ("full-range") tick bounds for a given tickSpacing.
     * @dev V4 requires every position tick to be a multiple of the pool's tickSpacing, otherwise
     *      modifyLiquidity reverts. The widest valid magnitude is therefore
     *      floor(MAX_USABLE_TICK / tickSpacing) * tickSpacing. For the default spacing of 120 this
     *      returns ±887160 (identical to MIN_TICK / MAX_TICK). Callers that build pools with a
     *      non-default tickSpacing should use this instead of the hardcoded constants so the
     *      full-range bounds stay aligned (e.g. spacing 200 → ±887200, not ±887160).
     * @param tickSpacing The pool's tick spacing (must be > 0)
     * @return tickLower The aligned minimum (negative) tick
     * @return tickUpper The aligned maximum (positive) tick
     */
    function fullRangeTicks(int24 tickSpacing) internal pure returns (int24 tickLower, int24 tickUpper) {
        // Spacing must be positive
        if (tickSpacing <= 0) revert Unauthorized();
        // Snap the absolute max tick down to a spacing multiple
        int24 maxAligned = (MAX_USABLE_TICK / tickSpacing) * tickSpacing;
        // Symmetric full range
        return (-maxAligned, maxAligned);
    }

    /// @notice Compute the sqrt price at a given tick using the standard Uniswap V4 TickMath algorithm
    /// @dev Uses iterative bit-manipulation to compute 1.0001^tick as a Q64.96 sqrt ratio.
    ///      This is a direct port of the Uniswap V4 TickMath.getSqrtPriceAtTick reference implementation.
    ///      Individual magic-constant lines are standard TickMath bit patterns and need no per-line explanation.
    /// @param tick The tick to convert (must be in range [MIN_TICK, MAX_TICK])
    /// @return sqrtPriceX96 The sqrt(1.0001^tick) encoded as Q64.96
    function getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        unchecked {
            // Compute absolute tick value
            uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));
            // Ensure tick is within valid range (absolute V4 TickMath max, matches Uniswap)
            if (absTick > uint256(int256(MAX_USABLE_TICK))) revert Unauthorized();

            // Select the base ratio depending on the lowest bit of the absolute tick
            uint256 ratio = absTick & 0x1 != 0
                ? 0xfffcb933bd6fad37aa2d162d1a594001
                : 0x100000000000000000000000000000000;
            // Iterative bit-pattern multiplication — standard TickMath magic constants
            if (absTick & 0x2 != 0) ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
            if (absTick & 0x4 != 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
            if (absTick & 0x8 != 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
            if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
            if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
            if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
            if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
            if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
            if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
            if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
            if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
            if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
            if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
            if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
            if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
            if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
            if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
            if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
            if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

            // If tick is positive, invert the ratio (reciprocal)
            if (tick > 0) ratio = type(uint256).max / ratio;

            // Downshift from Q128.128 to Q64.96, rounding up if needed
            sqrtPriceX96 = uint160((ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1));
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // LIQUIDITY CALCULATIONS
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Calculate optimal liquidity from ETH and token amounts for the full-range tick span
     * @dev Delegates to the 5-param overload using MIN_SQRT_RATIO and MAX_SQRT_RATIO as bounds.
     *      Returns the minimum of the two per-currency liquidities (binding constraint).
     * @param sqrtPriceX96 Current pool price as Q64.96 sqrt price
     * @param ethAmount Available ETH (currency0) amount
     * @param tokenAmount Available token (currency1) amount
     * @return liquidity Optimal liquidity amount (limited by the binding currency)
     */
    function getLiquidityForAmounts(
        uint160 sqrtPriceX96,
        uint256 ethAmount,
        uint256 tokenAmount
    ) internal pure returns (uint128 liquidity) {
        // Delegate to the 5-param overload using full-range sqrt price bounds
        return getLiquidityForAmounts(sqrtPriceX96, MIN_SQRT_RATIO, MAX_SQRT_RATIO, ethAmount, tokenAmount);
    }

    /**
     * @notice Calculate optimal liquidity from ETH and token amounts with explicit sqrt price bounds
     * @dev Computes liquidity for each currency independently then takes the minimum.
     *      The binding (minimum) constraint determines how much liquidity can be minted
     *      without excess of either currency. Matches Uniswap V4 LiquidityAmounts logic.
     * @param sqrtPriceX96 Current pool price as Q64.96 sqrt price
     * @param sqrtPriceLowerX96 Lower bound sqrt price (matches lower tick)
     * @param sqrtPriceUpperX96 Upper bound sqrt price (matches upper tick)
     * @param ethAmount Available ETH (currency0) amount
     * @param tokenAmount Available token (currency1) amount
     * @return liquidity Optimal liquidity (minimum of the two per-currency results)
     */
    function getLiquidityForAmounts(
        uint160 sqrtPriceX96,
        uint160 sqrtPriceLowerX96,
        uint160 sqrtPriceUpperX96,
        uint256 ethAmount,
        uint256 tokenAmount
    ) internal pure returns (uint128 liquidity) {
        // Liquidity implied by ETH amount
        uint128 liq0 = getLiquidityForAmount0(sqrtPriceX96, sqrtPriceUpperX96, ethAmount);
        // Liquidity implied by token amount
        uint128 liq1 = getLiquidityForAmount1(sqrtPriceLowerX96, sqrtPriceX96, tokenAmount);
        // Return the binding (minimum) constraint
        return liq0 < liq1 ? liq0 : liq1;
    }
    
    /**
     * @notice Calculate liquidity from a currency0 (ETH) amount and a sqrt price range
     * @dev Formula: L = amount0 * sqrtA * sqrtB / Q96 / (sqrtB - sqrtA)
     *      Using 512-bit intermediate precision to avoid overflow.
     * @param sqrtPriceAX96 First sqrt price bound (Q64.96)
     * @param sqrtPriceBX96 Second sqrt price bound (Q64.96)
     * @param amount0 ETH (currency0) amount to convert to liquidity
     * @return Liquidity units implied by this ETH amount across the given price range
     */
    function getLiquidityForAmount0(
        uint160 sqrtPriceAX96,
        uint160 sqrtPriceBX96,
        uint256 amount0
    ) internal pure returns (uint128) {
        // Ensure priceA <= priceB for consistent math
        if (sqrtPriceAX96 > sqrtPriceBX96) {
            (sqrtPriceAX96, sqrtPriceBX96) = (sqrtPriceBX96, sqrtPriceAX96);
        }
        
        // intermediate = sqrtPriceA * sqrtPriceB / Q96 (512-bit precision)
        uint256 intermediate = GluedMath.md512(sqrtPriceAX96, sqrtPriceBX96, Q96);
        // liquidity = amount0 * intermediate / (sqrtPriceB - sqrtPriceA)
        return toUint128(GluedMath.md512(amount0, intermediate, sqrtPriceBX96 - sqrtPriceAX96));
    }
    
    /**
     * @notice Calculate liquidity from a currency1 (token) amount and a sqrt price range
     * @dev Formula: L = amount1 * Q96 / (sqrtB - sqrtA)
     *      Using 512-bit intermediate precision to avoid overflow.
     * @param sqrtPriceAX96 First sqrt price bound (Q64.96)
     * @param sqrtPriceBX96 Second sqrt price bound (Q64.96)
     * @param amount1 Token (currency1) amount to convert to liquidity
     * @return Liquidity units implied by this token amount across the given price range
     */
    function getLiquidityForAmount1(
        uint160 sqrtPriceAX96,
        uint160 sqrtPriceBX96,
        uint256 amount1
    ) internal pure returns (uint128) {
        // Ensure priceA <= priceB for consistent math
        if (sqrtPriceAX96 > sqrtPriceBX96) {
            (sqrtPriceAX96, sqrtPriceBX96) = (sqrtPriceBX96, sqrtPriceAX96);
        }
        
        // liquidity = amount1 * Q96 / (sqrtPriceB - sqrtPriceA)
        return toUint128(GluedMath.md512(amount1, Q96, sqrtPriceBX96 - sqrtPriceAX96));
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // AMOUNT-FROM-LIQUIDITY HELPERS (inverse of getLiquidityForAmounts)
    // Matches V4 SqrtPriceMath.getAmount0Delta / getAmount1Delta
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Compute the currency0 (ETH) amount for a given liquidity across a sqrt price range
     * @dev Formula: amount0 = L * (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper / Q96)
     *              = L * Q96 * (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper)
     *      Matches V4 SqrtPriceMath.getAmount0Delta.
     * @param sqrtLowerX96 Lower sqrt price bound (Q64.96)
     * @param sqrtUpperX96 Upper sqrt price bound (Q64.96)
     * @param liquidity Liquidity units to compute the ETH amount for
     * @return ETH (currency0) amount corresponding to this liquidity across the price range
     */
    function getAmount0ForLiquidity(
        uint160 sqrtLowerX96, uint160 sqrtUpperX96, uint128 liquidity
    ) internal pure returns (uint256) {
        // Swap if lower > upper to ensure consistent ordering
        if (sqrtLowerX96 > sqrtUpperX96) (sqrtLowerX96, sqrtUpperX96) = (sqrtUpperX96, sqrtLowerX96);
        // amount0 = L * Q96 * (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper)
        // Split into two md512 calls: first L*Q96/sqrtUpper, then * delta / sqrtLower
        return GluedMath.md512(
            GluedMath.md512(uint256(liquidity), Q96, uint256(sqrtUpperX96)),
            uint256(sqrtUpperX96) - uint256(sqrtLowerX96),
            uint256(sqrtLowerX96)
        );
    }

    /**
     * @notice Compute the currency1 (token) amount for a given liquidity across a sqrt price range
     * @dev Formula: amount1 = L * (sqrtUpper - sqrtLower) / Q96
     *      Matches V4 SqrtPriceMath.getAmount1Delta.
     * @param sqrtLowerX96 Lower sqrt price bound (Q64.96)
     * @param sqrtUpperX96 Upper sqrt price bound (Q64.96)
     * @param liquidity Liquidity units to compute the token amount for
     * @return Token (currency1) amount corresponding to this liquidity across the price range
     */
    function getAmount1ForLiquidity(
        uint160 sqrtLowerX96, uint160 sqrtUpperX96, uint128 liquidity
    ) internal pure returns (uint256) {
        // Swap if lower > upper to ensure consistent ordering
        if (sqrtLowerX96 > sqrtUpperX96) (sqrtLowerX96, sqrtUpperX96) = (sqrtUpperX96, sqrtLowerX96);
        // amount1 = L * (sqrtUpper - sqrtLower) / Q96
        return GluedMath.md512(uint256(liquidity), uint256(sqrtUpperX96) - uint256(sqrtLowerX96), Q96);
    }

    /**
     * @notice Compute both currency amounts for a liquidity position given the current price and tick range
     * @dev Handles all three price-relative-to-range cases per V4 PositionManager conventions:
     *      - Price below range: position holds only ETH (currency0)
     *      - Price above range: position holds only tokens (currency1)
     *      - Price in range: position holds both currencies
     * @param sqrtPriceX96 Current pool price as Q64.96 sqrt price
     * @param sqrtLowerX96 Sqrt price at the lower tick (Q64.96)
     * @param sqrtUpperX96 Sqrt price at the upper tick (Q64.96)
     * @param liquidity Liquidity units to compute amounts for
     * @return amount0 Currency0 (ETH) amount held by this liquidity
     * @return amount1 Currency1 (token) amount held by this liquidity
     */
    function getAmountsForLiquidity(
        uint160 sqrtPriceX96, uint160 sqrtLowerX96, uint160 sqrtUpperX96, uint128 liquidity
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        if (sqrtPriceX96 <= sqrtLowerX96) {
            // Current price is entirely below the range: position is fully in ETH (currency0)
            amount0 = getAmount0ForLiquidity(sqrtLowerX96, sqrtUpperX96, liquidity);
        } else if (sqrtPriceX96 >= sqrtUpperX96) {
            // Current price is entirely above the range: position is fully in tokens (currency1)
            amount1 = getAmount1ForLiquidity(sqrtLowerX96, sqrtUpperX96, liquidity);
        } else {
            // Current price is within the range: position holds both currencies
            // ETH from current price to upper bound
            amount0 = getAmount0ForLiquidity(sqrtPriceX96, sqrtUpperX96, liquidity);
            // Tokens from lower bound to current price
            amount1 = getAmount1ForLiquidity(sqrtLowerX96, sqrtPriceX96, liquidity);
        }
    }

    /**
     * @notice Safely cast a uint256 to uint128, reverting on overflow
     * @dev Used throughout liquidity calculations to safely downcast intermediate results.
     * @param value The uint256 value to cast
     * @return The value as uint128 (reverts if value > type(uint128).max)
     */
    function toUint128(uint256 value) internal pure returns (uint128) {
        // Revert if value exceeds uint128 range
        if (value > type(uint128).max) revert("Overflow");
        // Safe downcast after overflow check
        return uint128(value);
    }
    
    /**
     * @notice Create a single-element uint256 array containing the given value
     * @dev Convenience helper used when a function requires an array but only one element is needed.
     * @param id The single value to wrap in an array
     * @return arr A newly allocated uint256[1] containing id
     */
    function singleArray(uint256 id) internal pure returns (uint256[] memory arr) {
        // Allocate a 1-element array in memory
        arr = new uint256[](1);
        // Set the sole element
        arr[0] = id;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABSTRACT CONTRACT FOR UNLOCK CALLBACK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @title GluedV4Callback
 * @notice Abstract contract that inheriting contracts use to interact with Uniswap V4 via the unlock→callback pattern
 * @dev Implements unlockCallback, which V4 PoolManager calls back during every operation.
 *      Settlement pattern:
 *        - Native ETH: settle{value: amount}()
 *        - ERC20: sync(currency) → _transferToken() → settle()
 *      Inheriting contracts must implement _transferToken to handle ERC20 transfers.
 *      All V4 operations (add/remove liquidity, collect fees, swap) are dispatched through this single callback.
 */
abstract contract GluedV4Callback {
    // Attach library functions to all types
    using GluedV4Core for *;
    
    /// @dev Immutable V4 PoolManager address; set once during construction and never changed
    address internal immutable POOL_MANAGER;
    /// @dev EIP-1153 transient storage slot for the callback recipient address.
    ///      Derived per-instance from address(this) so each proxy clone has its own slot.
    ///      Set via TSTORE before unlock(), read via TLOAD inside the callback, auto-cleared at tx end.
    function _recipientSlot() private view returns (bytes32) {
        // Derive a unique slot from the clone's own address
        return keccak256(abi.encodePacked(address(this), "CallbackRecipient"));
    }
    function _setRecipient(address recipient) private {
        // Compute the transient slot for this clone
        bytes32 slot = _recipientSlot();
        // Store recipient address in transient storage
        assembly { tstore(slot, recipient) }
    }
    function _getRecipient() private view returns (address recipient) {
        // Compute the transient slot for this clone
        bytes32 slot = _recipientSlot();
        // Load recipient address from transient storage
        assembly { recipient := tload(slot) }
    }
    function _clearRecipient() private {
        // Compute the transient slot for this clone
        bytes32 slot = _recipientSlot();
        // Zero out the transient recipient slot
        assembly { tstore(slot, 0) }
    }
    
    // Operation code: add liquidity to V4 pool (internal so an inheriting hook can drive the same
    // callback with its own payload — e.g. a liquidity-units add that skips the amount math)
    uint8 internal constant OP_ADD_LIQUIDITY = 1;
    // Operation code: remove liquidity from V4 pool
    uint8 internal constant OP_REMOVE_LIQUIDITY = 2;
    // Operation code: collect accrued trading fees
    uint8 internal constant OP_COLLECT_FEES = 3;
    // Operation code: execute an exact-input swap
    uint8 internal constant OP_SWAP = 4;
    
    /// @notice Deploy the callback contract with a fixed PoolManager address
    /// @param poolManager Address of the Uniswap V4 PoolManager on this chain
    constructor(address poolManager) {
        // Zero address would break all V4 calls
        if (poolManager == address(0)) revert Unauthorized();
        // Store immutably; cannot be changed post-deploy
        POOL_MANAGER = poolManager;
    }
    
    /// @dev Unpack a V4 BalanceDelta (packed int256) into its two signed 128-bit components.
    ///      Matches BalanceDeltaLibrary.amount0() and amount1() from v4-core.
    ///      amount0 occupies the upper 128 bits; amount1 occupies the lower 128 bits.
    /// @param delta The packed BalanceDelta returned by PoolManager.modifyLiquidity or swap
    /// @return amount0 Signed 128-bit delta for currency0 (negative = owed to PM, positive = claimable)
    /// @return amount1 Signed 128-bit delta for currency1 (negative = owed to PM, positive = claimable)
    function _unpackDelta(int256 delta) internal pure returns (int128 amount0, int128 amount1) {
        assembly {
            // Arithmetic right-shift: extract upper 128 bits (signed)
            amount0 := sar(128, delta)
            // Sign-extend lower 128 bits (byte index 15 = 16 bytes)
            amount1 := signextend(15, delta)
        }
    }
    
    /// @dev Send tokens owed to the PoolManager during an unlock callback (negative delta settlement).
    ///      For native ETH: the value is sent directly with settle{value: amount}().
    ///      For ERC20: PM.sync() checkpoints its balance, then _transferToken() moves the tokens,
    ///      then PM.settle() confirms the delta matched the snapshot.
    /// @param currency The currency to settle (address(0) = ETH, otherwise ERC20)
    /// @param amount The amount of currency owed to the PoolManager
    function _settleV4(address currency, uint256 amount) internal {
        if (currency == address(0)) {
            // Native ETH: send value directly with settle call
            IPoolManagerMin(POOL_MANAGER).settle{value: amount}();
        } else {
            // ERC20: checkpoint balance, transfer tokens, then confirm settlement
            // Tell PM to snapshot its balance
            IPoolManagerMin(POOL_MANAGER).sync(currency);
            // Transfer ERC20 to PM
            _transferToken(currency, POOL_MANAGER, amount);
            // Confirm: PM checks delta vs snapshot
            IPoolManagerMin(POOL_MANAGER).settle();
        }
    }
    
    /// @notice Execute an exact-input swap while the PoolManager is ALREADY unlocked.
    /// @dev    Every other swap path here goes through {_swapV4}, which opens its own `unlock`. Code that
    ///         runs INSIDE somebody else's unlock — a hook callback, most of all — cannot do that (the
    ///         PoolManager rejects a nested unlock), so this variant calls `swap` directly and balances
    ///         the resulting deltas itself: it settles what it owes and takes the output to this contract.
    ///
    ///         The price limit is pinned to the direction's extreme, so slippage is the caller's job —
    ///         compare the returned `amountOut` against a floor it computed before calling.
    /// @param key        The V4 pool key.
    /// @param zeroForOne True to sell currency0 for currency1, false for the reverse.
    /// @param amountIn   Exact input amount (this contract must hold it).
    /// @return amountInUsed Input the pool consumed.
    /// @return amountOut    Output the pool delivered to this contract.
    function _swapInUnlock(
        IPoolManagerMin.PoolKey memory key,
        bool zeroForOne,
        uint256 amountIn
    ) internal returns (uint256 amountInUsed, uint256 amountOut) {
        // Nothing to swap
        if (amountIn == 0) return (0, 0);

        // Let the price move freely; the caller enforces its own output floor
        uint160 limit = zeroForOne ? GluedV4Core.MIN_SQRT_RATIO + 1 : GluedV4Core.MAX_SQRT_RATIO - 1;

        // Exact-input swap on the already-unlocked PoolManager
        int256 swapDelta = IPoolManagerMin(POOL_MANAGER).swap(
            key,
            IPoolManagerMin.SwapParams({
                // Direction of the sale
                zeroForOne: zeroForOne,
                // Negative = exact input
                amountSpecified: -int256(amountIn),
                // Direction extreme
                sqrtPriceLimitX96: limit
            }),
            ""
        );
        // Split the packed delta into its two currency legs
        (int128 delta0, int128 delta1) = _unpackDelta(swapDelta);

        // Pay what we owe, then claim what we are owed
        if (delta0 < 0) _settleV4(key.currency0, uint256(uint128(-delta0)));
        if (delta1 < 0) _settleV4(key.currency1, uint256(uint128(-delta1)));
        if (delta0 > 0) IPoolManagerMin(POOL_MANAGER).take(key.currency0, address(this), uint256(uint128(delta0)));
        if (delta1 > 0) IPoolManagerMin(POOL_MANAGER).take(key.currency1, address(this), uint256(uint128(delta1)));

        // Report the realised legs
        amountInUsed = zeroForOne
            ? (delta0 < 0 ? uint256(uint128(-delta0)) : 0)
            : (delta1 < 0 ? uint256(uint128(-delta1)) : 0);
        amountOut = zeroForOne
            ? (delta1 > 0 ? uint256(uint128(delta1)) : 0)
            : (delta0 > 0 ? uint256(uint128(delta0)) : 0);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // EXTERNAL CALLBACK
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /// @notice Callback invoked by PoolManager.unlock() to execute a V4 operation
    /// @dev Only callable by the registered PoolManager (enforced via require).
    ///      Decodes the operation type from the first 32 bytes of data, then dispatches to the
    ///      appropriate internal handler. Handlers settle negative deltas (owed to PM) and
    ///      take positive deltas (owed to caller), then return encoded deltas to the unlock caller.
    /// @param data ABI-encoded payload: first 32 bytes = uint8 opType, remainder = operation params
    /// @return ABI-encoded (int128 delta0, int128 delta1) balance deltas for the caller to decode
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        // Only PM can call this callback
        if (msg.sender != POOL_MANAGER) revert Unauthorized();
        
        // Decode the operation type from first 32 bytes
        uint8 opType = abi.decode(data[:32], (uint8));
        // Remaining bytes are operation-specific params
        bytes memory params = data[32:];
        
        if (opType == OP_ADD_LIQUIDITY) {
            // Route to add-liquidity handler
            return _handleAddLiquidity(params);
        } else if (opType == OP_REMOVE_LIQUIDITY || opType == OP_COLLECT_FEES) {
            // Both use same handler (delta=0 for fees)
            return _handleRemoveLiquidity(params);
        }
        
        // Invalid opType — should never reach here (OP_SWAP is reserved: the hook swaps in-place
        // inside the carrying swap's own unlock via _swapInUnlock, never through a fresh unlock)
        revert("Unknown operation");
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // LIQUIDITY OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Add ETH and token liquidity to a V4 pool position
     * @dev Calculates optimal liquidity from the provided amounts and current pool price,
     *      then encodes an ADD_LIQUIDITY callback payload and calls PoolManager.unlock().
     *      The unlock→callback pattern handles settlement: negative deltas are paid (settle),
     *      positive deltas (accrued fees from existing position) are claimed (take).
     *      Tick bounds (0,0) resolve to full-range (MIN_TICK, MAX_TICK).
     * @param key The V4 PoolKey identifying the pool
     * @param ethAmount ETH to deposit (currency0); actual used amount may be less if token is binding
     * @param tokenAmount Token to deposit (currency1); actual used amount may be less if ETH is binding
     * @param owner Address that owns the position (salt derived from this address)
     * @param tickLower Lower tick bound (0 = use MIN_TICK for full range)
     * @param tickUpper Upper tick bound (0 = use MAX_TICK for full range)
     * @return result AddLiquidityResult containing liquidity minted, amounts used, and fees collected
     */
    function _addLiquidityV4(
        IPoolManagerMin.PoolKey memory key,
        uint256 ethAmount,
        uint256 tokenAmount,
        address owner,
        int24 tickLower,
        int24 tickUpper
    ) internal returns (GluedV4Core.AddLiquidityResult memory result) {
        // Both zero = sentinel for full range
        if (tickLower == 0 && tickUpper == 0) {
            // Resolve to spacing-aligned full range (±887160 for spacing 120)
            (tickLower, tickUpper) = GluedV4Core.fullRangeTicks(key.tickSpacing);
        }

        // Compute sqrt price at lower tick
        uint160 sqrtLower = GluedV4Core.getSqrtRatioAtTick(tickLower);
        // Compute sqrt price at upper tick
        uint160 sqrtUpper = GluedV4Core.getSqrtRatioAtTick(tickUpper);

        // Derive pool ID from key
        bytes32 poolId = keccak256(abi.encode(key));
        // Read current pool state
        GluedV4Core.Slot0 memory slot0 = GluedV4Core.getSlot0(POOL_MANAGER, poolId);
        
        // Calculate optimal liquidity from amounts and tick range
        uint128 liquidity = GluedV4Core.getLiquidityForAmounts(
            slot0.sqrtPriceX96, sqrtLower, sqrtUpper, ethAmount, tokenAmount
        );
        
        // Must produce non-zero LP
        if (liquidity == 0) revert Unauthorized();
        
        // Set transient recipient for any fee take()
        _setRecipient(owner);
        
        // Encode callback payload
        bytes memory callbackData = abi.encode(
            // Operation type
            OP_ADD_LIQUIDITY,
            // Pool key
            key,
            // Positive = add liquidity
            int256(uint256(liquidity)),
            // Per-user position salt
            GluedV4Core.positionSalt(owner),
            // Lower tick bound
            tickLower,
            // Upper tick bound
            tickUpper
        );
        
        // Execute via PM unlock
        bytes memory returnData = IPoolManagerMin(POOL_MANAGER).unlock(callbackData);
        // Decode balance deltas
        (int128 delta0, int128 delta1) = abi.decode(returnData, (int128, int128));
        
        // Liquidity minted
        result.liquidity = liquidity;
        // ETH consumed by position
        result.ethUsed = delta0 < 0 ? uint256(uint128(-delta0)) : 0;
        // Tokens consumed by position
        result.tokenUsed = delta1 < 0 ? uint256(uint128(-delta1)) : 0;
        // ETH fees collected
        result.ethFees = delta0 > 0 ? uint256(uint128(delta0)) : 0;
        // Token fees collected
        result.tokenFees = delta1 > 0 ? uint256(uint128(delta1)) : 0;
        
        // Clear transient recipient (hygiene; auto-clears at tx end)
        _clearRecipient();
    }
    
    /**
     * @notice Remove V4 LP liquidity from a position and deliver the underlying tokens to the recipient
     * @dev Encodes a REMOVE_LIQUIDITY callback payload (negative liquidityDelta) and calls PoolManager.unlock().
     *      V4 returns positive deltas representing the principal + accrued fees returned to this contract.
     *      The callback takes both currencies and sends them directly to recipient.
     *      Tick bounds (0,0) are resolved to full-range in the callback handler.
     * @param key The V4 PoolKey identifying the pool
     * @param liquidity Liquidity units to remove (must be > 0)
     * @param owner Address that owns the position (salt derived from this address)
     * @param recipient Address to receive the returned ETH and tokens
     * @param tickLower Lower tick of the position (0 = full-range sentinel, resolved in callback)
     * @param tickUpper Upper tick of the position (0 = full-range sentinel, resolved in callback)
     * @return result RemoveLiquidityResult with ethReceived and tokenReceived amounts
     */
    function _removeLiquidityV4(
        IPoolManagerMin.PoolKey memory key,
        uint128 liquidity,
        address owner,
        address recipient,
        int24 tickLower,
        int24 tickUpper
    ) internal returns (GluedV4Core.RemoveLiquidityResult memory result) {
        // Cannot remove zero liquidity
        if (liquidity == 0) revert Unauthorized();
        
        // Set transient recipient so callback's take() sends to the right address
        _setRecipient(recipient);
        
        // Encode callback payload
        bytes memory callbackData = abi.encode(
            // Operation type: remove liquidity
            OP_REMOVE_LIQUIDITY,
            // Pool key identifying the pool
            key,
            // Negative liquidityDelta = remove this many units
            -int256(uint256(liquidity)),
            // Per-user salt to identify the correct position
            GluedV4Core.positionSalt(owner),
            // Lower tick (0 = sentinel for full range)
            tickLower,
            // Upper tick (0 = sentinel for full range)
            tickUpper
        );
        
        // Trigger callback via PM unlock
        bytes memory returnData = IPoolManagerMin(POOL_MANAGER).unlock(callbackData);
        // Decode returned deltas
        (int128 delta0, int128 delta1) = abi.decode(returnData, (int128, int128));
        
        // Positive delta0 = ETH returned
        result.ethReceived = delta0 > 0 ? uint256(uint128(delta0)) : 0;
        // Positive delta1 = tokens returned
        result.tokenReceived = delta1 > 0 ? uint256(uint128(delta1)) : 0;
        
        // Clear transient recipient (hygiene; auto-clears at tx end)
        _clearRecipient();
    }
    
    /**
     * @notice Collect accrued V4 trading fees from a position without removing any liquidity
     * @dev Encodes a COLLECT_FEES callback payload (liquidityDelta = 0) and calls PoolManager.unlock().
     *      A zero-delta modifyLiquidity flushes accumulated fees for the position without moving liquidity.
     *      V4 returns positive deltas for the accrued fees; the callback takes them and sends to recipient.
     * @param key The V4 PoolKey identifying the pool
     * @param owner Address that owns the position (salt derived from this address)
     * @param recipient Address to receive the collected fee tokens
     * @param tickLower Lower tick of the position (0 = full-range sentinel, resolved in callback)
     * @param tickUpper Upper tick of the position (0 = full-range sentinel, resolved in callback)
     * @return ethFees Amount of ETH (currency0) fees collected
     * @return tokenFees Amount of token (currency1) fees collected
     */
    function _collectFeesV4(
        IPoolManagerMin.PoolKey memory key,
        address owner,
        address recipient,
        int24 tickLower,
        int24 tickUpper
    ) internal returns (uint256 ethFees, uint256 tokenFees) {
        // Set transient recipient so callback's take() sends fees to the right address
        _setRecipient(recipient);
        
        // Encode callback payload
        bytes memory callbackData = abi.encode(
            // Operation type: collect fees (same handler as remove, delta = 0)
            OP_COLLECT_FEES,
            // Pool key identifying the pool
            key,
            // Zero liquidityDelta = collect fees without moving liquidity
            int256(0),
            // Per-user salt to identify the correct position
            GluedV4Core.positionSalt(owner),
            // Lower tick (0 = sentinel for full range)
            tickLower,
            // Upper tick (0 = sentinel for full range)
            tickUpper
        );
        
        // Trigger callback via PM unlock
        bytes memory returnData = IPoolManagerMin(POOL_MANAGER).unlock(callbackData);
        // Decode returned deltas
        (int128 delta0, int128 delta1) = abi.decode(returnData, (int128, int128));
        
        // Positive delta0 = ETH fees collected
        ethFees = delta0 > 0 ? uint256(uint128(delta0)) : 0;
        // Positive delta1 = token fees collected
        tokenFees = delta1 > 0 ? uint256(uint128(delta1)) : 0;
        
        // Clear transient recipient (hygiene; auto-clears at tx end)
        _clearRecipient();
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // CALLBACK HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /// @dev Handles the ADD_LIQUIDITY callback from PoolManager.unlock().
    ///      Decodes the pool key, liquidity delta, position salt, and tick range.
    ///      Calls modifyLiquidity with a positive delta, then settles negative deltas (tokens owed to PM)
    ///      and takes positive deltas (accrued fees from existing position returned to recipient).
    function _handleAddLiquidity(bytes memory params) private returns (bytes memory) {
        // Decode callback payload
        (
            // Pool key
            IPoolManagerMin.PoolKey memory key,
            // Positive = add liquidity
            int256 liquidityDelta,
            // Per-user position salt
            bytes32 salt,
            // Lower tick (already resolved by caller)
            int24 tickLower,
            // Upper tick (already resolved by caller)
            int24 tickUpper
        ) = abi.decode(params, (IPoolManagerMin.PoolKey, int256, bytes32, int24, int24));

        // Build modifyLiquidity params struct
        IPoolManagerMin.ModifyLiquidityParams memory modifyParams = IPoolManagerMin.ModifyLiquidityParams({
            // Resolved lower tick
            tickLower: tickLower,
            // Resolved upper tick
            tickUpper: tickUpper,
            // Amount of liquidity to add
            liquidityDelta: liquidityDelta,
            // Position identifier
            salt: salt
        });
        
        // Execute on PM
        (int256 callerDelta, ) = IPoolManagerMin(POOL_MANAGER).modifyLiquidity(key, modifyParams, "");
        // Unpack balance deltas
        (int128 delta0, int128 delta1) = _unpackDelta(callerDelta);
        
        // Settle negative deltas (tokens owed to PM for new liquidity)
        if (delta0 < 0) _settleV4(key.currency0, uint256(uint128(-delta0)));
        if (delta1 < 0) _settleV4(key.currency1, uint256(uint128(-delta1)));
        
        // Take positive deltas (accrued V4 trading fees from existing position).
        // When adding to an existing position, modifyLiquidity returns a NET delta
        // that includes fees earned since the last interaction. If fees exceed the
        // deposit in one currency, that delta is positive and must be taken.
        address recipient = _getRecipient();
        // Fallback to self if not set
        if (recipient == address(0)) recipient = address(this);
        // Claim ETH output
        if (delta0 > 0) IPoolManagerMin(POOL_MANAGER).take(key.currency0, recipient, uint256(uint128(delta0)));
        // Claim token output
        if (delta1 > 0) IPoolManagerMin(POOL_MANAGER).take(key.currency1, recipient, uint256(uint128(delta1)));
        
        // Return deltas to caller
        return abi.encode(delta0, delta1);
    }
    
    /// @dev Handles both REMOVE_LIQUIDITY and COLLECT_FEES callbacks from PoolManager.unlock().
    ///      Both operations use modifyLiquidity: negative delta for removal, zero delta for fee collection.
    ///      Resolves sentinel (0,0) tick bounds to full-range, then calls modifyLiquidity.
    ///      Takes all positive deltas (principal + fees returned) and sends them to the recipient.
    function _handleRemoveLiquidity(bytes memory params) private returns (bytes memory) {
        // Decode callback payload
        (
            // Pool key
            IPoolManagerMin.PoolKey memory key,
            // Negative = remove liquidity (or 0 = collect fees)
            int256 liquidityDelta,
            // Per-user position salt
            bytes32 salt,
            // Lower tick (0 = sentinel)
            int24 tickLower,
            // Upper tick (0 = sentinel)
            int24 tickUpper
        ) = abi.decode(params, (IPoolManagerMin.PoolKey, int256, bytes32, int24, int24));

        // Both zero = sentinel for full range
        if (tickLower == 0 && tickUpper == 0) {
            // Resolve to spacing-aligned full range (±887160 for spacing 120)
            (tickLower, tickUpper) = GluedV4Core.fullRangeTicks(key.tickSpacing);
        }
        
        // Build modifyLiquidity params struct
        IPoolManagerMin.ModifyLiquidityParams memory modifyParams = IPoolManagerMin.ModifyLiquidityParams({
            // Resolved lower tick
            tickLower: tickLower,
            // Resolved upper tick
            tickUpper: tickUpper,
            // Amount to remove (negative) or 0 (collect fees)
            liquidityDelta: liquidityDelta,
            // Position identifier
            salt: salt
        });
        
        // Execute on PM
        (int256 callerDelta, ) = IPoolManagerMin(POOL_MANAGER).modifyLiquidity(key, modifyParams, "");
        // Unpack balance deltas
        (int128 delta0, int128 delta1) = _unpackDelta(callerDelta);
        
        // Retrieve transient callback recipient
        address recipient = _getRecipient();
        // Fallback to self if not set
        if (recipient == address(0)) recipient = address(this);
        
        // Claim ETH
        if (delta0 > 0) IPoolManagerMin(POOL_MANAGER).take(key.currency0, recipient, uint256(uint128(delta0)));
        // Claim tokens
        if (delta1 > 0) IPoolManagerMin(POOL_MANAGER).take(key.currency1, recipient, uint256(uint128(delta1)));
        
        // Return deltas to caller
        return abi.encode(delta0, delta1);
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // ABSTRACT FUNCTION
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /// @notice Transfer an ERC20 token to a target address (must be implemented by inheriting contract)
    /// @dev Called during ERC20 settlement (_settleV4) to move tokens from this contract to the PoolManager.
    ///      The inheriting contract decides how the transfer is executed (e.g. IERC20.transfer or safeTransfer).
    /// @param token The ERC20 token address to transfer
    /// @param to The recipient address (typically the PoolManager during settlement)
    /// @param amount The amount of tokens to transfer
    function _transferToken(address token, address to, uint256 amount) internal virtual;
}
