"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { Net } from "@/lib/chains";
import { fnum } from "@/lib/format";
import { nativeCurrencyOf, useUsdPrice } from "@/lib/prices";
import { runSim, targetMult, type Scenario, type SimConfig } from "@/lib/sim/engine";
import { BarChart, type Bucket } from "./BarChart";
import { LineChart } from "./LineChart";

/* fixed simulation window: 12 months */
const SIM_DAYS = 364;
const MONTHS = 12;

/** monthly spend from a cumulative daily series */
function monthlySpend(cum: number[]): number[] {
  const out: number[] = [];
  let prev = 0;
  for (let m = 0; m < MONTHS; m++) {
    const idx = Math.min(cum.length - 1, Math.round(((m + 1) * SIM_DAYS) / MONTHS) - 1);
    out.push(cum[idx] - prev);
    prev = cum[idx];
  }
  return out;
}

const currencyOf = nativeCurrencyOf;

/* ------------------------------------------------------- primitives */

/** classic add-liquidity amount box: big number input + token badge */
function AmountBox({
  value,
  onChange,
  sym,
  icon,
  desc,
}: {
  value: number;
  onChange: (v: number) => void;
  sym: string;
  icon?: string;
  desc?: string;
}) {
  return (
    <div className="rounded-xl border-2 border-[var(--line)] bg-white p-3 transition-colors focus-within:border-magenta">
      <div className="flex items-center gap-3">
        <input
          className="mono w-full bg-transparent text-[22px] font-extrabold text-txt outline-none placeholder:text-dim2"
          type="number"
          min={0}
          value={value || ""}
          placeholder="0"
          onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        />
        <span className="mono flex flex-shrink-0 items-center gap-2 rounded-full border-2 border-txt bg-white px-3 py-1.5 text-[13px] font-extrabold shadow-[0_2px_0_var(--t-txt)]">
          {icon ? (
            <Image src={icon} alt="" width={20} height={20} className="h-5 w-5" />
          ) : (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-magenta text-[10px] font-black text-white">
              T
            </span>
          )}
          {sym}
        </span>
      </div>
      {desc && <div className="mt-1 text-[11px] text-dim2">{desc}</div>}
    </div>
  );
}

function Slide({
  label,
  desc,
  value,
  onChange,
  min,
  max,
  step = 1,
  fmt = (v: number) => String(v),
}: {
  label: string;
  desc?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  fmt?: (v: number) => string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="label">{label}</span>
        <span className="mono rounded-md bg-magenta/10 px-2 py-0.5 text-[12px] font-bold text-magenta">
          {fmt(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(Math.max(value, min), max)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {desc && <div className="mt-0.5 text-[11px] leading-snug text-dim2">{desc}</div>}
    </div>
  );
}

function Seg<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { v: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={String(o.v)}
          onClick={() => onChange(o.v)}
          className={`mono rounded-lg border px-1 py-2 text-[12px] font-bold transition-colors ${
            value === o.v
              ? "border-magenta bg-magenta/10 text-magenta"
              : "border-[var(--line)] bg-white text-dim hover:border-[var(--line2)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** tiny sparkline of a scenario's price story (log-scaled) */
function ShapeSpark({ sc, active }: { sc: Scenario; active: boolean }) {
  const W = 64;
  const H = 22;
  const pts: string[] = [];
  let min = Infinity;
  let max = -Infinity;
  const vals: number[] = [];
  for (let i = 0; i <= 32; i++) {
    const v = Math.log(targetMult(sc, i / 32));
    vals.push(v);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = Math.max(1e-9, max - min);
  vals.forEach((v, i) => {
    const x = (i / 32) * W;
    const y = H - 2 - ((v - min) / span) * (H - 4);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={active ? "#fe0087" : "#9aa0b4"}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const SCENARIOS: { v: Scenario; name: string; desc: string }[] = [
  { v: "steady", name: "steady climb", desc: "a grind up, all year" },
  { v: "meme", name: "meme cycle", desc: "violent pump, then the dump" },
  { v: "wave", name: "rollercoaster", desc: "pump → dump → pump again" },
];

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4 rounded-xl border border-[var(--line)] bg-white/60 p-4">
      <div className="kicker !text-[10px]">{title}</div>
      {children}
    </div>
  );
}

const kfmt = (v: number) =>
  v >= 1_000_000_000
    ? `${(v / 1_000_000_000).toFixed(2)}B`
    : v >= 1_000_000
      ? `${(v / 1_000_000).toFixed(1)}M`
      : v >= 1000
        ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`
        : String(v);

/* ------------------------------------------------------- the lab */

type Lab = {
  balCur: number; // currency amount you add to the pool
  balTok: number; // token amount you add to the pool
  scenario: Scenario; // the year's price story — it sets the volume too
  potStart: number;
  compoundPct: number;
  buybackPct: number;
  burnOn: boolean;
  burnPct: number;
  feePips: number;
};

const DEFAULT_LAB: Lab = {
  balCur: 5,
  balTok: 1_000_000_000,
  scenario: "meme",
  potStart: 0,
  compoundPct: 50,
  buybackPct: 20,
  burnOn: true,
  burnPct: 20,
  feePips: 3000,
};

/** last-resort USD rates while CoinGecko loads (refined live) */
const FALLBACK_PX: Record<string, number> = { ETH: 1900, BNB: 590, POL: 0.075, USD: 1 };

function toConfig(lab: Lab, px: number): SimConfig {
  // volume comes in USD; the pool runs in the network currency
  return {
    days: SIM_DAYS,
    feePips: lab.feePips,
    initialLiquiditySec: Math.max(1e-9, lab.balCur),
    initialPrice: Math.max(1e-9, lab.balCur) / Math.max(1e-9, lab.balTok),
    initialPot: lab.potStart / px, // pot slider is USD too
    dailyDonation: 0,
    scenario: lab.scenario,
    compoundPct: lab.compoundPct,
    buybackPct: lab.buybackPct,
    burnPct: lab.burnPct,
    burnAcquired: lab.burnOn,
  };
}

function gainLabel(g: number): string {
  if (!isFinite(g)) return "—";
  if (g > 500) return `×${(1 + g / 100).toFixed(1)}`;
  return `${g >= 0 ? "+" : ""}${g.toFixed(1)}%`;
}

const HOOK_PINK = "#fe0087";
const BASE_BLUE = "#2b46e8";

export function SimLab({ net }: { net: Net }) {
  const cur = currencyOf(net);
  const [lab, setLab] = useState<Lab>({ ...DEFAULT_LAB });
  // keep the fee split consistent: buyback/burn always fit in what compound leaves
  const set = (patch: Partial<Lab>) =>
    setLab((l) => {
      const next = { ...l, ...patch };
      const room = 100 - next.compoundPct;
      next.buybackPct = Math.min(next.buybackPct, room);
      next.burnPct = Math.min(next.burnPct, room);
      return next;
    });

  const usdPx = useUsdPrice(cur.sym);
  // always have a usable rate: live CoinGecko when loaded, fallback meanwhile
  const px = usdPx ?? FALLBACK_PX[cur.sym] ?? 1;

  const days = useMemo(() => runSim(toConfig(lab, px)), [lab, px]);
  const last = days[days.length - 1];

  // pool DEPTH measured at the LAUNCH price: 2·L·√P₀. In V4 fees live
  // OUTSIDE the curve, so without autocompounding L never grows — this
  // measure isolates re-invested fees from price appreciation, and the
  // "without" pool stays flat by construction, exactly like on-chain.
  const sqrtP0 = Math.sqrt(Math.max(1e-12, lab.balCur) / Math.max(1e-12, lab.balTok));
  const depthDaily = days.map((d) => 2 * d.liquidity * sqrtP0);

  // extra depth built by the hook, month by month
  const growthBuckets: Bucket[] = useMemo(() => {
    // GROWTH above the deposit, at the launch price: a plain V4 pool never
    // re-invests fees, so its growth is zero BY DEFINITION — only the
    // hook's compounding can make these bars exist
    const start = 2 * Math.max(1e-9, lab.balCur);
    const out: Bucket[] = [];
    for (let m = 0; m < MONTHS; m++) {
      const idx = Math.min(days.length - 1, Math.round(((m + 1) * SIM_DAYS) / MONTHS) - 1);
      out.push({ t: m + 1, a: Math.max(0, depthDaily[idx] - start), b: 0 });
    }
    return out;
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  // monthly firepower: buybacks + sell defense are ONE thing — the pot firing
  const fireBuckets: Bucket[] = useMemo(() => {
    const fired = monthlySpend(days.map((d) => d.pumped + d.shielded));
    return fired.map((a, i) => ({ t: i + 1, a, b: 0 }));
  }, [days]);

  const burnSeries = days.map((d) => ({ t: d.day, v: d.burned }));

  // what the fee recipient earns — token side valued at the price it was
  // EARNED at, not marked to the final price
  const recCurSeries = days.map((d) => ({ t: d.day, v: d.recCur * px }));
  const recTokSeries = days.map((d) => ({ t: d.day, v: d.recTokCur * px }));

  const price0 = Math.max(1e-9, lab.balCur) / Math.max(1e-9, lab.balTok);
  const priceEnd = last?.price ?? price0;
  const priceBaseEnd = last?.priceBase ?? price0;
  const pfmt = fnum;

  // THE POSITION — your LP is the pool's only position, so it IS the
  // reserves: start = exactly what you deposited, end = the final curve
  const curStart = Math.max(1e-9, lab.balCur);
  const curEnd = (last?.liquidity ?? 0) * Math.sqrt(priceEnd);
  const tokEnd = (last?.liquidity ?? 0) / Math.sqrt(priceEnd);
  const curBaseEnd = (last?.liquidityBase ?? 0) * Math.sqrt(priceBaseEnd);
  const tokBaseEnd = (last?.liquidityBase ?? 0) / Math.sqrt(priceBaseEnd);
  // full position value = both legs at that pool's own end price = 2·cur
  const posStart = 2 * curStart;
  const posEnd = 2 * curEnd;
  const posBaseEnd = 2 * curBaseEnd;
  const edge = posEnd - posBaseEnd;

  // USD helpers (CoinGecko live rate, fallback while loading)
  const usdK = (v: number) => `$${kfmt(Math.round(v * px))}`;
  const usdP = (v: number) => `$${fnum(v * px)}`;

  const stats: { v: string; sub: string; l: string; good: boolean }[] = [
    {
      v: usdK(posEnd),
      sub: `${fnum(curEnd)} ${cur.sym} + ${kfmt(Math.round(tokEnd))} TOKEN · started at ${usdK(posStart)} (${fnum(curStart)} ${cur.sym} + ${kfmt(lab.balTok)})`,
      l: "your position after 12m",
      good: posEnd >= posStart,
    },
    {
      v: usdK(posBaseEnd),
      sub: `${fnum(curBaseEnd)} ${cur.sym} + ${kfmt(Math.round(tokBaseEnd))} TOKEN · same market, no hook`,
      l: "without the hook",
      good: posBaseEnd >= posStart,
    },
    {
      v: `${edge >= 0 ? "+" : "−"}${usdK(Math.abs(edge))}`,
      sub: `${gainLabel((edge / Math.max(1e-12, posBaseEnd)) * 100)} more position value vs no hook`,
      l: "the hook's edge",
      good: edge >= 0,
    },
    {
      v: `${usdP(priceEnd)}`,
      sub: `${gainLabel(((priceEnd - price0) / price0) * 100)} with the hook · ${gainLabel(((priceBaseEnd - price0) / price0) * 100)} without`,
      l: "TOKEN price after 12m",
      good: priceEnd >= price0,
    },
  ];

  const priceSeries = days.map((d) => ({ t: d.day, v: d.price * px }));
  const priceBaseSeries = days.map((d) => ({ t: d.day, v: d.priceBase * px }));

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      {/* controls */}
      <div className="panel h-fit">
        <div className="chead">
          <span>scenario</span>
          <button
            className="mono text-[10px] uppercase tracking-wider text-dim hover:text-magenta"
            onClick={() => setLab({ ...DEFAULT_LAB })}
          >
            reset
          </button>
        </div>
        <div className="space-y-4 p-5">
          <Group title="add liquidity">
            <AmountBox
              value={lab.balCur}
              onChange={(v) => set({ balCur: v })}
              sym={cur.sym}
              icon={cur.icon}
              desc={`the ${cur.sym} side of your position`}
            />
            <AmountBox
              value={lab.balTok}
              onChange={(v) => set({ balTok: v })}
              sym="TOKEN"
              desc="your project token on the other side — together they set the starting price"
            />
            <div className="mono rounded-lg border border-dashed border-[var(--line2)] px-3 py-2 text-[12px] text-dim">
              starting price{" "}
              <span className="font-bold text-magenta">
                1 TOKEN = {pfmt(price0)} {cur.sym}
              </span>{" "}
              · depth {kfmt(lab.balCur)} {cur.sym}
            </div>
            <div>
              <div className="label mb-1.5">pool fee — what traders pay per swap</div>
              <Seg
                options={[
                  { v: 500, label: "0.05%" },
                  { v: 3000, label: "0.30%" },
                  { v: 10000, label: "1.00%" },
                ]}
                value={lab.feePips}
                onChange={(v) => set({ feePips: v })}
              />
            </div>
          </Group>

          <Group title="the market — 12 months of trading">
            <div>
              <div className="label mb-1.5">the year&apos;s price story</div>
              <div className="grid gap-1.5">
                {SCENARIOS.map((s) => (
                  <button
                    key={s.v}
                    onClick={() => set({ scenario: s.v })}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                      lab.scenario === s.v
                        ? "border-magenta bg-magenta/10"
                        : "border-[var(--line)] bg-white hover:border-[var(--line2)]"
                    }`}
                  >
                    <ShapeSpark sc={s.v} active={lab.scenario === s.v} />
                    <span>
                      <span className={`mono block text-[12px] font-extrabold ${lab.scenario === s.v ? "text-magenta" : "text-txt"}`}>
                        {s.name}
                      </span>
                      <span className="block text-[11px] text-dim2">{s.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-1.5 text-[11px] leading-snug text-dim2">
                each story brings its OWN daily volume, scaled to your
                pool&apos;s market cap — hype trades hard, a dead chart barely
                trades. hover the price chart to see any day&apos;s volume. the
                engine derives each day&apos;s buy/sell split so the pool chases
                this curve as far as the circulating supply physically allows
              </div>
            </div>
          </Group>

          <Group title="the machine">
            <Slide
              label="starting pot"
              desc="dollars donated into the pot on day one — fuel for buybacks and defense"
              value={lab.potStart}
              onChange={(v) => set({ potStart: v })}
              min={0}
              max={200_000}
              step={1_000}
              fmt={(v) => `$${kfmt(v)}`}
            />
            <Slide
              label="autocompound"
              desc="share of trading fees re-invested as more liquidity"
              value={lab.compoundPct}
              onChange={(v) => set({ compoundPct: v })}
              min={0}
              max={100}
              fmt={(v) => `${v}%`}
            />
            <Slide
              label="buyback fuel"
              desc={`share of the ${cur.sym}-side fees that refills the pot — compound + buyback ≤ 100%, the rest goes to your recipient`}
              value={lab.buybackPct}
              onChange={(v) => set({ buybackPct: v })}
              min={0}
              max={100 - lab.compoundPct}
              fmt={(v) => `${v}%`}
            />
            <Slide
              label="burn"
              desc="share of the TOKEN-side fees destroyed forever — compound + burn ≤ 100%, the rest goes to your recipient"
              value={lab.burnPct}
              onChange={(v) => set({ burnPct: v })}
              min={0}
              max={100 - lab.compoundPct}
              fmt={(v) => `${v}%`}
            />
            <div className="rounded-lg border border-dashed border-[var(--line2)] p-3">
              <div className="flex items-center justify-between">
                <span className="label">burn what the pot buys?</span>
                <button
                  className={`toggle ${lab.burnOn ? "on" : ""}`}
                  onClick={() => set({ burnOn: !lab.burnOn })}
                  aria-label="toggle burning acquired tokens"
                />
              </div>
              <div className="mt-1.5 text-[11px] leading-snug text-dim2">
                {lab.burnOn
                  ? "the tokens the pot acquires — bought in buybacks and absorbed by the sell defense — are destroyed forever"
                  : "the tokens the pot acquires — bought in buybacks and absorbed by the sell defense — are delivered to your recipient"}
              </div>
            </div>
          </Group>
        </div>
      </div>

      {/* results */}
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {stats.map((s) => (
            <div key={s.l} className="panel px-4 py-4">
              <div className={`mono text-lg font-extrabold sm:text-xl ${s.good ? "text-magenta" : "text-bad"}`}>
                {s.v}
              </div>
              <div className="mono mt-0.5 text-[10.5px] text-dim2">{s.sub}</div>
              <div className="label mt-1.5">{s.l}</div>
            </div>
          ))}
        </div>

        {/* activity pills — every number is computed by the replay */}
        <div className="flex flex-wrap gap-2">
          <span className="pill pink">
            pot fired {usdK((last?.pumped ?? 0) + (last?.shielded ?? 0))}
          </span>
          {(last?.burned ?? 0) > 0 && <span className="pill bad">burned {kfmt(Math.round(last?.burned ?? 0))} TOKEN</span>}
          <span className="pill">
            to recipient {usdK((last?.recCur ?? 0) + (last?.recTokCur ?? 0))}
          </span>
        </div>

        {/* the curve itself: full-range position, start → end */}
        <div className="panel">
          <div className="chead">
            <span>the curve — full range, day 0 → day 364</span>
          </div>
          <div className="mono grid grid-cols-2 divide-x divide-[var(--line)] text-[12px]">
            {[
              {
                tag: "day 0",
                cur: Math.max(1e-12, lab.balCur),
                tok: Math.max(1e-12, lab.balTok),
                p: price0,
              },
              {
                tag: "day 364",
                cur: (last?.liquidity ?? 0) * Math.sqrt(last?.price ?? price0),
                tok: (last?.liquidity ?? 0) / Math.sqrt(last?.price ?? price0),
                p: priceEnd,
              },
            ].map((s) => (
              <div key={s.tag} className="space-y-1.5 p-4">
                <div className="kicker !text-[10px]">{s.tag}</div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-dim2">{cur.sym} reserve</span>
                  <span className="font-bold text-txt">
                    {fnum(s.cur)} <span className="text-dim2">({usdK(s.cur)})</span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-dim2">TOKEN reserve</span>
                  <span className="font-bold text-txt">{fnum(s.tok)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-dim2">price</span>
                  <span className="font-bold text-magenta">
                    {fnum(s.p)} {cur.sym}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-dim2">V4 tick</span>
                  <span className="font-bold text-txt">{Math.round(Math.log(s.p) / Math.log(1.0001))}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* the price path the scenario produced — with vs without the hook */}
        <div className="panel">
          <div className="chead">
            <span>TOKEN price over the year — the scenario, executed (USD)</span>
            <span className="mono flex items-center gap-4 text-[10px] normal-case tracking-normal">
              <span className="flex items-center gap-1.5" style={{ color: HOOK_PINK }}>
                <i className="h-[3px] w-5 rounded" style={{ background: HOOK_PINK }} /> with the hook
              </span>
              <span className="flex items-center gap-1.5" style={{ color: BASE_BLUE }}>
                <i className="h-[3px] w-5 rounded" style={{ background: BASE_BLUE }} /> without
              </span>
            </span>
          </div>
          <div className="p-4">
            <LineChart
              series={[
                { points: priceSeries, color: HOOK_PINK, fill: true, label: "with the hook — buybacks push, the defense holds the dumps" },
                { points: priceBaseSeries, color: BASE_BLUE, fill: false, label: "the same market, plain pool — it chases the scenario as far as the circulating supply allows" },
              ]}
              height={190}
              yFormat={(v) => `$${fnum(v)}`}
              empty="no volume, no price action"
              hoverExtra={(t) => {
                const d = days[Math.min(days.length - 1, Math.max(0, Math.round(t) - 1))];
                return d ? `volume that day $${kfmt(Math.round(d.volume * px))}` : "";
              }}
            />
          </div>
        </div>

        {/* extra depth built by compounding — a plain V4 pool builds ZERO */}
        <div className="panel">
          <div className="chead">
            <span className="flex items-center gap-2">
              <Image src={cur.icon} alt="" width={16} height={16} className="h-4 w-4" />
              extra pool depth built by the hook — re-invested fees, at the launch price
            </span>
            <span className="mono text-[10px] normal-case tracking-normal text-dim2">
              without the hook: $0 — plain V4 never compounds fees
            </span>
          </div>
          <div className="p-4">
            <BarChart
              buckets={growthBuckets.map((k) => ({ t: k.t, a: k.a * px, b: 0 }))}
              aColor={HOOK_PINK}
              bColor={BASE_BLUE}
              aLabel="built by the hook"
              bLabel=""
              xLabel={(i) => `m${i + 1}`}
              yFormat={(v) => `$${kfmt(Math.round(v))}`}
              empty="no compounding yet — raise the autocompound share"
            />
            <p className="mono mt-2 px-1 text-[10.5px] leading-relaxed text-dim2">
              in plain V4 fees sit OUTSIDE the curve, so a normal pool builds
              exactly $0 of new depth — every dollar in these bars is
              liquidity the hook created by re-investing fees, valued at the
              fixed launch price so price moves can&apos;t inflate it. the
              actual end-of-year reserves are in &ldquo;the curve&rdquo; panel
              above (same liquidity, valued at the end price).
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="chead">
            <span>pot fired per month — buybacks + sell defense (USD)</span>
          </div>
          <div className="p-4">
            <BarChart
              buckets={fireBuckets.map((k) => ({ t: k.t, a: k.a * px, b: 0 }))}
              aColor={HOOK_PINK}
              bColor={BASE_BLUE}
              aLabel="fired"
              bLabel=""
              xLabel={(i) => `m${i + 1}`}
              yFormat={(v) => `$${kfmt(Math.round(v))}`}
              empty="the pot never fired — add a starting pot or buyback fuel"
            />
          </div>
        </div>

        {/* what the fee recipient earns — the residual of both splits */}
        <div className="panel">
          <div className="chead">
            <span>to the fee recipient — cumulative (USD)</span>
            <span className="mono flex items-center gap-4 text-[10px] normal-case tracking-normal">
              <span className="flex items-center gap-1.5" style={{ color: HOOK_PINK }}>
                <i className="h-[3px] w-5 rounded" style={{ background: HOOK_PINK }} /> {cur.sym} side
              </span>
              <span className="flex items-center gap-1.5" style={{ color: BASE_BLUE }}>
                <i className="h-[3px] w-5 rounded" style={{ background: BASE_BLUE }} /> TOKEN side
              </span>
            </span>
          </div>
          <div className="p-4">
            <LineChart
              series={[
                { points: recCurSeries, color: HOOK_PINK, fill: true, label: `${cur.sym} side: fees minus compound (${lab.compoundPct}%) and buyback (${lab.buybackPct}%) = ${Math.max(0, 100 - lab.compoundPct - lab.buybackPct)}%` },
                { points: recTokSeries, color: BASE_BLUE, fill: true, label: `TOKEN side: fees minus compound (${lab.compoundPct}%) and burn (${lab.burnPct}%) = ${Math.max(0, 100 - lab.compoundPct - lab.burnPct)}%${lab.burnOn ? "" : " + the tokens the pot acquires"}` },
              ]}
              height={160}
              yFormat={(v) => `$${kfmt(Math.round(v))}`}
              empty="nothing routed to the recipient yet"
            />
          </div>
        </div>

        {(last?.burned ?? 0) > 0 && (
          <div className="panel">
            <div className="chead">
              <span>TOKEN burned — cumulative</span>
              <span className="mono text-[10px] normal-case tracking-normal text-dim2">
                {lab.burnOn ? "pot buys + defense absorbs" : ""}{lab.burnOn && lab.burnPct > 0 ? " + " : ""}{lab.burnPct > 0 ? `${lab.burnPct}% of TOKEN fees` : ""}
              </span>
            </div>
            <div className="p-4">
              <LineChart
                series={[{ points: burnSeries, color: "#e23a3a", fill: true }]}
                height={145}
                yFormat={(v) => kfmt(Math.round(v))}
              />
            </div>
          </div>
        )}

        <p className="mono px-1 text-[11px] leading-relaxed text-dim2">
          12 months, fully deterministic — you pick the price story; the story
          sets each day&apos;s volume (turnover scaled to your pool&apos;s own
          market cap) and the engine derives each day&apos;s buy/sell split so
          the pool follows that curve (a thin market simply can&apos;t reach an
          aggressive target — exactly like on-chain). every trade executes as
          a REAL swap with real price impact: fees accrue on the gross volume
          → every trade harvests → the split compounds, refuels the pot
          {lab.burnOn ? " and burns" : ""} → the pot buys back alongside buys
          and absorbs sell flow at the pool&apos;s exact execution price.
          without the hook, fees are never re-invested and there is no pot.
          {" "}usd via {usdPx !== null ? "coingecko live" : "a fallback rate"} (1 {cur.sym} = ${fnum(px)}).
        </p>
      </div>
    </div>
  );
}
