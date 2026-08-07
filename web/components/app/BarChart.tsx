"use client";

import { useId, useMemo, useState } from "react";
import { fnum } from "@/lib/format";

export type Bucket = { t: number; a: number; b: number };

/**
 * Weekly stacked bar chart, two series (a on the bottom, b stacked on top),
 * with week ticks, y labels and a hover readout.
 */
export function BarChart({
  buckets,
  aColor,
  bColor,
  aLabel,
  bLabel,
  height = 170,
  yFormat = fnum,
  unit,
  xLabel,
  empty = "no data yet",
}: {
  buckets: Bucket[];
  aColor: string;
  bColor: string;
  aLabel: string;
  bLabel: string;
  height?: number;
  yFormat?: (v: number) => string;
  unit?: string;
  /** custom x tick label; defaults to weekly ("w8", "w16", …) */
  xLabel?: (i: number) => string;
  empty?: string;
}) {
  const W = 640;
  const H = height;
  const PAD = { l: 54, r: 10, t: 12, b: 20 };
  const gid = useId().replace(/[:]/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const { vMax, sx, sy, bw, hasData } = useMemo(() => {
    if (buckets.length < 1) {
      return { vMax: 1, sx: (i: number) => i, sy: (v: number) => v, bw: 4, hasData: false };
    }
    const rawMax = Math.max(...buckets.map((k) => k.a + k.b), 1e-9);
    const vMax = rawMax * 1.1;
    const slotW = (W - PAD.l - PAD.r) / buckets.length;
    const sx = (i: number) => PAD.l + slotW * (i + 0.5);
    const sy = (v: number) => H - PAD.b - (v / vMax) * (H - PAD.t - PAD.b);
    return { vMax, sx, sy, bw: Math.max(3, slotW * 0.72), hasData: true };
  }, [buckets, H]);

  if (!hasData || buckets.every((k) => k.a + k.b <= 0)) {
    return (
      <div className="mono flex items-center justify-center text-[12px] text-dim2" style={{ height }}>
        {empty}
      </div>
    );
  }

  const u = unit ? ` ${unit}` : "";
  const hovered = hover !== null ? buckets[hover] : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const slotW = (W - PAD.l - PAD.r) / buckets.length;
    const i = Math.min(buckets.length - 1, Math.max(0, Math.floor((px - PAD.l) / slotW)));
    setHover(i);
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`${gid}-a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={aColor} stopOpacity="1" />
            <stop offset="100%" stopColor={aColor} stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id={`${gid}-b`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={bColor} stopOpacity="0.95" />
            <stop offset="100%" stopColor={bColor} stopOpacity="0.5" />
          </linearGradient>
        </defs>
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
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="rgba(28,36,71,.16)" />

        {buckets.map((k, i) => {
          const x = sx(i);
          const y0 = sy(0);
          const yA = sy(k.a);
          const yAB = sy(k.a + k.b);
          return (
            <g key={i} opacity={hover === null || hover === i ? 1 : 0.4}>
              {k.a > 0 && (
                <rect x={x - bw / 2} y={yA} width={bw} height={Math.max(1, y0 - yA)} rx={2} fill={`url(#${gid}-a)`} />
              )}
              {k.b > 0 && (
                <rect x={x - bw / 2} y={yAB} width={bw} height={Math.max(1, yA - yAB)} rx={2} fill={`url(#${gid}-b)`} />
              )}
            </g>
          );
        })}

        {buckets.map((_, i) => {
          // few buckets (e.g. monthly): label every one; many: every 8th
          const show = buckets.length <= 14 || (i + 1) % 8 === 0;
          return show ? (
            <text key={i} x={sx(i)} y={H - 6} fill="#8b93a8" fontSize={9.5} fontFamily="monospace" textAnchor="middle">
              {xLabel ? xLabel(i) : `w${i + 1}`}
            </text>
          ) : null;
        })}

        {/* y labels — in the left gutter, halo-outlined */}
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
      {hovered && (
        <div className="mono pointer-events-none absolute left-2 top-2 rounded-lg border border-[var(--line2)] bg-bg/95 px-3 py-1.5 text-[11px] text-txt">
          <span className="text-dim2">{xLabel ? xLabel(hover!) : `week ${hover! + 1}`}</span>
          <span className="ml-2" style={{ color: aColor }}>
            {aLabel} {yFormat(hovered.a)}
            {u}
          </span>
          {bLabel && (
            <span className="ml-2" style={{ color: bColor }}>
              {bLabel} {yFormat(hovered.b)}
              {u}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
