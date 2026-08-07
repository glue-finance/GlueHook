import type { PoolEvent } from "./events";

export type SeriesPoint = { t: number; v: number }; // t = unix seconds (or block as fallback), v = value

/**
 * Program liquidity trajectory from lifecycle events.
 * Liquidity is a uint128 in pool units; charted as a relative number.
 */
export function liquiditySeries(events: PoolEvent[]): SeriesPoint[] {
  let liq = 0;
  const pts: SeriesPoint[] = [];
  for (const e of events) {
    const t = e.timestamp ?? e.block;
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
  let bal = 0;
  const pts: SeriesPoint[] = [];
  for (const e of events) {
    const t = e.timestamp ?? e.block;
    if (e.kind === "Donated") bal += Number(e.data.amount ?? "0");
    else if (e.kind === "Harvested") bal += Number(e.data.fueled ?? "0");
    else if (e.kind === "Pumped") bal -= Number(e.data.spent ?? "0");
    else if (e.kind === "Shielded") bal -= Number(e.data.paid ?? "0");
    else continue;
    pts.push({ t, v: Math.max(0, bal) });
  }
  // anchor the tail on the live reading when available (event scan may be partial)
  if (currentBalance !== undefined && pts.length > 0) {
    const drift = currentBalance - pts[pts.length - 1].v;
    if (Math.abs(drift) > 1e-9) pts.push({ t: Math.floor(Date.now() / 1000), v: currentBalance });
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
