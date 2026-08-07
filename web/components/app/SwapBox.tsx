"use client";

import { useEffect, useMemo, useState } from "react";
import {
  erc20Abi,
  formatUnits,
  maxUint160,
  maxUint256,
  parseUnits,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import { PERMIT2, type Net } from "@/lib/chains";
import { clientForNet } from "@/lib/client";
import { ftoken } from "@/lib/format";
import { isNative } from "@/lib/hook";
import {
  encodePermit2PermitInput,
  encodeV4ExactInSingle,
  PERMIT2_TYPES,
  permit2Abi,
  UR_COMMAND_PERMIT2_PERMIT,
  universalRouterAbi,
  type PermitSingle,
} from "@/lib/router";
import { useBalanceOf, usePoolState } from "@/lib/usePoolState";
import { useTokenMeta, type TokenMeta } from "@/lib/usePool";
import { usePairUsd, usdStr } from "@/lib/usd";
import { quoteExactIn } from "@/lib/v4math";
import type { RegisteredPool } from "@/lib/registry";
import { TxStatus, useHookTx } from "./forms/useHookTx";
import { useGasReserve } from "@/lib/gas";
import { TokenIconFor } from "./TokenIcon";

/**
 * The swap form, content-only — embedded as the first (default) section of the
 * pool's action box. Quotes locally from the pool's own state and routes
 * through the Universal Router, Uniswap-style: an ERC20 input takes ONE
 * on-chain approve (token→Permit2, once per token ever) on its own press,
 * and the Permit2→router grant rides the swap transaction itself as a
 * gasless EIP-712 signature — there is never a second approval transaction.
 */
export function SwapPanel({ net, pool }: { net: Net; pool: RegisteredPool }) {
  const key = pool.key;
  const { address: me, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const state = usePoolState(net, pool.poolId);
  const meta0 = useTokenMeta(net, key?.currency0);
  const meta1 = useTokenMeta(net, key?.currency1);
  const { tx, send } = useHookTx(net);

  // direction: true = sell currency0 for currency1
  const [zeroForOne, setZeroForOne] = useState(true);
  const [amount, setAmount] = useState("");
  const [slippagePct, setSlippagePct] = useState(1);

  const inToken = (zeroForOne ? key?.currency0 : key?.currency1) as Address | undefined;
  const inMeta: TokenMeta | undefined = zeroForOne ? meta0.data : meta1.data;
  const outMeta: TokenMeta | undefined = zeroForOne ? meta1.data : meta0.data;
  const inBal = useBalanceOf(net, inToken, me);
  const gasReserve = useGasReserve(net);

  const dec0 = meta0.data?.decimals ?? 18;
  const dec1 = meta1.data?.decimals ?? 18;
  const { u0, u1 } = usePairUsd(net, key, state.data?.sqrtPriceX96, dec0, dec1);
  const uIn = zeroForOne ? u0 : u1;
  const uOut = zeroForOne ? u1 : u0;

  // permit2 plumbing state for an ERC20 input — null = still being checked;
  // the gates decide what the button does, so it stays disabled until known
  const [needsTokenApprove, setNeedsTokenApprove] = useState<boolean | null>(null);
  const [needsPermit2, setNeedsPermit2] = useState<boolean | null>(null);

  const amountIn = useMemo(() => {
    try {
      return parseUnits(amount || "0", inMeta?.decimals ?? 18);
    } catch {
      return 0n;
    }
  }, [amount, inMeta]);

  // local quote from raw pool state — single-position pools never cross ticks
  const quote = useMemo(() => {
    if (!state.data?.initialized || amountIn <= 0n || !key) return null;
    return quoteExactIn(
      state.data.sqrtPriceX96,
      state.data.liquidity,
      key.fee,
      zeroForOne,
      amountIn,
    );
  }, [state.data, amountIn, key, zeroForOne]);

  const minOut = quote
    ? (quote.amountOut * BigInt(Math.floor((100 - slippagePct) * 100))) / 10_000n
    : 0n;

  // check the two-stage ERC20 allowance (token→Permit2, Permit2→router)
  useEffect(() => {
    if (!me || !inToken || isNative(inToken) || !net.universalRouter || amountIn <= 0n) {
      setNeedsTokenApprove(false);
      setNeedsPermit2(false);
      return;
    }
    // unknown until the read lands — the button waits rather than guessing
    setNeedsTokenApprove(null);
    setNeedsPermit2(null);
    let dead = false;
    const client = clientForNet(net);
    (async () => {
      try {
        const [erc20Allow, p2] = await Promise.all([
          client.readContract({
            address: inToken,
            abi: erc20Abi,
            functionName: "allowance",
            args: [me, PERMIT2],
          }),
          client.readContract({
            address: PERMIT2,
            abi: permit2Abi,
            functionName: "allowance",
            args: [me, inToken, net.universalRouter!],
          }),
        ]);
        if (dead) return;
        setNeedsTokenApprove((erc20Allow as bigint) < amountIn);
        const [p2Amount, p2Exp] = p2 as [bigint, number, number];
        const now = Math.floor(Date.now() / 1000);
        setNeedsPermit2(p2Amount < amountIn || p2Exp <= now);
      } catch {
        /* RPC hiccup — leave gates as-is */
      }
    })();
    return () => {
      dead = true;
    };
  }, [me, inToken, net, amountIn, tx.s]);

  if (!key) return null;
  if (!net.universalRouter) {
    return (
      <p className="mono text-[12px] text-dim2">
        no Universal Router on {net.label} yet — swap directly against the
        PoolManager from your own contracts.
      </p>
    );
  }

  const inSym = inMeta?.symbol ?? "…";
  const outSym = outMeta?.symbol ?? "…";
  const nativeIn = !!inToken && isNative(inToken);
  const busy = tx.s === "wallet" || tx.s === "pending";
  const inUsd = usdStr(Number(formatUnits(amountIn, inMeta?.decimals ?? 18)), uIn);
  const outUsd =
    quote && outMeta ? usdStr(Number(formatUnits(quote.amountOut, outMeta.decimals)), uOut) : null;

  /**
   * ONE button, one transaction per press. "Approve" grants token→Permit2
   * (the only on-chain approval an ERC20 ever needs); "Swap" swaps — and when
   * the Permit2→router allowance is short, the same swap transaction carries
   * a gasless PermitSingle signature (UR command 0x0a), Uniswap-style, so a
   * second approval transaction never exists.
   */
  async function submit() {
    if (!quote || amountIn <= 0n || !me || !inToken) return;

    // step 1 — token → Permit2 (once per token, ever)
    if (needsTokenApprove) {
      await send({
        address: inToken,
        abi: erc20Abi,
        functionName: "approve",
        args: [PERMIT2, maxUint256],
      });
      return;
    }

    // step 2 — the swap, carrying a Permit2 signature when the router grant is short
    let permitInput: Hex | null = null;
    if (!nativeIn && needsPermit2) {
      try {
        // the signature's domain is chain-bound — make sure the wallet is on it
        if (chainId !== net.chain.id) await switchChainAsync({ chainId: net.chain.id });
        // fresh nonce — Permit2 increments it on every permit
        const [, , nonce] = (await clientForNet(net).readContract({
          address: PERMIT2,
          abi: permit2Abi,
          functionName: "allowance",
          args: [me, inToken, net.universalRouter!],
        })) as [bigint, number, number];
        const now = Math.floor(Date.now() / 1000);
        const permit: PermitSingle = {
          details: {
            token: inToken,
            amount: maxUint160,
            expiration: now + 30 * 24 * 3600, // 30 days — later swaps skip the signature
            nonce,
          },
          spender: net.universalRouter!,
          sigDeadline: BigInt(now + 1800),
        };
        const signature = await signTypedDataAsync({
          domain: { name: "Permit2", chainId: net.chain.id, verifyingContract: PERMIT2 },
          types: PERMIT2_TYPES,
          primaryType: "PermitSingle",
          message: permit,
        });
        permitInput = encodePermit2PermitInput(permit, signature);
      } catch {
        return; // signature rejected / unavailable — nothing was sent
      }
    }

    const { commands, inputs } = encodeV4ExactInSingle({
      key: key!,
      zeroForOne,
      amountIn,
      minAmountOut: minOut,
    });
    const done = await send({
      address: net.universalRouter!,
      abi: universalRouterAbi as Abi,
      functionName: "execute",
      args: permitInput
        ? [
            (UR_COMMAND_PERMIT2_PERMIT + commands.slice(2)) as Hex,
            [permitInput, ...inputs],
            BigInt(Math.floor(Date.now() / 1000) + 1800),
          ]
        : [commands, inputs, BigInt(Math.floor(Date.now() / 1000) + 1800)],
      value: nativeIn ? amountIn : 0n,
    });
    if (done) setAmount("");
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-end">
        <span className="mono text-[10.5px] text-dim2">
          fee {(key.fee / 10_000).toFixed(2)}% · via Universal Router
        </span>
      </div>

      {/* input */}
      <div className="rounded-2xl border border-[var(--line)] bg-panel2 px-4 py-3 transition-colors focus-within:border-magenta/50">
        <div className="mono mb-1 text-[10.5px] text-dim2">you sell</div>
        <div className="flex items-center justify-between">
          <input
            className="w-full bg-transparent text-[26px] font-bold outline-none placeholder:text-dim2"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.trim())}
          />
          <span className="mono ml-3 flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--line)] bg-white py-1 pl-1.5 pr-3 text-[13px] font-bold shadow-sm">
            <TokenIconFor net={net} address={inToken} symbol={inSym} size={22} />
            {inSym}
          </span>
        </div>
        <div className="mono mt-1 flex items-center justify-between text-[10.5px] text-dim2">
          <span>{inUsd ? `≈ ${inUsd}` : ""}</span>
          {inBal.data !== undefined && inMeta && (
            <button
              className="underline decoration-dotted"
              onClick={() => {
                // a native-side max keeps the live gas reserve behind
                const reserve = nativeIn ? gasReserve.data ?? 0n : 0n;
                const max = inBal.data! > reserve ? inBal.data! - reserve : 0n;
                setAmount(formatUnits(max, inMeta.decimals));
              }}
            >
              balance {ftoken(inBal.data, inMeta.decimals)} — max
            </button>
          )}
        </div>
      </div>

      {/* flip */}
      <div className="relative z-10 -my-2.5 flex justify-center">
        <button
          className="grid h-10 w-10 place-items-center rounded-xl border-4 border-[var(--t-bg)] bg-white text-[15px] shadow-md transition-transform hover:rotate-180"
          onClick={() => {
            setZeroForOne((z) => !z);
            setAmount("");
          }}
          title="flip direction"
        >
          ↓
        </button>
      </div>

      {/* output */}
      <div className="rounded-2xl border border-[var(--line)] bg-panel2 px-4 py-3">
        <div className="mono mb-1 text-[10.5px] text-dim2">you receive (estimated)</div>
        <div className="flex items-center justify-between">
          <div className="text-[26px] font-bold">
            {quote && outMeta ? ftoken(quote.amountOut, outMeta.decimals) : "0.0"}
          </div>
          <span className="mono ml-3 flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--line)] bg-white py-1 pl-1.5 pr-3 text-[13px] font-bold shadow-sm">
            <TokenIconFor
              net={net}
              address={(zeroForOne ? key?.currency1 : key?.currency0) ?? null}
              symbol={outSym}
              size={22}
            />
            {outSym}
          </span>
        </div>
        <div className="mono mt-1 flex items-center justify-between text-[10.5px] text-dim2">
          <span>{outUsd ? `≈ ${outUsd}` : ""}</span>
          {quote && outMeta && (
            <span>min {ftoken(minOut, outMeta.decimals)} after {slippagePct}% slippage</span>
          )}
        </div>
      </div>

      {/* slippage */}
      <div className="mt-3 flex items-center gap-2">
        <span className="label">slippage</span>
        {[0.5, 1, 3].map((s) => (
          <button
            key={s}
            className={`pill ${slippagePct === s ? "hi" : ""}`}
            onClick={() => setSlippagePct(s)}
          >
            {s}%
          </button>
        ))}
      </div>

      {/* ONE button, Uniswap-style — the label IS the next step */}
      <button
        className="btn-launch mt-3"
        disabled={
          !quote ||
          amountIn <= 0n ||
          busy ||
          needsTokenApprove === null ||
          needsPermit2 === null
        }
        onClick={submit}
      >
        {needsTokenApprove === null || needsPermit2 === null
          ? "checking approvals…"
          : needsTokenApprove
            ? `Approve ${inSym}`
            : "Swap"}
      </button>
      {(needsTokenApprove || needsPermit2) && !busy && (
        <p className="mono mt-1.5 text-center text-[10.5px] text-dim2">
          {needsTokenApprove
            ? `one-time approval for ${inSym} — the swap comes next, with a free signature`
            : `the swap carries a free Permit2 signature — no extra transaction`}
        </p>
      )}
      <TxStatus tx={tx} net={net} />

      {state.data?.initialized === false && (
        <p className="mono mt-2 text-[10.5px] text-warn">pool not initialized yet</p>
      )}
    </div>
  );
}
