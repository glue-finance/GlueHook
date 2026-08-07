"use client";

import { useId, useMemo, useState } from "react";
import type { SeriesPoint } from "@/lib/derive";
import { fnum } from "@/lib/format";

export type ChartSeries = {
  points: SeriesPoint[];
  color: string;
  dashed?: boolean;
  fill?: boolean;
  label?: string;
};

/**
 * Hand-rolled SVG line chart: multi-series, gradient area fills, dashed
 * comparison lines, hover crosshair, last-value chip. No chart library.
 */
export function LineChart({
  series,
  height = 190,
  yFormat = fnum,
  empty = "no data yet",
  unit,
  hoverExtra,
}: {
  series: ChartSeries[];
  height?: number;
  yFormat?: (v: number) => string;
  empty?: string;
  /** currency/token suffix appended to axis + value labels */
  unit?: string;
  /** extra hover line (e.g. that day's volume), computed from the hovered t */
  hoverExtra?: (t: number) => string;
}) {
  const W = 640;
  const H = height;
  // the left gutter must fit the widest label fnum can emit ("1.32×10²⁰")
  const PAD = { l: 74, r: 10, t: 12, b: 16 };
  const gid = useId().replace(/[:]/g, "");
  const [hover, setHover] = useState<{
    x: number;
    t: number;
    vals: { color: string; v: number; y: number; label?: string; dashed?: boolean }[];
  } | null>(null);

  const { paths, scaleX, scaleY, tMin, tMax, vMax, hasData } = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (all.length < 2) {
      return { paths: [], scaleX: (t: number) => t, scaleY: (v: number) => v, tMin: 0, tMax: 1, vMax: 1, hasData: false };
    }
    const tMin = Math.min(...all.map((p) => p.t));
    const tMax = Math.max(...all.map((p) => p.t));
    const vMaxRaw = Math.max(...all.map((p) => p.v));
    const vMax = vMaxRaw <= 0 ? 1 : vMaxRaw * 1.1;
    const sx = (t: number) =>
      PAD.l + ((t - tMin) / Math.max(1e-9, tMax - tMin)) * (W - PAD.l - PAD.r);
    const sy = (v: number) => H - PAD.b - (v / vMax) * (H - PAD.t - PAD.b);

    const paths = series.map((s) => {
      if (s.points.length < 2) return { d: "", area: "", s };
      // simple polyline — daily-resolution data reads smooth and truthful
      let d = `M${sx(s.points[0].t).toFixed(1)},${sy(s.points[0].v).toFixed(1)}`;
      for (let i = 1; i < s.points.length; i++) {
        const p = s.points[i];
        d += ` L${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`;
      }
      const area = s.fill
        ? `${d} L${sx(s.points[s.points.length - 1].t).toFixed(1)},${H - PAD.b} L${sx(s.points[0].t).toFixed(1)},${H - PAD.b} Z`
        : "";
      return { d, area, s };
    });
    return { paths, scaleX: sx, scaleY: sy, tMin, tMax, vMax, hasData: true };
  }, [series, H]);

  if (!hasData) {
    return (
      <div
        className="mono flex items-center justify-center text-[12px] text-dim2"
        style={{ height }}
      >
        {empty}
      </div>
    );
  }

  const primary = series.find((s) => !s.dashed) ?? series[0];
  const lastV = primary.points.length ? primary.points[primary.points.length - 1].v : 0;
  const u = unit ? ` ${unit}` : "";

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = tMin + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (tMax - tMin);
    // snap to the primary series' time grid, then read EVERY series there
    const pts = primary.points;
    let best = pts[0];
    for (const p of pts) if (p.t <= t) best = p;
    const vals = series
      .filter((s) => s.points.length)
      .map((s) => {
        let bp = s.points[0];
        for (const p of s.points) if (p.t <= best.t) bp = p;
        return { color: s.color, v: bp.v, y: scaleY(bp.v), label: s.label, dashed: s.dashed };
      });
    setHover({ x: scaleX(Math.max(best.t, tMin)), t: best.t, vals });
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {paths.map(({ s }, i) =>
            s.fill ? (
              <linearGradient key={i} id={`${gid}-g${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.35" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
              </linearGradient>
            ) : null,
          )}
        </defs>
        {/* gridlines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={PAD.t + f * (H - PAD.t - PAD.b)}
            y2={PAD.t + f * (H - PAD.t - PAD.b)}
            stroke="rgba(28,36,71,.07)"
            strokeDasharray="2 5"
          />
        ))}
        {/* baseline axis */}
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={H - PAD.b}
          y2={H - PAD.b}
          stroke="rgba(28,36,71,.16)"
        />
        {paths.map(({ d, area, s }, i) =>
          d ? (
            <g key={i}>
              {area && <path d={area} fill={`url(#${gid}-g${i})`} />}
              {/* soft glow under solid lines */}
              {!s.dashed && (
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={9}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={0.14}
                />
              )}
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={s.dashed ? 2.2 : 3.4}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? "1 8" : undefined}
                opacity={s.dashed ? 0.9 : 1}
              />
            </g>
          ) : null,
        )}
        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={PAD.t} y2={H - PAD.b} stroke="rgba(28,36,71,.3)" strokeDasharray="3 4" />
            {hover.vals.map((h, i) => (
              <circle key={i} cx={hover.x} cy={h.y} r={5} fill="#fff" stroke={h.color} strokeWidth={2.5} />
            ))}
          </g>
        )}
        {/* y axis labels — in the left gutter, halo-outlined */}
        {[
          { v: vMax, y: PAD.t + 4 },
          { v: vMax / 2, y: PAD.t + 0.5 * (H - PAD.t - PAD.b) + 4 },
          { v: 0, y: H - PAD.b + 3 },
        ].map((l, i) => (
          <text
            key={i}
            x={PAD.l - 8}
            y={l.y}
            fill="#5c6580"
            fontSize={10}
            fontWeight={700}
            fontFamily="monospace"
            textAnchor="end"
            stroke="#fff"
            strokeWidth={3}
            paintOrder="stroke"
            strokeLinejoin="round"
          >
            {yFormat(l.v)}
            {u}
          </text>
        ))}
      </svg>
      {/* last value chip pinned to the primary series' end */}
      {!hover && (
        <div
          className="mono pointer-events-none absolute right-2 rounded-full border-2 px-2.5 py-1 text-[11px] font-bold"
          style={{
            top: `${(scaleY(lastV) / H) * 100}%`,
            transform: "translateY(-50%)",
            color: primary.color,
            borderColor: primary.color,
            background: "#fff",
          }}
        >
          {yFormat(lastV)}
          {u}
        </div>
      )}
      {hover && (
        <div className="mono pointer-events-none absolute left-2 top-2 space-y-0.5 rounded-lg border border-[var(--line2)] bg-bg/90 px-3 py-1.5 text-[11px] text-txt">
          <div className="text-dim2">
            {hover.t > 1e9 ? new Date(hover.t * 1000).toLocaleString() : hover.t < 10_000 ? `day ${hover.t}` : `block ${hover.t}`}
          </div>
          {hover.vals.map((h, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <i className="inline-block h-[3px] w-3 rounded" style={{ background: h.color, opacity: h.dashed ? 0.6 : 1 }} />
              <span className="font-bold" style={{ color: h.color }}>
                {yFormat(h.v)}
                {u}
              </span>
            </div>
          ))}
          {hoverExtra && <div className="pt-0.5 text-dim">{hoverExtra(hover.t)}</div>}
        </div>
      )}
      {series.some((s) => s.label) && (
        <div className="mt-1 flex flex-wrap gap-3 px-1">
          {series
            .filter((s) => s.label)
            .map((s) => (
              <span key={s.label} className="mono flex items-center gap-1.5 text-[10.5px] text-dim">
                <i
                  className="inline-block h-[3px] w-4 rounded"
                  style={{ background: s.color, opacity: s.dashed ? 0.6 : 1 }}
                />
                {s.label}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
