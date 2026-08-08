"use client";

import { useMemo } from "react";
import { liquiditySeries, projectLiquidity } from "@/lib/derive";
import type { PoolEvent } from "@/lib/events";
import { fnum } from "@/lib/format";
import { LineChart } from "./LineChart";
import { ScanBar } from "./ScanBar";

export function LiquidityChart({
  events,
  loading,
  progress = null,
}: {
  events: PoolEvent[];
  loading: boolean;
  progress?: number | null;
}) {
  const { live, proj, compounds, raw, pct } = useMemo(() => {
    // drop the leading zero-liquidity points (ProgramCreated fires before the
    // first add) so "growth since launch" is measured from the first real add
    let raw = liquiditySeries(events);
    const start = raw.findIndex((p) => p.v > 0);
    raw = start > 0 ? raw.slice(start) : raw;
    const projRaw = projectLiquidity(raw);
    // raw pool-liquidity units (2.33x10^22) mean nothing to a human — chart
    // the position's GROWTH since launch instead, and let the tooltip carry
    // the absolute units
    const v0 = raw.length > 0 && raw[0].v > 0 ? raw[0].v : 0;
    const toPct = (p: { t: number; v: number }) => ({ t: p.t, v: v0 > 0 ? ((p.v - v0) / v0) * 100 : p.v });
    const live = v0 > 0 ? raw.map(toPct) : raw;
    const proj = v0 > 0 ? projRaw.map(toPct) : projRaw;
    const compounds = events.filter((e) => e.kind === "Compounded").length;
    return { live, proj, compounds, raw, pct: v0 > 0 };
  }, [events]);

  const yFmt = (v: number) => (pct ? `${v >= 0 ? "+" : "−"}${fnum(Math.abs(v))}%` : fnum(v));
  const unitsAt = (t: number): string => {
    let last = raw[0];
    for (const p of raw) if (p.t <= t) last = p;
    return last ? `${fnum(last.v)} pool units` : "";
  };

  return (
    <div className="panel">
      <div className="chead">
        <span>program liquidity</span>
        <span className="flex items-center gap-2">
          {compounds > 0 && <span className="pill hi">{compounds} compounds</span>}
          {loading ? <span className="pill">scanning…</span> : <span className="livedot" />}
        </span>
      </div>
      {loading && (
        <div className="px-4 pt-3">
          <ScanBar progress={progress} thin />
        </div>
      )}
      <div className="p-4">
        <LineChart
          series={[
            { points: live, color: "#17b512", fill: true, label: pct ? "position growth since launch" : "liquidity (pool units)" },
            // the projection only exists once ≥6h of real history backs the trend
            ...(proj.length
              ? [{ points: proj, color: "#7ab800", dashed: true, label: "projection (recent compound trend)" }]
              : []),
          ]}
          yFormat={yFmt}
          hoverExtra={pct ? unitsAt : undefined}
          empty={loading ? "scanning events…" : "no LP program events on this pool yet"}
        />
      </div>
    </div>
  );
}
