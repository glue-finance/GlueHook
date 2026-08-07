"use client";

import { useMemo, useState } from "react";
import { DEXSCREENER_CHAIN, type Net } from "@/lib/chains";
import { useIsMobile } from "@/lib/useIsMobile";

/**
 * DexScreener embed — chart + live transactions for a Uniswap V4 pool.
 * Pure iframe, no API calls: V4 pools are addressed by their 32-byte poolId,
 * so the embed URL is simply /{chain}/{poolId}. Only rendered on networks
 * DexScreener indexes (DEXSCREENER_CHAIN) — everywhere else it's a no-op.
 *
 * The sandbox deliberately OMITS allow-top-navigation: with it granted the
 * embed can navigate the whole app away.
 *
 * On phones the chart is loaded ON TAP instead of automatically. The embed is
 * a full charting runtime with its own websocket, and mounting it next to the
 * app's own state was enough to push mobile Safari over its per-tab memory
 * ceiling — at which point the browser discards the page and reloads it from
 * scratch, which reads as "the page refreshes when the chart loads". Deferring
 * it keeps the decision (and the memory) with the user. Desktop is unaffected.
 */
export function DexScreenerEmbed({ net, poolId }: { net: Net; poolId: string }) {
  const chain = DEXSCREENER_CHAIN[net.slug];
  const isMobile = useIsMobile();
  const [armed, setArmed] = useState(false);

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

  // null = breakpoint not read yet; hold off rather than mount the heavy
  // desktop iframe on a phone just to unmount it on the next tick
  const show = isMobile === false || armed;

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
      {show ? (
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
      ) : (
        <div className="flex h-[240px] flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="mono text-[11px] leading-relaxed text-dim2">
            price chart & trades, straight from DexScreener
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={isMobile === null}
            onClick={() => setArmed(true)}
          >
            load chart
          </button>
          <div className="mono text-[10px] text-dim2">it&apos;s a heavy embed — loads on tap</div>
        </div>
      )}
    </div>
  );
}
