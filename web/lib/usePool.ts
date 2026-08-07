"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { erc20Abi, zeroAddress, type Address, type Hex } from "viem";
import type { Net } from "./chains";
import { clientForNet } from "./client";
import { fetchPoolEvents, resolveTimestamps, type PoolEvent } from "./events";
import { glueHookAbi, isNative, type PoolKey, type Pot, type Program } from "./hook";
import { importPool, scanPools, type RegisteredPool } from "./registry";

// ---------------------------------------------------------------------------
// Pool registry
// ---------------------------------------------------------------------------

export function usePoolList(net: Net) {
  const [progress, setProgress] = useState<number | null>(null);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["pools", net.chain.id],
    queryFn: async () => {
      const pools = await scanPools(net, (scanned, total) =>
        setProgress(Math.min(100, Number((scanned * 100n) / total))),
      );
      setProgress(null);
      return pools;
    },
    staleTime: 60_000,
    retry: 1,
  });
  const importById = useCallback(
    async (poolId: Hex): Promise<RegisteredPool | null> => {
      const p = await importPool(net, poolId);
      if (p) qc.invalidateQueries({ queryKey: ["pools", net.chain.id] });
      return p;
    },
    [net, qc],
  );
  return { ...q, progress, importById };
}

// ---------------------------------------------------------------------------
// Live pot + program state
// ---------------------------------------------------------------------------

export function usePot(net: Net, poolId: Hex | null) {
  return useQuery({
    queryKey: ["pot", net.chain.id, poolId],
    enabled: !!poolId,
    refetchInterval: 12_000,
    queryFn: async (): Promise<Pot> => {
      const client = clientForNet(net);
      return (await client.readContract({
        address: net.hook,
        abi: glueHookAbi,
        functionName: "potOf",
        args: [poolId!],
      })) as Pot;
    },
  });
}

export function useProgram(net: Net, poolId: Hex | null) {
  return useQuery({
    queryKey: ["program", net.chain.id, poolId],
    enabled: !!poolId,
    refetchInterval: 12_000,
    queryFn: async (): Promise<Program> => {
      const client = clientForNet(net);
      return (await client.readContract({
        address: net.hook,
        abi: glueHookAbi,
        functionName: "programOf",
        args: [poolId!],
      })) as Program;
    },
  });
}

// ---------------------------------------------------------------------------
// Quotes (attack / defense curves)
// ---------------------------------------------------------------------------

/**
 * The pot's attack / defense curves, quoted by the hook's own views.
 * UNITS MATTER: `quotePump` speaks SECONDARY on both axes (the carrying buy's
 * input and the pot's spend), but `quoteShield` speaks MAIN (the sell being
 * absorbed) — so the shield probes are the pot's balance TRANSLATED into
 * main-side sizes through the pool's live price.
 */
export function useQuoteCurves(
  net: Net,
  key: PoolKey | null,
  potBalance: bigint | undefined,
  sqrtPriceX96: bigint | undefined,
  mainIs0: boolean,
) {
  return useQuery({
    queryKey: [
      "quotes",
      net.chain.id,
      key ? JSON.stringify(key) : null,
      potBalance?.toString(),
      sqrtPriceX96?.toString(),
      mainIs0,
    ],
    enabled: !!key && potBalance !== undefined && potBalance > 0n && !!sqrtPriceX96,
    staleTime: 30_000,
    queryFn: async () => {
      const client = clientForNet(net);
      const bal = potBalance!;
      const steps = [1n, 2n, 5n, 10n, 25n, 50n, 100n, 250n, 500n];

      // pump probes: SECONDARY buy sizes around the pot's own (secondary) scale
      const pumpSizes = steps.map((m) => (bal * m) / 100n);

      // shield probes: the same scale ladder converted to MAIN raw units at the
      // pool's live price — raw main per raw secondary
      const r = Number(sqrtPriceX96!) / 2 ** 96;
      const rawMainPerRawSec = mainIs0 ? 1 / (r * r) : r * r;
      const shieldSizes = pumpSizes.map((s) => {
        const v = Number(s) * rawMainPerRawSec;
        return isFinite(v) && v >= 1 ? BigInt(Math.round(v)) : 1n;
      });

      const pump = await Promise.all(
        pumpSizes.map(async (s) => {
          try {
            const [spend, out] = (await client.readContract({
              address: net.hook,
              abi: glueHookAbi,
              functionName: "quotePump",
              args: [key!, s],
            })) as [bigint, bigint];
            return { size: s, spend, out };
          } catch {
            return { size: s, spend: 0n, out: 0n };
          }
        }),
      );
      const shield = await Promise.all(
        shieldSizes.map(async (s) => {
          try {
            const [absorbed, paid] = (await client.readContract({
              address: net.hook,
              abi: glueHookAbi,
              functionName: "quoteShield",
              args: [key!, -s],
            })) as [bigint, bigint];
            return { size: s, absorbed, paid };
          } catch {
            return { size: s, absorbed: 0n, paid: 0n };
          }
        }),
      );
      return { pump, shield };
    },
  });
}

// ---------------------------------------------------------------------------
// Event feed with incremental polling
// ---------------------------------------------------------------------------

export function useFeed(net: Net, pool: RegisteredPool | null) {
  const [events, setEvents] = useState<PoolEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!pool) {
      setEvents([]);
      return;
    }
    let dead = false;
    setLoading(true);

    async function pull(first: boolean) {
      try {
        const evs = await fetchPoolEvents(
          net,
          pool!.poolId,
          pool!.block,
          first
            ? (s, t) => setProgress(Math.min(100, Number((s * 100n) / t)))
            : undefined,
        );
        const stamped = await resolveTimestamps(net, pool!.poolId, evs);
        if (!dead) {
          setEvents([...stamped]);
          setProgress(null);
        }
      } catch {
        /* transient RPC failure — next poll retries */
      }
      if (!dead && first) setLoading(false);
    }

    pull(true);
    const id = setInterval(() => pull(false), 6000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [net, pool]);

  return { events, loading, progress };
}

// ---------------------------------------------------------------------------
// Token metadata
// ---------------------------------------------------------------------------

export type TokenMeta = { symbol: string; decimals: number };

export function useTokenMeta(net: Net, addr: Address | null | undefined) {
  return useQuery({
    queryKey: ["token", net.chain.id, addr],
    enabled: !!addr,
    staleTime: Infinity,
    queryFn: async (): Promise<TokenMeta> => {
      if (!addr || isNative(addr))
        return {
          symbol: net.chain.nativeCurrency.symbol,
          decimals: net.chain.nativeCurrency.decimals,
        };
      const client = clientForNet(net);
      try {
        const [symbol, decimals] = await Promise.all([
          client.readContract({ address: addr, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address: addr, abi: erc20Abi, functionName: "decimals" }),
        ]);
        return { symbol: symbol as string, decimals: Number(decimals) };
      } catch {
        return { symbol: addr.slice(0, 6), decimals: 18 };
      }
    },
  });
}

export { zeroAddress };
