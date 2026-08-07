/**
 * Uniswap V4 math in bigint — exact mirrors of the on-chain libraries, so the
 * UI can turn HUMAN inputs (token amounts) into the contract's units
 * (uint128 liquidity) and quote swaps locally from raw pool state.
 *
 *  · TickMath.getSqrtRatioAtTick — bit-for-bit port
 *  · LiquidityAmounts.getLiquidityForAmounts / getAmountsForLiquidity
 *  · single-pool exact-input swap quote on the constant-product curve
 *  · the PoolManager's extsload slots for slot0 + liquidity
 */

import { encodeAbiParameters, keccak256, type Hex } from "viem";

export const Q96 = 2n ** 96n;
export const MAX_UINT_256 = 2n ** 256n - 1n;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

/* --------------------------------------------------------------- TickMath */

const TICK_CONSTANTS: [bigint, bigint][] = [
  [0x1n, 0xfffcb933bd6fad37aa2d162d1a594001n],
  [0x2n, 0xfff97272373d413259a46990580e213an],
  [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000n, 0x48a170391f7dc42444e8fa2n],
];

/** exact port of TickMath.getSqrtRatioAtTick (Q64.96) */
export function getSqrtRatioAtTick(tick: number): bigint {
  const absTick = BigInt(Math.abs(tick));
  let ratio = 0x100000000000000000000000000000000n;
  for (const [bit, c] of TICK_CONSTANTS) {
    if ((absTick & bit) !== 0n) ratio = (ratio * c) >> 128n;
  }
  if (tick > 0) ratio = MAX_UINT_256 / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

/* ------------------------------------------------------- LiquidityAmounts */

/** L that amount0 funds over [sqrtA, sqrtB] (both above the price) */
export function liquidityForAmount0(sqrtA: bigint, sqrtB: bigint, amount0: bigint): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  const intermediate = (sqrtA * sqrtB) / Q96;
  return (amount0 * intermediate) / (sqrtB - sqrtA);
}

/** L that amount1 funds over [sqrtA, sqrtB] (both below the price) */
export function liquidityForAmount1(sqrtA: bigint, sqrtB: bigint, amount1: bigint): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return (amount1 * Q96) / (sqrtB - sqrtA);
}

/** max L both amounts fund at the current price (LiquidityAmounts mirror) */
export function liquidityForAmounts(
  sqrtP: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  if (sqrtP <= sqrtA) return liquidityForAmount0(sqrtA, sqrtB, amount0);
  if (sqrtP >= sqrtB) return liquidityForAmount1(sqrtA, sqrtB, amount1);
  const l0 = liquidityForAmount0(sqrtP, sqrtB, amount0);
  const l1 = liquidityForAmount1(sqrtA, sqrtP, amount1);
  return l0 < l1 ? l0 : l1;
}

/** the amounts a position of L over [sqrtA, sqrtB] holds at price sqrtP (floor) */
export function amountsForLiquidity(
  sqrtP: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  L: bigint,
): { amount0: bigint; amount1: bigint } {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  if (sqrtP <= sqrtA) {
    return { amount0: (L * Q96 * (sqrtB - sqrtA)) / sqrtB / sqrtA, amount1: 0n };
  }
  if (sqrtP >= sqrtB) {
    return { amount0: 0n, amount1: (L * (sqrtB - sqrtA)) / Q96 };
  }
  return {
    amount0: (L * Q96 * (sqrtB - sqrtP)) / sqrtB / sqrtP,
    amount1: (L * (sqrtP - sqrtA)) / Q96,
  };
}

/* ------------------------------------------------------------- swap quote */

/**
 * Exact-input swap quote against the live (sqrtP, L) — the LP fee comes off
 * the input, then the constant-product curve executes. Single-position pools
 * (ours are one full-range-ish program) never cross an initialized tick, so
 * this matches the chain to the wei absent concurrent trades.
 */
export function quoteExactIn(
  sqrtP: bigint,
  L: bigint,
  feePips: number,
  zeroForOne: boolean,
  amountIn: bigint,
): { amountOut: bigint; sqrtPAfter: bigint } {
  if (amountIn <= 0n || L <= 0n || sqrtP <= 0n) return { amountOut: 0n, sqrtPAfter: sqrtP };
  const inAfterFee = (amountIn * BigInt(1_000_000 - feePips)) / 1_000_000n;
  if (zeroForOne) {
    // sell currency0: 1/√P' = 1/√P + in/L → √P' = L·√P·Q96 / (L·Q96 + in·√P)
    const denom = L * Q96 + inAfterFee * sqrtP;
    const sqrtPAfter = (L * sqrtP * Q96) / denom;
    const amountOut = (L * (sqrtP - sqrtPAfter)) / Q96;
    return { amountOut, sqrtPAfter };
  }
  // sell currency1: √P' = √P + in·Q96/L
  const sqrtPAfter = sqrtP + (inAfterFee * Q96) / L;
  const amountOut = (L * Q96 * (sqrtPAfter - sqrtP)) / sqrtPAfter / sqrtP;
  return { amountOut, sqrtPAfter };
}

/* -------------------------------------------------- PoolManager state slots */

/** `_pools` mapping slot in the PoolManager (V4 core layout) */
const POOLS_SLOT = 6n;

/** storage slot of a pool's slot0 (extsload target) */
export function slot0Slot(poolId: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }],
      [poolId, POOLS_SLOT],
    ),
  );
}

/** storage slot of a pool's active liquidity: slot0 + 3 */
export function liquiditySlot(poolId: Hex): Hex {
  const base = BigInt(slot0Slot(poolId));
  return `0x${(base + 3n).toString(16).padStart(64, "0")}` as Hex;
}

/** unpack slot0: sqrtPriceX96 (160) | tick (int24) | protocolFee (24) | lpFee (24) */
export function unpackSlot0(word: Hex): { sqrtPriceX96: bigint; tick: number; lpFee: number } {
  const v = BigInt(word);
  const sqrtPriceX96 = v & ((1n << 160n) - 1n);
  let tick = Number((v >> 160n) & 0xffffffn);
  if (tick >= 0x800000) tick -= 0x1000000;
  const lpFee = Number((v >> 208n) & 0xffffffn);
  return { sqrtPriceX96, tick, lpFee };
}

/* ------------------------------------------------------------ price helpers */

/** human price of token1 in token0 units (or the reverse) from sqrtPriceX96 */
export function priceFromSqrt(
  sqrtPriceX96: bigint,
  dec0: number,
  dec1: number,
): { price1per0: number; price0per1: number } {
  // (√P/Q96)² = raw1/raw0 — scale by decimals for the human ratio
  const r = Number(sqrtPriceX96) / Number(Q96);
  const raw = r * r;
  const price1per0 = raw * 10 ** (dec0 - dec1); // token1 per 1 token0
  return { price1per0, price0per1: price1per0 > 0 ? 1 / price1per0 : 0 };
}

/** sqrtPriceX96 from a human "token1 per token0" price */
export function sqrtFromPrice(price1per0: number, dec0: number, dec1: number): bigint {
  const raw = price1per0 * 10 ** (dec1 - dec0);
  if (!(raw > 0)) return 0n;
  // √raw in float, then into Q96 — plenty for an INITIAL price choice
  return BigInt(Math.floor(Math.sqrt(raw) * 2 ** 48)) * 2n ** 48n;
}
