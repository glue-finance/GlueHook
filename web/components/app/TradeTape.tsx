"use client";

import { useMemo } from "react";
import type { Net } from "@/lib/chains";
import type { PoolEvent } from "@/lib/events";
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

function describe(e: PoolEvent, main?: TokenMeta, sec?: TokenMeta): string {
  const S = (x?: string, m?: TokenMeta) => (x ? ftoken(BigInt(x), m?.decimals ?? 18) : "0");
  switch (e.kind) {
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
          const s = STYLE[e.kind] ?? { color: "#a5b6a1", label: e.kind };
          return (
            <a
              key={`${e.txHash}-${e.logIndex}`}
              href={`${net.explorer}/tx/${e.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="tape-item flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-green/5"
            >
              <span
                className="mono w-[74px] flex-shrink-0 text-center text-[10px] font-bold tracking-wider"
                style={{
                  color: s.color,
                  textShadow: `0 0 12px ${s.color}66`,
                }}
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
    </div>
  );
}
