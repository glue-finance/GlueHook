import { formatUnits } from "viem";

export function short(addr: string, n = 4): string {
  return addr.length > 12 ? `${addr.slice(0, 2 + n)}…${addr.slice(-n)}` : addr;
}

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const sub = (n: number) => String(n).split("").map((c) => SUB[+c]).join("");

/**
 * Human number with adaptive precision, never scientific notation:
 * 1234567 -> 1.23M · 0.00001234 -> 0.0₄1234 (subscript counts the zeros)
 */
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sup = (n: number) => String(n).split("").map((c) => SUP[+c]).join("");

export function fnum(x: number): string {
  if (!isFinite(x)) return "∞";
  const neg = x < 0 ? "-" : "";
  const a = Math.abs(x);
  if (a >= 1e15) {
    // absurd magnitudes: 3.7×10³³ instead of scientific notation
    const exp = Math.floor(Math.log10(a));
    return `${neg}${(a / 10 ** exp).toFixed(2)}×10${sup(exp)}`;
  }
  if (a >= 1e12) return neg + (a / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return neg + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return neg + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return neg + (a / 1e3).toFixed(2) + "K";
  if (a >= 1) return x.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (a === 0) return "0";
  if (a >= 0.0001) return neg + String(parseFloat(a.toFixed(4)));
  // tiny: compress the zero run — 0.0000030061 renders as 0.0₅3006
  let zeros = -Math.floor(Math.log10(a)) - 1;
  let digits = Math.round(a * 10 ** (zeros + 4)); // 4 significant digits
  if (digits >= 10000) {
    digits = 1000;
    zeros -= 1;
  }
  if (zeros < 1) return neg + String(parseFloat(a.toFixed(6)));
  return `${neg}0.0${sub(zeros)}${String(digits).replace(/0+$/, "") || "0"}`;
}

export function ftoken(wei: bigint, decimals = 18): string {
  return fnum(Number(formatUnits(wei, decimals)));
}

export function fpct(wad: bigint): string {
  return (Number(wad) / 1e16).toFixed(wad % 10n ** 16n === 0n ? 0 : 1) + "%";
}

export function ago(tsMs: number): string {
  const s = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
