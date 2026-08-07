"use client";

import { useEffect, useState } from "react";

/* ---------------------------------------------------------------- helpers */

function useTick(ms: number): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((v) => v + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}

function Card({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="panel panel-hi overflow-hidden">
      <div className="chead">
        <span>{title}</span>
        <span className="flex gap-1.5">
          <i className="h-2 w-2 rounded-full bg-bad/60" />
          <i className="h-2 w-2 rounded-full bg-warn/60" />
          <i className="h-2 w-2 rounded-full bg-green/60" />
        </span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ 0 pot */

export function PotVisual() {
  const t = useTick(1500);
  const fill = [34, 42, 51, 58, 66, 73][t % 6];
  const sources = ["trading fees", "project deposits", "anyone's donation"];
  return (
    <Card title="the pot">
      <div className="space-y-4 py-1">
        <div className="grid grid-cols-3 gap-2">
          {sources.map((s, i) => (
            <div key={s} className={`flowbox ${t % 3 === i ? "hot" : ""}`}>{s}</div>
          ))}
        </div>
        <div className="flow-arrow">↓ ↓ ↓</div>
        <div className="relative mx-auto h-[120px] w-[170px] overflow-hidden rounded-b-[46px] rounded-t-xl border-2 border-[var(--line2)]">
          <div
            className="absolute bottom-0 left-0 right-0 transition-all duration-700"
            style={{
              height: `${fill}%`,
              background: "linear-gradient(180deg, #ff5cb4, #fe0087 60%, #c4006b)",
              boxShadow: "0 0 24px rgba(254,0,135,.45)",
            }}
          />
          <div className="mono absolute inset-0 flex items-center justify-center text-[13px] font-bold text-txt">
            {fill}% armed
          </div>
        </div>
        <p className="mono text-center text-[11px] leading-relaxed text-dim2">
          a pot of collateral living inside your pool — it spends itself, both
          ways, automatically.
        </p>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- 1 zero fee */

export function ZeroFeeVisual() {
  return (
    <Card title="protocol_fee.sol">
      <div className="flex flex-col items-center gap-4 py-6">
        <div className="mono text-[64px] font-extrabold leading-none tracking-tight">
          <span className="grad-text">0.00%</span>
        </div>
        <div className="label">hook fee — forever</div>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <span className="pill hi">no owner</span>
          <span className="pill hi">no admin keys</span>
          <span className="pill hi">no upgrade path</span>
          <span className="pill teal">source verified on 23 chains</span>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------- 2 pump */

export function PumpVisual() {
  const t = useTick(2200);
  const buys = [
    { user: 1.0, pump: 0.42 },
    { user: 2.4, pump: 0.9 },
    { user: 0.3, pump: 0.14 },
    { user: 4.1, pump: 1.6 },
  ];
  const b = buys[t % buys.length];
  return (
    <Card title="afterSwap — pump">
      <div className="space-y-4">
        <div className="row">
          <span className="text-dim">user buys MAIN</span>
          <span className="v text-txt">{b.user.toFixed(2)} ETH</span>
        </div>
        <div>
          <div className="mb-1.5 flex justify-between">
            <span className="label">buy size</span>
            <span className="mono text-[11px] text-dim">{b.user.toFixed(2)}</span>
          </div>
          <div className="meter">
            <i style={{ width: `${Math.min(100, b.user * 22)}%` }} />
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex justify-between">
            <span className="label text-teal">pot pumps alongside</span>
            <span className="mono text-[11px] text-teal">{b.pump.toFixed(2)}</span>
          </div>
          <div className="meter">
            <i
              style={{
                width: `${Math.min(100, b.pump * 22)}%`,
                background: "linear-gradient(90deg,#00987f,#17b512)",
              }}
            />
          </div>
        </div>
        <p className="mono text-[11px] leading-relaxed text-dim2">
          pump spend ∝ the carrying buy, capped at 80% of the unlocked slice —
          a dust buy can only unlock a dust pump. un-sandwichable by construction.
        </p>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------- 3 burn */

export function BurnVisual() {
  const t = useTick(1600);
  const step = t % 4;
  const boxes = ["recipient = 0x0", "token.burn()", "→ 0xdEaD", "held forever"];
  return (
    <Card title="burn cascade">
      <div className="space-y-2 py-2">
        {boxes.map((b, i) => (
          <div key={b}>
            <div className={`flowbox ${step >= i ? "hot" : ""}`}>{b}</div>
            {i < boxes.length - 1 && <div className="flow-arrow py-1">↓ if not possible</div>}
          </div>
        ))}
        <p className="mono pt-2 text-[11px] leading-relaxed text-dim2">
          bought MAIN is destroyed: native burn first, dead address second, and
          un-burnable weird tokens are held by the hook forever — out of supply
          either way.
        </p>
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------- 4 shield */

export function ShieldVisual() {
  const W = 300;
  const H = 120;
  // pool price path without shield (drops on sell) vs with shield (flat)
  const withShield = "M0,40 L110,40 L150,40 L300,40";
  const without = "M0,40 L110,40 L150,78 L300,78";
  return (
    <Card title="beforeSwap — shield">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <line x1="0" y1="40" x2={W} y2="40" stroke="rgba(23,181,18,.12)" strokeDasharray="4 5" />
        <path d={without} fill="none" stroke="#e23a3a" strokeWidth="2" strokeDasharray="5 5" opacity="0.7" />
        <path d={withShield} fill="none" stroke="#00987f" strokeWidth="2.5" />
        <circle cx="130" cy="40" r="5" fill="#00987f">
          <animate attributeName="r" values="4;7;4" dur="1.8s" repeatCount="indefinite" />
        </circle>
        <text x="136" y="28" fill="#00987f" fontSize="10" fontFamily="monospace">
          sell absorbed by pot
        </text>
        <text x="294" y="95" textAnchor="end" fill="#e23a3a" fontSize="10" fontFamily="monospace" opacity="0.8">
          price without shield
        </text>
        <text x="8" y="106" fill="#8b93a8" fontSize="9" fontFamily="monospace">
          seller gets the pool&apos;s EXACT price
        </text>
        <text x="8" y="117" fill="#8b93a8" fontSize="9" fontFamily="monospace">
          — fee and tick impact included
        </text>
      </svg>
      <div className="mt-3 flex gap-2">
        <span className="pill teal">price does not move</span>
        <span className="pill">pot receives the MAIN</span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- 5 compound */

export function CompoundVisual() {
  const t = useTick(2000);
  const pct = [24, 41, 58, 76, 91][t % 5];
  return (
    <Card title="autocompound + carry">
      <div className="space-y-4 py-1">
        <div className="flex items-end gap-1.5" aria-hidden>
          {Array.from({ length: 14 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-sm"
              style={{
                height: `${18 + i * 4 + (i >= 10 ? (pct / 100) * 20 : 0)}px`,
                background:
                  i >= 10
                    ? "linear-gradient(180deg,#7ab800,#17b512)"
                    : "rgba(23,181,18,.22)",
                boxShadow: i >= 10 ? "0 0 12px rgba(23,181,18,.35)" : undefined,
                transition: "height .5s ease",
              }}
            />
          ))}
        </div>
        <div className="label text-center">position liquidity, harvest after harvest</div>
        <div>
          <div className="mb-1.5 flex justify-between">
            <span className="label">compound share of fees</span>
            <span className="mono text-[11px] text-green">{pct}%</span>
          </div>
          <div className="meter">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <p className="mono text-[11px] leading-relaxed text-dim2">
          the secondary token anchors the mint; whatever can&apos;t be placed this
          round is carried to the next harvest — nothing leaks.
        </p>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- 6 harvest */

export function HarvestVisual() {
  const t = useTick(1100);
  const fill = [15, 34, 52, 71, 88, 100, 8][t % 7];
  const fired = fill === 100;
  return (
    <Card title="auto-harvest">
      <div className="space-y-4 py-1">
        <div className="row">
          <span className="text-dim">fees accrued in position</span>
          <span className="v">{fired ? "harvested ✓" : `${fill}% of min`}</span>
        </div>
        <div className="meter">
          <i
            style={{
              width: `${fill}%`,
              background: fired
                ? "linear-gradient(90deg,#7ab800,#17b512)"
                : "linear-gradient(90deg,rgba(23,181,18,.5),rgba(23,181,18,.8))",
              boxShadow: fired ? "0 0 18px rgba(23,181,18,.8)" : undefined,
            }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {["swap", "swap", fired ? "swap → HARVEST" : "swap"].map((s, i) => (
            <div key={i} className={`flowbox ${fired && i === 2 ? "hot" : ""}`}>
              {s}
            </div>
          ))}
        </div>
        <p className="mono text-[11px] leading-relaxed text-dim2">
          once fees pass the owner&apos;s minimums, the NEXT swap harvests them
          automatically inside its own transaction — no keeper, no cron, no oracle.
        </p>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ 7 fee split */

export function SplitVisual() {
  return (
    <Card title="harvest split — per side">
      <div className="space-y-5 py-1">
        <div>
          <div className="label mb-2 text-teal">secondary side (buyback currency)</div>
          <div className="flex h-8 w-full overflow-hidden rounded-lg">
            <div className="flex items-center justify-center bg-green/80 text-[10px] font-bold text-bg" style={{ width: "35%" }}>
              compound 35%
            </div>
            <div className="flex items-center justify-center bg-teal/80 text-[10px] font-bold text-bg" style={{ width: "40%" }}>
              buyback fuel 40%
            </div>
            <div className="flex items-center justify-center bg-lime/60 text-[10px] font-bold text-bg" style={{ width: "25%" }}>
              recipient 25%
            </div>
          </div>
        </div>
        <div>
          <div className="label mb-2 text-green">main side (defended asset)</div>
          <div className="flex h-8 w-full overflow-hidden rounded-lg">
            <div className="flex items-center justify-center bg-green/80 text-[10px] font-bold text-bg" style={{ width: "30%" }}>
              compound 30%
            </div>
            <div className="flex items-center justify-center bg-bad/70 text-[10px] font-bold text-bg" style={{ width: "25%" }}>
              burn 25%
            </div>
            <div className="flex items-center justify-center bg-lime/60 text-[10px] font-bold text-bg" style={{ width: "45%" }}>
              recipient 45%
            </div>
          </div>
        </div>
        <p className="mono text-[11px] leading-relaxed text-dim2">
          shares are set on the GROSS harvest, per side: compound + buyback ≤ 100%
          on the secondary, compound + burn ≤ 100% on the main. the residual goes
          to one recipient per side. changes only affect FUTURE harvests.
        </p>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- 8 roles */

export function RolesVisual() {
  return (
    <Card title="owner / operator">
      <div className="grid grid-cols-1 gap-3 py-1 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--line2)] bg-green/5 p-4">
          <div className="label mb-2 text-green">owner</div>
          <ul className="mono space-y-1.5 text-[11px] text-dim">
            <li>· holds the liquidity</li>
            <li>· add / remove LP</li>
            <li>· harvest</li>
            <li>· transfer or surrender</li>
          </ul>
          <div className="pill bad mt-3 max-w-full whitespace-normal! text-center">owner = 0x0 → LP locked forever</div>
        </div>
        <div className="rounded-xl border border-[rgba(0,152,127,.3)] bg-teal/5 p-4">
          <div className="label mb-2 text-teal">operator</div>
          <ul className="mono space-y-1.5 text-[11px] text-dim">
            <li>· edits the fee split</li>
            <li>· edits harvest minimums</li>
            <li>· edits recipients</li>
            <li>· surrender independently</li>
          </ul>
          <div className="pill teal mt-3 max-w-full whitespace-normal! text-center">operator = 0x0 → config frozen</div>
        </div>
      </div>
      <p className="mono pt-3 text-[11px] leading-relaxed text-dim2">
        two roles, independently surrenderable — lock the settings without losing
        the property, or lock the property and keep tuning. the hook is not a
        locker; lockers compose on top.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------ 9 integrate */

export function IntegrateVisual() {
  return (
    <Card title="integrate.sol">
      <div className="codeblock text-[11.5px]">
        <span className="c">{"// fuel the pot — one call, no oracle"}</span>
        {"\n"}
        <span className="g">hook</span>.donate{"{"}value: amt{"}"}(key, amt);
        {"\n\n"}
        <span className="c">{"// read the machine before acting"}</span>
        {"\n"}
        (spend, out) = <span className="g">hook</span>.quotePump(key, buySize);
        {"\n"}
        (absorb, paid) = <span className="g">hook</span>.quoteShield(key, sellSize);
        {"\n\n"}
        <span className="c">{"// same address on every chain"}</span>
        {"\n"}
        <span className="t">0xb216070c3509047ea597E2E626A29cea427a60C8</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="pill hi">contract-to-contract</span>
        <span className="pill hi">no price oracle</span>
        <span className="pill teal">2 view quotes</span>
      </div>
    </Card>
  );
}
