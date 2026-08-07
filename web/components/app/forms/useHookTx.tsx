"use client";

import { useCallback, useState } from "react";
import type { Abi } from "viem";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import type { Net } from "@/lib/chains";
import { clientForNet } from "@/lib/client";
import { glueHookAbi } from "@/lib/hook";
import { wagmiConfig } from "@/lib/wagmi";

export type TxState =
  | { s: "idle" }
  | { s: "wallet" }
  | { s: "pending"; hash: `0x${string}` }
  | { s: "ok"; hash: `0x${string}` }
  | { s: "err"; msg: string };

/**
 * After a receipt lands, make sure the app's own public client has caught up
 * to the receipt's block. The wallet's node and our fallback RPCs are
 * different machines — reading allowance/balance the instant the wallet
 * confirms routinely returns PRE-transaction state, which is how an approval
 * "confirms" yet the UI still demands it. Bounded: never blocks past ~8s.
 */
async function syncReadClient(net: Net, blockNumber: bigint) {
  const client = clientForNet(net);
  for (let i = 0; i < 16; i++) {
    try {
      // cacheTime 0 — the default getBlockNumber cache would defeat the poll
      const b = await client.getBlockNumber({ cacheTime: 0 });
      if (b >= blockNumber) return;
    } catch {
      /* transient RPC failure — keep polling */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** One-stop hook write: switches chain if needed, sends, waits, verifies, reports. */
export function useHookTx(net: Net) {
  const { chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [tx, setTx] = useState<TxState>({ s: "idle" });

  const send = useCallback(
    async (opts: {
      functionName: string;
      args: readonly unknown[];
      value?: bigint;
      address?: `0x${string}`;
      abi?: Abi;
    }) => {
      if (!isConnected) {
        setTx({ s: "err", msg: "connect a wallet first" });
        return null;
      }
      try {
        setTx({ s: "wallet" });
        if (chainId !== net.chain.id) await switchChainAsync({ chainId: net.chain.id });
        const hash = await writeContractAsync({
          address: opts.address ?? net.hook,
          abi: opts.abi ?? (glueHookAbi as Abi),
          functionName: opts.functionName,
          args: opts.args as unknown[],
          value: opts.value,
          chainId: net.chain.id,
        });
        setTx({ s: "pending", hash });
        const receipt = await waitForTransactionReceipt(wagmiConfig, {
          hash,
          chainId: net.chain.id,
        });
        if (receipt.status !== "success") {
          setTx({ s: "err", msg: "transaction reverted on-chain" });
          return null;
        }
        // hold "pending" until our read RPCs can actually SEE the new state
        await syncReadClient(net, receipt.blockNumber);
        setTx({ s: "ok", hash });
        return hash;
      } catch (e) {
        const msg = e instanceof Error ? e.message.split("\n")[0].slice(0, 140) : "transaction failed";
        setTx({ s: "err", msg });
        return null;
      }
    },
    [chainId, isConnected, net, switchChainAsync, writeContractAsync],
  );

  return { tx, send, reset: () => setTx({ s: "idle" }) };
}

export function TxStatus({ tx, net }: { tx: TxState; net: Net }) {
  if (tx.s === "idle") return null;
  return (
    <div className="mono mt-2 text-[11px]">
      {tx.s === "wallet" && <span className="text-warn">confirm in wallet…</span>}
      {tx.s === "pending" && (
        <a href={`${net.explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer" className="text-warn underline">
          pending… view on explorer ↗
        </a>
      )}
      {tx.s === "ok" && (
        <a href={`${net.explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer" className="text-green underline">
          confirmed ✓ view on explorer ↗
        </a>
      )}
      {tx.s === "err" && <span className="text-bad">{tx.msg}</span>}
    </div>
  );
}
