"use client";

import { useMemo } from "react";
import { isAddress, parseUnits, zeroAddress, type Address } from "viem";
import { validateConfig, WAD, type ProgramConfig } from "@/lib/hook";
import type { TokenMeta } from "@/lib/usePool";

export type ConfigDraft = {
  compoundPct: number; // 0..100
  buybackPct: number;
  burnPct: number;
  potCompoundPct: number; // buyback split: pot output → compound carry
  potBurnPct: number; // buyback split: pot output → burn cascade
  publicHarvest: boolean;
  secondaryRecipient: string;
  mainRecipient: string;
  minMain: string; // token units, parsed with decimals
  minSecondary: string;
};

export const EMPTY_DRAFT: ConfigDraft = {
  compoundPct: 0,
  buybackPct: 0,
  burnPct: 0,
  potCompoundPct: 0,
  potBurnPct: 0,
  publicHarvest: true,
  secondaryRecipient: "",
  mainRecipient: "",
  minMain: "0",
  minSecondary: "0",
};

export function draftToConfig(d: ConfigDraft, mainDec: number, secDec: number): ProgramConfig {
  const pctToWad = (p: number) => (BigInt(Math.round(p * 100)) * WAD) / 10_000n;
  const addr = (s: string): Address => (isAddress(s) ? (s as Address) : zeroAddress);
  return {
    compoundShareWad: pctToWad(d.compoundPct),
    buybackShareWad: pctToWad(d.buybackPct),
    burnShareWad: pctToWad(d.burnPct),
    potCompoundShareWad: pctToWad(d.potCompoundPct),
    potBurnShareWad: pctToWad(d.potBurnPct),
    publicHarvest: d.publicHarvest,
    secondaryRecipient: addr(d.secondaryRecipient),
    mainRecipient: addr(d.mainRecipient),
    minMain: safeParse(d.minMain, mainDec),
    minSecondary: safeParse(d.minSecondary, secDec),
  };
}

function safeParse(s: string, dec: number): bigint {
  try {
    return parseUnits(s || "0", dec);
  } catch {
    return 0n;
  }
}

export function configError(
  d: ConfigDraft,
  mainIsNative: boolean,
  mainDec: number,
  secDec: number,
): string | null {
  for (const [label, v] of [
    ["secondary recipient", d.secondaryRecipient],
    ["main recipient", d.mainRecipient],
  ] as const) {
    if (v && !isAddress(v)) return `${label} is not a valid address`;
  }
  return validateConfig(draftToConfig(d, mainDec, secDec), mainIsNative);
}

export function Slider({
  label,
  value,
  onChange,
  color = "#17b512",
  max = 100,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color?: string;
  max?: number;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="label">{label}</span>
        <span className="mono text-[12px]" style={{ color }}>
          {value}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function ConfigEditor({
  draft,
  onChange,
  mainIsNative,
  main,
  sec,
}: {
  draft: ConfigDraft;
  onChange: (d: ConfigDraft) => void;
  mainIsNative: boolean;
  main?: TokenMeta;
  sec?: TokenMeta;
}) {
  const set = (patch: Partial<ConfigDraft>) => onChange({ ...draft, ...patch });
  const err = useMemo(
    () => configError(draft, mainIsNative, main?.decimals ?? 18, sec?.decimals ?? 18),
    [draft, mainIsNative, main, sec],
  );

  const secResidual = Math.max(0, 100 - draft.compoundPct - draft.buybackPct);
  const mainResidual = Math.max(0, 100 - draft.compoundPct - draft.burnPct);

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-xl border border-[var(--line2)] bg-green/5 p-4">
        <div className="label text-green">autocompound — applies to BOTH sides of every harvest</div>
        <Slider label="compound share" value={draft.compoundPct} onChange={(v) => set({ compoundPct: v })} />
      </div>

      <div className="space-y-3 rounded-xl border border-[rgba(0,152,127,.25)] bg-teal/5 p-4">
        <div className="label text-teal">secondary side — {sec?.symbol ?? "buyback currency"}</div>
        <Slider
          label="buyback fuel"
          value={draft.buybackPct}
          onChange={(v) => set({ buybackPct: v })}
          color="#00987f"
          max={Math.max(0, 100 - draft.compoundPct)}
        />
        <div className="mono text-[11px] text-dim2">
          compound {draft.compoundPct}% + buyback {draft.buybackPct}% → residual to recipient:{" "}
          <span className="text-lime">{secResidual}%</span>
        </div>
        {secResidual > 0 && (
          <input
            className="input"
            placeholder="secondary recipient (0x…)"
            value={draft.secondaryRecipient}
            onChange={(e) => set({ secondaryRecipient: e.target.value.trim() })}
          />
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-[var(--line)] bg-green/5 p-4">
        <div className="label text-green">main side — {main?.symbol ?? "defended asset"}</div>
        {mainIsNative ? (
          <div className="mono text-[11px] text-warn">
            burn disabled: MAIN is the network token (can&apos;t be burned)
          </div>
        ) : (
          <Slider
            label="burn"
            value={draft.burnPct}
            onChange={(v) => set({ burnPct: v })}
            color="#e23a3a"
            max={Math.max(0, 100 - draft.compoundPct)}
          />
        )}
        <div className="mono text-[11px] text-dim2">
          compound {draft.compoundPct}% + burn {draft.burnPct}% → residual to recipient:{" "}
          <span className="text-lime">{mainResidual}%</span>
        </div>
        {mainResidual > 0 && (
          <input
            className="input"
            placeholder="main recipient (0x…)"
            value={draft.mainRecipient}
            onChange={(e) => set({ mainRecipient: e.target.value.trim() })}
          />
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-[rgba(254,0,135,.25)] bg-magenta/5 p-4">
        <div className="label text-magenta">
          buyback split — what happens to the {main?.symbol ?? "main"} the pot buys
        </div>
        <Slider
          label="→ autocompound (becomes pool liquidity)"
          value={draft.potCompoundPct}
          onChange={(v) => set({ potCompoundPct: v })}
          max={Math.max(0, 100 - draft.potBurnPct)}
        />
        {mainIsNative ? (
          <div className="mono text-[11px] text-warn">
            burn disabled: MAIN is the network token (can&apos;t be burned)
          </div>
        ) : (
          <Slider
            label="→ burn"
            value={draft.potBurnPct}
            onChange={(v) => set({ potBurnPct: v })}
            color="#e23a3a"
            max={Math.max(0, 100 - draft.potCompoundPct)}
          />
        )}
        <div className="mono text-[11px] text-dim2">
          compound {draft.potCompoundPct}% + burn {draft.potBurnPct}% → the rest (
          <span className="text-lime">{Math.max(0, 100 - draft.potCompoundPct - draft.potBurnPct)}%</span>
          ) follows the pot&apos;s recipient — a live address is delivered to, the burn address burns.
          both at 0 = the whole buyback follows the pot&apos;s recipient, exactly the classic behaviour.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="label mb-1.5">min {main?.symbol ?? "main"} to auto-harvest</div>
          <input className="input" value={draft.minMain} onChange={(e) => set({ minMain: e.target.value.trim() })} />
        </div>
        <div>
          <div className="label mb-1.5">min {sec?.symbol ?? "secondary"} to auto-harvest</div>
          <input className="input" value={draft.minSecondary} onChange={(e) => set({ minSecondary: e.target.value.trim() })} />
        </div>
      </div>
      <p className="mono text-[10.5px] leading-relaxed text-dim2">
        both minimums at 0 = auto-harvest off (manual harvest only). when fees pass
        the minimums, the next swap harvests automatically.
      </p>

      <label className="flex cursor-pointer items-center justify-between">
        <span className="label">public harvest (anyone can trigger)</span>
        <span
          className={`toggle ${draft.publicHarvest ? "on" : ""}`}
          onClick={() => set({ publicHarvest: !draft.publicHarvest })}
        />
      </label>

      {err && <div className="mono rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-[11.5px] text-bad">{err}</div>}
    </div>
  );
}
