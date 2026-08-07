"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ConnectBtn } from "@/components/ConnectBtn";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { CreatePool } from "@/components/app/CreatePool";
import { DexScreenerEmbed } from "@/components/app/DexScreenerEmbed";
import { LiquidityChart } from "@/components/app/LiquidityChart";
import { PoolDashboard, ProgramPositionCard, WalletCard } from "@/components/app/PoolDashboard";
import { NetworkSelect, PoolPicker } from "@/components/app/PoolPicker";
import { PotGauge } from "@/components/app/PotGauge";
import { ProgramInfoCard } from "@/components/app/ProgramInfo";
import { SettingsBox } from "@/components/app/SettingsBox";
import { SimLab } from "@/components/app/SimLab";
import { TradeTape } from "@/components/app/TradeTape";
import { NETS, type Net } from "@/lib/chains";
import { short } from "@/lib/format";
import type { RegisteredPool } from "@/lib/registry";
import { useFeed, usePot, useProgram, useTokenMeta } from "@/lib/usePool";

/** matches Tailwind's `lg` breakpoint — below it the pool view uses its own tabs */
function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 1023px)");
    const sync = () => setMobile(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);
  return mobile;
}

type MobileTab = "info" | "trade" | "charts" | "manage";

function AppInner() {
  const params = useSearchParams();
  const [tab, setTab] = useState<"live" | "simulate">(
    params.get("tab") === "simulate" ? "simulate" : "live",
  );
  const [net, setNet] = useState<Net>(NETS.find((n) => n.slug === "robinhood") ?? NETS[0]);
  const [pool, setPool] = useState<RegisteredPool | null>(null);
  const [creating, setCreating] = useState(false);
  const [mtab, setMtab] = useState<MobileTab>("info");
  const isMobile = useIsMobile();

  const pot = usePot(net, pool?.poolId ?? null);
  const program = useProgram(net, pool?.poolId ?? null);
  const feed = useFeed(net, pool);
  const mainMeta = useTokenMeta(net, pot.data?.main);
  const secMeta = useTokenMeta(net, pot.data?.secondary);

  // a fresh pool always opens on info
  useEffect(() => {
    setMtab("info");
  }, [pool?.poolId]);

  const newPoolBtn = (
    <button
      className="btn btn-primary w-full"
      onClick={() => {
        setPool(null);
        setCreating(true);
      }}
    >
      + new pool (Uniswap V4 + hook)
    </button>
  );

  return (
    <>
      <Nav right={<ConnectBtn />} />

      <main className="mx-auto max-w-7xl px-5 pb-16 pt-28">
        {/* control strip */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <NetworkSelect
              net={net}
              onChange={(n) => {
                setNet(n);
                setPool(null);
              }}
            />
            {pool && (
              <span className="pill hi">
                pool {short(pool.poolId, 6)}
                {pool.key && ` · ${(pool.key.fee / 10_000).toFixed(2)}%`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isMobile && tab === "live" && pool && !creating && (
              <button className="btn btn-ghost btn-sm shrink-0" onClick={() => setPool(null)}>
                ← pools
              </button>
            )}
            <div className="tabbar">
              <button className={tab === "live" ? "on" : ""} onClick={() => setTab("live")}>
                Live
              </button>
              <button className={tab === "simulate" ? "on" : ""} onClick={() => setTab("simulate")}>
                Simulate
              </button>
            </div>
          </div>
        </div>

        {tab === "simulate" ? (
          <SimLab net={net} />
        ) : creating ? (
          <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
            <div className="space-y-6">
              <button className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>
                ← back
              </button>
            </div>
            <div className="space-y-6">
              <CreatePool
                net={net}
                onCreated={(p) => {
                  // straight to the pool's page — the wizard's job is done
                  setPool(p);
                  setCreating(false);
                }}
                onClose={() => setCreating(false)}
              />
            </div>
          </div>
        ) : !pool ? (
          <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
            <div className="space-y-6">
              <PoolPicker net={net} selected={pool} onSelect={(p) => { setPool(p); }} />
            </div>
            <div className="panel flex min-h-[420px] flex-col items-center justify-center gap-5 p-10 text-center">
              <div className="grad-text mono text-4xl font-extrabold">select a pool</div>
              <p className="max-w-md text-[14px] leading-relaxed text-dim">
                pick a hooked pool on the left (or import one by poolId) and
                everything below comes straight from the chain — no backend,
                no indexer, no made-up numbers.
              </p>
              <div className="mono grid max-w-md gap-2 text-left text-[11.5px] text-dim2 sm:grid-cols-2">
                <span className="rounded-lg border border-[var(--line)] bg-panel2 px-3 py-2">
                  📊 reserves &amp; price — read from the PoolManager&apos;s own storage
                </span>
                <span className="rounded-lg border border-[var(--line)] bg-panel2 px-3 py-2">
                  ⛽ pot power — quoted by the hook&apos;s on-chain views
                </span>
                <span className="rounded-lg border border-[var(--line)] bg-panel2 px-3 py-2">
                  📈 liquidity history — rebuilt from the pool&apos;s real events
                </span>
                <span className="rounded-lg border border-[var(--line)] bg-panel2 px-3 py-2">
                  🔄 swap, add &amp; remove — signed by your own wallet
                </span>
              </div>
              <div className="w-full max-w-xs">{newPoolBtn}</div>
            </div>
          </div>
        ) : isMobile ? (
          /* ------------------------------------------- mobile pool view */
          <div className="space-y-4">
            <div className="tabbar w-full !p-[3px]">
              {(["info", "trade", "charts", "manage"] as MobileTab[]).map((t) => (
                <button
                  key={t}
                  className={`flex-1 ${mtab === t ? "on" : ""}`}
                  onClick={() => setMtab(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            {mtab === "info" && (
              <div className="space-y-4">
                <PoolDashboard net={net} pool={pool} pot={pot.data} />
                <ProgramInfoCard net={net} pot={pot.data} program={program.data} />
                <TradeTape
                  net={net}
                  events={feed.events}
                  main={mainMeta.data}
                  sec={secMeta.data}
                  loading={feed.loading}
                />
              </div>
            )}
            {mtab === "trade" && (
              <div className="space-y-4">
                <WalletCard net={net} pool={pool} />
                <SettingsBox
                  net={net}
                  pool={pool}
                  pot={pot.data}
                  program={program.data}
                  sections={["swap", "donate"]}
                />
              </div>
            )}
            {mtab === "charts" && (
              <div className="space-y-4">
                <LiquidityChart events={feed.events} loading={feed.loading} />
                <PotGauge net={net} pool={pool} pot={pot.data} events={feed.events} />
                <DexScreenerEmbed net={net} poolId={pool.poolId} />
              </div>
            )}
            {mtab === "manage" && (
              <div className="space-y-4">
                <ProgramPositionCard net={net} pool={pool} program={program.data} />
                <SettingsBox
                  net={net}
                  pool={pool}
                  pot={pot.data}
                  program={program.data}
                  sections={["add", "manage", "donate"]}
                />
              </div>
            )}
          </div>
        ) : (
          /* ------------------------------------------ desktop pool view */
          <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
            {/* left column */}
            <div className="space-y-6">
              {newPoolBtn}
              <PoolPicker net={net} selected={pool} onSelect={(p) => { setPool(p); }} />
              <ProgramPositionCard net={net} pool={pool} program={program.data} />
              <WalletCard net={net} pool={pool} />
              <SettingsBox net={net} pool={pool} pot={pot.data} program={program.data} />
              <TradeTape
                net={net}
                events={feed.events}
                main={mainMeta.data}
                sec={secMeta.data}
                loading={feed.loading}
              />
            </div>

            {/* right column */}
            <div className="space-y-6">
              <PoolDashboard net={net} pool={pool} pot={pot.data} />
              <LiquidityChart events={feed.events} loading={feed.loading} />
              <PotGauge net={net} pool={pool} pot={pot.data} events={feed.events} />
              <DexScreenerEmbed net={net} poolId={pool.poolId} />
            </div>
          </div>
        )}

      </main>

      <Footer />
    </>
  );
}

export default function AppPage() {
  return (
    <Suspense>
      <AppInner />
    </Suspense>
  );
}
