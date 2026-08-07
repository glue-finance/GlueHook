"use client";

import { maxUint256, zeroAddress } from "viem";
import { useAccount } from "wagmi";
import type { Net } from "@/lib/chains";
import { ftoken, short } from "@/lib/format";
import { isNative, type Pot, type Program } from "@/lib/hook";
import { useTokenMeta } from "@/lib/usePool";

/* Read-only "how is this pool configured" panel. Desktop: the `info` tab of
 * the settings box. Mobile: its own card in the Info tab. Same body both ways. */

const C_COMPOUND = "#17b512"; // green — back into the position
const C_BUYBACK = "#00987f"; // teal — into the pot
const C_BURN = "#e23a3a"; // red — out of supply
const C_REST = "#8b93a8"; // gray — delivered to the recipient

function pct(wad: bigint): number {
  // WAD → percent with 2 decimals of precision
  return Number(wad / 10n ** 14n) / 100;
}

function fpct(p: number): string {
  return `${p % 1 === 0 ? p.toFixed(0) : p.toFixed(2)}%`;
}

function SplitBar({
  title,
  parts,
}: {
  title: string;
  parts: { label: string; pctV: number; color: string; note?: string }[];
}) {
  const shown = parts.filter((p) => p.pctV > 0);
  return (
    <div>
      <div className="label mb-2">{title}</div>
      <div className="flex h-3 w-full overflow-hidden rounded-full border border-[var(--line)] bg-panel2">
        {shown.length === 0 ? (
          <div className="h-full w-full" style={{ background: "repeating-linear-gradient(45deg,transparent,transparent 6px,rgba(139,147,168,.15) 6px,rgba(139,147,168,.15) 12px)" }} />
        ) : (
          shown.map((p) => (
            <div
              key={p.label}
              className="h-full"
              style={{ width: `${p.pctV}%`, background: p.color }}
            />
          ))
        )}
      </div>
      <div className="mt-2 space-y-1">
        {parts.map((p) => (
          <div key={p.label} className="mono flex items-center justify-between gap-3 text-[11px]">
            <span className="flex min-w-0 items-center gap-2 text-dim">
              <i className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="truncate">
                {p.label}
                {p.note && <span className="text-dim2"> · {p.note}</span>}
              </span>
            </span>
            <span className="flex-shrink-0 font-bold text-txt">{fpct(p.pctV)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoleRow({
  label,
  addr,
  me,
  surrenderedText,
  surrenderedTone,
}: {
  label: string;
  addr?: string;
  me?: string;
  surrenderedText: string;
  surrenderedTone: "bad" | "warn";
}) {
  if (!addr) return null;
  const surrendered = addr === zeroAddress;
  return (
    <div className="row">
      <span className="text-dim">{label}</span>
      <span className="v">
        {surrendered ? (
          <span className={surrenderedTone === "bad" ? "text-bad" : "text-warn"}>{surrenderedText}</span>
        ) : (
          <>
            {short(addr)}
            {me && addr.toLowerCase() === me.toLowerCase() && <span className="text-green"> (you)</span>}
          </>
        )}
      </span>
    </div>
  );
}

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

  // pot output split (pump + shield) — lives on the program; without one the
  // whole output flows to the pot recipient (or the burn cascade on 0x0)
  const potCompound = exists ? pct(program!.potCompoundShareWad) : 0;
  const potBurn = exists ? pct(program!.potBurnShareWad) : 0;
  const potRest = Math.max(0, 100 - potCompound - potBurn);
  const potRecipientIsBurn = !!pot && pot.recipient === zeroAddress;
  const potRestLabel = potRecipientIsBurn
    ? "burn cascade (recipient = 0x0)"
    : `recipient ${pot ? short(pot.recipient) : "…"}`;

  return (
    <div className="space-y-6">
      {/* roles */}
      <div className="space-y-1">
        <RoleRow label="owner" addr={program?.exists ? program.owner : undefined} me={me} surrenderedText="surrendered — LP locked forever" surrenderedTone="bad" />
        <RoleRow label="operator" addr={program?.exists ? program.operator : undefined} me={me} surrenderedText="surrendered — config frozen" surrenderedTone="warn" />
        <RoleRow label="pot admin" addr={pot?.admin} me={me} surrenderedText="surrendered" surrenderedTone="warn" />
        {pot && (
          <div className="row">
            <span className="text-dim">pot recipient</span>
            <span className="v">
              {potRecipientIsBurn ? <span className="text-bad">BURN (cascade)</span> : short(pot.recipient)}
            </span>
          </div>
        )}
      </div>

      {!exists ? (
        <p className="mono text-[11.5px] leading-relaxed text-dim2">
          no LP program on this pool yet — the pot (donations, pump, shield)
          works regardless, and its whole output goes to{" "}
          {potRecipientIsBurn ? "the burn cascade" : `the recipient ${pot ? short(pot.recipient) : "…"}`}.
          once a program exists, its settings appear here.
        </p>
      ) : (
        <>
          {/* the three splits, one bar each */}
          <SplitBar
            title={`LP fees — ${secSym} side`}
            parts={[
              { label: "compound → position", pctV: pct(program!.compoundShareWad), color: C_COMPOUND },
              { label: "buyback → pot", pctV: pct(program!.buybackShareWad), color: C_BUYBACK },
              {
                label:
                  program!.secondaryRecipient === zeroAddress
                    ? "rest — no recipient"
                    : `rest → ${short(program!.secondaryRecipient)}`,
                pctV: Math.max(0, 100 - pct(program!.compoundShareWad) - pct(program!.buybackShareWad)),
                color: C_REST,
              },
            ]}
          />
          <SplitBar
            title={`LP fees — ${mainSym} side`}
            parts={[
              { label: "compound → position", pctV: pct(program!.compoundShareWad), color: C_COMPOUND },
              { label: "burn → cascade", pctV: pct(program!.burnShareWad), color: C_BURN },
              {
                label:
                  program!.mainRecipient === zeroAddress
                    ? "rest — no recipient"
                    : `rest → ${short(program!.mainRecipient)}`,
                pctV: Math.max(0, 100 - pct(program!.compoundShareWad) - pct(program!.burnShareWad)),
                color: C_REST,
              },
            ]}
          />
          <SplitBar
            title={`buyback output (pump + shield, in ${mainSym})`}
            parts={[
              { label: "compound → position carry", pctV: potCompound, color: C_COMPOUND },
              { label: "burn → cascade", pctV: potBurn, color: C_BURN },
              { label: potRestLabel, pctV: potRest, color: potRecipientIsBurn ? C_BURN : C_REST },
            ]}
          />

          {/* auto-harvest */}
          <div className="space-y-1">
            <div className="label mb-1.5">auto-harvest</div>
            <div className="row">
              <span className="text-dim">min {mainSym}</span>
              <span className="v">
                {program!.minMain === maxUint256 ? (
                  <span className="text-warn">disarmed</span>
                ) : (
                  `${ftoken(program!.minMain, mainDec)} ${mainSym}`
                )}
              </span>
            </div>
            <div className="row">
              <span className="text-dim">min {secSym}</span>
              <span className="v">
                {program!.minSecondary === maxUint256 ? (
                  <span className="text-warn">disarmed</span>
                ) : (
                  `${ftoken(program!.minSecondary, secDec)} ${secSym}`
                )}
              </span>
            </div>
            <div className="row">
              <span className="text-dim">manual harvest</span>
              <span className="v">
                {program!.publicHarvest || program!.owner === zeroAddress ? (
                  <span className="text-green">public — anyone</span>
                ) : (
                  "owner only"
                )}
              </span>
            </div>
          </div>
        </>
      )}

      <p className="mono text-[10.5px] leading-relaxed text-dim2">
        {pot && isNative(pot.main)
          ? `${mainSym} is native — burn shares are not allowed on this pool by design.`
          : "every number above is read live from the hook — nothing is cached or off-chain."}
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
      <div className="border-b border-[var(--line)] px-5 py-3">
        <span className="label">pool settings</span>
      </div>
      <div className="p-5">
        <ProgramInfo {...props} />
      </div>
    </div>
  );
}
