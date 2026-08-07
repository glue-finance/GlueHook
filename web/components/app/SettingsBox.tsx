"use client";

import { useEffect, useMemo, useState } from "react";
import {
  erc20Abi,
  formatUnits,
  isAddress,
  maxUint256,
  parseUnits,
  zeroAddress,
  type Address,
} from "viem";
import { useAccount } from "wagmi";
import type { Net } from "@/lib/chains";
import { ftoken, short } from "@/lib/format";
import {
  fullRangeTicks,
  isNative,
  poolIdOf,
  type PoolKey,
  type Pot,
  type Program,
} from "@/lib/hook";
import { useGasReserve } from "@/lib/gas";
import type { RegisteredPool } from "@/lib/registry";
import { usePairUsd } from "@/lib/usd";
import { useTokenMeta, type TokenMeta } from "@/lib/usePool";
import { positionAmounts, useAllowance, useBalanceOf, usePoolState } from "@/lib/usePoolState";
import { getSqrtRatioAtTick, liquidityForAmounts } from "@/lib/v4math";
import {
  ConfigEditor,
  configError,
  draftToConfig,
  EMPTY_DRAFT,
  type ConfigDraft,
} from "./forms/ConfigEditor";
import { AmountBox, PairAmounts, parseAmt, type PairValue } from "./forms/PairAmounts";
import { TxStatus, useHookTx } from "./forms/useHookTx";
import { ProgramInfo } from "./ProgramInfo";
import { SwapPanel } from "./SwapBox";

type Section = "swap" | "add" | "manage" | "donate" | "info";

/**
 * Desktop tab order. `info` leads — and therefore opens by default — because
 * landing on a pool should first tell you what the pool IS, not put a trade
 * form in front of you. Mobile passes its own subsets (the page hosts an
 * `info` tab of its own), so this order only governs the desktop box.
 */
const ALL_SECTIONS: Section[] = ["info", "swap", "add", "manage", "donate"];

export function SettingsBox({
  net,
  pool,
  pot,
  program,
  sections = ALL_SECTIONS,
}: {
  net: Net;
  pool: RegisteredPool;
  pot: Pot | undefined;
  program: Program | undefined;
  /** subset of tabs to render (mobile splits the box across its own tabs) */
  sections?: Section[];
}) {
  const [section, setSection] = useState<Section>(sections[0] ?? "swap");
  const { address } = useAccount();

  const key = pool.key;
  const main = useTokenMeta(net, pot?.main);
  const sec = useTokenMeta(net, pot?.secondary);

  // add LP / manage only make sense when the LP is (or can become) YOURS:
  // no program yet → anyone may try to create it (the pot admin succeeds);
  // program live → only its owner adds, only owner/operator/admin manage
  const programExists = program?.exists ?? false;
  const isOwner = programExists && !!address && program!.owner.toLowerCase() === address.toLowerCase();
  const isOperator = programExists && !!address && program!.operator.toLowerCase() === address.toLowerCase();
  const isAdmin = !!pot && !!address && pot.admin.toLowerCase() === address.toLowerCase();
  const showAdd = !programExists || isOwner;
  const showManage = programExists && (isOwner || isOperator || isAdmin);

  const tabs = useMemo(() => {
    return sections.filter((s) => {
      if (s === "add") return showAdd;
      if (s === "manage") return showManage;
      return true;
    });
  }, [sections, showAdd, showManage]);

  // a wallet change can hide the open tab — fall back to the first visible one
  useEffect(() => {
    if (tabs.length > 0 && !tabs.includes(section)) setSection(tabs[0]);
  }, [tabs, section]);

  // the box outlives a pool switch, so reset it: a new pool always opens on
  // its leading tab rather than inheriting the previous pool's open form
  useEffect(() => {
    setSection(sections[0] ?? "swap");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.poolId]);

  if (!key) {
    return (
      <div className="panel p-5">
        <div className="mono text-[12px] leading-relaxed text-dim">
          This pool&apos;s PoolKey couldn&apos;t be recovered from public logs, so
          key-bound operations aren&apos;t available here. The pot itself is live —
          integrate directly against the contract.
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="border-b border-[var(--line)] p-2">
        {/* an owner sees all five tabs — compact them on desktop so "info" never clips */}
        <div className={`tabbar w-full !p-[3px] ${tabs.length >= 5 ? "compact" : ""}`}>
          {tabs.map((s) => (
            <button
              key={s}
              className={`flex-1 ${section === s ? "on" : ""}`}
              onClick={() => setSection(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="p-5">
        {section === "swap" && <SwapPanel net={net} pool={pool} />}
        {section === "add" && (
          <AddLiquidity net={net} poolKey={key} pot={pot} program={program} main={main.data} sec={sec.data} me={address} />
        )}
        {section === "manage" && (
          <Manage net={net} pool={pool} poolKey={key} pot={pot} program={program} main={main.data} sec={sec.data} me={address} />
        )}
        {section === "donate" && (
          <Donate net={net} poolKey={key} pot={pot} sec={sec.data} me={address} />
        )}
        {section === "info" && <ProgramInfo net={net} pot={pot} program={program} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ add LP */

function AddLiquidity({
  net,
  poolKey,
  pot,
  program,
  main,
  sec,
  me,
}: {
  net: Net;
  poolKey: PoolKey;
  pot: Pot | undefined;
  program: Program | undefined;
  main?: TokenMeta;
  sec?: TokenMeta;
  me?: Address;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [owner, setOwner] = useState("");
  const [draft, setDraft] = useState<ConfigDraft>({ ...EMPTY_DRAFT });
  const [amounts, setAmounts] = useState<PairValue>({ a0: "", a1: "" });
  const [phase, setPhase] = useState<string | null>(null);
  const { tx, send } = useHookTx(net);

  const poolId = useMemo(() => poolIdOf(poolKey), [poolKey]);
  const state = usePoolState(net, poolId);
  const meta0 = useTokenMeta(net, poolKey.currency0);
  const meta1 = useTokenMeta(net, poolKey.currency1);
  const bal0 = useBalanceOf(net, poolKey.currency0, me);
  const bal1 = useBalanceOf(net, poolKey.currency1, me);
  const dec0 = meta0.data?.decimals ?? 18;
  const dec1 = meta1.data?.decimals ?? 18;
  const gasReserve = useGasReserve(net);
  const pairUsd = usePairUsd(net, poolKey, state.data?.sqrtPriceX96, dec0, dec1);

  const hasNative = isNative(poolKey.currency0);
  const programExists = program?.exists ?? false;
  const mainIsNative = pot ? isNative(pot.main) : false;

  const ownerAddr: Address = isAddress(owner) ? (owner as Address) : owner === "" && me ? me : zeroAddress;
  const surrendered = ownerAddr === zeroAddress;

  const cfgErr = advanced
    ? configError(draft, mainIsNative, main?.decimals ?? 18, sec?.decimals ?? 18)
    : null;

  // amounts → uint128 liquidity, computed at the LIVE price over the position's
  // range (an existing program's own ticks, else full range)
  const liq = useMemo(() => {
    const sqrtP = state.data?.sqrtPriceX96;
    if (!sqrtP || sqrtP === 0n) return 0n;
    const amt0 = parseAmt(amounts.a0, dec0);
    const amt1 = parseAmt(amounts.a1, dec1);
    if (amt0 <= 0n && amt1 <= 0n) return 0n;
    const range = programExists
      ? { tickLower: program!.tickLower, tickUpper: program!.tickUpper }
      : fullRangeTicks(poolKey.tickSpacing);
    const L = liquidityForAmounts(
      sqrtP,
      getSqrtRatioAtTick(range.tickLower),
      getSqrtRatioAtTick(range.tickUpper),
      amt0,
      amt1,
    );
    // shave a hair so on-chain round-up never exceeds the typed amounts
    return L > 1_000_000n ? L - L / 1_000_000n : L;
  }, [state.data, amounts, dec0, dec1, programExists, program, poolKey.tickSpacing]);

  // Live allowance reads gate the ONE action button, Uniswap-style: while an
  // approval is missing the button IS that approval — one transaction per
  // press, and the label advances once the receipt is verified.
  const amt0 = parseAmt(amounts.a0, dec0);
  const amt1 = parseAmt(amounts.a1, dec1);
  // Uniswap rule: an amount above the wallet balance disables the button
  const insufficient0 = amt0 > 0n && bal0.data !== undefined && amt0 > bal0.data;
  const insufficient1 = amt1 > 0n && bal1.data !== undefined && amt1 > bal1.data;
  const allow0 = useAllowance(net, poolKey.currency0, me, net.hook);
  const allow1 = useAllowance(net, poolKey.currency1, me, net.hook);
  const needApprove0 =
    !isNative(poolKey.currency0) && amt0 > 0n && allow0.data !== undefined && allow0.data < amt0;
  const needApprove1 =
    !isNative(poolKey.currency1) && amt1 > 0n && allow1.data !== undefined && allow1.data < amt1;
  const allowancesLoading =
    (!isNative(poolKey.currency0) && amt0 > 0n && allow0.data === undefined) ||
    (!isNative(poolKey.currency1) && amt1 > 0n && allow1.data === undefined);

  /** one press = one approval — the next press does the next step */
  async function approveNext() {
    const token = needApprove0 ? poolKey.currency0 : poolKey.currency1;
    const sym = needApprove0
      ? meta0.data?.symbol ?? short(poolKey.currency0)
      : meta1.data?.symbol ?? short(poolKey.currency1);
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

  async function submit() {
    if (needApprove0 || needApprove1) return; // the button is the approval until then
    const value = hasNative ? parseAmt(amounts.a0, 18) : 0n;
    if (programExists) {
      await send({ functionName: "addProgramLiquidity", args: [poolKey, liq], value });
    } else if (advanced) {
      await send({
        functionName: "addLiquidityAdvanced",
        args: [poolKey, 0, 0, liq, ownerAddr, draftToConfig(draft, main?.decimals ?? 18, sec?.decimals ?? 18)],
        value,
      });
    } else {
      await send({
        functionName: "addLiquidity",
        args: [poolKey, 0, 0, liq, ownerAddr],
        value,
      });
    }
  }

  return (
    <div className="space-y-4">
      {programExists ? (
        <p className="mono text-[11.5px] leading-relaxed text-dim2">
          this pool already has its LP program ({short(program!.owner)}) — adding
          tops up the existing position at ticks [{program!.tickLower}, {program!.tickUpper}].
          only the owner can add.
        </p>
      ) : pot && me && pot.admin.toLowerCase() !== me.toLowerCase() ? (
        <p className="mono rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-[11.5px] leading-relaxed text-warn">
          only the pot admin ({short(pot.admin)}) can create this pool&apos;s one LP
          program — the admin is whoever initialized the pool on the PoolManager.
        </p>
      ) : null}
      {!programExists && (
        <div className="flex items-center justify-between">
          <span className="label">mode</span>
          <div className="tabbar !p-[3px]">
            <button className={!advanced ? "on" : ""} onClick={() => setAdvanced(false)}>
              normal
            </button>
            <button className={advanced ? "on" : ""} onClick={() => setAdvanced(true)}>
              advanced
            </button>
          </div>
        </div>
      )}

      {/* classic deposit boxes — type one side, the other follows the price */}
      <PairAmounts
        sym0={meta0.data?.symbol ?? "…"}
        sym1={meta1.data?.symbol ?? "…"}
        dec0={dec0}
        dec1={dec1}
        sqrtP={state.data?.sqrtPriceX96 ?? null}
        value={amounts}
        onChange={setAmounts}
        bal0={bal0.data}
        bal1={bal1.data}
        native0={hasNative}
        gasReserve={gasReserve.data}
        usd0={pairUsd.u0}
        usd1={pairUsd.u1}
      />
      {!programExists && (
        <p className="mono text-[10.5px] text-dim2">
          full range (spacing {poolKey.tickSpacing}: [
          {fullRangeTicks(poolKey.tickSpacing).tickLower}, {fullRangeTicks(poolKey.tickSpacing).tickUpper}])
          {hasNative && " · the native side is a hard cap, excess refunded"}
        </p>
      )}

      {!programExists && (
        <div>
          <div className="label mb-1.5">owner (empty = you)</div>
          <input
            className="input"
            placeholder={me ?? "0x…"}
            value={owner}
            onChange={(e) => setOwner(e.target.value.trim())}
          />
          {surrendered && (
            <div className="mono mt-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-[11.5px] text-bad">
              owner = 0x0 → this liquidity is LOCKED FOREVER and harvest is forced
              public. nobody — including you — can ever withdraw it.
            </div>
          )}
        </div>
      )}

      {advanced && !programExists && (
        <ConfigEditor draft={draft} onChange={setDraft} mainIsNative={mainIsNative} main={main} sec={sec} />
      )}

      <button
        className="btn-launch"
        disabled={
          liq === 0n ||
          insufficient0 ||
          insufficient1 ||
          !!cfgErr ||
          allowancesLoading ||
          tx.s === "wallet" ||
          tx.s === "pending" ||
          phase !== null
        }
        onClick={needApprove0 || needApprove1 ? approveNext : submit}
      >
        {phase ??
          (insufficient0 || insufficient1
            ? `Insufficient ${
                insufficient0
                  ? meta0.data?.symbol ?? short(poolKey.currency0)
                  : meta1.data?.symbol ?? short(poolKey.currency1)
              } balance`
            : allowancesLoading
              ? "checking approvals…"
              : needApprove0
                ? `Approve ${meta0.data?.symbol ?? short(poolKey.currency0)}`
                : needApprove1
                  ? `Approve ${meta1.data?.symbol ?? short(poolKey.currency1)}`
                  : programExists
                    ? "Add to program"
                    : advanced
                      ? "Add liquidity (advanced)"
                      : "Add liquidity")}
      </button>
      {(needApprove0 || needApprove1) && phase === null && (
        <p className="mono -mt-2 text-center text-[10.5px] text-dim2">
          one press per step — approve, then add.
        </p>
      )}
      <TxStatus tx={tx} net={net} />
    </div>
  );
}

/* ------------------------------------------------------------------ manage */

function Manage({
  net,
  pool,
  poolKey,
  pot,
  program,
  main,
  sec,
  me,
}: {
  net: Net;
  pool: RegisteredPool;
  poolKey: PoolKey;
  pot: Pot | undefined;
  program: Program | undefined;
  main?: TokenMeta;
  sec?: TokenMeta;
  me?: Address;
}) {
  const { tx, send } = useHookTx(net);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [removePct, setRemovePct] = useState(50);
  const [newOwner, setNewOwner] = useState("");
  const [newOperator, setNewOperator] = useState("");
  const [newRecipient, setNewRecipient] = useState("");

  const state = usePoolState(net, pool.poolId);
  const meta0 = useTokenMeta(net, poolKey.currency0);
  const meta1 = useTokenMeta(net, poolKey.currency1);

  const isOwner = !!me && !!program && program.owner.toLowerCase() === me.toLowerCase();
  const isOperator = !!me && !!program && program.operator.toLowerCase() === me.toLowerCase();
  const isAdmin = !!me && !!pot && pot.admin.toLowerCase() === me.toLowerCase();
  const mainIsNative = pot ? isNative(pot.main) : false;

  const removeL = program ? (program.liquidity * BigInt(removePct)) / 100n : 0n;
  const removePreview = positionAmounts(
    state.data,
    removeL,
    program?.tickLower,
    program?.tickUpper,
  );

  if (!program?.exists) {
    return (
      <p className="mono text-[12px] leading-relaxed text-dim2">
        no LP program on this pool yet — create one in the add tab. the pot
        (donations, pump, shield) works regardless.
      </p>
    );
  }

  // seed the config editor from the live program (mins converted to human units)
  const mainDec = main?.decimals ?? 18;
  const secDec = sec?.decimals ?? 18;
  const liveDraft: ConfigDraft = draft ?? {
    compoundPct: Number(program.compoundShareWad / 10n ** 16n),
    buybackPct: Number(program.buybackShareWad / 10n ** 16n),
    burnPct: Number(program.burnShareWad / 10n ** 16n),
    potCompoundPct: Number(program.potCompoundShareWad / 10n ** 16n),
    potBurnPct: Number(program.potBurnShareWad / 10n ** 16n),
    publicHarvest: program.publicHarvest,
    secondaryRecipient: program.secondaryRecipient === zeroAddress ? "" : program.secondaryRecipient,
    mainRecipient: program.mainRecipient === zeroAddress ? "" : program.mainRecipient,
    minMain: formatUnits(program.minMain, mainDec),
    minSecondary: formatUnits(program.minSecondary, secDec),
  };

  const cfgErr = configError(liveDraft, mainIsNative, mainDec, secDec);

  return (
    <div className="space-y-6">
      {/* roles */}
      <div className="space-y-1">
        <div className="row">
          <span className="text-dim">owner</span>
          <span className="v">
            {program.owner === zeroAddress ? (
              <span className="text-bad">surrendered — LP locked forever</span>
            ) : (
              <>{short(program.owner)}{isOwner && <span className="text-green"> (you)</span>}</>
            )}
          </span>
        </div>
        <div className="row">
          <span className="text-dim">operator</span>
          <span className="v">
            {program.operator === zeroAddress ? (
              <span className="text-warn">surrendered — config frozen</span>
            ) : (
              <>{short(program.operator)}{isOperator && <span className="text-green"> (you)</span>}</>
            )}
          </span>
        </div>
        <div className="row">
          <span className="text-dim">pot admin</span>
          <span className="v">
            {short(pot?.admin ?? "")}
            {isAdmin && <span className="text-green"> (you)</span>}
          </span>
        </div>
      </div>

      {/* harvest */}
      <div>
        <button
          className="btn btn-primary w-full"
          disabled={tx.s === "wallet" || tx.s === "pending" || (!program.publicHarvest && !isOwner)}
          onClick={() => send({ functionName: "harvest", args: [poolKey] })}
        >
          Harvest now
        </button>
        {!program.publicHarvest && !isOwner && (
          <p className="mono mt-1.5 text-[10.5px] text-dim2">harvest is owner-only on this pool</p>
        )}
      </div>

      {/* operator: config */}
      {(isOperator || isOwner) && (
        <details className="group">
          <summary className="label cursor-pointer py-1 group-open:text-green">▸ edit program config (operator)</summary>
          <div className="mt-3 space-y-3">
            <ConfigEditor draft={liveDraft} onChange={setDraft} mainIsNative={mainIsNative} main={main} sec={sec} />
            <button
              className="btn btn-ghost w-full"
              disabled={!isOperator || !!cfgErr || tx.s === "wallet" || tx.s === "pending"}
              onClick={() =>
                send({
                  functionName: "setProgramConfig",
                  args: [pool.poolId, draftToConfig(liveDraft, main?.decimals ?? 18, sec?.decimals ?? 18)],
                })
              }
            >
              {isOperator ? "Save config" : "only the operator can save"}
            </button>
          </div>
        </details>
      )}

      {/* owner: liquidity + roles */}
      {isOwner && (
        <details className="group">
          <summary className="label cursor-pointer py-1 group-open:text-green">▸ owner controls</summary>
          <div className="mt-3 space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label">remove liquidity</span>
                <span className="mono text-[12px] font-bold text-magenta">{removePct}%</span>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={removePct}
                onChange={(e) => setRemovePct(Number(e.target.value))}
              />
              <div className="mono mt-1.5 flex items-center justify-between text-[10.5px] text-dim2">
                <span>
                  ≈ {ftoken(removePreview.amount0, meta0.data?.decimals ?? 18)}{" "}
                  {meta0.data?.symbol ?? "…"} + {ftoken(removePreview.amount1, meta1.data?.decimals ?? 18)}{" "}
                  {meta1.data?.symbol ?? "…"}
                </span>
                <span>pending fees harvest first</span>
              </div>
              <button
                className="btn btn-ghost mt-2 w-full"
                disabled={removeL <= 0n || tx.s === "wallet" || tx.s === "pending"}
                onClick={() =>
                  send({ functionName: "removeProgramLiquidity", args: [poolKey, removeL, me] })
                }
              >
                Remove {removePct}% of the position
              </button>
            </div>
            <div>
              <div className="label mb-1.5">transfer ownership (0x0 = surrender, locks LP forever)</div>
              <div className="flex gap-2">
                <input className="input" placeholder="0x…" value={newOwner} onChange={(e) => setNewOwner(e.target.value.trim())} />
                <button
                  className="btn btn-ghost btn-sm flex-shrink-0"
                  disabled={!isAddress(newOwner) && newOwner !== "0x0" || tx.s === "wallet" || tx.s === "pending"}
                  onClick={() =>
                    send({
                      functionName: "transferProgramOwnership",
                      args: [pool.poolId, newOwner === "0x0" ? zeroAddress : (newOwner as Address)],
                    })
                  }
                >
                  transfer
                </button>
              </div>
            </div>
          </div>
        </details>
      )}

      {(isOperator || isOwner) && (
        <details className="group">
          <summary className="label cursor-pointer py-1 group-open:text-green">▸ set operator</summary>
          <div className="mt-3 flex gap-2">
            <input className="input" placeholder="0x… (0x0 = surrender settings)" value={newOperator} onChange={(e) => setNewOperator(e.target.value.trim())} />
            <button
              className="btn btn-ghost btn-sm flex-shrink-0"
              disabled={(!isAddress(newOperator) && newOperator !== "0x0") || tx.s === "wallet" || tx.s === "pending"}
              onClick={() =>
                send({
                  functionName: "setProgramOperator",
                  args: [pool.poolId, newOperator === "0x0" ? zeroAddress : (newOperator as Address)],
                })
              }
            >
              set
            </button>
          </div>
        </details>
      )}

      {/* pot admin: recipient */}
      {isAdmin && (
        <details className="group">
          <summary className="label cursor-pointer py-1 group-open:text-green">▸ pot recipient (admin)</summary>
          <div className="mt-3 space-y-2">
            <p className="mono text-[10.5px] text-dim2">
              current: {pot!.recipient === zeroAddress ? "BURN (cascade)" : short(pot!.recipient)} · 0x0 = burn
              {mainIsNative && " — burn not allowed: MAIN is native"}
            </p>
            <div className="flex gap-2">
              <input className="input" placeholder="0x… (0x0 = burn)" value={newRecipient} onChange={(e) => setNewRecipient(e.target.value.trim())} />
              <button
                className="btn btn-ghost btn-sm flex-shrink-0"
                disabled={(!isAddress(newRecipient) && newRecipient !== "0x0") || tx.s === "wallet" || tx.s === "pending"}
                onClick={() =>
                  send({
                    functionName: "setRecipient",
                    args: [pool.poolId, newRecipient === "0x0" ? zeroAddress : (newRecipient as Address)],
                  })
                }
              >
                set
              </button>
            </div>
          </div>
        </details>
      )}

      <TxStatus tx={tx} net={net} />
    </div>
  );
}

/* ------------------------------------------------------------------ donate */

function Donate({
  net,
  poolKey,
  pot,
  sec,
  me,
}: {
  net: Net;
  poolKey: PoolKey;
  pot: Pot | undefined;
  sec?: TokenMeta;
  me?: Address;
}) {
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<string | null>(null);
  const { tx, send } = useHookTx(net);
  const secIsNative = pot ? isNative(pot.secondary) : false;
  const dec = sec?.decimals ?? 18;

  // balance + live USD for the donated (SECONDARY) side
  const bal = useBalanceOf(net, pot?.secondary, me);
  const gasReserve = useGasReserve(net);
  const poolId = useMemo(() => poolIdOf(poolKey), [poolKey]);
  const state = usePoolState(net, poolId);
  const meta0 = useTokenMeta(net, poolKey.currency0);
  const meta1 = useTokenMeta(net, poolKey.currency1);
  const pairUsd = usePairUsd(
    net,
    poolKey,
    state.data?.sqrtPriceX96,
    meta0.data?.decimals ?? 18,
    meta1.data?.decimals ?? 18,
  );
  const secIs0 = pot ? pot.secondary.toLowerCase() === poolKey.currency0.toLowerCase() : false;
  const secUsd = secIs0 ? pairUsd.u0 : pairUsd.u1;

  // Live allowance read gates the ONE button, Uniswap-style: while the
  // approval is missing the button IS the approval — one transaction per
  // press, label advancing on the verified receipt.
  const allowSec = useAllowance(net, pot?.secondary, me, net.hook);
  const amtParsed = (() => {
    try {
      return parseUnits(amount || "0", dec);
    } catch {
      return 0n;
    }
  })();
  const needApprove =
    !secIsNative && amtParsed > 0n && allowSec.data !== undefined && allowSec.data < amtParsed;
  const allowanceLoading = !secIsNative && amtParsed > 0n && allowSec.data === undefined;
  // Uniswap rule: an amount above the wallet balance disables the button
  const insufficient = amtParsed > 0n && bal.data !== undefined && amtParsed > bal.data;

  /** one press = the approval — the next press donates */
  async function approveSec() {
    if (!pot) return;
    setPhase(`approving ${sec?.symbol ?? short(pot.secondary)}…`);
    try {
      await send({
        address: pot.secondary,
        abi: erc20Abi,
        functionName: "approve",
        args: [net.hook, maxUint256],
      });
      await allowSec.refetch();
    } finally {
      setPhase(null);
    }
  }

  async function submit() {
    if (!pot || amtParsed <= 0n || needApprove) return;
    await send({
      functionName: "donate",
      args: [poolKey, amtParsed],
      value: secIsNative ? amtParsed : 0n,
    });
  }

  return (
    <div className="space-y-4">
      <p className="mono text-[11.5px] leading-relaxed text-dim2">
        donations fuel the pot in the SECONDARY currency ({sec?.symbol ?? "…"}).
        the pot spends them pumping buys and shielding sells — permissionless,
        anyone can fuel any pool.
      </p>
      <AmountBox
        sym={sec?.symbol ?? "…"}
        value={amount}
        onChange={setAmount}
        bal={bal.data}
        dec={dec}
        native={secIsNative}
        gasReserve={gasReserve.data}
        unitUsd={secUsd}
      />
      <button
        className="btn-launch"
        disabled={
          amtParsed <= 0n ||
          insufficient ||
          allowanceLoading ||
          tx.s === "wallet" ||
          tx.s === "pending" ||
          phase !== null
        }
        onClick={needApprove ? approveSec : submit}
      >
        {phase ??
          (insufficient
            ? `Insufficient ${sec?.symbol ?? "…"} balance`
            : allowanceLoading
              ? "checking approval…"
              : needApprove
                ? `Approve ${sec?.symbol ?? (pot ? short(pot.secondary) : "…")}`
                : "Donate to the pot")}
      </button>
      {needApprove && phase === null && (
        <p className="mono -mt-2 text-center text-[10.5px] text-dim2">
          one press per step — approve, then donate.
        </p>
      )}
      <TxStatus tx={tx} net={net} />
    </div>
  );
}
