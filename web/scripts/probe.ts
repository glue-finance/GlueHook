/* Full-consistency probe of the simulator engine — run: npx tsx scripts/probe.ts */
import { runSim, targetMult, type SimConfig, type Scenario } from "../lib/sim/engine";

const PX = 1900; // USD per ETH, matches UI fallback
const cfg = (over: Partial<SimConfig> = {}): SimConfig => ({
  days: 364,
  feePips: 3000,
  initialLiquiditySec: 1, // 1 ETH
  initialPrice: 1 / 1_000_000_000, // vs 1B TOKEN
  initialPot: 0,
  dailyDonation: 0,
  scenario: "wave",
  compoundPct: 50,
  buybackPct: 20,
  burnPct: 20,
  burnAcquired: true,
  ...over,
});

let fails = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "  ok " : "FAIL "} ${name}${detail ? " — " + detail : ""}`);
};
const f = (v: number) => (Math.abs(v) >= 1e6 ? v.toExponential(3) : v.toFixed(Math.abs(v) < 1 ? 12 : 2));

for (const sc of ["steady", "meme", "wave"] as Scenario[]) {
  const c = cfg({ scenario: sc });
  const days = runSim(c);
  const last = days[days.length - 1];
  const SUPPLY = 1_000_000_000;
  const P0 = c.initialPrice;

  const poolTok = last.liquidity / Math.sqrt(last.price);
  const poolCur = last.liquidity * Math.sqrt(last.price);
  const circ = SUPPLY - poolTok - last.burned;

  console.log(`\n=== ${sc} ===`);
  console.log(
    `  end: pool ${f(poolCur)} ETH + ${(poolTok / 1e6).toFixed(1)}M TOK · burned ${(last.burned / 1e6).toFixed(1)}M · recTok ${(last.recTok / 1e6).toFixed(1)}M · circ ${(circ / 1e6).toFixed(1)}M`,
  );
  console.log(
    `  price x${(last.price / P0).toFixed(1)} (base x${(last.priceBase / P0).toFixed(1)}, target x${targetMult(sc, 1).toFixed(1)}) · pot fired $${((last.pumped + last.shielded) * PX).toFixed(0)} · rec $${((last.recCur + last.recTokCur) * PX).toFixed(0)}`,
  );

  // 1. conservation: pool + burned can never exceed the supply, and the
  // derived circulating stock is never negative (recTok is cumulative
  // INCOME — the same tokens recycle through the market, so it is not a
  // holding and may legitimately exceed the snapshot float)
  check("supply conservation", poolTok + last.burned <= SUPPLY * (1 + 1e-9), `pool+burned = ${((poolTok + last.burned) / 1e6).toFixed(1)}M of 1000M`);
  check("circulating ≥ 0", circ >= -SUPPLY * 1e-9, `circ ${(circ / 1e6).toFixed(1)}M`);

  // 2. hook L monotonic, base L constant
  let mono = true;
  for (let i = 1; i < days.length; i++) if (days[i].liquidity < days[i - 1].liquidity * (1 - 1e-12)) mono = false;
  check("hook liquidity monotonic", mono);
  check("base liquidity constant", days.every((d) => Math.abs(d.liquidityBase - days[0].liquidityBase) < 1e-12 * days[0].liquidityBase));

  // 3. the pot fires EVERY month (volume>0, buyback>0)
  const fired: number[] = [];
  for (let mth = 0; mth < 12; mth++) {
    const a = days[Math.round((mth * 364) / 12)];
    const b = days[Math.min(363, Math.round(((mth + 1) * 364) / 12) - 1)];
    fired.push(b.pumped + b.shielded - (a.pumped + a.shielded));
  }
  check("pot fires all 12 months", fired.every((v) => v > 0), fired.map((v) => (v * PX).toFixed(0)).join(","));

  // 4. the plain pool tracks the scenario; the hook must never end
  // meaningfully BELOW it (burn/defense can only push it above)
  const tEnd = P0 * targetMult(sc, 1);
  check("base tracks target", Math.abs(Math.log(last.priceBase / tEnd)) < 0.35, `x${(last.priceBase / P0).toFixed(1)} vs x${targetMult(sc, 1).toFixed(1)}`);
  check("hook never below plain", last.price >= last.priceBase * 0.9, `hook x${(last.price / P0).toFixed(1)} vs base x${(last.priceBase / P0).toFixed(1)}`);

  // 5. price paths actually differ between scenarios (checked after loop)

  // 6. stat cross-checks the UI derives
  const posEnd = 2 * poolCur;
  check("position = 2×cur leg", posEnd > 0 && Math.abs(poolCur - last.liquidity * Math.sqrt(last.price)) < 1e-9 * poolCur);
  const tick = Math.round(Math.log(last.price) / Math.log(1.0001));
  check("V4 tick finite", Number.isFinite(tick), `tick ${tick}`);
}

// 5. distinct shapes: at day 95 (the meme/wave peak zone) the three
// stories are far apart — probe the plain pool there
const at95 = (sc: Scenario) => {
  const days = runSim(cfg({ scenario: sc }));
  return days[94].priceBase / cfg().initialPrice;
};
const ms = { steady: at95("steady"), meme: at95("meme"), wave: at95("wave") };
console.log(`\nday-95 multiples: steady x${ms.steady.toFixed(1)} · meme x${ms.meme.toFixed(1)} · wave x${ms.wave.toFixed(1)}`);
check("scenarios distinct", Math.abs(Math.log(ms.steady / ms.meme)) > 0.5 && Math.abs(Math.log(ms.steady / ms.wave)) > 0.5);

// 7. smoothness in the deposit: ±1% liquidity must move outputs by only
// a few % — volume scales with the cap, so everything scales together
console.log("");
for (const sc of ["steady", "meme", "wave"] as Scenario[]) {
  const out = [0.99, 1, 1.01].map((eth) => {
    const days = runSim(cfg({ scenario: sc, initialLiquiditySec: eth, initialPrice: eth / 1e9 }));
    const l = days[days.length - 1];
    return { mult: l.price / (eth / 1e9), L: l.liquidity / days[0].liquidityBase };
  });
  const rel = (a: number, b: number) => Math.abs(a / b - 1);
  const ok =
    rel(out[0].mult, out[1].mult) < 0.05 &&
    rel(out[2].mult, out[1].mult) < 0.05 &&
    rel(out[0].L, out[1].L) < 0.05 &&
    rel(out[2].L, out[1].L) < 0.05;
  check(`smooth in deposit (${sc})`, ok, `mult x${out[0].mult.toFixed(2)} / x${out[1].mult.toFixed(2)} / x${out[2].mult.toFixed(2)} · L x${out[0].L.toFixed(3)} / x${out[1].L.toFixed(3)} / x${out[2].L.toFixed(3)}`);
}

// 8. deposit sweep: scale-invariance — % outcomes should be similar at
// any pool size since the story's volume scales with the cap
console.log("");
for (const eth of [1, 10, 100]) {
  const days = runSim(cfg({ initialLiquiditySec: eth, initialPrice: eth / 1e9 }));
  const l = days[days.length - 1];
  const volPeak = Math.max(...days.map((d) => d.volume)) * PX;
  console.log(
    `  ${eth} ETH pool → price x${(l.price / (eth / 1e9)).toFixed(1)} · L growth x${(l.liquidity / days[0].liquidityBase).toFixed(2)} · burned ${(l.burned / 1e7).toFixed(1)}% · peak vol $${(volPeak / 1000).toFixed(1)}k/day · fired $${((l.pumped + l.shielded) * PX).toFixed(0)}`,
  );
}

// 9. all mechanics off → hook world == plain world exactly
{
  const days = runSim(cfg({ compoundPct: 0, buybackPct: 0, burnPct: 0, burnAcquired: false }));
  const l = days[days.length - 1];
  check("\nno-op hook == plain pool", Math.abs(l.price / l.priceBase - 1) < 1e-9 && Math.abs(l.liquidity / l.liquidityBase - 1) < 1e-12);
}

console.log(fails ? `\n${fails} FAILURES` : "\nALL CHECKS PASS");
process.exit(fails ? 1 : 0);
