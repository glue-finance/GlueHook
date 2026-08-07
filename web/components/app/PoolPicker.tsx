"use client";

import { useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { useAccount } from "wagmi";
import { MAINNETS, TESTNETS, type Net } from "@/lib/chains";
import { NetIcon } from "@/components/NetIcon";
import { short } from "@/lib/format";
import type { RegisteredPool } from "@/lib/registry";
import { usePoolList, useTokenMeta } from "@/lib/usePool";
import { PairIcons } from "./TokenIcon";

export function NetworkSelect({ net, onChange }: { net: Net; onChange: (n: Net) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const Section = ({ title, nets }: { title: string; nets: readonly Net[] }) => (
    <div>
      <div className="label px-3 pb-1 pt-3">{title}</div>
      <div className="grid grid-cols-2 gap-1 px-2 pb-2">
        {nets.map((n) => {
          const active = n.slug === net.slug;
          return (
            <button
              key={n.slug}
              onClick={() => {
                onChange(n);
                setOpen(false);
              }}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold transition-colors ${
                active ? "bg-magenta/10 text-magenta" : "text-txt hover:bg-[rgba(28,36,71,0.06)]"
              }`}
            >
              <NetIcon slug={n.slug} label={n.label} chainId={n.chain.id} size={18} />
              <span className="truncate">{n.label}</span>
              {active && <span className="ml-auto text-magenta">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 rounded-full border-2 border-txt bg-white px-4 py-2.5 text-[14px] font-extrabold shadow-[0_3px_0_var(--t-txt)] transition-all hover:-translate-y-[1px] hover:shadow-[0_4px_0_var(--t-txt)]"
      >
        <NetIcon slug={net.slug} label={net.label} chainId={net.chain.id} size={20} />
        {net.label}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="panel panel-hi absolute left-0 top-[calc(100%+8px)] z-40 max-h-[70vh] w-[340px] overflow-y-auto">
          <Section title="mainnets" nets={MAINNETS} />
          <div className="mx-3 border-t border-[var(--line)]" />
          <Section title="testnets" nets={TESTNETS} />
        </div>
      )}
    </div>
  );
}

function PoolRow({
  net,
  pool,
  selected,
  mine,
  onSelect,
}: {
  net: Net;
  pool: RegisteredPool;
  selected: boolean;
  mine: boolean;
  onSelect: () => void;
}) {
  const c0 = useTokenMeta(net, pool.key?.currency0);
  const c1 = useTokenMeta(net, pool.key?.currency1);
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
        selected ? "bg-green/10 shadow-[inset_0_0_0_1px_var(--line2)]" : "hover:bg-green/5"
      }`}
    >
      <span className="mono flex items-center gap-2.5 text-[12.5px] text-txt">
        {pool.key && (
          <PairIcons
            net={net}
            a={pool.key.currency0}
            b={pool.key.currency1}
            symA={c0.data?.symbol ?? "?"}
            symB={c1.data?.symbol ?? "?"}
            size={22}
          />
        )}
        {pool.key
          ? `${c0.data?.symbol ?? "…"} / ${c1.data?.symbol ?? "…"}`
          : short(pool.poolId, 6)}
      </span>
      <span className="mono flex items-center gap-2 text-[10.5px] text-dim2">
        {mine && <span className="pill hi">yours</span>}
        {pool.key && <span className="pill">{(pool.key.fee / 10_000).toFixed(2)}%</span>}
        {short(pool.poolId)}
      </span>
    </button>
  );
}

export function PoolPicker({
  net,
  selected,
  onSelect,
}: {
  net: Net;
  selected: RegisteredPool | null;
  onSelect: (p: RegisteredPool) => void;
}) {
  const { data: pools, isLoading, progress, importById, refetch } = usePoolList(net);
  const { address: me } = useAccount();
  // your pools first — "yours" == the wallet that opened the pot (real Initialize data)
  const sorted = me
    ? [...(pools ?? [])].sort((a, b) => {
        const am = a.admin?.toLowerCase() === me.toLowerCase() ? 0 : 1;
        const bm = b.admin?.toLowerCase() === me.toLowerCase() ? 0 : 1;
        return am - bm;
      })
    : pools ?? [];
  const [importId, setImportId] = useState("");
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function doImport() {
    setImportErr(null);
    const id = importId.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) {
      setImportErr("a poolId is 32 bytes: 0x + 64 hex chars");
      return;
    }
    setImporting(true);
    try {
      const p = await importById(id as Hex);
      if (p) onSelect(p);
      else setImportErr("pool not found on this network (no Initialize event for this id)");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="panel">
      <div className="chead">
        <span>pools on {net.label}</span>
        <button className="mono text-[10px] uppercase tracking-wider text-dim hover:text-green" onClick={() => refetch()}>
          rescan ⟳
        </button>
      </div>
      <div className="space-y-1 p-2">
        {isLoading && (
          <div className="mono px-3 py-6 text-center text-[12px] text-dim2">
            scanning PotOpened logs{progress !== null ? ` — ${progress}%` : ""}…
          </div>
        )}
        {!isLoading && (pools?.length ?? 0) === 0 && (
          <div className="mono px-3 py-6 text-center text-[12px] leading-relaxed text-dim2">
            no hooked pools on {net.label} yet.
            <br />
            be the first — or import one by poolId below.
          </div>
        )}
        {sorted.map((p) => (
          <PoolRow
            key={p.poolId}
            net={net}
            pool={p}
            selected={selected?.poolId === p.poolId}
            mine={!!me && p.admin?.toLowerCase() === me.toLowerCase()}
            onSelect={() => onSelect(p)}
          />
        ))}
      </div>
      <div className="border-t border-[var(--line)] p-3">
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="import by poolId (0x…)"
            value={importId}
            onChange={(e) => setImportId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doImport()}
          />
          <button className="btn btn-ghost btn-sm flex-shrink-0" onClick={doImport} disabled={importing}>
            {importing ? "…" : "import"}
          </button>
        </div>
        {importErr && <div className="mono mt-2 text-[11px] text-bad">{importErr}</div>}
      </div>
    </div>
  );
}
