"use client";

import { formatUnits, parseUnits } from "viem";
import { fnum, ftoken } from "@/lib/format";
import { Q96 } from "@/lib/v4math";

export type PairValue = { a0: string; a1: string };

/** parse a human amount, tolerant of junk */
export function parseAmt(s: string, dec: number): bigint {
  try {
    return parseUnits(s || "0", dec);
  } catch {
    return 0n;
  }
}

/**
 * The classic two-box deposit input: edit one side and the other follows the
 * pool price (raw price = (√P/Q96)²), exactly like Uniswap's add-liquidity.
 */
export function PairAmounts({
  sym0,
  sym1,
  dec0,
  dec1,
  sqrtP,
  value,
  onChange,
  bal0,
  bal1,
  native0 = false,
  native1 = false,
  gasReserve,
  usd0,
  usd1,
}: {
  sym0: string;
  sym1: string;
  dec0: number;
  dec1: number;
  /** live (or chosen launch) √price — null disables auto-fill */
  sqrtP: bigint | null;
  value: PairValue;
  onChange: (v: PairValue) => void;
  bal0?: bigint;
  bal1?: bigint;
  /** the native side's MAX keeps a little behind for gas */
  native0?: boolean;
  native1?: boolean;
  /** live wei reserve kept behind a native MAX (priced from the chain's fee data) */
  gasReserve?: bigint;
  /** USD per whole token, when priceable — shows a live ≈ $ under the input */
  usd0?: number | null;
  usd1?: number | null;
}) {
  // derive the counter-amount through the raw pool price
  function fill0(a0: string): PairValue {
    if (!sqrtP || sqrtP === 0n) return { ...value, a0 };
    const amt0 = parseAmt(a0, dec0);
    const amt1 = (amt0 * sqrtP * sqrtP) / Q96 / Q96;
    return { a0, a1: amt0 > 0n ? trim(formatUnits(amt1, dec1)) : "" };
  }
  function fill1(a1: string): PairValue {
    if (!sqrtP || sqrtP === 0n) return { ...value, a1 };
    const amt1 = parseAmt(a1, dec1);
    const amt0 = (amt1 * Q96 * Q96) / sqrtP / sqrtP;
    return { a1, a0: amt1 > 0n ? trim(formatUnits(amt0, dec0)) : "" };
  }

  return (
    <div className="space-y-2">
      <AmountBox
        sym={sym0}
        value={value.a0}
        onChange={(s) => onChange(fill0(s))}
        bal={bal0}
        dec={dec0}
        native={native0}
        gasReserve={gasReserve}
        unitUsd={usd0}
      />
      <AmountBox
        sym={sym1}
        value={value.a1}
        onChange={(s) => onChange(fill1(s))}
        bal={bal1}
        dec={dec1}
        native={native1}
        gasReserve={gasReserve}
        unitUsd={usd1}
      />
    </div>
  );
}

function trim(s: string): string {
  const n = Number(s);
  if (!isFinite(n)) return s;
  return n.toLocaleString("en-US", { maximumFractionDigits: 8, useGrouping: false });
}

/** One amount box: input, symbol chip, live ≈ $, balance and a gas-aware MAX. */
export function AmountBox({
  sym,
  value,
  onChange,
  bal,
  dec,
  native,
  gasReserve,
  unitUsd,
}: {
  sym: string;
  value: string;
  onChange: (s: string) => void;
  bal?: bigint;
  dec: number;
  native: boolean;
  gasReserve?: bigint;
  /** USD per whole token, when priceable */
  unitUsd?: number | null;
}) {
  const reserve = native ? gasReserve ?? 0n : 0n;
  const max = bal === undefined ? null : bal > reserve ? bal - reserve : 0n;
  const typed = Number(value);
  const usd = unitUsd != null && isFinite(typed) && typed > 0 ? typed * unitUsd : null;
  return (
    <div className="rounded-xl border border-[var(--line)] bg-panel2 px-4 py-3">
      <div className="flex items-center justify-between">
        <input
          className="w-full bg-transparent text-[20px] font-bold outline-none"
          placeholder="0.0"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
        />
        <span className="mono ml-3 shrink-0 rounded-full border border-[var(--line)] px-3 py-1 text-[12px] font-bold">
          {sym}
        </span>
      </div>
      {(usd !== null || bal !== undefined) && (
        <div className="mono mt-1.5 flex items-center justify-between gap-2 text-[10.5px] text-dim2">
          <span className="truncate">
            {usd !== null && <span className="mr-2">≈ ${fnum(usd)}</span>}
            {bal !== undefined && (
              <>
                balance <span className="font-bold text-dim">{ftoken(bal, dec)}</span>
                {native && reserve > 0n && ` — MAX keeps ~${ftoken(reserve, dec)} for gas`}
              </>
            )}
          </span>
          {bal !== undefined && (
            <button
              className="shrink-0 rounded-full border border-green/50 bg-green/10 px-2.5 py-0.5 text-[10px] font-extrabold text-green transition-all hover:bg-green/20"
              onClick={() => max !== null && onChange(max > 0n ? trim(formatUnits(max, dec)) : "0")}
            >
              MAX
            </button>
          )}
        </div>
      )}
    </div>
  );
}
