"use client";

import { useId, useMemo, useState } from "react";
import { fnum } from "@/lib/format";

export type BarGroup = { label: string; a: number; b: number };

/**
 * Grouped comparison bar chart: two big side-by-side columns per group
 * (e.g. per month), with gridlines, a zero axis and a hover readout —
 * built to compare "with the hook" vs "without" at a glance.
 */
export function GroupBars({
  groups,
  aColor,
  bColor,
  aLabel,
  bLabel,
  height = 205,
  yFormat = fnum,
  hoverFormat,
  empty = "no data yet",
}: {
  groups: BarGroup[];
  aColor: string;
  bColor: string;
  aLabel: string;
  bLabel: string;
  height?: number;
  yFormat?: (v: number) => string;
  /** optional richer formatter for the hover readout (e.g. USD + native) */
  hoverFormat?: (v: number) => string;
  empty?: string;
}) {
  const W = 640;
  const H = height;
  const PAD = { l: 54, r: 10, t: 14, b: 24 };
  const gid = useId().replace(/[:]/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const { vMax, slotW, sy, hasData } = useMemo(() => {
    if (!groups.length) {
      return { vMax: 1, slotW: 10, sy: (v: number) => v, hasData: false };
    }
    const rawMax = Math.max(...groups.map((g) => Math.max(g.a, g.b)), 1e-9);
    const vMax = rawMax * 1.08;
    const slotW = (W - PAD.l - PAD.r) / groups.length;
    const sy = (v: number) => H - PAD.b - (v / vMax) * (H - PAD.t - PAD.b);
    return { vMax, slotW, sy, hasData: true };
  }, [groups, H]);

  if (!hasData || groups.every((g) => g.a <= 0 && g.b <= 0)) {
    return (
      <div className="mono flex items-center justify-center text-[12px] text-dim2" style={{ height }}>
        {empty}
      </div>
    );
  }

  const hf = hoverFormat ?? yFormat;
  const hovered = hover !== null ? groups[hover] : null;
  const bw = Math.min(26, slotW * 0.32); // one column width
  const gap = Math.min(5, bw * 0.25);
  const y0 = sy(0);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.min(groups.length - 1, Math.max(0, Math.floor((px - PAD.l) / slotW)));
    setHover(i);
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`${gid}-a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={aColor} stopOpacity="1" />
            <stop offset="100%" stopColor={aColor} stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id={`${gid}-b`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={bColor} stopOpacity="0.7" />
            <stop offset="100%" stopColor={bColor} stopOpacity="0.35" />
          </linearGradient>
        </defs>
        {/* gridlines */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={sy(vMax * f)}
            y2={sy(vMax * f)}
            stroke="rgba(28,36,71,.08)"
          />
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y0} y2={y0} stroke="rgba(28,36,71,.25)" strokeWidth={1.5} />

        {groups.map((g, i) => {
          const cx = PAD.l + slotW * (i + 0.5);
          const yA = sy(g.a);
          const yB = sy(g.b);
          const active = hover === null || hover === i;
          return (
            <g key={i} opacity={active ? 1 : 0.35}>
              {/* with the hook */}
              <rect
                x={cx - bw - gap / 2}
                y={yA}
                width={bw}
                height={Math.max(1.5, y0 - yA)}
                rx={3}
                fill={`url(#${gid}-a)`}
                stroke="rgba(28,36,71,.35)"
                strokeWidth={1}
              />
              {/* without */}
              <rect
                x={cx + gap / 2}
                y={yB}
                width={bw}
                height={Math.max(1.5, y0 - yB)}
                rx={3}
                fill={`url(#${gid}-b)`}
                stroke="rgba(28,36,71,.3)"
                strokeWidth={1}
              />
              <text x={cx} y={H - 7} fill="#8b93a8" fontSize={10} fontFamily="monospace" textAnchor="middle">
                {g.label}
              </text>
            </g>
          );
        })}

        {/* y labels — in the left gutter, halo-outlined */}
        {[1, 0.5, 0].map((f) => (
          <text
            key={f}
            x={PAD.l - 8}
            y={sy(vMax * f) + (f === 0 ? 3 : 4)}
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
            {yFormat(vMax * f)}
          </text>
        ))}
      </svg>

      {hovered && (
        <div className="mono pointer-events-none absolute left-2 top-1 rounded-lg border border-[var(--line2)] bg-bg/95 px-3 py-1.5 text-[11px] text-txt shadow-sm">
          <span className="text-dim2">{hovered.label}</span>
          <span className="ml-2 font-bold" style={{ color: aColor }}>
            {aLabel} {hf(hovered.a)}
          </span>
          <span className="ml-2 font-bold" style={{ color: bColor }}>
            {bLabel} {hf(hovered.b)}
          </span>
        </div>
      )}
    </div>
  );
}
