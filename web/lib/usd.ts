"use client";

import { useMemo } from "react";
import type { Net } from "./chains";
import { fnum } from "./format";
import { isNative, type PoolKey } from "./hook";
import { nativeCurrencyOf, useUsdPrice } from "./prices";
import { priceFromSqrt } from "./v4math";

/**
 * USD price per WHOLE token for each side of a pool, anchored on the network
 * currency (V4 sorts native first, so a native side is always currency0) and
 * translated through the pool's OWN live price. `null` when unpriceable —
 * pure-ERC20 pairs have no USD anchor without an external oracle.
 */
export function usePairUsd(
  net: Net,
  key: PoolKey | null | undefined,
  sqrtPriceX96: bigint | undefined,
  dec0: number,
  dec1: number,
): { u0: number | null; u1: number | null } {
  const px = useUsdPrice(nativeCurrencyOf(net).sym);
  return useMemo(() => {
    if (!px || !key || !isNative(key.currency0)) return { u0: null, u1: null };
    if (!sqrtPriceX96 || sqrtPriceX96 === 0n) return { u0: px, u1: null };
    const pr = priceFromSqrt(sqrtPriceX96, dec0, dec1);
    return { u0: px, u1: isFinite(pr.price0per1) && pr.price0per1 > 0 ? px * pr.price0per1 : null };
  }, [px, key, sqrtPriceX96, dec0, dec1]);
}

/** `≈ $1.2K` style, or null when the side has no USD anchor. */
export function usdStr(amount: number | null | undefined, unitUsd: number | null): string | null {
  if (amount == null || unitUsd == null || !isFinite(amount)) return null;
  return `$${fnum(amount * unitUsd)}`;
}
