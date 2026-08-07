"use client";

import { useMemo } from "react";
import { liquiditySeries, projectLiquidity } from "@/lib/derive";
import type { PoolEvent } from "@/lib/events";
import { fnum } from "@/lib/format";
import { LineChart } from "./LineChart";

export function LiquidityChart({ events, loading }: { events: PoolEvent[]; loading: boolean }) {
  const { live, proj, compounds } = useMemo(() => {
    const live = liquiditySeries(events);
    const proj = projectLiquidity(live);
    const compounds = events.filter((e) => e.kind === "Compounded").length;
    return { live, proj, compounds };
  }, [events]);

  return (
    <div className="panel">
      <div className="chead">
        <span>program liquidity</span>
        <span className="flex items-center gap-2">
          {compounds > 0 && <span className="pill hi">{compounds} compounds</span>}
          {loading ? <span className="pill">scanning…</span> : <span className="livedot" />}
        </span>
      </div>
      <div className="p-4">
        <LineChart
          series={[
            { points: live, color: "#17b512", fill: true, label: "liquidity (pool units)" },
            // the projection only exists once ≥6h of real history backs the trend
            ...(proj.length
              ? [{ points: proj, color: "#7ab800", dashed: true, label: "projection (recent compound trend)" }]
              : []),
          ]}
          yFormat={fnum}
          empty={loading ? "scanning events…" : "no LP program events on this pool yet"}
        />
      </div>
    </div>
  );
}
