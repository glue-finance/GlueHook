"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { erc20Abi, isAddress, maxUint256, zeroAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import type { Net } from "@/lib/chains";
import { fnum, ftoken, short } from "@/lib/format";
import {
  FEE_TIERS,
  glueHookAbi,
  isNative,
  fullRangeTicks,
  poolIdOf,
  type PoolKey,
  type Program,
} from "@/lib/hook";
import { registerPool, type RegisteredPool } from "@/lib/registry";
import { usePot, useProgram, useTokenMeta } from "@/lib/usePool";
import { fetchPoolState, useAllowance, useBalanceOf, usePoolState } from "@/lib/usePoolState";
import { getSqrtRatioAtTick, liquidityForAmounts, priceFromSqrt, sqrtFromPrice } from "@/lib/v4math";
import {
  clampDraft,
  ConfigEditor,
  configError,
  draftToConfig,
  EMPTY_DRAFT,
  Slider,
  type ConfigDraft,
} from "./forms/ConfigEditor";
import { PairAmounts, parseAmt, syncPair, type PairValue } from "./forms/PairAmounts";
import { TxStatus, useHookTx } from "./forms/useHookTx";
import { clientForNet } from "@/lib/client";
import { useGasReserve } from "@/lib/gas";
import { TokenSelect } from "./TokenSelect";

const PINK = "#fe0087";
const BLUE = "#2b46e8";
const GREEN = "#17b512";
const YELLOW = "#c9a800";

/* ------------------------------------------------------------------ steps */

const STEPS = [
  { n: 1, t: "pair & fee", d: "the two tokens and the fee tier", c: PINK },
  { n: 2, t: "price & deposit", d: "launch price and your amounts", c: BLUE },
  { n: 3, t: "superpowers", d: "buyback · burn · autocompound", c: GREEN },
  { n: 4, t: "launch", d: "one transaction and it's alive", c: YELLOW },
] as const;

const FEE_DESCRIPTIONS = ["very stable pairs", "stable pairs", "most pairs", "exotic pairs"];

/* ---------------------------------------------------------------- presets */

type PresetId = "lp" | "buyburn" | "compound" | "flywheel" | "custom";

const PRESETS: {
  id: PresetId;
  icon: string;
  name: string;
  desc: string;
  color: string;
}[] = [
  {
    id: "lp",
    icon: "💧",
    name: "just LP",
    desc: "no machine — all trading fees stay claimable by you, rules editable later.",
    color: BLUE,
  },
  {
    id: "buyburn",
    icon: "🔥",
    name: "buyback & burn",
    desc: "every harvest fuels the pot for buybacks, and everything bought back burns.",
    color: PINK,
  },
  {
    id: "compound",
    icon: "🌀",
    name: "autocompound",
    desc: "100% of fees re-invest as deeper liquidity — the pool grows itself.",
    color: GREEN,
  },
  {
    id: "flywheel",
    icon: "⚡",
    name: "full machine",
    desc: "half of every harvest compounds, half fuels the buyback — and half of what the pot buys compounds back into liquidity. all engines on.",
    color: YELLOW,
  },
  {
    id: "custom",
    icon: "🎛",
    name: "custom",
    desc: "open every knob: shares, recipients, thresholds, public harvest.",
    color: "#1c2447",
  },
];

function presetDraft(id: PresetId, mainIsNative: boolean, me?: Address): ConfigDraft {
  const meStr = me ?? "";
  switch (id) {
    case "buyburn":
      return {
        ...EMPTY_DRAFT,
        buybackPct: 100,
        // the network token can't burn — residual main flows to you instead
        burnPct: mainIsNative ? 0 : 100,
        mainRecipient: mainIsNative ? meStr : "",
      };
    case "compound":
      return { ...EMPTY_DRAFT, compoundPct: 100 };
    case "flywheel":
      return {
        ...EMPTY_DRAFT,
        compoundPct: 50,
        buybackPct: 50,
        burnPct: mainIsNative ? 0 : 50,
        // the buyback split: half of every pot purchase becomes pool liquidity,
        // the rest follows the pot's recipient (burn by default)
        potCompoundPct: 50,
        mainRecipient: mainIsNative ? meStr : "",
      };
    default:
      return { ...EMPTY_DRAFT };
  }
}

/* ----------------------------------------------------- market price lookup */

/**
 * Uniswap-style existing-pool discovery: when the SELECTED pool doesn't exist
 * yet, scan every fee tier for this pair — both hooked (our hook) and vanilla
 * V4 pools — and surface the deepest live pool's current price as the
 * suggested launch price. Reads straight out of the PoolManager's storage.
 */
function useReferencePrice(net: Net, key: PoolKey | null, enabled: boolean) {
  const c0 = key?.currency0;
  const c1 = key?.currency1;
  return useQuery({
    queryKey: ["refPrice", net.chain.id, c0, c1],
    enabled: enabled && !!c0 && !!c1,
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const candidates = FEE_TIERS.flatMap((t) =>
        [net.hook, zeroAddress].map((hooks) => ({
          fee: t.fee,
          tickSpacing: t.spacing,
          label: t.label,
          hooks,
        })),
      );
      const states = await Promise.all(
        candidates.map(async (c) => {
          try {
            const s = await fetchPoolState(
              net,
              poolIdOf({ currency0: c0!, currency1: c1!, fee: c.fee, tickSpacing: c.tickSpacing, hooks: c.hooks }),
            );
            return s.initialized && s.liquidity > 0n
              ? { sqrtPriceX96: s.sqrtPriceX96, liquidity: s.liquidity, feeLabel: c.label, hooked: c.hooks !== zeroAddress }
              : null;
          } catch {
            return null;
          }
        }),
      );
      // the deepest pool is the most trustworthy price
      const live = states.filter((s): s is NonNullable<typeof s> => s !== null);
      if (live.length === 0) return null;
      live.sort((a, b) => (b.liquidity > a.liquidity ? 1 : b.liquidity < a.liquidity ? -1 : 0));
      return live[0];
    },
  });
}

/* ------------------------------------------------------------- component */

/**
 * The "new pool" wizard — the whole Uniswap V4 new-position flow plus the
 * hook's options, as four playful steps. The poolId is computed live, cached
 * in the browser registry the moment the pool exists, and printed BIG.
 */
export function CreatePool({
  net,
  onCreated,
  onClose,
}: {
  net: Net;
  onCreated: (pool: RegisteredPool) => void;
  onClose: () => void;
}) {
  const { address: me } = useAccount();
  const { tx, send } = useHookTx(net);
  const [step, setStep] = useState(1);

  /* ------------------------------ pair + fee ------------------------------ */
  const [tokenA, setTokenA] = useState("");
  // native pre-picked (swap it for any token) — except on a no-native chain
  // like Tempo, where the "native" coin doesn't exist: start both empty
  const [tokenB, setTokenB] = useState<string>(net.noNative ? "" : zeroAddress);
  const [feeIdx, setFeeIdx] = useState(2); // 0.30%

  const addrA = isAddress(tokenA) ? (tokenA as Address) : null;
  const addrB = isAddress(tokenB) ? (tokenB as Address) : null;

  const key: PoolKey | null = useMemo(() => {
    if (!addrA || addrB === null || addrA.toLowerCase() === addrB.toLowerCase()) return null;
    const [c0, c1] =
      addrA.toLowerCase() < addrB.toLowerCase() ? [addrA, addrB] : [addrB, addrA];
    return {
      currency0: c0,
      currency1: c1,
      fee: FEE_TIERS[feeIdx].fee,
      tickSpacing: FEE_TIERS[feeIdx].spacing,
      hooks: net.hook,
    };
  }, [addrA, addrB, feeIdx, net.hook]);

  const poolId = key ? poolIdOf(key) : null;
  const state = usePoolState(net, poolId);
  const pot = usePot(net, state.data?.initialized ? poolId : null);
  const prog = useProgram(net, state.data?.initialized ? poolId : null);
  const initialized = state.data?.initialized ?? false;
  const potReady = pot.data?.configured ?? false;
  const programExists = prog.data?.exists ?? false;
  const programOwner = prog.data?.owner;
  // `addProgramLiquidity` is owner-only; a surrendered program (owner 0) takes no adds at all
  const notProgramOwner =
    programExists && (!me || !programOwner || programOwner.toLowerCase() !== me.toLowerCase());

  const meta0 = useTokenMeta(net, key?.currency0);
  const meta1 = useTokenMeta(net, key?.currency1);
  const metaA = useTokenMeta(net, addrA);
  const metaB = useTokenMeta(net, addrB);
  const sym0 = meta0.data?.symbol ?? "…";
  const sym1 = meta1.data?.symbol ?? "…";
  const dec0 = meta0.data?.decimals ?? 18;
  const dec1 = meta1.data?.decimals ?? 18;

  /* ------------------------------ price ------------------------------ */
  // priceStr is "quote per 1 base"; flip swaps which side is the base
  const [priceStr, setPriceStr] = useState("");
  const [flip, setFlip] = useState(false);
  const baseSym = flip ? sym1 : sym0;
  const quoteSym = flip ? sym0 : sym1;

  const launchSqrt = useMemo(() => {
    const p = Number(priceStr);
    if (!(p > 0)) return null;
    const price1per0 = flip ? 1 / p : p;
    return sqrtFromPrice(price1per0, dec0, dec1);
  }, [priceStr, flip, dec0, dec1]);

  /* ------------------------------ deposit ------------------------------ */
  const [amounts, setAmounts] = useState<PairValue>({ a0: "", a1: "" });
  // which box the user typed in last — that side stays authoritative when the
  // price changes and the OTHER side is re-derived (exactly Uniswap's rule)
  const [lastEdited, setLastEdited] = useState<0 | 1>(0);
  const bal0 = useBalanceOf(net, key?.currency0, me);
  const bal1 = useBalanceOf(net, key?.currency1, me);
  const gasReserve = useGasReserve(net);
  const sqrtP = state.data?.initialized ? state.data.sqrtPriceX96 : launchSqrt;

  // the price moved (retyped launch price, flip, or a live pool tick) →
  // re-derive the dependent amount from the last-edited side
  useEffect(() => {
    setAmounts((v) => syncPair(lastEdited, v, sqrtP, dec0, dec1));
  }, [sqrtP, lastEdited, dec0, dec1]);

  // Uniswap-style: while THIS pool doesn't exist, look for live pools on the
  // same pair (every fee tier, hooked or vanilla) and propose their price
  const refPool = useReferencePrice(net, key, !initialized);
  const refPrices = refPool.data ? priceFromSqrt(refPool.data.sqrtPriceX96, dec0, dec1) : null;
  const refShown = refPrices ? (flip ? refPrices.price0per1 : refPrices.price1per0) : null;

  const liquidity = useMemo(() => {
    if (!key || !sqrtP || sqrtP === 0n) return 0n;
    const amt0 = parseAmt(amounts.a0, dec0);
    const amt1 = parseAmt(amounts.a1, dec1);
    if (amt0 <= 0n && amt1 <= 0n) return 0n;
    const { tickLower, tickUpper } = fullRangeTicks(key.tickSpacing);
    const L = liquidityForAmounts(
      sqrtP,
      getSqrtRatioAtTick(tickLower),
      getSqrtRatioAtTick(tickUpper),
      amt0,
      amt1,
    );
    // shave a hair so on-chain round-up never exceeds the typed amounts
    return L > 1_000_000n ? L - L / 1_000_000n : L;
  }, [key, sqrtP, amounts, dec0, dec1]);

  /* --------------------------- powers (step 3) --------------------------- */
  const [mainIs0, setMainIs0] = useState(false);
  const [preset, setPreset] = useState<PresetId>("lp");
  const [draft, setDraft] = useState<ConfigDraft>({ ...EMPTY_DRAFT });
  const [recipient, setRecipient] = useState("");

  const mainAddr = key ? (mainIs0 ? key.currency0 : key.currency1) : null;
  const mainIsNative = mainAddr ? isNative(mainAddr) : false;
  const recipientAddr: Address = isAddress(recipient) ? (recipient as Address) : zeroAddress;
  const recipientBad = mainIsNative && recipientAddr === zeroAddress;

  const advanced = preset !== "lp";
  const mainDec = mainIs0 ? dec0 : dec1;
  const secDec = mainIs0 ? dec1 : dec0;
  const cfgErr = advanced ? configError(draft, mainIsNative, mainDec, secDec) : null;

  function pickPreset(id: PresetId) {
    setPreset(id);
    if (id !== "custom") setDraft(presetDraft(id, mainIsNative, me));
  }

  /* ------------------------------- actions ------------------------------- */

  const [phase, setPhase] = useState<string | null>(null);

  // Live allowance reads gate the ONE action button, Uniswap-style: while an
  // approval is missing the button IS that approval — one transaction per
  // press, and the label advances once `send` verified the receipt (it also
  // waits for our read RPCs to reach the receipt's block, so the refetch
  // below can't come back stale).
  const amt0 = parseAmt(amounts.a0, dec0);
  const amt1 = parseAmt(amounts.a1, dec1);
  // a deposit you can't pay for blocks Continue AND the launch button
  const insufficient0 = amt0 > 0n && bal0.data !== undefined && amt0 > bal0.data;
  const insufficient1 = amt1 > 0n && bal1.data !== undefined && amt1 > bal1.data;
  const allow0 = useAllowance(net, key?.currency0, me, net.hook);
  const allow1 = useAllowance(net, key?.currency1, me, net.hook);
  const needApprove0 =
    !!key && !isNative(key.currency0) && amt0 > 0n && allow0.data !== undefined && allow0.data < amt0;
  const needApprove1 =
    !!key && !isNative(key.currency1) && amt1 > 0n && allow1.data !== undefined && allow1.data < amt1;
  const allowancesLoading =
    (!!key && !isNative(key.currency0) && amt0 > 0n && allow0.data === undefined) ||
    (!!key && !isNative(key.currency1) && amt1 > 0n && allow1.data === undefined);

  /** one press = one approval — the next press does the next step */
  async function approveNext() {
    if (!key) return;
    const token = needApprove0 ? key.currency0 : key.currency1;
    const sym = needApprove0 ? sym0 : sym1;
    setPhase(`approving ${sym}…`);
    try {
      await send({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [net.hook, maxUint256],
      });
      await Promise.all([allow0.refetch(), allow1.refetch()]);
    } finally {
      setPhase(null);
    }
  }

  /**
   * The launch itself — the pool launches in a single transaction
   * (initialize + roles + seeded program). On an already-live pool the same
   * button switches the machine on (if needed) and seeds the liquidity.
   */
  async function doLaunch() {
    if (!key || !mainAddr || liquidity <= 0n) return;
    if (needApprove0 || needApprove1) return; // the button is the approval until then
    const value = isNative(key.currency0) ? amt0 : 0n;
    try {
      if (!initialized) {
        if (!launchSqrt) return;
        setPhase("launching the pool…");
        const hash = await send({
          functionName: "launchPool",
          args: [
            key,
            launchSqrt,
            mainAddr,
            recipientAddr,
            0,
            0,
            liquidity,
            me ?? zeroAddress,
            draftToConfig(draft, mainDec, secDec),
          ],
          value,
        });
        if (hash && me) {
          const p = registerPool(net, key, me, 0);
          onCreated(p);
          state.refetch();
          pot.refetch();
        }
      } else {
        // A pool holds exactly ONE program, forever — a fresh read decides
        // between creating it (addLiquidity/Advanced) and topping it up
        // (addProgramLiquidity, owner-only). Using stale hook data here would
        // send the create entry into its one-shot guard (PotAlreadyReady).
        let live: Program | undefined = prog.data;
        try {
          live = (await clientForNet(net).readContract({
            address: net.hook,
            abi: glueHookAbi,
            functionName: "programOf",
            args: [poolId!],
          })) as Program;
        } catch {
          /* unreachable RPC → fall back to the cached read */
        }

        let done: `0x${string}` | null = null;
        if (live?.exists) {
          setPhase("adding liquidity to the program…");
          done = await send({ functionName: "addProgramLiquidity", args: [key, liquidity], value });
        } else {
          if (!potReady) {
            setPhase("switching the machine on…");
            const h = await send({ functionName: "initPot", args: [key, mainAddr, recipientAddr] });
            if (!h) return;
            pot.refetch();
          }
          setPhase("seeding liquidity…");
          if (advanced) {
            done = await send({
              functionName: "addLiquidityAdvanced",
              args: [key, 0, 0, liquidity, me ?? zeroAddress, draftToConfig(draft, mainDec, secDec)],
              value,
            });
          } else {
            done = await send({
              functionName: "addLiquidity",
              args: [key, 0, 0, liquidity, me ?? zeroAddress],
              value,
            });
          }
        }
        prog.refetch();
        // Success → straight to the pool's dashboard, no dangling "seed again" state
        if (done && me) onCreated(registerPool(net, key, me, 0));
      }
    } finally {
      setPhase(null);
    }
  }

  /* ------------------------------ step gating ----------------------------- */

  const stepOk = [
    key !== null,
    (initialized || launchSqrt !== null) && liquidity > 0n && !insufficient0 && !insufficient1,
    // An existing program keeps its own rules — the config step can't block the add
    programExists || (!cfgErr && !recipientBad),
  ];
  const canContinue = step <= 3 ? stepOk[step - 1] : false;
  const busy = tx.s === "wallet" || tx.s === "pending";

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="panel overflow-hidden">
      <div className="chead">
        <span>new pool — Uniswap V4 + the hook</span>
        <button className="pill" onClick={onClose}>✕ close</button>
      </div>

      <div className="grid lg:grid-cols-[240px_1fr]">
        {/* ------------------------------ step rail ------------------------------ */}
        <div className="border-b border-[var(--line)] p-5 lg:border-b-0 lg:border-r">
          <div className="flex gap-2 lg:flex-col lg:gap-0">
            {STEPS.map((s, i) => {
              const done = step > s.n || (s.n < 4 && stepOk[s.n - 1] && step > s.n);
              const active = step === s.n;
              return (
                <button
                  key={s.n}
                  className="group flex flex-1 items-start gap-3 text-left lg:flex-none lg:pb-6"
                  onClick={() => {
                    // free navigation backwards; forwards only through valid steps
                    if (s.n < step || stepOk.slice(0, s.n - 1).every(Boolean)) setStep(s.n);
                  }}
                >
                  <div className="relative flex flex-col items-center">
                    <span
                      className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full border-2 text-[13px] font-extrabold transition-all"
                      style={{
                        borderColor: active || done ? s.c : "var(--line2)",
                        background: active ? s.c : done ? `${s.c}18` : "transparent",
                        color: active ? "#fff" : done ? s.c : "var(--t-dim2)",
                        boxShadow: active ? `0 6px 16px ${s.c}55` : "none",
                      }}
                    >
                      {done && !active ? "✓" : s.n}
                    </span>
                    {i < STEPS.length - 1 && (
                      <span
                        className="mt-1 hidden h-8 w-[2px] rounded lg:block"
                        style={{ background: step > s.n ? s.c : "var(--line)" }}
                      />
                    )}
                  </div>
                  <div className="hidden pt-1 sm:block">
                    <div
                      className="text-[13.5px] font-extrabold leading-tight"
                      style={{ color: active ? s.c : "var(--t-txt)" }}
                    >
                      {s.t}
                    </div>
                    <div className="mono mt-0.5 text-[10px] leading-snug text-dim2">{s.d}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* live pool id chip */}
          {poolId && (
            <div className="mono mt-2 hidden rounded-lg border border-[var(--line)] bg-panel2 px-3 py-2 text-[10px] leading-relaxed text-dim2 lg:block">
              <span className="text-dim">pool id</span>
              <div className="break-all font-bold text-magenta">{short(poolId, 10)}</div>
              {initialized && <span className="text-green">live on {net.label} ✓</span>}
            </div>
          )}
        </div>

        {/* ------------------------------ step body ------------------------------ */}
        <div className="p-6">
          {/* ============================ 1 · pair & fee ============================ */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <div className="mb-3 text-[15px] font-extrabold">Select the pair</div>
                <div className="space-y-2.5">
                  <TokenSelect
                    net={net}
                    value={addrA}
                    symbol={metaA.data?.symbol}
                    onChange={(a) => setTokenA(a)}
                    allowNative={!net.noNative}
                    exclude={addrB}
                    placeholder="Select your token"
                  />
                  <TokenSelect
                    net={net}
                    value={addrB}
                    symbol={metaB.data?.symbol}
                    onChange={(a) => setTokenB(a)}
                    allowNative={!net.noNative}
                    exclude={addrA}
                    placeholder="Select the second token"
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 text-[15px] font-extrabold">Fee tier</div>
                <p className="mono mb-3 text-[11px] text-dim2">
                  what traders pay the pool per swap — and what feeds the machine.
                </p>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {FEE_TIERS.map((t, i) => {
                    const on = feeIdx === i;
                    return (
                      <button
                        key={t.fee}
                        className="rounded-xl border-2 p-3.5 text-left transition-all"
                        style={{
                          borderColor: on ? PINK : "var(--line)",
                          background: on ? "rgba(254,0,135,.05)" : "transparent",
                          transform: on ? "translateY(-2px)" : "none",
                          boxShadow: on ? "0 8px 20px rgba(254,0,135,.14)" : "none",
                        }}
                        onClick={() => setFeeIdx(i)}
                      >
                        <div className="text-[16px] font-extrabold" style={{ color: on ? PINK : "var(--t-txt)" }}>
                          {t.label}
                        </div>
                        <div className="mono mt-1 text-[10px] leading-snug text-dim2">
                          {FEE_DESCRIPTIONS[i]}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {initialized && (
                <div className="mono rounded-xl border border-green/40 bg-green/5 px-4 py-3 text-[11.5px] text-green">
                  this exact pool already exists on {net.label} — you can still deposit into it and
                  configure the machine in the next steps.
                </div>
              )}
            </div>
          )}

          {/* ========================== 2 · price & deposit ========================== */}
          {step === 2 && (
            <div className="space-y-6">
              {!initialized ? (
                <div>
                  <div className="mb-1 text-[15px] font-extrabold">Set the launch price</div>
                  <p className="mono mb-3 text-[11px] text-dim2">
                    the exchange rate the pool opens at — this IS the market price until trades move it.
                  </p>
                  <div className="rounded-2xl border-2 border-blue/40 bg-blue/5 p-5">
                    <div className="mono mb-2 flex items-center justify-between text-[11px] text-dim">
                      <span>1 {baseSym} =</span>
                      <button
                        className="pill"
                        onClick={() => {
                          setFlip((f) => !f);
                          setPriceStr("");
                        }}
                      >
                        ⇄ price in {baseSym}
                      </button>
                    </div>
                    <div className="flex items-baseline gap-3">
                      <input
                        className="w-full bg-transparent text-[34px] font-extrabold tracking-tight outline-none"
                        placeholder="0.0"
                        value={priceStr}
                        onChange={(e) => setPriceStr(e.target.value.trim())}
                      />
                      <span className="mono shrink-0 text-[15px] font-bold text-blue">{quoteSym}</span>
                    </div>
                  </div>

                  {/* an existing pool on this pair already trades — propose its price */}
                  {refShown !== null && refPool.data && (
                    <div className="mono mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-green/40 bg-green/5 px-4 py-3 text-[11px]">
                      <span className="text-dim">
                        this pair already trades — 1 {baseSym} ={" "}
                        <b className="text-green">{fnum(refShown)}</b> {quoteSym}{" "}
                        <span className="text-dim2">
                          ({refPool.data.feeLabel}{refPool.data.hooked ? "" : " · no hook"} pool, the deepest live one)
                        </span>
                      </span>
                      <button
                        className="shrink-0 rounded-full border border-green/50 bg-green/10 px-3 py-1 text-[10.5px] font-extrabold text-green transition-all hover:bg-green/20"
                        onClick={() =>
                          setPriceStr(
                            refShown.toLocaleString("en-US", {
                              maximumSignificantDigits: 8,
                              useGrouping: false,
                            }),
                          )
                        }
                      >
                        use market price
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mono rounded-xl border border-green/40 bg-green/5 px-4 py-3 text-[11.5px] text-green">
                  the pool is live — deposits happen at the pool&apos;s current price automatically.
                </div>
              )}

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[15px] font-extrabold">Deposit</span>
                  <span className="pill">full range</span>
                </div>
                <p className="mono mb-3 text-[11px] text-dim2">
                  type one side — the other follows the price. full-range means you earn on every trade
                  at any price, ever.
                </p>
                <PairAmounts
                  sym0={sym0}
                  sym1={sym1}
                  dec0={dec0}
                  dec1={dec1}
                  sqrtP={sqrtP}
                  value={amounts}
                  onChange={(v, edited) => {
                    setAmounts(v);
                    setLastEdited(edited);
                  }}
                  bal0={bal0.data}
                  bal1={bal1.data}
                  native0={key ? isNative(key.currency0) : false}
                  native1={key ? isNative(key.currency1) : false}
                  gasReserve={gasReserve.data}
                />
                {insufficient0 && (
                  <p className="mono mt-2 text-[10.5px] font-bold text-warn">
                    not enough {sym0} — you have {ftoken(bal0.data!, dec0)}, this deposit needs {amounts.a0}
                  </p>
                )}
                {insufficient1 && (
                  <p className="mono mt-2 text-[10.5px] font-bold text-warn">
                    not enough {sym1} — you have {ftoken(bal1.data!, dec1)}, this deposit needs {amounts.a1}
                  </p>
                )}
                {key && isNative(key.currency0) && (
                  <p className="mono mt-2 text-[10.5px] text-dim2">
                    the {net.chain.nativeCurrency.symbol} side is a hard cap — any excess is refunded.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ============================ 3 · superpowers ============================ */}
          {step === 3 && (
            <div className="space-y-6">
              {programExists && (
                <div className="mono rounded-xl border border-yellow/40 bg-yellow/5 px-4 py-3 text-[11.5px] text-[color:var(--yellow,#c9a800)]">
                  this pool's program is already running — your deposit joins it under its EXISTING
                  rules, so nothing below is sent on-chain. edit the live rules from the pool's
                  settings panel after adding.
                </div>
              )}
              <div>
                <div className="mb-1 text-[15px] font-extrabold">Which token does the pot defend?</div>
                <p className="mono mb-3 text-[11px] text-dim2">
                  the pot buys THIS token back on buys and absorbs its sells. usually: your project token.
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { is0: false, sym: sym1, addr: key?.currency1 },
                    { is0: true, sym: sym0, addr: key?.currency0 },
                  ].map((o) => {
                    const on = mainIs0 === o.is0;
                    return (
                      <button
                        key={String(o.is0)}
                        className="rounded-xl border-2 p-4 text-left transition-all"
                        style={{
                          borderColor: on ? PINK : "var(--line)",
                          background: on ? "rgba(254,0,135,.05)" : "transparent",
                          boxShadow: on ? "0 8px 20px rgba(254,0,135,.14)" : "none",
                        }}
                        onClick={() => {
                          setMainIs0(o.is0);
                          // re-derive the preset with the new main side
                          if (preset !== "custom") {
                            const nativeMain = o.addr ? isNative(o.addr) : false;
                            setDraft(presetDraft(preset, nativeMain, me));
                          }
                        }}
                      >
                        <div className="text-[17px] font-extrabold" style={{ color: on ? PINK : "var(--t-txt)" }}>
                          {o.sym}
                        </div>
                        <div className="mono mt-0.5 text-[10px] text-dim2">
                          {on ? "defended · bought back · burnable" : "becomes the buyback currency"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-1 text-[15px] font-extrabold">Pick the machine</div>
                <p className="mono mb-3 text-[11px] text-dim2">
                  one tap configures everything. every preset stays editable later by the operator.
                </p>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {PRESETS.map((p) => {
                    const on = preset === p.id;
                    return (
                      <button
                        key={p.id}
                        className="flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all"
                        style={{
                          borderColor: on ? p.color : "var(--line)",
                          background: on ? `${p.color}0d` : "transparent",
                          transform: on ? "translateY(-2px)" : "none",
                          boxShadow: on ? `0 8px 20px ${p.color}22` : "none",
                        }}
                        onClick={() => pickPreset(p.id)}
                      >
                        <span className="text-[22px]">{p.icon}</span>
                        <span>
                          <span
                            className="block text-[14.5px] font-extrabold"
                            style={{ color: on ? p.color : "var(--t-txt)" }}
                          >
                            {p.name}
                          </span>
                          <span className="mt-0.5 block text-[11.5px] leading-snug text-dim">
                            {p.desc}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* burn / recipient consequences, in plain words */}
              {preset !== "lp" && (
                <div className="mono rounded-xl border border-[var(--line)] bg-panel2 px-4 py-3 text-[11px] leading-relaxed text-dim">
                  {preset === "custom" ? (
                    <>full manual — set every share and recipient below.</>
                  ) : (
                    <SplitSummary draft={draft} mainSym={mainIs0 ? sym0 : sym1} secSym={mainIs0 ? sym1 : sym0} />
                  )}
                </div>
              )}

              <div>
                <div className="label mb-1.5">
                  where do bought-back {mainIs0 ? sym0 : sym1} go? {!mainIsNative && "(empty = BURN 🔥)"}
                </div>
                <input
                  className="input"
                  placeholder={mainIsNative ? "recipient required — the network token can't burn" : "0x… or leave empty to burn"}
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value.trim())}
                />
                {recipientBad && (
                  <p className="mono mt-1 text-[10.5px] text-warn">a native MAIN needs a live recipient</p>
                )}
              </div>

              {/* the buyback split — the new pot-output routing, editable on every machine preset */}
              {advanced && preset !== "custom" && (
                <div className="space-y-3 rounded-xl border border-[rgba(254,0,135,.25)] bg-magenta/5 p-4">
                  <div className="label text-magenta">
                    buyback split — what happens to the {mainIs0 ? sym0 : sym1} the pot buys
                  </div>
                  <Slider
                    label="→ autocompound (becomes pool liquidity)"
                    value={draft.potCompoundPct}
                    onChange={(v) => setDraft(clampDraft(draft, { potCompoundPct: v }))}
                    max={Math.max(0, 100 - draft.potBurnPct)}
                  />
                  {!mainIsNative && (
                    <Slider
                      label="→ burn"
                      value={draft.potBurnPct}
                      onChange={(v) => setDraft(clampDraft(draft, { potBurnPct: v }))}
                      color="#e23a3a"
                      max={Math.max(0, 100 - draft.potCompoundPct)}
                    />
                  )}
                  <div className="mono text-[11px] text-dim2">
                    the rest (
                    <span className="text-lime">
                      {Math.max(0, 100 - draft.potCompoundPct - draft.potBurnPct)}%
                    </span>
                    ) follows the destination above — a live address is delivered to, empty burns.
                  </div>
                </div>
              )}

              {preset === "custom" && (
                <ConfigEditor
                  draft={draft}
                  onChange={setDraft}
                  mainIsNative={mainIsNative}
                  main={mainIs0 ? meta0.data : meta1.data}
                  sec={mainIs0 ? meta1.data : meta0.data}
                />
              )}
            </div>
          )}

          {/* =============================== 4 · launch =============================== */}
          {step === 4 && poolId && (
            <div className="space-y-5">
              {/* the poolId, VERY BIG */}
              <div className="rounded-2xl border-2 border-magenta bg-magenta/5 p-5">
                <div className="label mb-1">
                  pool id {initialized ? <span className="text-green">· LIVE ✓</span> : "· ready to launch"}
                </div>
                <button
                  className="mono w-full break-all text-left text-[clamp(15px,2vw,22px)] font-extrabold leading-tight tracking-tight text-magenta"
                  title="copy"
                  onClick={() => navigator.clipboard?.writeText(poolId)}
                >
                  {poolId}
                </button>
                <div className="mono mt-1 text-[10px] text-dim2">
                  {sym0}/{sym1} · {FEE_TIERS[feeIdx].label} · hook {short(net.hook)} — tap to copy · saved
                  in your browser
                </div>
              </div>

              {/* what the button will do, in plain words */}
              <div className="rounded-2xl border border-[var(--line)] bg-panel2 p-5">
                <div className="mono text-[11.5px] leading-relaxed text-dim">
                  {!initialized ? (
                    <>
                      opens <b className="text-txt">{sym0}/{sym1}</b> at your price, declares{" "}
                      <b className="text-txt">{mainIs0 ? sym0 : sym1}</b> as the defended token with{" "}
                      <b className="text-txt">
                        {recipientAddr === zeroAddress ? "BURN 🔥" : short(recipientAddr)}
                      </b>{" "}
                      as the destination, and seeds{" "}
                      <b className="text-txt">
                        {amounts.a0 || "0"} {sym0} + {amounts.a1 || "0"} {sym1}
                      </b>{" "}
                      full-range with your rules locked in from block one. you become the pot admin
                      and the program owner — all in ONE transaction.
                    </>
                  ) : programExists ? (
                    <>
                      the pool is live and its program already exists — this ADDS{" "}
                      <b className="text-txt">
                        {amounts.a0 || "0"} {sym0} + {amounts.a1 || "0"} {sym1}
                      </b>{" "}
                      into the existing position (pending fees are harvested through the split
                      first). the program's rules stay as they are — edit them from the pool's
                      settings panel. owner-only:{" "}
                      <b className="text-txt">
                        {programOwner === zeroAddress
                          ? "this program is SURRENDERED — nobody can add"
                          : short(programOwner ?? zeroAddress)}
                      </b>
                      .
                    </>
                  ) : (
                    <>
                      the pool is live —{" "}
                      {!potReady && (
                        <>
                          this switches the machine on ({mainIs0 ? sym0 : sym1} defended,{" "}
                          {recipientAddr === zeroAddress ? "BURN 🔥" : short(recipientAddr)} as the
                          destination), then{" "}
                        </>
                      )}
                      seeds{" "}
                      <b className="text-txt">
                        {amounts.a0 || "0"} {sym0} + {amounts.a1 || "0"} {sym1}
                      </b>{" "}
                      full-range{advanced ? " with your program rules" : ""}.
                    </>
                  )}
                </div>
              </div>

              {/* ONE button, Uniswap-style — while approvals are missing it IS the
                  next approval; each press fires one transaction and the label
                  advances on the verified receipt */}
              <button
                className="btn-launch"
                disabled={
                  !key ||
                  (!initialized && !launchSqrt) ||
                  liquidity <= 0n ||
                  insufficient0 ||
                  insufficient1 ||
                  allowancesLoading ||
                  // An add sends no config and touches no roles; only the create path validates them
                  (programExists ? notProgramOwner : recipientBad || !!cfgErr) ||
                  busy ||
                  phase !== null
                }
                onClick={needApprove0 || needApprove1 ? approveNext : doLaunch}
              >
                {phase ??
                  (insufficient0 || insufficient1
                    ? `insufficient ${insufficient0 ? sym0 : sym1} balance`
                    : allowancesLoading
                    ? "checking approvals…"
                    : needApprove0
                      ? `Approve ${sym0}`
                      : needApprove1
                        ? `Approve ${sym1}`
                        : !initialized
                          ? "Launch the pool"
                          : programExists
                            ? "Add liquidity to the program"
                            : potReady
                              ? "Seed the liquidity"
                              : "Switch on + seed")}
              </button>
              <p className="mono -mt-2 text-center text-[10.5px] text-dim2">
                {needApprove0 || needApprove1
                  ? `${needApprove0 && needApprove1 ? "two approvals" : "one approval"} first — one press per step, then the launch.`
                  : !initialized
                    ? "one transaction — pool, roles, rules and liquidity all land together."
                    : programExists
                      ? "one transaction — your deposit joins the live program."
                      : "one transaction — rules and liquidity land together."}
              </p>

              <TxStatus tx={tx} net={net} />
            </div>
          )}

          {/* ------------------------------ nav buttons ------------------------------ */}
          <div className="mt-8 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-5">
            <button
              className="btn btn-ghost btn-sm"
              disabled={step === 1}
              onClick={() => setStep((s) => Math.max(1, s - 1))}
            >
              ← back
            </button>
            {step < 4 ? (
              <button
                className="btn btn-primary"
                disabled={!canContinue}
                onClick={() => setStep((s) => s + 1)}
              >
                {step === 3 ? "Review & launch →" : "Continue →"}
              </button>
            ) : (
              <span className="mono text-[10.5px] text-dim2">
                one transaction, then the machine runs itself forever.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ sub-widgets */

/** the preset's split, spelled out in one line per side */
function SplitSummary({ draft, mainSym, secSym }: { draft: ConfigDraft; mainSym: string; secSym: string }) {
  const secRest = Math.max(0, 100 - draft.compoundPct - draft.buybackPct);
  const mainRest = Math.max(0, 100 - draft.compoundPct - draft.burnPct);
  return (
    <>
      every harvest:{" "}
      <b className="text-txt">
        {secSym} side → {draft.compoundPct > 0 && `${draft.compoundPct}% compound`}
        {draft.compoundPct > 0 && draft.buybackPct > 0 && " + "}
        {draft.buybackPct > 0 && `${draft.buybackPct}% buyback fuel`}
        {secRest > 0 && ` + ${secRest}% to you`}
      </b>
      {" · "}
      <b className="text-txt">
        {mainSym} side → {draft.compoundPct > 0 && `${draft.compoundPct}% compound`}
        {draft.compoundPct > 0 && (draft.burnPct > 0 || mainRest > 0) && " + "}
        {draft.burnPct > 0 && `${draft.burnPct}% burn`}
        {draft.burnPct > 0 && mainRest > 0 && " + "}
        {mainRest > 0 && `${mainRest}% to you`}
      </b>
      {(draft.potCompoundPct > 0 || draft.potBurnPct > 0) && (
        <>
          {" · "}
          <b className="text-txt">
            every buyback → {draft.potCompoundPct > 0 && `${draft.potCompoundPct}% compounds into liquidity`}
            {draft.potCompoundPct > 0 && draft.potBurnPct > 0 && " + "}
            {draft.potBurnPct > 0 && `${draft.potBurnPct}% burns`}
            {100 - draft.potCompoundPct - draft.potBurnPct > 0 &&
              ` + ${100 - draft.potCompoundPct - draft.potBurnPct}% to the pot's recipient`}
          </b>
        </>
      )}
    </>
  );
}

