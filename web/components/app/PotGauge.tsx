"use client";

import { useMemo } from "react";
import { formatUnits } from "viem";
import type { Net } from "@/lib/chains";
import { burnedSeries, potSeries } from "@/lib/derive";
import type { PoolEvent } from "@/lib/events";
import { fnum, ftoken } from "@/lib/format";
import type { Pot } from "@/lib/hook";
import { useQuoteCurves, useTokenMeta } from "@/lib/usePool";
import { usePoolState } from "@/lib/usePoolState";
import type { RegisteredPool } from "@/lib/registry";
import { LineChart } from "./LineChart";

export function PotGauge({
  net,
  pool,
  pot,
  events,
}: {
  net: Net;
  pool: RegisteredPool;
  pot: Pot | undefined;
  events: PoolEvent[];
}) {
  const secMeta = useTokenMeta(net, pot?.secondary);
  const mainMeta = useTokenMeta(net, pot?.main);
  const state = usePoolState(net, pool.poolId);
  const dec = secMeta.data?.decimals ?? 18;
  const mainDec = mainMeta.data?.decimals ?? 18;
  const sym = secMeta.data?.symbol ?? "SEC";
  const mainSym = mainMeta.data?.symbol ?? "MAIN";

  const mainIs0 = !!pot && !!pool.key && pot.main === pool.key.currency0;
  const curves = useQuoteCurves(net, pool.key, pot?.balance, state.data?.sqrtPriceX96, mainIs0);

  const balSeries = useMemo(() => {
    // series is built in raw units (event data is raw), displayed in tokens
    const curRaw = pot ? Number(pot.balance) : undefined;
    return potSeries(events, curRaw).map((p) => ({ t: p.t, v: p.v / 10 ** dec }));
  }, [events, pot, dec]);

  // cumulative main out of circulation forever (burn cascade), in main tokens
  const burned = useMemo(
    () => burnedSeries(events).map((p) => ({ t: p.t, v: p.v / 10 ** mainDec })),
    [events, mainDec],
  );

  // attack: pot spend (secondary) vs carrying buy size (secondary)
  // defense: main absorbed vs main sell size — MAIN decimals on both axes
  const { attack, defense } = useMemo(() => {
    if (!curves.data) return { attack: [], defense: [] };
    const dSec = (x: bigint) => Number(formatUnits(x, dec));
    const dMain = (x: bigint) => Number(formatUnits(x, mainDec));
    return {
      attack: curves.data.pump.map((p) => ({ t: dSec(p.size), v: dSec(p.spend) })),
      defense: curves.data.shield.map((p) => ({ t: dMain(p.size), v: dMain(p.absorbed) })),
    };
  }, [curves.data, dec, mainDec]);

  // lifetime firepower actually deployed: pump spend + shield payments, both
  // denominated in the secondary currency (the pot's own unit)
  const totalDeployed = useMemo(() => {
    let sum = 0n;
    for (const e of events) {
      if (e.kind === "Pumped") sum += BigInt(e.data.spent ?? "0");
      else if (e.kind === "Shielded") sum += BigInt(e.data.paid ?? "0");
    }
    return sum;
  }, [events]);

  const fullCover = useMemo(() => {
    if (!curves.data) return null;
    let last: bigint | null = null;
    for (const s of curves.data.shield) {
      if (s.absorbed >= s.size) last = s.size;
      else break;
    }
    return last;
  }, [curves.data]);

  return (
    <div className="panel">
      <div className="chead">
        <span>pot power</span>
        <span className="pill hi" title="total spent on buybacks + sell defense">
          {pot ? `${ftoken(totalDeployed, dec)} ${sym} deployed` : "…"}
        </span>
      </div>
      <div className="space-y-5 p-4">
        <div>
          <div className="label mb-2">pot balance over time</div>
          <LineChart
            series={[{ points: balSeries, color: "#fe0087", fill: true }]}
            height={130}
            yFormat={fnum}
            unit={sym}
            empty="no pot activity yet"
            lastChip={false}
          />
        </div>

        {burned.length > 1 && (
          <div>
            <div className="label mb-2" style={{ color: "#e2571e" }}>
              burned forever — cumulative
            </div>
            <LineChart
              series={[{ points: burned, color: "#e2571e", fill: true }]}
              height={120}
              yFormat={fnum}
              unit={mainSym}
            />
            <p className="mono mt-1 px-1 text-[10px] leading-relaxed text-dim2">
              {mainSym} permanently removed from circulation through the burn
              cascade — buyback burns and harvest burns combined.
            </p>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <div className="label mb-2 text-green">
              attack — pump spend vs buy size
            </div>
            <LineChart
              series={[{ points: attack, color: "#17b512", fill: true }]}
              height={120}
              yFormat={fnum}
              unit={sym}
              empty={pot && pot.balance === 0n ? "pot is empty" : "quoting…"}
            />
            <p className="mono mt-1 px-1 text-[10px] leading-relaxed text-dim2">
              {sym} the pot spends alongside a buy of a given size — the 80%
              haircut and the buy-size cap flatten the top.
            </p>
          </div>
          <div>
            <div className="label mb-2 text-teal">
              defense — sell absorption capacity
            </div>
            <LineChart
              series={[{ points: defense, color: "#00987f", fill: true }]}
              height={120}
              yFormat={fnum}
              unit={mainSym}
              empty={pot && pot.balance === 0n ? "pot is empty" : "quoting…"}
            />
            <p className="mono mt-1 px-1 text-[10px] leading-relaxed text-dim2">
              {fullCover !== null && fullCover !== undefined
                ? `sells up to ~${ftoken(fullCover, mainDec)} ${mainSym} are fully absorbed at the pool's exact price.`
                : `${mainSym} the pot eats out of a sell before the rest hits the pool.`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
