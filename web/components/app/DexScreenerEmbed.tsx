"use client";

import { useMemo } from "react";
import { DEXSCREENER_CHAIN, type Net } from "@/lib/chains";

/**
 * DexScreener embed — chart + live transactions for a Uniswap V4 pool.
 * Pure iframe, no API calls: V4 pools are addressed by their 32-byte poolId,
 * so the embed URL is simply /{chain}/{poolId}. Only rendered on networks
 * DexScreener indexes (DEXSCREENER_CHAIN) — everywhere else it's a no-op.
 *
 * The sandbox deliberately OMITS allow-top-navigation: with it granted the
 * embed can (and on mobile does) navigate the whole app away, which shows up
 * as the page "refreshing" while the chart loads. Everything the chart needs
 * stays granted.
 */
export function DexScreenerEmbed({ net, poolId }: { net: Net; poolId: string }) {
  const chain = DEXSCREENER_CHAIN[net.slug];

  const src = useMemo(() => {
    if (!chain) return null;
    const params = new URLSearchParams({
      embed: "1",
      theme: "light",
      chartTheme: "light",
      trades: "1",
      info: "0",
      loadChartSettings: "0",
      chartLeftToolbar: "0",
      chartType: "usd",
    });
    return `https://dexscreener.com/${chain}/${poolId}?${params.toString()}`;
  }, [chain, poolId]);

  if (!chain || !src) return null;

  return (
    <div className="panel overflow-hidden">
      <div className="chead">
        <span>market view</span>
        <a
          href={`https://dexscreener.com/${chain}/${poolId}`}
          target="_blank"
          rel="noreferrer"
          className="mono text-[10px] text-dim2 hover:underline"
        >
          dexscreener ↗
        </a>
      </div>
      <iframe
        key={src}
        src={src}
        title="DexScreener chart & trades"
        loading="lazy"
        allow="clipboard-write"
        // no allow-top-navigation: a sandboxed embed can never reload the app
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
        className="block h-[560px] w-full border-0 lg:h-[680px]"
      />
    </div>
  );
}
