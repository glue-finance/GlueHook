// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {GluedV4Core, IPoolManagerMin} from "../../contracts/libs/GluedV4Core.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title V4PoolHelper
 * @notice Test-only Uniswap V4 counterparty that can seed and trade ANY pool key, hooked or not, in
 *         either swap mode.
 * @dev    The existing {V4SwapHelper} drives the canonical hookless staking pools through the engine's
 *         own exact-input pipeline, which is the wrong tool for hook work: a hook suite needs a pool key
 *         carrying an arbitrary `hooks` address, exact-OUTPUT swaps as well as exact-input, and the raw
 *         balance deltas rather than a normalised result struct. This helper owns its own unlock loop so
 *         it can provide all three, and it never touches the engine's paths, so no existing suite changes
 *         behaviour.
 *
 *         It holds its own ETH and token balances and settles from them, so a test funds it once and then
 *         trades freely. Fixture only.
 */
contract V4PoolHelper {
    /// @notice The V4 PoolManager.
    address public immutable PM;

    /// @dev Operation selectors for the unlock payload.
    uint8 private constant OP_SWAP = 1;
    uint8 private constant OP_MODIFY = 2;

    constructor(address poolManager) {
        PM = poolManager;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ENTRIES
    // ═══════════════════════════════════════════════════════════════════════════════

    /// @notice Bring a pool into existence at an explicit price. The CALLER of this function is not the
    ///         pool's initialiser — this contract is, which matters for a hook that records one.
    function initialize(IPoolManagerMin.PoolKey calldata key, uint160 sqrtPriceX96) external {
        IPoolManagerMin(PM).initialize(key, sqrtPriceX96);
    }

    /// @notice Mint liquidity into a pool from this contract's own balances.
    /// @param key The pool key.
    /// @param tickLower Lower tick.
    /// @param tickUpper Upper tick.
    /// @param liquidity Liquidity to add.
    /// @return delta0 currency0 delta this contract settled or claimed.
    /// @return delta1 currency1 delta this contract settled or claimed.
    function addLiquidity(
        IPoolManagerMin.PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    ) external payable returns (int256 delta0, int256 delta1) {
        bytes memory out = IPoolManagerMin(PM).unlock(
            abi.encode(OP_MODIFY, key, tickLower, tickUpper, int256(uint256(liquidity)), false, int256(0))
        );
        return abi.decode(out, (int256, int256));
    }

    /// @notice Swap against a pool in either mode.
    /// @param key The pool key.
    /// @param zeroForOne True to sell currency0.
    /// @param amountSpecified V4's convention — negative for exact input, positive for exact output.
    /// @return delta0 currency0 delta (negative = this contract paid, positive = it received).
    /// @return delta1 currency1 delta.
    function swap(
        IPoolManagerMin.PoolKey calldata key,
        bool zeroForOne,
        int256 amountSpecified
    ) external payable returns (int256 delta0, int256 delta1) {
        bytes memory out = IPoolManagerMin(PM).unlock(
            abi.encode(OP_SWAP, key, int24(0), int24(0), int256(0), zeroForOne, amountSpecified)
        );
        return abi.decode(out, (int256, int256));
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // CALLBACK
    // ═══════════════════════════════════════════════════════════════════════════════

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == PM, "pm");
        (
            uint8 op,
            IPoolManagerMin.PoolKey memory key,
            int24 tickLower,
            int24 tickUpper,
            int256 liquidityDelta,
            bool zeroForOne,
            int256 amountSpecified
        ) = abi.decode(data, (uint8, IPoolManagerMin.PoolKey, int24, int24, int256, bool, int256));

        int256 packed;
        if (op == OP_SWAP) {
            uint160 limit = zeroForOne ? GluedV4Core.MIN_SQRT_RATIO + 1 : GluedV4Core.MAX_SQRT_RATIO - 1;
            packed = IPoolManagerMin(PM).swap(
                key,
                IPoolManagerMin.SwapParams({
                    zeroForOne: zeroForOne,
                    amountSpecified: amountSpecified,
                    sqrtPriceLimitX96: limit
                }),
                ""
            );
        } else {
            (packed, ) = IPoolManagerMin(PM).modifyLiquidity(
                key,
                IPoolManagerMin.ModifyLiquidityParams({
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: liquidityDelta,
                    salt: bytes32(0)
                }),
                ""
            );
        }

        int128 d0;
        int128 d1;
        assembly ("memory-safe") {
            d0 := sar(128, packed)
            d1 := signextend(15, packed)
        }

        if (d0 < 0) _settle(key.currency0, uint256(uint128(-d0)));
        if (d1 < 0) _settle(key.currency1, uint256(uint128(-d1)));
        if (d0 > 0) IPoolManagerMin(PM).take(key.currency0, address(this), uint256(uint128(d0)));
        if (d1 > 0) IPoolManagerMin(PM).take(key.currency1, address(this), uint256(uint128(d1)));

        return abi.encode(int256(d0), int256(d1));
    }

    function _settle(address currency, uint256 amount) private {
        if (currency == address(0)) {
            IPoolManagerMin(PM).settle{value: amount}();
        } else {
            IPoolManagerMin(PM).sync(currency);
            IERC20(currency).transfer(PM, amount);
            IPoolManagerMin(PM).settle();
        }
    }

    receive() external payable {}
}
