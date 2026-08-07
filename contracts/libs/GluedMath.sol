// SPDX-License-Identifier: MIT
/**
                                                    
███╗   ███╗ █████╗ ████████╗██╗  ██╗
████╗ ████║██╔══██╗╚══██╔══╝██║  ██║
██╔████╔██║███████║   ██║   ███████║
██║╚██╔╝██║██╔══██║   ██║   ██╔══██║
██║ ╚═╝ ██║██║  ██║   ██║   ██║  ██║
╚═╝     ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝
███████╗ ██████╗ ██████╗            
██╔════╝██╔═══██╗██╔══██╗           
█████╗  ██║   ██║██████╔╝           
██╔══╝  ██║   ██║██╔══██╗           
██║     ╚██████╔╝██║  ██║           
╚═╝      ╚═════╝ ╚═╝  ╚═╝           
 ██████╗ ██╗     ██╗   ██╗███████╗  
██╔════╝ ██║     ██║   ██║██╔════╝  
██║  ███╗██║     ██║   ██║█████╗    
██║   ██║██║     ██║   ██║██╔══╝    
╚██████╔╝███████╗╚██████╔╝███████╗  
 ╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝  
                                                                                                                                                                                                             
 @title GluedMath
 @author Implementation by @BasedToschi
 @notice Glued Math Basics is a library for advanced fixed-point math operations (Original version by Uniswap Labs).
 @notice Glued Math Expanded introduces a new function to adjust the decimal places between different tokens with different decimals or ETH.
 @dev Implements multiplication and division with overflow protection and precision retention.
 @dev This library is used to handle the decimal places of the tokens.

*/

pragma solidity ^0.8.35;

library GluedMath {

    /// @notice Single protocol-wide failure error (selector 0x82b42900), mirroring the
    ///         one declared everywhere else so the whole codebase reverts with one selector.
    error Unauthorized();

/**
    
██████╗  █████╗ ███████╗██╗ ██████╗    ███╗   ███╗ █████╗ ████████╗██╗  ██╗
██╔══██╗██╔══██╗██╔════╝██║██╔════╝    ████╗ ████║██╔══██╗╚══██╔══╝██║  ██║
██████╔╝███████║███████╗██║██║         ██╔████╔██║███████║   ██║   ███████║
██╔══██╗██╔══██║╚════██║██║██║         ██║╚██╔╝██║██╔══██║   ██║   ██╔══██║
██████╔╝██║  ██║███████║██║╚██████╗    ██║ ╚═╝ ██║██║  ██║   ██║   ██║  ██║
╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝ ╚═════╝    ╚═╝     ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝

*/
    /**
     * @notice Performs a multiply-divide operation with full precision.
     * @dev Calculates floor(a * b / denominator) with full precision, using 512-bit intermediate values.
     * Throws if the result overflows a uint256 or if the denominator is zero.
     *
     * @param a The multiplicand.
     * @param b The multiplier.
     * @param denominator The divisor.
     * @return result The result of the operation.
     *
     * Use case: When you need to calculate the result of a multiply-divide operation with full precision.
     */
    function md512(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {
        
        unchecked {

            // Calculate the product of a and b
            uint256 prod0; 
            uint256 prod1;

            // Calculate the product of a and b with overflow protection
            assembly {
                let mm := mulmod(a, b, not(0))
                prod0 := mul(a, b)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }

            // If the denominator is zero or the result overflows, revert
            if (denominator <= prod1) revert Unauthorized();

            // If the product of a and b is less than the denominator, return the result
            if (prod1 == 0) {
                assembly {
                    result := div(prod0, denominator)
                }

                // Return the result
                return result;
            }

            // Calculate the remainder of the product of a and b divided by the denominator
            uint256 remainder;
            assembly {
                remainder := mulmod(a, b, denominator)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }

            // Calculate the twos of the denominator (largest power of two dividing it)
            uint256 twos = (0 - denominator) & denominator;

            // Divide denominator and prod0 by that power of two, then shift the high-word
            // bits (prod1) down into prod0. This final fold is REQUIRED: without it the
            // contribution of prod1 is lost whenever a*b >= 2^256 (overflowing products),
            // which silently corrupts the result. Matches Uniswap FullMath.mulDiv exactly.
            assembly {
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                // twos := 2^256 / twos  (flip), used to fold prod1 into prod0
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;

            // Calculate the inverse of the denominator
            uint256 inv = (3 * denominator) ^ 2;
            inv *= 2 - denominator * inv; // inverse mod 2^8
            inv *= 2 - denominator * inv; // inverse mod 2^16
            inv *= 2 - denominator * inv; // inverse mod 2^32
            inv *= 2 - denominator * inv; // inverse mod 2^64
            inv *= 2 - denominator * inv; // inverse mod 2^128
            inv *= 2 - denominator * inv; // inverse mod 2^256

            // Calculate the result
            result = prod0 * inv;

            // Return the result
            return result;
        }
    }

    /**
     * @notice Performs a multiply-divide operation with full precision and rounding up.
     * @dev Calculates ceil(a * b / denominator) with full precision, using 512-bit intermediate values.
     * Throws if the result overflows a uint256 or if the denominator is zero.
     *
     * @param a The multiplicand.
     * @param b The multiplier.
     * @param denominator The divisor.
     * @return result The result of the operation, rounded up to the nearest integer.
     *
     * Use case: When you need to calculate the result of a multiply-divide operation with full precision and rounding up.
     */
    function md512Up(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {

        unchecked {

            // Calculate the result
            result = md512(a, b, denominator);

            // If the remainder of the product of a and b divided by the denominator is greater than 0, increment the result
            if (mulmod(a, b, denominator) > 0) {
                if (result >= type(uint256).max) revert Unauthorized();
                result++;
            }
        }
    }

    /**
     * @notice Fixed-point exponentiation: computes x^n scaled by `base`.
     * @dev Exponentiation-by-squaring. `x` is pre-scaled by `base` (e.g. a WAD), and the
     *      result is returned in the same `base` scale. Each squaring is done via `md512`
     *      (floor multiply-divide with 512-bit intermediates), so there is no overflow for
     *      any `x <= base`. O(log n). Used for geometric decay factors of the form
     *      `(1 - 1/T)^dt ≈ e^(-dt/T)`.
     *
     * @param x The base, pre-scaled by `base` (must be <= base for a decay factor).
     * @param n The integer exponent.
     * @param base The fixed-point scale (e.g. 1e18).
     * @return z The result `x^n`, in `base` scale.
     *
     * Use case: continuous exponential decay / compounding over an integer number of steps.
     */
    function rpow(uint256 x, uint256 n, uint256 base) internal pure returns (uint256 z) {
        // Seed: odd exponent starts from x, even from the identity element `base` (= 1.0).
        z = n % 2 != 0 ? x : base;
        // Square-and-multiply down the bits of n.
        for (n /= 2; n != 0; n /= 2) {
            // x = x^2 (in base scale)
            x = md512(x, x, base);
            // Fold x into the accumulator when the current bit is set.
            if (n % 2 != 0) z = md512(z, x, base);
        }
    }

/**
    
███████╗██╗  ██╗██████╗  █████╗ ███╗   ██╗██████╗ ███████╗██████╗     ███╗   ███╗ █████╗ ████████╗██╗  ██╗
██╔════╝╚██╗██╔╝██╔══██╗██╔══██╗████╗  ██║██╔══██╗██╔════╝██╔══██╗    ████╗ ████║██╔══██╗╚══██╔══╝██║  ██║
█████╗   ╚███╔╝ ██████╔╝███████║██╔██╗ ██║██║  ██║█████╗  ██║  ██║    ██╔████╔██║███████║   ██║   ███████║
██╔══╝   ██╔██╗ ██╔═══╝ ██╔══██║██║╚██╗██║██║  ██║██╔══╝  ██║  ██║    ██║╚██╔╝██║██╔══██║   ██║   ██╔══██║
███████╗██╔╝ ██╗██║     ██║  ██║██║ ╚████║██████╔╝███████╗██████╔╝    ██║ ╚═╝ ██║██║  ██║   ██║   ██║  ██║
╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ ╚══════╝╚═════╝     ╚═╝     ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝

*/

    /**
     * @notice Gets the decimals of a token
     * @dev If the token is ETH, you can use the address(0) as the token address.
     *
     * @param token The address of the token
     * @return decimals The number of decimals of the token
     *
     * Use case: When you need to get the decimals of a token
     */
    function getDecimals(address token) internal view returns (uint256 decimals) {
        
        // If the token is ETH, return 18
        if (token == address(0)) {
            return 18;
        }
        
        // Get the decimals of the token
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));

        // If the call failed, revert
        if (!(success && data.length >= 32)) revert Unauthorized();

        // Return the decimals of the token (ABI-encoded uint8 is right-padded in 32 bytes)
        return abi.decode(data, (uint256));
    }
    
    /**
     * @notice Adjusts decimal places between different token decimals. With this function,
     * you can get the right ammount of tokenOut from a given tokenIn address and amount
     * espressed in tokenIn's decimals.
     * @dev If one of the tokens is ETH, you can use the address(0) as the token address.
     *
     * @param amount The amount to adjust
     * @param tokenIn The address of the input token
     * @param tokenOut The address of the output token
     * @return adjustedAmount The adjusted amount with correct decimal places
     *
     * Use case: When you need to adjust the decimal places operating with two different tokens
     */
    function adjustDecimals(uint256 amount, address tokenIn, address tokenOut) internal view returns (uint256 adjustedAmount) {

        // Get the decimals of the input and output tokens
        uint256 decimalsIn = tokenIn == address(0) ? 18 : getDecimals(tokenIn);
        uint256 decimalsOut = tokenOut == address(0) ? 18 : getDecimals(tokenOut);
        
        // If the decimals are the same, return the amount
        if (decimalsIn == decimalsOut) return amount;
        
        // If input token is 0 decimal and output has decimals, special handling
        if (decimalsIn == 0 && decimalsOut > 0) {

            // Mltiply by 10^decimalsOut to ensure proper scaling
            return amount * (10 ** decimalsOut);
        }
        
        // If output token is 0 decimal and input has decimals, handle precision loss
        if (decimalsOut == 0 && decimalsIn > 0) {

            // Round up if there's any fractional part to avoid returning 0 for small amounts
            uint256 divisor = 10 ** decimalsIn;

            // Ceiling division
            return (amount + divisor - 1) / divisor;
        }
        
        // If the decimals of the input token are greater than the decimals of the output token, divide the amount
        return decimalsIn > decimalsOut
            ? amount / (10 ** (decimalsIn - decimalsOut))
            : amount * (10 ** (decimalsOut - decimalsIn));
    }

    /**
    * @dev You can combine md512 + adjustDecimals
    *
    * Example:
    *
    * uint256 result = adjustDecimals(md512(a, b, denominator), tokenIn, tokenOut);
    *
    */

}