/**
 * Client-side replay of the GlueHook mechanics with REAL Uniswap math.
 * No chain calls, no randomness — fully deterministic.
 *
 * Pool model: one full-range position (min tick → max tick), which is
 * exactly a constant-product curve tracked as (L, √P):
 *     token reserve = L/√P      currency reserve = L·√P
 *     buy  (currency in):  √P' = √P + curIn/L
 *     sell (token in):     1/√P' = 1/√P + tokIn/L
 * Fees accrue OUTSIDE the curve (V3/V4 style), per side.
 *
 * THE MARKET — a scenario, not sliders. You pick the year's price story
 * (steady climb / meme cycle / rollercoaster); the story also sets each
 * day's VOLUME as a turnover profile of that day's market cap (a hyped
 * launch turns its cap over 5–10× a day, a dead chart barely trades).
 * Each day is executed as many small slices; before every slice
 * EACH pool is asked "what net flow do you need to reach today's target
 * price?" — the scenario is the market's story and both worlds chase it.
 * VOLUME IS BUY *AND* SELL: the matched part of every slice executes as
 * a literal ROUND TRIP — a buy through the curve, then the very tokens
 * it bought sold straight back — so churn pays fees on both legs and
 * feeds the machine WITHOUT moving the price. Only the net imbalance
 * (capped at 80% of the slice, real markets are never one-sided) moves
 * the price, as one directional swap. A thin market simply can't reach
 * an aggressive target and lags it, exactly like on-chain.
 *
 * SUPPLY IS CONSERVED — the deposit is the whole token supply. The
 * circulating stock is DERIVED from the conservation invariant at every
 * step (supply − pool reserve − pending program fees − burned), so it
 * can never drift. Tokens held by the fee recipient are CIRCULATING —
 * they sit in a wallet like anyone else's; only burned tokens and the
 * program's not-yet-compounded fee tokens are out of the market. Sellers
 * can never deliver more tokens than circulate, so a burn that eats the
 * float makes later dumps physically smaller — that IS the mechanism.
 *
 * Hook mechanics replayed 1:1 with the contract's rules:
 *  · PUMP   — on each buy, the pot spends alongside it, capped at 80% of
 *             the slice the buy unlocks (spend ≤ 80%·min(pot, buy size)).
 *             The pot's swap pays the pool fee like any other trade.
 *  · SHIELD — on each sell, the pot absorbs at the pool's EXACT execution
 *             price (fee included) up to its balance; the pool does not
 *             move for the absorbed part; the rest swaps through.
 *  · HARVEST — every trade harvests: the split runs, the compound share
 *             re-invests (currency-anchored, un-matched side carries).
 *
 * Without the hook: the same trades on the same curve — but fees are
 * never re-invested, there is no pot, no pump, no shield.
 */

export type Scenario = "steady" | "meme" | "wave";

export type SimConfig = {
  days: number;
  feePips: number; // e.g. 3000 = 0.30%
  initialLiquiditySec: number; // initial pool depth, in CURRENCY (one side)
  initialPrice: number; // CURRENCY per TOKEN
  initialPot: number;
  dailyDonation: number;
  scenario: Scenario;
  compoundPct: number; // 0..100 — per SIDE: compound+buyback ≤ 100 (currency), compound+burn ≤ 100 (token)
  buybackPct: number;
  burnPct: number;
  /** burn what the pot ACQUIRES (buyback output + defense-absorbed tokens); off = they go to the recipient */
  burnAcquired: boolean;
};

export type DayPoint = {
  day: number;
  price: number;
  priceBase: number;
  target: number; // the scenario's target price for this day
  volume: number; // the story's trading volume that day, in CURRENCY
  liquidity: number;
  liquidityBase: number;
  pot: number;
  burned: number;
  pumped: number; // cumulative currency spent buying back
  shielded: number; // cumulative currency paid absorbing sells
  harvests: number;
  served: number; // cumulative currency volume executed
  servedBase: number;
  recCur: number; // cumulative CURRENCY paid to the fee recipient
  recTok: number; // cumulative TOKENS paid to the fee recipient
  recTokCur: number; // currency value of those tokens, priced when earned
  burnedCur: number; // currency value of the burn, priced at burn time
};

/* ------------------------------------------------ scenario curves */

/** keyframes: (time 0..1, price multiple of the launch price) */
const SHAPES: Record<Scenario, [number, number][]> = {
  // a grind up, all year
  steady: [
    [0, 1],
    [1, 8],
  ],
  // the classic meme: violent pump, then the long dump
  meme: [
    [0, 1],
    [0.16, 45],
    [0.55, 3],
    [1, 1.5],
  ],
  // pump → dump → pump again
  wave: [
    [0, 1],
    [0.26, 15],
    [0.55, 2.2],
    [1, 25],
  ],
};

/** VOLUME is part of the story too — each scenario carries a daily
 *  TURNOVER profile: volume as a multiple of that day's market cap.
 *  Small-cap DEX reality: a hyped launch turns its cap over 5–10× a
 *  day (a $400k-cap token doing millions in volume), a healthy chart
 *  does 0.3–1×, a dead one barely trades — nobody inputs volume, the
 *  story does. */
const TURNOVER: Record<Scenario, [number, number][]> = {
  // healthy, settling interest
  steady: [
    [0, 1.0],
    [0.3, 0.5],
    [1, 0.3],
  ],
  // launch frenzy at the pump, near-silence after the dump
  meme: [
    [0, 6],
    [0.16, 10],
    [0.3, 2.5],
    [0.55, 0.5],
    [1, 0.15],
  ],
  // active on every leg, lulls between
  wave: [
    [0, 3],
    [0.26, 8],
    [0.42, 1.5],
    [0.55, 3],
    [0.8, 1.5],
    [1, 6],
  ],
};

/** keyframe interpolation — smoothstep in log space, so every leg is a
 *  smooth exponential move with soft turns */
function shapeAt(pts: [number, number][], m: number): number {
  const t = Math.min(1, Math.max(0, m));
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0] || i === pts.length - 1) {
      const [m0, v0] = pts[i - 1];
      const [m1, v1] = pts[i];
      const s = Math.min(1, Math.max(0, (t - m0) / (m1 - m0)));
      const e = s * s * (3 - 2 * s); // smoothstep
      return Math.exp(Math.log(v0) + (Math.log(v1) - Math.log(v0)) * e);
    }
  }
  return pts[pts.length - 1][1];
}

/** target price multiple at time m ∈ [0,1] */
export function targetMult(scenario: Scenario, m: number): number {
  return shapeAt(SHAPES[scenario], m);
}

/** the story's daily volume at time m, per unit of LAUNCH market cap:
 *  turnover(m) × price-multiple(m). Multiply by the currency deposit
 *  (which IS the launch cap of a full-supply pool) to get currency/day. */
export function volumeMult(scenario: Scenario, m: number): number {
  return shapeAt(TURNOVER[scenario], m) * shapeAt(SHAPES[scenario], m);
}

/* ------------------------------------------------ pool primitives */

type Pool = { L: number; sqrtP: number };

/** buy: currency in (already net of fee) → price up */
function buy(pool: Pool, curIn: number): number {
  const before = pool.sqrtP;
  pool.sqrtP = pool.sqrtP + curIn / pool.L;
  // token out
  return pool.L * (1 / before - 1 / pool.sqrtP);
}

/** sell: token in (already net of fee) → price down */
function sell(pool: Pool, tokIn: number): number {
  const before = pool.sqrtP;
  const inv = 1 / pool.sqrtP + tokIn / pool.L;
  pool.sqrtP = 1 / inv;
  // currency out
  return pool.L * (before - pool.sqrtP);
}

/** currency received for selling tokIn at the current state (no state change) */
function quoteSell(pool: Pool, tokIn: number): number {
  const inv = 1 / pool.sqrtP + tokIn / pool.L;
  return pool.L * (pool.sqrtP - 1 / inv);
}

/** alternating trade slices per day — fine enough that a single slice is
 *  small next to the pool, so discretization doesn't distort the curve.
 *  Hype days trade many times the pool's own reserve, so the count is
 *  ADAPTIVE: enough slices that one slice stays ≤ ~2% of the currency
 *  reserve, floored at 200 and capped to keep the year instant. */
const MIN_SLICES = 200;
const MAX_SLICES = 4000;

function slicesFor(dayVol: number, curReserve: number): number {
  if (dayVol <= 0 || curReserve <= 0) return MIN_SLICES;
  const wanted = Math.ceil(dayVol / (0.02 * curReserve));
  return Math.min(MAX_SLICES, Math.max(MIN_SLICES, wanted));
}

export function runSim(cfg: SimConfig): DayPoint[] {
  const fee = cfg.feePips / 1_000_000;

  const P0 = Math.max(1e-18, cfg.initialPrice);
  const sqrtP0 = Math.sqrt(P0);
  const L0 = cfg.initialLiquiditySec / sqrtP0;

  const hook: Pool = { L: L0, sqrtP: sqrtP0 };
  const base: Pool = { L: L0, sqrtP: sqrtP0 };

  let pot = cfg.initialPot;
  let feeCur = 0;
  let feeTok = 0;
  let carryCur = 0;
  let carryTok = 0;
  let burned = 0;
  let pumped = 0;
  let shielded = 0;
  let served = 0;
  let servedBase = 0;
  let recCur = 0;
  let recTok = 0;
  let recTokCur = 0;
  let burnedCur = 0;

  const cShare = cfg.compoundPct / 100;
  const bbShare = cfg.buybackPct / 100;
  const burnShare = cfg.burnPct / 100;
  const residCur = Math.max(0, 1 - cShare - bbShare);
  const residTok = Math.max(0, 1 - cShare - burnShare);

  // SUPPLY CONSERVATION — the deposit IS the token supply. Every token
  // lives in exactly one bucket at all times: pool reserve (L/√P) ·
  // circulating supply · the program's pending fees · the recipient's
  // holdings · burned. The circulating stock is DERIVED from that
  // invariant every slice (supply − pool − pending − recipient −
  // burned), so it can never drift: token-side fees, the shield's and
  // pump's acquisitions, and net selling into the curve are all capped
  // by tokens that actually exist, and the end-of-year reserve at the
  // end tick is exact.
  const SUPPLY = L0 / sqrtP0;

  // markets are never one-sided: at most 80% of a slice may be net
  // imbalance, the remaining 20% is always matched two-way churn — so
  // fees, the pot, the shield and the compounder stay alive through
  // every leg of the scenario
  const CAP = 0.8;

  // HARVEST — runs on every trade, no minimums
  function harvest() {
    if (feeCur <= 0 && feeTok <= 0) return;
    const P = hook.sqrtP * hook.sqrtP;

    pot += feeCur * bbShare;
    const feeBurn = feeTok * burnShare;
    burned += feeBurn;
    burnedCur += feeBurn * P;
    recCur += feeCur * residCur;
    const rT = feeTok * residTok;
    recTok += rT;
    recTokCur += rT * P;

    const compCur = feeCur * cShare + carryCur;
    const compTok = feeTok * cShare + carryTok;
    feeCur = 0;
    feeTok = 0;

    // compound: currency anchors; balanced add needs compTok·P == compCur
    const needTok = compCur / P;
    const useTok = Math.min(compTok, needTok);
    const useCur = useTok * P;
    carryTok = compTok - useTok;
    carryCur = compCur - useCur;
    if (useCur > 0) {
      // a balanced add of fraction f of the virtual reserves grows L by
      // f — the token leg is REAL fee tokens re-entering the curve
      const curReserve = hook.L * hook.sqrtP;
      hook.L *= 1 + useCur / curReserve;
    }
  }

  const out: DayPoint[] = [];
  let totalSlices = 0;

  for (let day = 1; day <= cfg.days; day++) {
    pot += cfg.dailyDonation;

    // the story sets today's volume: turnover × cap. The launch cap of a
    // full-supply pool IS the currency deposit (SUPPLY·P0 = L0·√P0).
    const dayVol =
      volumeMult(cfg.scenario, (day - 0.5) / cfg.days) * cfg.initialLiquiditySec;
    const SLICES = slicesFor(dayVol, hook.L * hook.sqrtP);
    const slice = dayVol / SLICES;
    totalSlices += SLICES;

    for (let i = 0; i < SLICES; i++) {
      if (slice <= 0) break;

      // today's target price, interpolated inside the day
      const m = (day - 1 + (i + 1) / SLICES) / cfg.days;
      const sqrtT = sqrtP0 * Math.sqrt(targetMult(cfg.scenario, m));

      /* ---- plain pool: chases the story, fees never re-invested ----
       * The net currency flow that would take a pool to the target right
       * now is L·(√T − √P); the market can only deliver what this
       * slice's volume allows (capped at 80% one-sided). The REST of the
       * slice is matched churn, executed as a literal ROUND TRIP: a buy
       * through the curve, then the very tokens that buy produced sold
       * straight back — volume is buy AND sell, fees accrue on both
       * legs, the price returns to where it stood. Only the net leg
       * moves the price. Every leg is a REAL swap — price impact and
       * execution amounts are exact, never spot-price approximations. */
      {
        const needB = base.L * (sqrtT - base.sqrtP);
        const netB = Math.min(CAP * slice, Math.max(-CAP * slice, needB));
        // churn: buy half the matched volume, sell the proceeds back
        const churnB = Math.max(0, slice - Math.abs(netB)) / 2;
        if (churnB > 0) {
          const t = buy(base, churnB * (1 - fee));
          servedBase += churnB;
          servedBase += sell(base, t * (1 - fee));
        }
        // the net imbalance: ONE directional swap
        if (netB > 0) {
          buy(base, netB * (1 - fee));
          servedBase += netB;
        } else if (netB < 0) {
          // circulating = supply − pool reserve (all holders circulate)
          const oB = Math.max(0, SUPPLY - base.L / base.sqrtP);
          const tok = Math.min(-netB / (base.sqrtP * base.sqrtP), oB);
          if (tok > 0) servedBase += sell(base, tok * (1 - fee));
        }
      }

      /* ---- hooked pool: the SAME story, plus the machine ----
       * Same shape — round-trip churn + one net leg — but every buy
       * carries the PUMP and every sell meets the SHIELD, exactly like
       * the contract's beforeSwap/afterSwap. */

      // circulating stock, DERIVED from the conservation invariant.
      // Recipient tokens circulate (they're a wallet like any other);
      // only burns and the program's pending fee tokens are out.
      let o = Math.max(
        0,
        SUPPLY - hook.L / hook.sqrtP - burned - feeTok - carryTok,
      );

      // a buyer's swap: real price impact; the pot rides it (PUMP),
      // capped at 80% of what the buy unlocks; the pot's swap pays the
      // pool fee AND its own impact, and receives the curve's output
      const buyLeg = (cur: number): number => {
        if (cur <= 0) return 0;
        feeCur += cur * fee;
        const tokOut = buy(hook, cur * (1 - fee));
        served += cur;
        const spend = 0.8 * Math.min(pot, cur);
        if (spend > 0) {
          pot -= spend;
          pumped += spend;
          feeCur += spend * fee;
          const pumpTok = buy(hook, spend * (1 - fee));
          if (cfg.burnAcquired) {
            burned += pumpTok;
            burnedCur += spend;
          } else {
            recTok += pumpTok;
            recTokCur += spend;
          }
        }
        return tokOut;
      };

      // a seller's swap: fee skimmed in tokens up front; the SHIELD
      // absorbs at the pool's EXACT execution price (impact included) up
      // to the pot — the pool does not move for the absorbed part; the
      // remainder swaps through the curve for real
      const sellLeg = (tok: number) => {
        if (tok <= 0) return;
        const skim = tok * fee;
        feeTok += skim;
        o = Math.max(0, o - skim);
        const net = tok - skim;
        let absorbTok = 0;
        if (pot > 0) {
          const full = quoteSell(hook, net);
          if (full > 0) {
            absorbTok = net * Math.min(1, pot / full);
            const pay = Math.min(pot, quoteSell(hook, absorbTok));
            pot -= pay;
            shielded += pay;
            served += pay;
            o = Math.max(0, o - absorbTok);
            if (cfg.burnAcquired) {
              burned += absorbTok;
              burnedCur += pay;
            } else {
              recTok += absorbTok;
              recTokCur += pay;
            }
          }
        }
        const rest = net - absorbTok;
        if (rest > 0) {
          served += sell(hook, rest);
          o = Math.max(0, o - rest);
        }
      };

      const needH = hook.L * (sqrtT - hook.sqrtP);
      const netH = Math.min(CAP * slice, Math.max(-CAP * slice, needH));
      // churn round trip: buy, then sell the proceeds straight back
      const churnH = Math.max(0, slice - Math.abs(netH)) / 2;
      if (churnH > 0) sellLeg(buyLeg(churnH));
      // the net imbalance: ONE directional swap
      if (netH > 0) buyLeg(netH);
      else if (netH < 0) {
        sellLeg(Math.min(-netH / (hook.sqrtP * hook.sqrtP), o));
      }

      harvest();
    }

    out.push({
      day,
      price: hook.sqrtP * hook.sqrtP,
      priceBase: base.sqrtP * base.sqrtP,
      target: P0 * targetMult(cfg.scenario, day / cfg.days),
      volume: dayVol,
      liquidity: hook.L,
      liquidityBase: base.L,
      pot,
      burned,
      pumped,
      shielded,
      harvests: totalSlices,
      served,
      servedBase,
      recCur,
      recTok,
      recTokCur,
      burnedCur,
    });
  }
  return out;
}
