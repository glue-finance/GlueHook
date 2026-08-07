"use client";

import { maxUint256, zeroAddress } from "viem";
import { useAccount } from "wagmi";
import type { Net } from "@/lib/chains";
import { ftoken, short } from "@/lib/format";
import { isNative, type Pot, type Program } from "@/lib/hook";
import { useTokenMeta } from "@/lib/usePool";

/* Read-only "how is this pool configured" panel — compact and visual.
 * Desktop: the `info` tab of the settings box. Mobile: its own card in the
 * Info tab. Same body both ways. */

const C_COMPOUND = "#17b512"; // green — back into the position
const C_BUYBACK = "#00987f"; // teal — into the pot
const C_BURN = "#e23a3a"; // red — out of supply
const C_REST = "#98a0b3"; // gray — delivered to the recipient

function pct(wad: bigint): number {
  return Number(wad / 10n ** 14n) / 100;
}

function fpct(p: number): string {
  return `${p % 1 === 0 ? p.toFixed(0) : p.toFixed(1)}%`;
}

/* ------------------------------------------------------------- donut --- */

type Slice = { label: string; v: number; color: string };

function Donut({ title, slices }: { title: string; slices: Slice[] }) {
  const R = 30;
  const C = 2 * Math.PI * R;
  const live = slices.filter((s) => s.v > 0);
  const top = live.length > 0 ? live.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  let acc = 0;
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--line)] bg-panel2 px-2 py-3">
      <svg width="86" height="86" viewBox="0 0 86 86" className="-rotate-90">
        {/* empty track */}
        <circle cx="43" cy="43" r={R} fill="none" stroke="rgba(28,36,71,.08)" strokeWidth="11" />
        {live.map((s) => {
          const from = (acc / 100) * C;
          acc += s.v;
          return (
            <circle
              key={s.label}
              cx="43"
              cy="43"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="11"
              strokeDasharray={`${(s.v / 100) * C} ${C}`}
              strokeDashoffset={-from}
              style={{ transition: "stroke-dasharray .6s ease, stroke-dashoffset .6s ease" }}
            />
          );
        })}
        {/* center readout (un-rotate) */}
        <g transform="rotate(90 43 43)">
          <text x="43" y="47" textAnchor="middle" fontSize="14" fontWeight="800" fontFamily="var(--font-mono)" fill={top?.color ?? "#98a0b3"}>
            {top ? fpct(top.v) : "—"}
          </text>
        </g>
      </svg>
      <div className="label text-center leading-tight">{title}</div>
      <div className="w-full space-y-0.5">
        {slices.map((s) => (
          <div key={s.label} className="mono flex items-center justify-between gap-1 text-[9.5px]">
            <span className="flex min-w-0 items-center gap-1 text-dim2">
              <i className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: s.color, opacity: s.v > 0 ? 1 : 0.3 }} />
              <span className="truncate">{s.label}</span>
            </span>
            <span className={`flex-shrink-0 font-bold ${s.v > 0 ? "text-txt" : "text-dim2"}`}>{fpct(s.v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- role chips --- */

function RoleChip({
  label,
  value,
  tone = "plain",
  you,
}: {
  label: string;
  value: string;
  tone?: "plain" | "bad" | "warn" | "green";
  you?: boolean;
}) {
  const toneCls =
    tone === "bad"
      ? "border-bad/40 bg-bad/5 text-bad"
      : tone === "warn"
        ? "border-warn/40 bg-warn/5 text-warn"
        : tone === "green"
          ? "border-green/40 bg-green/5 text-green"
          : "border-[var(--line)] bg-panel2 text-txt";
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneCls}`}>
      <div className="label mb-0.5 !text-dim2">{label}</div>
      <div className="mono truncate text-[11.5px] font-bold">
        {value}
        {you && <span className="text-green"> ✓ you</span>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- body --- */

export function ProgramInfo({
  net,
  pot,
  program,
}: {
  net: Net;
  pot: Pot | undefined;
  program: Program | undefined;
}) {
  const { address: me } = useAccount();
  const main = useTokenMeta(net, pot?.main);
  const sec = useTokenMeta(net, pot?.secondary);
  const mainSym = main.data?.symbol ?? "MAIN";
  const secSym = sec.data?.symbol ?? "SECONDARY";
  const mainDec = main.data?.decimals ?? 18;
  const secDec = sec.data?.decimals ?? 18;

  const exists = program?.exists ?? false;
  const isYou = (a?: string) => !!me && !!a && a.toLowerCase() === me.toLowerCase();
  const potBurns = !!pot && pot.recipient === zeroAddress;

  const compound = exists ? pct(program!.compoundShareWad) : 0;
  const buyback = exists ? pct(program!.buybackShareWad) : 0;
  const burn = exists ? pct(program!.burnShareWad) : 0;
  const potCompound = exists ? pct(program!.potCompoundShareWad) : 0;
  const potBurn = exists ? pct(program!.potBurnShareWad) : 0;
  const potRest = Math.max(0, 100 - potCompound - potBurn);

  return (
    <div className="space-y-4">
      {/* who runs what — compact chips */}
      <div className="grid grid-cols-2 gap-2">
        <RoleChip
          label="owner"
          value={!exists ? "—" : program!.owner === zeroAddress ? "locked forever" : short(program!.owner)}
          tone={exists && program!.owner === zeroAddress ? "bad" : "plain"}
          you={exists && isYou(program!.owner)}
        />
        <RoleChip
          label="operator"
          value={!exists ? "—" : program!.operator === zeroAddress ? "config frozen" : short(program!.operator)}
          tone={exists && program!.operator === zeroAddress ? "warn" : "plain"}
          you={exists && isYou(program!.operator)}
        />
        <RoleChip
          label="pot admin"
          value={pot ? short(pot.admin) : "—"}
          you={isYou(pot?.admin)}
        />
        <RoleChip
          label="buyback goes to"
          value={potBurns ? "🔥 BURN" : pot ? short(pot.recipient) : "—"}
          tone={potBurns ? "bad" : "plain"}
          you={!potBurns && isYou(pot?.recipient)}
        />
      </div>

      {!exists ? (
        <p className="mono rounded-xl border border-[var(--line)] bg-panel2 px-3 py-2.5 text-[11px] leading-relaxed text-dim2">
          no LP program yet — the pot (donate, pump, shield) works anyway, and
          its whole output goes {potBurns ? "to the burn cascade 🔥" : `to ${pot ? short(pot.recipient) : "…"}`}.
        </p>
      ) : (
        <>
          {/* the three splits — donuts, like the sim page */}
          <div className="grid grid-cols-3 gap-2">
            <Donut
              title={`${secSym} fees`}
              slices={[
                { label: "compound", v: compound, color: C_COMPOUND },
                { label: "buyback", v: buyback, color: C_BUYBACK },
                {
                  label: program!.secondaryRecipient === zeroAddress ? "recipient" : short(program!.secondaryRecipient),
                  v: Math.max(0, 100 - compound - buyback),
                  color: C_REST,
                },
              ]}
            />
            <Donut
              title={`${mainSym} fees`}
              slices={[
                { label: "compound", v: compound, color: C_COMPOUND },
                { label: "burn", v: burn, color: C_BURN },
                {
                  label: program!.mainRecipient === zeroAddress ? "recipient" : short(program!.mainRecipient),
                  v: Math.max(0, 100 - compound - burn),
                  color: C_REST,
                },
              ]}
            />
            <Donut
              title="buyback out"
              slices={[
                { label: "compound", v: potCompound, color: C_COMPOUND },
                { label: "burn", v: potBurn, color: C_BURN },
                {
                  label: potBurns ? "burn 🔥" : pot ? short(pot.recipient) : "recipient",
                  v: potRest,
                  color: potBurns ? C_BURN : C_REST,
                },
              ]}
            />
          </div>

          {/* auto-harvest — one pill row */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="pill">
              min {mainSym}:{" "}
              {program!.minMain === maxUint256 ? "off" : ftoken(program!.minMain, mainDec)}
            </span>
            <span className="pill">
              min {secSym}:{" "}
              {program!.minSecondary === maxUint256 ? "off" : ftoken(program!.minSecondary, secDec)}
            </span>
            <span className={`pill ${program!.publicHarvest || program!.owner === zeroAddress ? "hi" : ""}`}>
              harvest: {program!.publicHarvest || program!.owner === zeroAddress ? "public" : "owner"}
            </span>
          </div>
        </>
      )}

      <p className="mono text-[10px] leading-relaxed text-dim2">
        {pot && isNative(pot.main)
          ? `${mainSym} is native — burn shares are impossible on this pool by design.`
          : "read live from the hook — nothing cached, nothing off-chain."}
      </p>
    </div>
  );
}

/** Standalone card wrapper (mobile Info tab) — same body, own panel. */
export function ProgramInfoCard(props: {
  net: Net;
  pot: Pot | undefined;
  program: Program | undefined;
}) {
  return (
    <div className="panel">
      <div className="chead">
        <span>pool settings</span>
        <span className="pill hi">live</span>
      </div>
      <div className="p-4">
        <ProgramInfo {...props} />
      </div>
    </div>
  );
}
