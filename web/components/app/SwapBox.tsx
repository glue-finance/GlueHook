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
} from "viem";
import { useAccount } from "wagmi";
import { PERMIT2, type Net } from "@/lib/chains";
import { clientForNet } from "@/lib/client";
import { ftoken } from "@/lib/format";
import { isNative } from "@/lib/hook";
import { encodeV4ExactInSingle, permit2Abi, universalRouterAbi } from "@/lib/router";
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
 * pool's action box. Quotes locally from the pool's own state, routes through
 * the Universal Router, and walks the two Permit2 approval stages with explicit
 * Uniswap-style buttons.
 */
export function SwapPanel({ net, pool }: { net: Net; pool: RegisteredPool }) {
  const key = pool.key;
  const { address: me } = useAccount();
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

  // permit2 plumbing state for an ERC20 input
  const [needsTokenApprove, setNeedsTokenApprove] = useState(false);
  const [needsPermit2, setNeedsPermit2] = useState(false);

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

  async function submit() {
    if (!quote || amountIn <= 0n) return;
    const { commands, inputs } = encodeV4ExactInSingle({
      key: key!,
      zeroForOne,
      amountIn,
      minAmountOut: minOut,
    });
    await send({
      address: net.universalRouter!,
      abi: universalRouterAbi as Abi,
      functionName: "execute",
      args: [commands, inputs, BigInt(Math.floor(Date.now() / 1000) + 1800)],
      value: nativeIn ? amountIn : 0n,
    });
    setAmount("");
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

      {/* ERC20 input: the two Permit2 stages as explicit approve buttons */}
      {needsTokenApprove && inToken && (
        <button
          className="btn-approve mt-3"
          disabled={busy}
          onClick={() =>
            send({
              address: inToken,
              abi: erc20Abi,
              functionName: "approve",
              args: [PERMIT2, maxUint256],
            })
          }
        >
          Approve {inSym}
        </button>
      )}
      {!needsTokenApprove && needsPermit2 && inToken && (
        <button
          className="btn-approve mt-3"
          disabled={busy}
          onClick={() =>
            send({
              address: PERMIT2,
              abi: permit2Abi as Abi,
              functionName: "approve",
              args: [inToken, net.universalRouter!, maxUint160, 2n ** 48n - 1n],
            })
          }
        >
          Allow the router to spend {inSym}
        </button>
      )}

      <button
        className="btn-launch mt-3"
        disabled={
          !quote ||
          amountIn <= 0n ||
          needsTokenApprove ||
          needsPermit2 ||
          busy
        }
        onClick={submit}
      >
        {needsTokenApprove || needsPermit2 ? "approve first" : "Swap"}
      </button>
      <TxStatus tx={tx} net={net} />

      {state.data?.initialized === false && (
        <p className="mono mt-2 text-[10.5px] text-warn">pool not initialized yet</p>
      )}
    </div>
  );
}
