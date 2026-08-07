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
 * Re-derive the dependent side of a pair from the side that was last edited,
 * through the raw pool price ((√P/Q96)²). Shared by the input boxes and by
 * callers that need to re-sync after the PRICE moved (a retyped launch price,
 * a flip, or a live pool tick) — Uniswap keeps the last-edited field and
 * recomputes the other one, and so do we.
 */
export function syncPair(
  edited: 0 | 1,
  value: PairValue,
  sqrtP: bigint | null,
  dec0: number,
  dec1: number,
): PairValue {
  if (!sqrtP || sqrtP === 0n) return value;
  if (edited === 0) {
    const amt0 = parseAmt(value.a0, dec0);
    const amt1 = (amt0 * sqrtP * sqrtP) / Q96 / Q96;
    return { a0: value.a0, a1: amt0 > 0n ? trim(formatUnits(amt1, dec1)) : "" };
  }
  const amt1 = parseAmt(value.a1, dec1);
  const amt0 = (amt1 * Q96 * Q96) / sqrtP / sqrtP;
  return { a1: value.a1, a0: amt1 > 0n ? trim(formatUnits(amt0, dec0)) : "" };
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
  /** `edited` names the side the user touched, so the caller can keep it authoritative */
  onChange: (v: PairValue, edited: 0 | 1) => void;
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
  return (
    <div className="space-y-2">
      <AmountBox
        sym={sym0}
        value={value.a0}
        onChange={(s) => onChange(syncPair(0, { ...value, a0: s }, sqrtP, dec0, dec1), 0)}
        bal={bal0}
        dec={dec0}
        native={native0}
        gasReserve={gasReserve}
        unitUsd={usd0}
      />
      <AmountBox
        sym={sym1}
        value={value.a1}
        onChange={(s) => onChange(syncPair(1, { ...value, a1: s }, sqrtP, dec0, dec1), 1)}
        bal={bal1}
        dec={dec1}
        native={native1}
        gasReserve={gasReserve}
        unitUsd={usd1}
      />
    </div>
  );
}

/**
 * Cut a decimal string to `dp` places by TRUNCATION, working on the string
 * itself. Never through Number(): a float round-trip ROUNDS — so a balance of
 * 0.999999999999999999 came back as "1", i.e. more than the wallet holds — and
 * it also drops digits past ~17 significant figures. An amount too small to
 * survive the cut keeps its full precision instead of collapsing to zero.
 */
function trim(s: string, dp = 8): string {
  const [whole, frac = ""] = s.split(".");
  if (frac.length <= dp) return s;
  const cut = frac.slice(0, dp).replace(/0+$/, "");
  if (!cut && /^0*$/.test(whole)) return s;
  return cut ? `${whole}.${cut}` : whole;
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
  // A native MAX without a priced reserve would offer the whole balance and
  // leave nothing to pay gas with, so it stays unavailable until the fee query
  // lands rather than falling back to a zero reserve.
  const reservePending = native && gasReserve === undefined;
  const reserve = native ? gasReserve ?? 0n : 0n;
  const max = bal === undefined || reservePending ? null : bal > reserve ? bal - reserve : 0n;
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
              type="button"
              disabled={max === null}
              className="shrink-0 rounded-full border border-green/50 bg-green/10 px-2.5 py-0.5 text-[10px] font-extrabold text-green transition-all hover:bg-green/20 disabled:cursor-not-allowed disabled:opacity-40"
              // the exact string, not a trimmed one: this side is the one the
              // user is spending, so it must round-trip back to the same wei
              onClick={() => max !== null && onChange(max > 0n ? formatUnits(max, dec) : "0")}
            >
              MAX
            </button>
          )}
        </div>
      )}
    </div>
  );
}
