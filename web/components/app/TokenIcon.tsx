"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import type { Net } from "@/lib/chains";
import { useTokenLogos } from "@/lib/tokenlists";

/** Deterministic fallback colour from a symbol. */
function hue(sym: string): number {
  let h = 0;
  for (const c of sym) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/**
 * A token logo that walks a list of candidate sources on load errors
 * (token list → TrustWallet → DexScreener CDN) before falling back to a
 * letter circle. `src` stays supported for single-source callers.
 */
export function TokenIcon({
  src,
  srcs,
  symbol,
  size = 24,
}: {
  src?: string;
  srcs?: string[];
  symbol: string;
  size?: number;
}) {
  const list = srcs ?? (src ? [src] : []);
  const [i, setI] = useState(0);
  const identity = list.join("|");
  // new candidate set (token switched, list loaded late) → restart the walk
  useEffect(() => setI(0), [identity]);
  const s = { width: size, height: size };
  if (i < list.length) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote token-list logos, arbitrary hosts
      <img
        key={list[i]}
        src={list[i]}
        alt={symbol}
        style={s}
        className="flex-shrink-0 rounded-full bg-white object-cover shadow-[0_0_0_1.5px_var(--line)]"
        onError={() => setI((v) => v + 1)}
        loading="lazy"
      />
    );
  }
  return (
    <span
      style={{
        ...s,
        fontSize: size * 0.44,
        background: `hsl(${hue(symbol)} 70% 88%)`,
        color: `hsl(${hue(symbol)} 75% 32%)`,
      }}
      className="grid flex-shrink-0 place-items-center rounded-full font-extrabold shadow-[0_0_0_1.5px_var(--line)]"
    >
      {(symbol || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Same, resolving every candidate source for an address on this chain. */
export function TokenIconFor({
  net,
  address,
  symbol,
  size = 24,
}: {
  net: Net;
  address: Address | null | undefined;
  symbol: string;
  size?: number;
}) {
  const logos = useTokenLogos(net, address);
  return <TokenIcon srcs={logos} symbol={symbol} size={size} />;
}

/** The classic overlapping pair badge. */
export function PairIcons({
  net,
  a,
  b,
  symA,
  symB,
  size = 24,
}: {
  net: Net;
  a: Address | null | undefined;
  b: Address | null | undefined;
  symA: string;
  symB: string;
  size?: number;
}) {
  return (
    <span className="flex flex-shrink-0 items-center">
      <TokenIconFor net={net} address={a} symbol={symA} size={size} />
      <span style={{ marginLeft: -size * 0.32 }} className="relative">
        <TokenIconFor net={net} address={b} symbol={symB} size={size} />
      </span>
    </span>
  );
}
