import { BURN_MODES, type PoolEvent } from "./events";

export type SeriesPoint = { t: number; v: number }; // t = unix seconds (or block as fallback), v = value

/**
 * ONE time base per chart. Timestamps resolve lazily and in bounded batches,
 * so a busy pool always has events still carrying `timestamp: null` — and the
 * old per-event fallback `timestamp ?? block` MIXED unix seconds (~1.8e9) with
 * block numbers (~1e7) on the same axis, crushing the real curve into two
 * clusters joined by a nonsense line. Instead: interpolate every missing
 * timestamp from the resolved (block, timestamp) anchors, and only when fewer
 * than two anchors exist fall back to blocks for EVERY point (a wrong unit,
 * but a consistent one — the shape stays true and the tooltip says "block").
 */
function makeTimeOf(events: PoolEvent[]): { timeOf: (e: PoolEvent) => number; timestamped: boolean } {
  if (!events.some((e) => e.timestamp === null)) {
    return { timeOf: (e) => e.timestamp!, timestamped: events.length > 0 };
  }
  const anchors: { b: number; t: number }[] = [];
  for (const e of events) {
    if (e.timestamp === null) continue;
    if (anchors.length === 0 || anchors[anchors.length - 1].b !== e.block) {
      anchors.push({ b: e.block, t: e.timestamp });
    }
  }
  if (anchors.length < 2) return { timeOf: (e) => e.block, timestamped: false };

  const est = (b: number): number => {
    let lo = 0;
    let hi = anchors.length - 1;
    if (b <= anchors[0].b) hi = 1;
    else if (b >= anchors[hi].b) lo = hi - 1;
    else {
      // binary search the surrounding anchor pair
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (anchors[mid].b <= b) lo = mid;
        else hi = mid;
      }
    }
    const a = anchors[lo];
    const z = anchors[hi];
    const rate = z.b > a.b ? (z.t - a.t) / (z.b - a.b) : 0;
    return a.t + (b - a.b) * rate;
  };
  return { timeOf: (e) => e.timestamp ?? est(e.block), timestamped: true };
}

/**
 * Program liquidity trajectory from lifecycle events.
 * Liquidity is a uint128 in pool units; charted as a relative number.
 */
export function liquiditySeries(events: PoolEvent[]): SeriesPoint[] {
  const { timeOf } = makeTimeOf(events);
  let liq = 0;
  const pts: SeriesPoint[] = [];
  for (const e of events) {
    const t = timeOf(e);
    if (e.kind === "ProgramCreated") {
      // creation itself carries no liquidity; the Add event follows
      pts.push({ t, v: liq });
    } else if (e.kind === "ProgramLiquidityAdded" || e.kind === "Compounded") {
      liq += Number(e.data.liquidity ?? "0");
      pts.push({ t, v: liq });
    } else if (e.kind === "ProgramLiquidityRemoved") {
      liq -= Number(e.data.liquidity ?? "0");
      pts.push({ t, v: Math.max(0, liq) });
    }
  }
  return pts;
}

/**
 * Pot (secondary currency) balance trajectory:
 * Donated(+amount) · Harvested(+fueled) · Pumped(−spent) · Shielded(−paid)
 */
export function potSeries(events: PoolEvent[], currentBalance?: number): SeriesPoint[] {
  const { timeOf, timestamped } = makeTimeOf(events);
  let bal = 0;
  const pts: SeriesPoint[] = [];
  for (const e of events) {
    const t = timeOf(e);
    if (e.kind === "Donated") bal += Number(e.data.amount ?? "0");
    else if (e.kind === "Harvested") bal += Number(e.data.fueled ?? "0");
    else if (e.kind === "Pumped") bal -= Number(e.data.spent ?? "0");
    else if (e.kind === "Shielded") bal -= Number(e.data.paid ?? "0");
    else continue;
    pts.push({ t, v: Math.max(0, bal) });
  }
  // anchor the tail on the live reading when available (event scan may be
  // partial) — only on a timestamp axis, never mixing "now" into block units
  if (timestamped && currentBalance !== undefined && pts.length > 0) {
    const drift = currentBalance - pts[pts.length - 1].v;
    if (Math.abs(drift) > 1e-9) pts.push({ t: Math.floor(Date.now() / 1000), v: currentBalance });
  }
  return pts;
}

/**
 * Cumulative main taken out of circulation forever: every Delivered event
 * whose mode is a burn leg (BURNED · DEAD · HELD). Covers both the buyback
 * split's burn and the harvest's main-side burn — both route through the
 * same delivery cascade, so this single event stream never double-counts.
 */
export function burnedSeries(events: PoolEvent[]): SeriesPoint[] {
  const { timeOf } = makeTimeOf(events);
  let total = 0;
  const pts: SeriesPoint[] = [];
  for (const e of events) {
    if (e.kind !== "Delivered" || !BURN_MODES.has(e.data.mode ?? "")) continue;
    total += Number(e.data.amount ?? "0");
    pts.push({ t: timeOf(e), v: total });
  }
  return pts;
}

/**
 * Dotted forward projection of the liquidity curve: linear-fit the compound
 * growth over the trailing window and extend it `horizon` seconds forward.
 */
export function projectLiquidity(
  series: SeriesPoint[],
  horizonSec = 7 * 86400,
  windowSec = 14 * 86400,
): SeriesPoint[] {
  if (series.length < 2) return [];
  const last = series[series.length - 1];
  const cut = last.t - windowSec;
  const win = series.filter((p) => p.t >= cut);
  const base = win.length >= 2 ? win : series.slice(-2);
  const first = base[0];
  const dt = last.t - first.t;
  if (dt <= 0) return [];
  // a trend fitted over minutes says nothing about a week — extrapolating the
  // first add 7 days forward paints absurd hockey sticks, so require at least
  // 6 hours of real history before drawing any projection at all
  if (dt < 6 * 3600) return [];
  const rate = (last.v - first.v) / dt; // liquidity per second, recent trend
  const growth = Math.max(0, rate);
  const steps = 8;
  const out: SeriesPoint[] = [{ t: last.t, v: last.v }];
  for (let i = 1; i <= steps; i++) {
    const t = last.t + (horizonSec * i) / steps;
    out.push({ t, v: last.v + growth * (t - last.t) });
  }
  return out;
}
