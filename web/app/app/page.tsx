"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Hex } from "viem";
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
import { NETS, netBySlug, type Net } from "@/lib/chains";
import { short } from "@/lib/format";
import { importPool, type RegisteredPool } from "@/lib/registry";
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
type Tab = "live" | "simulate";

const DEFAULT_NET = NETS.find((n) => n.slug === "robinhood") ?? NETS[0];
const POOL_ID = /^0x[0-9a-fA-F]{64}$/;

/**
 * The app's whole view state lives in the URL: `?chain=<slug>&pool=<poolId>`
 * (plus `tab=simulate`). A pool is identified by its poolId AND its chain —
 * the same id means nothing without knowing which chain to read it from — so
 * both have to travel together for a link to be shareable.
 */
function hrefFor(net: Net, poolId: string | null, tab: Tab) {
  const sp = new URLSearchParams();
  sp.set("chain", net.slug);
  if (poolId) sp.set("pool", poolId);
  if (tab === "simulate") sp.set("tab", "simulate");
  return `${window.location.pathname}?${sp}`;
}

/**
 * Share the current view. The URL already IS the pool (chain + poolId), so
 * there is nothing to build here — it hands off to the OS share sheet where
 * one exists (phones) and falls back to the clipboard everywhere else.
 */
function ShareButton({ label }: { label: string }) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1_800);
    return () => clearTimeout(t);
  }, [done]);

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: label, url });
        return;
      } catch {
        // dismissed, or the sheet refused — fall through to the clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setDone(true);
    } catch {
      /* clipboard blocked (insecure origin) — nothing useful to do */
    }
  }

  return (
    <button className="btn btn-ghost btn-sm shrink-0" title="copy a link to this pool" onClick={share}>
      {done ? (
        "link copied ✓"
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M9 2h5v5M14 2L7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          share
        </span>
      )}
    </button>
  );
}

function AppInner() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get("tab") === "simulate" ? "simulate" : "live");
  const [net, setNet] = useState<Net>(() => netBySlug(params.get("chain") ?? "") ?? DEFAULT_NET);
  const [pool, setPool] = useState<RegisteredPool | null>(null);
  const [creating, setCreating] = useState(false);
  const [mtab, setMtab] = useState<MobileTab>("info");
  const isMobile = useIsMobile();

  // a shared link names a pool the picker may not have scanned yet, so it is
  // resolved on its own (importPool answers from cache when it can)
  const [opening, setOpening] = useState(() => POOL_ID.test(params.get("pool") ?? ""));

  /** Adopt whatever the address bar currently says — mount and back/forward. */
  const openRef = useRef(0);
  const applyUrl = useCallback(async () => {
    const sp = new URLSearchParams(window.location.search);
    const n = netBySlug(sp.get("chain") ?? "") ?? DEFAULT_NET;
    const id = sp.get("pool") ?? "";
    setNet(n);
    setTab(sp.get("tab") === "simulate" ? "simulate" : "live");
    setCreating(false);

    if (!POOL_ID.test(id)) {
      setPool(null);
      setOpening(false);
      return;
    }
    // stamp the attempt so a slow resolve can never overwrite a newer one
    const ticket = ++openRef.current;
    setOpening(true);
    try {
      const p = await importPool(n, id as Hex);
      if (ticket === openRef.current) setPool(p);
    } finally {
      if (ticket === openRef.current) setOpening(false);
    }
  }, []);

  useEffect(() => {
    applyUrl();
    window.addEventListener("popstate", applyUrl);
    return () => window.removeEventListener("popstate", applyUrl);
  }, [applyUrl]);

  // ...and write it back whenever the view moves. Landing on a different pool
  // or chain is a real navigation (push, so Back returns to the list); flipping
  // Live/Simulate is not (replace).
  const lastIdRef = useRef<string | null>(null);
  useEffect(() => {
    // never write while a link is still being opened: `pool` is legitimately
    // null mid-resolve, and writing that would erase the very id being loaded
    if (opening) return;
    const id = `${net.slug}|${pool?.poolId ?? ""}`;
    const href = hrefFor(net, pool?.poolId ?? null, tab);
    if (href !== window.location.pathname + window.location.search) {
      if (lastIdRef.current === null || lastIdRef.current === id) {
        window.history.replaceState(null, "", href);
      } else {
        window.history.pushState(null, "", href);
      }
    }
    lastIdRef.current = id;
  }, [net, pool?.poolId, tab, opening]);

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
              <>
                <span className="pill hi">
                  pool {short(pool.poolId, 6)}
                  {pool.key && ` · ${(pool.key.fee / 10_000).toFixed(2)}%`}
                </span>
                <ShareButton label={`${net.label} pool ${short(pool.poolId, 6)}`} />
              </>
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
            {opening ? (
              <div className="panel flex min-h-[420px] flex-col items-center justify-center gap-4 p-10 text-center">
                <div className="grad-text mono text-3xl font-extrabold">opening pool…</div>
                <p className="mono max-w-md text-[12px] leading-relaxed text-dim2">
                  reading {short(params.get("pool") ?? "", 8)} from {net.label}
                </p>
              </div>
            ) : (
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
            )}
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
