"use client";

import { useMemo, useState } from "react";
import type { Net } from "@/lib/chains";
import { BURN_MODES, type PoolEvent } from "@/lib/events";
import { ago, ftoken, short } from "@/lib/format";
import type { TokenMeta } from "@/lib/usePool";
import { ScanBar } from "./ScanBar";

const STYLE: Record<string, { color: string; label: string }> = {
  Pumped: { color: "#17b512", label: "PUMP" },
  Shielded: { color: "#00987f", label: "SHIELD" },
  Donated: { color: "#7ab800", label: "DONATE" },
  Harvested: { color: "#cf9700", label: "HARVEST" },
  Compounded: { color: "#fe0087", label: "COMPOUND" },
  ProgramLiquidityAdded: { color: "#a5b6a1", label: "LP+" },
  ProgramLiquidityRemoved: { color: "#e23a3a", label: "LP−" },
  ProgramCreated: { color: "#a5b6a1", label: "PROGRAM" },
};

function styleOf(e: PoolEvent): { color: string; label: string } {
  if (e.kind === "Delivered") {
    // burn legs stand apart from ordinary recipient payouts and the carry credit
    if (BURN_MODES.has(e.data.mode ?? "")) return { color: "#e2571e", label: "BURNED" };
    if (e.data.mode === "5") return { color: "#b86bcf", label: "CARRY" };
    return { color: "#a5b6a1", label: "PAYOUT" };
  }
  return STYLE[e.kind] ?? { color: "#a5b6a1", label: e.kind };
}

/** What each action MEANS — shown when hovering the badge in the tape. */
const EXPLAIN: Record<string, string> = {
  PUMP: "the pot spent its secondary to buy main inside a buyer's swap — extra buy pressure lands on every buy",
  SHIELD: "the pot absorbed part of a sell at the pool's own price, so less sell pressure ever reaches the pool",
  DONATE: "someone sent secondary straight into the pot — anyone can fuel the buyback firepower",
  HARVEST: "the program's accrued LP fees were collected and split by the pool's own rules (compound, burn, buyback, recipient)",
  COMPOUND: "collected fees were re-minted into the pool's own liquidity — the position grows itself",
  BURNED: "main removed from circulation forever through the burn cascade (own burn, 0xdead, or held on the hook with no exit)",
  CARRY: "buyback output credited to the compound carry — it becomes the pool's own liquidity at the next harvest",
  PAYOUT: "a delivery leg pushed to the pool's configured recipient (or parked for a retry if it refused)",
  "LP+": "liquidity added to the program position",
  "LP−": "liquidity removed from the program position by its owner",
  PROGRAM: "the pool's LP program was created — the machine switched on",
};

function describe(e: PoolEvent, main?: TokenMeta, sec?: TokenMeta): string {
  const S = (x?: string, m?: TokenMeta) => (x ? ftoken(BigInt(x), m?.decimals ?? 18) : "0");
  switch (e.kind) {
    case "Delivered": {
      const amt = `${S(e.data.amount, main)} ${main?.symbol ?? ""}`;
      switch (e.data.mode) {
        case "1": return `${amt} burned 🔥`;
        case "2": return `${amt} sent to 0xdead 🔥`;
        case "3": return `${amt} locked on the hook forever 🔥`;
        case "5": return `${amt} credited to the compound carry`;
        case "4": return `${amt} parked for the recipient (retryable)`;
        default: return `${amt} delivered to ${short(e.data.to ?? "")}`;
      }
    }
    case "Pumped":
      return `spent ${S(e.data.spent, sec)} ${sec?.symbol ?? ""} → bought ${S(e.data.bought, main)} ${main?.symbol ?? ""}`;
    case "Shielded":
      return `absorbed ${S(e.data.absorbed, main)} ${main?.symbol ?? ""} for ${S(e.data.paid, sec)} ${sec?.symbol ?? ""}`;
    case "Donated":
      return `${short(e.data.donor ?? "")} donated ${S(e.data.amount, sec)} ${sec?.symbol ?? ""}`;
    case "Harvested":
      return `fees ${S(e.data.mainFees, main)}/${S(e.data.secondaryFees, sec)} · fueled ${S(e.data.fueled, sec)} · burned ${S(e.data.burned, main)}`;
    case "Compounded":
      return `+${ftoken(BigInt(e.data.liquidity ?? "0"), 0)} liquidity re-minted from fees`;
    case "ProgramLiquidityAdded":
      return `+${ftoken(BigInt(e.data.liquidity ?? "0"), 0)} liquidity added`;
    case "ProgramLiquidityRemoved":
      return `−${ftoken(BigInt(e.data.liquidity ?? "0"), 0)} liquidity removed to ${short(e.data.to ?? "")}`;
    case "ProgramCreated":
      return `LP program opened by ${short(e.data.owner ?? "")}`;
    default:
      return "";
  }
}

export function TradeTape({
  net,
  events,
  main,
  sec,
  loading,
  progress = null,
}: {
  net: Net;
  events: PoolEvent[];
  main?: TokenMeta;
  sec?: TokenMeta;
  loading: boolean;
  progress?: number | null;
}) {
  const items = useMemo(() => [...events].reverse().slice(0, 40), [events]);
  // fixed-position tooltip: the tape scrolls (overflow-y-auto clips absolutely
  // positioned children), so the explainer floats above the viewport instead
  const [tip, setTip] = useState<{ x: number; y: number; below: boolean; label: string; color: string; text: string } | null>(null);
  return (
    <div className="panel">
      <div className="chead">
        <span>live tape</span>
        <span className="flex items-center gap-2">
          <span className="mono text-[10px] text-dim2">{events.length} events</span>
          <span className="livedot" />
        </span>
      </div>
      {loading && (
        <div className="px-3 pt-2">
          <ScanBar progress={progress} thin />
        </div>
      )}
      <div className="max-h-[340px] overflow-y-auto p-2">
        {items.length === 0 && (
          <div className="mono py-10 text-center text-[12px] text-dim2">
            {loading ? "scanning…" : "no activity yet — every pump, shield, donation and harvest lands here"}
          </div>
        )}
        {items.map((e) => {
          const s = styleOf(e);
          return (
            <a
              key={`${e.txHash}-${e.logIndex}`}
              href={`${net.explorer}/tx/${e.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="tape-item flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-green/5"
            >
              <span
                className="mono w-[74px] flex-shrink-0 cursor-help text-center text-[10px] font-bold tracking-wider"
                style={{
                  color: s.color,
                  textShadow: `0 0 12px ${s.color}66`,
                }}
                onMouseEnter={(ev) => {
                  const text = EXPLAIN[s.label];
                  if (!text) return;
                  const r = ev.currentTarget.getBoundingClientRect();
                  const below = r.top < 120; // no room above → flip under the badge
                  setTip({
                    x: r.left + r.width / 2,
                    y: below ? r.bottom + 6 : r.top - 6,
                    below,
                    label: s.label,
                    color: s.color,
                    text,
                  });
                }}
                onMouseLeave={() => setTip(null)}
              >
                {s.label}
              </span>
              <span className="mono flex-1 truncate text-[11.5px] text-dim">
                {describe(e, main, sec)}
              </span>
              <span className="mono flex-shrink-0 text-[10px] text-dim2">
                {e.timestamp ? ago(e.timestamp * 1000) : `#${e.block}`}
              </span>
            </a>
          );
        })}
      </div>
      {tip && (
        <div
          className="mono pointer-events-none fixed z-[60] w-[240px] rounded-lg border border-[var(--line2)] bg-bg/95 px-3 py-2 text-[10.5px] leading-relaxed text-dim shadow-lg"
          style={{ left: tip.x, top: tip.y, transform: tip.below ? "translate(-50%, 0)" : "translate(-50%, -100%)" }}
        >
          <div className="mb-0.5 text-[10px] font-bold tracking-wider" style={{ color: tip.color }}>
            {tip.label}
          </div>
          {tip.text}
        </div>
      )}
    </div>
  );
}
