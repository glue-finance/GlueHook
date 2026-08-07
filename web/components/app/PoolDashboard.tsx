"use client";

import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import type { Net } from "@/lib/chains";
import { ftoken, fnum } from "@/lib/format";
import type { Pot, Program } from "@/lib/hook";
import type { RegisteredPool } from "@/lib/registry";
import { useTokenMeta } from "@/lib/usePool";
import { positionAmounts, usePoolState, useBalanceOf } from "@/lib/usePoolState";
import { usePairUsd, usdStr } from "@/lib/usd";
import { priceFromSqrt } from "@/lib/v4math";
import { PairIcons, TokenIconFor } from "./TokenIcon";

const PINK = "#fe0087";
const BLUE = "#2b46e8";

const toNum = (v: bigint | undefined, dec: number): number | null =>
  v === undefined ? null : Number(formatUnits(v, dec));

/** token amount + optional USD shadow value on one right-aligned cell */
function Value({ v, dec, usd }: { v: bigint | undefined; dec: number; usd: string | null }) {
  return (
    <span className="text-right">
      <span className="v">{v === undefined ? "…" : ftoken(v, dec)}</span>
      {usd && <span className="mono ml-1.5 text-[10px] text-dim2">≈ {usd}</span>}
    </span>
  );
}

/* ----------------------------------------------- the LP program's position */

/** The program's position valued at the live price — lives in the LEFT column. */
export function ProgramPositionCard({
  net,
  pool,
  program,
}: {
  net: Net;
  pool: RegisteredPool;
  program: Program | undefined;
}) {
  const key = pool.key;
  const state = usePoolState(net, pool.poolId);
  const meta0 = useTokenMeta(net, key?.currency0);
  const meta1 = useTokenMeta(net, key?.currency1);
  const dec0 = meta0.data?.decimals ?? 18;
  const dec1 = meta1.data?.decimals ?? 18;
  const { u0, u1 } = usePairUsd(net, key, state.data?.sqrtPriceX96, dec0, dec1);

  if (!program?.exists) return null;
  const s = state.data;
  const posAmts = positionAmounts(s, program.liquidity, program.tickLower, program.tickUpper);
  const share = s && s.liquidity > 0n ? (Number(program.liquidity) / Number(s.liquidity)) * 100 : null;
  const a0 = toNum(posAmts.amount0, dec0);
  const a1 = toNum(posAmts.amount1, dec1);
  const totalUsd =
    u0 !== null && u1 !== null && a0 !== null && a1 !== null ? `$${fnum(a0 * u0 + a1 * u1)}` : null;

  return (
    <div className="panel p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="label text-magenta">LP program position</span>
        {totalUsd && <span className="pill hi">{totalUsd}</span>}
      </div>
      <div className="row">
        <span className="flex items-center gap-2 text-dim">
          <TokenIconFor net={net} address={key?.currency0} symbol={meta0.data?.symbol ?? "…"} size={18} />
          {meta0.data?.symbol ?? "…"}
        </span>
        <Value v={posAmts.amount0} dec={dec0} usd={usdStr(toNum(posAmts.amount0, dec0), u0)} />
      </div>
      <div className="row">
        <span className="flex items-center gap-2 text-dim">
          <TokenIconFor net={net} address={key?.currency1} symbol={meta1.data?.symbol ?? "…"} size={18} />
          {meta1.data?.symbol ?? "…"}
        </span>
        <Value v={posAmts.amount1} dec={dec1} usd={usdStr(toNum(posAmts.amount1, dec1), u1)} />
      </div>
      {share !== null && (
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="mono text-[10.5px] text-dim">share of pool</span>
            <span className="mono text-[11.5px] font-extrabold text-magenta">{share.toFixed(1)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-magenta/10">
            <div
              className="h-full rounded-full bg-magenta transition-all"
              style={{ width: `${Math.min(100, share)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------- the user wallet */

/** The connected wallet's two side balances with USD — lives in the LEFT column. */
export function WalletCard({ net, pool }: { net: Net; pool: RegisteredPool }) {
  const { address: me } = useAccount();
  const key = pool.key;
  const state = usePoolState(net, pool.poolId);
  const meta0 = useTokenMeta(net, key?.currency0);
  const meta1 = useTokenMeta(net, key?.currency1);
  const bal0 = useBalanceOf(net, key?.currency0, me);
  const bal1 = useBalanceOf(net, key?.currency1, me);
  const dec0 = meta0.data?.decimals ?? 18;
  const dec1 = meta1.data?.decimals ?? 18;
  const { u0, u1 } = usePairUsd(net, key, state.data?.sqrtPriceX96, dec0, dec1);

  if (!me) return null;
  const totalUsd =
    u0 !== null && u1 !== null && bal0.data !== undefined && bal1.data !== undefined
      ? `$${fnum((toNum(bal0.data, dec0) ?? 0) * u0 + (toNum(bal1.data, dec1) ?? 0) * u1)}`
      : null;

  return (
    <div className="panel p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="label">your wallet</span>
        {totalUsd && <span className="pill">{totalUsd}</span>}
      </div>
      <div className="row">
        <span className="flex items-center gap-2 text-dim">
          <TokenIconFor net={net} address={key?.currency0} symbol={meta0.data?.symbol ?? "…"} size={18} />
          {meta0.data?.symbol ?? "…"}
        </span>
        <Value v={bal0.data} dec={dec0} usd={usdStr(toNum(bal0.data, dec0), u0)} />
      </div>
      <div className="row">
        <span className="flex items-center gap-2 text-dim">
          <TokenIconFor net={net} address={key?.currency1} symbol={meta1.data?.symbol ?? "…"} size={18} />
          {meta1.data?.symbol ?? "…"}
        </span>
        <Value v={bal1.data} dec={dec1} usd={usdStr(toNum(bal1.data, dec1), u1)} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- dashboard */

/**
 * The pool, at a glance: the poolId printed BIG, the live reserves and price
 * out of the PoolManager's own storage, and the V4 constant-product curve with
 * the live point on it. The position and wallet cards live in the left column.
 */
export function PoolDashboard({
  net,
  pool,
  pot,
}: {
  net: Net;
  pool: RegisteredPool;
  pot: Pot | undefined;
}) {
  const key = pool.key;
  const state = usePoolState(net, pool.poolId);
  const meta0 = useTokenMeta(net, key?.currency0);
  const meta1 = useTokenMeta(net, key?.currency1);
  const [copied, setCopied] = useState(false);

  const dec0 = meta0.data?.decimals ?? 18;
  const dec1 = meta1.data?.decimals ?? 18;
  const sym0 = meta0.data?.symbol ?? "…";
  const sym1 = meta1.data?.symbol ?? "…";

  const s = state.data;
  const prices = s?.initialized ? priceFromSqrt(s.sqrtPriceX96, dec0, dec1) : null;
  const { u0, u1 } = usePairUsd(net, key, s?.sqrtPriceX96, dec0, dec1);
  const tvl =
    u0 !== null && u1 !== null && s
      ? `$${fnum((toNum(s.reserve0, dec0) ?? 0) * u0 + (toNum(s.reserve1, dec1) ?? 0) * u1)}`
      : null;

  return (
    <div className="panel p-5">
      {/* ---- the poolId, VERY BIG ---- */}
      <div className="mb-5 rounded-2xl border-2 border-magenta bg-magenta/5 p-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="label">pool id</span>
          <span className="mono flex items-center gap-2 text-[10.5px] text-dim2">
            {key && (
              <PairIcons net={net} a={key.currency0} b={key.currency1} symA={sym0} symB={sym1} size={18} />
            )}
            {sym0}/{sym1}{key ? ` · ${(key.fee / 10_000).toFixed(2)}%` : ""} · tick spacing {key?.tickSpacing ?? "—"}
          </span>
        </div>
        <button
          className="mono w-full break-all text-left text-[clamp(16px,2.4vw,26px)] font-extrabold leading-tight tracking-tight text-magenta"
          onClick={() => {
            navigator.clipboard?.writeText(pool.poolId);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          title="copy pool id"
        >
          {pool.poolId}
        </button>
        <div className="mono mt-1.5 text-[10.5px] text-dim2">
          {copied ? "copied ✓" : "tap to copy — this id is the pool's address inside the PoolManager singleton"}
        </div>
      </div>

      {/* ---- live state ---- */}
      <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--line)] bg-panel2 p-4">
            <div className="label mb-2.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="livedot" /> pool balances — live
              </span>
              {tvl && <span className="pill hi">TVL {tvl}</span>}
            </div>
            <div className="row">
              <span className="flex items-center gap-2 text-dim">
                <TokenIconFor net={net} address={key?.currency0} symbol={sym0} size={18} />
                {sym0}
              </span>
              <Value v={s?.reserve0} dec={dec0} usd={usdStr(toNum(s?.reserve0, dec0), u0)} />
            </div>
            <div className="row">
              <span className="flex items-center gap-2 text-dim">
                <TokenIconFor net={net} address={key?.currency1} symbol={sym1} size={18} />
                {sym1}
              </span>
              <Value v={s?.reserve1} dec={dec1} usd={usdStr(toNum(s?.reserve1, dec1), u1)} />
            </div>
            <div className="row"><span className="text-dim">active liquidity L</span><span className="v">{s ? fnum(Number(s.liquidity)) : "…"}</span></div>
            <div className="row"><span className="text-dim">tick</span><span className="v">{s?.tick ?? "…"}</span></div>
          </div>

          <div className="rounded-xl border border-[var(--line)] bg-panel2 p-4">
            <div className="label mb-2.5 text-blue">price — from the live sqrtPriceX96</div>
            <div className="row">
              <span className="flex items-center gap-2 text-dim">
                <TokenIconFor net={net} address={key?.currency0} symbol={sym0} size={18} />
                1 {sym0}
              </span>
              <span className="text-right">
                <span className="v">{prices ? fnum(prices.price1per0) : "—"} {sym1}</span>
                {u0 !== null && <span className="mono ml-1.5 text-[10px] text-dim2">≈ {usdStr(1, u0)}</span>}
              </span>
            </div>
            <div className="row">
              <span className="flex items-center gap-2 text-dim">
                <TokenIconFor net={net} address={key?.currency1} symbol={sym1} size={18} />
                1 {sym1}
              </span>
              <span className="text-right">
                <span className="v">{prices ? fnum(prices.price0per1) : "—"} {sym0}</span>
                {u1 !== null && <span className="mono ml-1.5 text-[10px] text-dim2">≈ {usdStr(1, u1)}</span>}
              </span>
            </div>
          </div>
        </div>

        {/* ---- the curve ---- */}
        <CurveView
          reserve0={s?.reserve0}
          reserve1={s?.reserve1}
          sym0={sym0}
          sym1={sym1}
          dec0={dec0}
          dec1={dec1}
          potMain={pot && key ? (pot.main === key.currency0 ? 0 : 1) : null}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- curve chart */

/**
 * The V4 curve exactly as Uniswap draws it: x·y = k through the LIVE point,
 * an area glow under it, the reserves marked with animated guides. Pure SVG.
 */
function CurveView({
  reserve0,
  reserve1,
  sym0,
  sym1,
  dec0,
  dec1,
  potMain,
}: {
  reserve0: bigint | undefined;
  reserve1: bigint | undefined;
  sym0: string;
  sym1: string;
  dec0: number;
  dec1: number;
  potMain: 0 | 1 | null;
}) {
  const W = 420;
  const H = 380;
  const PAD = 48;

  const pts = useMemo(() => {
    if (!reserve0 || !reserve1 || reserve0 <= 0n || reserve1 <= 0n) return null;
    const x0 = Number(formatUnits(reserve0, dec0));
    const y0 = Number(formatUnits(reserve1, dec1));
    if (!(x0 > 0) || !(y0 > 0)) return null;
    const k = x0 * y0;
    // window: the live point in the middle of a 0.25×..4× span
    const xMin = x0 * 0.25;
    const xMax = x0 * 4;
    const yMax = k / xMin;
    const yMin = k / xMax;
    const X = (x: number) => PAD + ((Math.log(x) - Math.log(xMin)) / (Math.log(xMax) - Math.log(xMin))) * (W - PAD - 16);
    const Y = (y: number) => H - PAD - ((Math.log(y) - Math.log(yMin)) / (Math.log(yMax) - Math.log(yMin))) * (H - PAD - 16);
    const curve: string[] = [];
    const N = 90;
    for (let i = 0; i <= N; i++) {
      const x = Math.exp(Math.log(xMin) + (i / N) * (Math.log(xMax) - Math.log(xMin)));
      const y = k / x;
      curve.push(`${i === 0 ? "M" : "L"}${X(x).toFixed(1)},${Y(y).toFixed(1)}`);
    }
    const d = curve.join(" ");
    // area between the curve and the bottom-left corner (under the hyperbola)
    const area = `${d} L${(W - 16).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;
    // ghost points at 0.5× and 2× of the reserve, to hint the price ladder
    const ghosts = [0.5, 2].map((m) => ({ cx: X(x0 * m), cy: Y(k / (x0 * m)) }));
    return { d, area, cx: X(x0), cy: Y(y0), x0, y0, ghosts };
  }, [reserve0, reserve1, dec0, dec1]);

  return (
    <div className="rounded-xl border border-[var(--line)] bg-gradient-to-b from-white to-[rgba(254,0,135,0.03)] p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="label">the curve — x·y = k, live</span>
        <span className="mono text-[10px] text-dim2">log-log window ×0.25 … ×4</span>
      </div>
      {!pts ? (
        <div className="mono grid h-[340px] place-items-center text-[12px] text-dim2">
          {reserve0 === undefined ? "reading pool state…" : "no liquidity yet"}
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          <defs>
            <linearGradient id="curveArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PINK} stopOpacity="0.16" />
              <stop offset="100%" stopColor={BLUE} stopOpacity="0.03" />
            </linearGradient>
            <radialGradient id="pointGlow">
              <stop offset="0%" stopColor={PINK} stopOpacity="0.5" />
              <stop offset="100%" stopColor={PINK} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* soft grid */}
          {[0.25, 0.5, 0.75].map((f) => (
            <g key={f}>
              <line x1={PAD} x2={W - 16} y1={16 + f * (H - PAD - 16)} y2={16 + f * (H - PAD - 16)} stroke="rgba(28,36,71,.05)" />
              <line y1={16} y2={H - PAD} x1={PAD + f * (W - PAD - 16)} x2={PAD + f * (W - PAD - 16)} stroke="rgba(28,36,71,.05)" />
            </g>
          ))}

          {/* axes */}
          <line x1={PAD} y1={H - PAD} x2={W - 8} y2={H - PAD} stroke="var(--line2)" strokeWidth="1" />
          <line x1={PAD} y1={H - PAD} x2={PAD} y2={8} stroke="var(--line2)" strokeWidth="1" />
          <text x={W - 10} y={H - PAD + 16} textAnchor="end" className="mono" fontSize="10" fill="#8b93a8">
            {sym0} reserve →
          </text>
          <text x={PAD - 6} y={14} textAnchor="start" className="mono" fontSize="10" fill="#8b93a8">
            ↑ {sym1} reserve
          </text>

          {/* area under the curve, then a glow pass, then the curve itself */}
          <path d={pts.area} fill="url(#curveArea)" />
          <path d={pts.d} fill="none" stroke={PINK} strokeWidth="8" opacity="0.12" strokeLinecap="round" />
          <path d={pts.d} fill="none" stroke={PINK} strokeWidth="2.8" strokeLinecap="round" />

          {/* ghost markers at 0.5× / 2× reserve */}
          {pts.ghosts.map((g, i) => (
            <circle key={i} cx={g.cx} cy={g.cy} r="3.5" fill="#fff" stroke={BLUE} strokeWidth="1.5" opacity="0.55" />
          ))}

          {/* guides to the live point */}
          <line x1={pts.cx} y1={H - PAD} x2={pts.cx} y2={pts.cy} stroke={BLUE} strokeWidth="1" strokeDasharray="3 4" />
          <line x1={PAD} y1={pts.cy} x2={pts.cx} y2={pts.cy} stroke={BLUE} strokeWidth="1" strokeDasharray="3 4" />

          {/* live point with a breathing glow */}
          <circle cx={pts.cx} cy={pts.cy} r="22" fill="url(#pointGlow)">
            <animate attributeName="r" values="16;26;16" dur="2.6s" repeatCount="indefinite" />
          </circle>
          <circle cx={pts.cx} cy={pts.cy} r="7" fill={PINK} stroke="#fff" strokeWidth="2.5" />

          {/* reserve chips on the axes */}
          <g>
            <rect x={pts.cx - 34} y={H - PAD + 6} width="68" height="17" rx="8.5" fill="#fff" stroke={BLUE} strokeOpacity="0.35" />
            <text x={pts.cx} y={H - PAD + 18} textAnchor="middle" className="mono" fontSize="10" fontWeight="700" fill="#1c2447">
              {fnum(pts.x0)}
            </text>
          </g>
          <g>
            <rect x={2} y={pts.cy - 9} width="44" height="17" rx="8.5" fill="#fff" stroke={BLUE} strokeOpacity="0.35" />
            <text x={24} y={pts.cy + 3.5} textAnchor="middle" className="mono" fontSize="10" fontWeight="700" fill="#1c2447">
              {fnum(pts.y0)}
            </text>
          </g>

          {/* which side the pot defends */}
          {potMain !== null && (
            <text x={W - 10} y={28} textAnchor="end" className="mono" fontSize="10" fill={PINK} fontWeight="700">
              🛡 pot defends {potMain === 0 ? sym0 : sym1}
            </text>
          )}
        </svg>
      )}
    </div>
  );
}
