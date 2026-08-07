"use client";

import { useQuery } from "@tanstack/react-query";
import { erc20Abi, type Address, type Hex } from "viem";
import type { Net } from "./chains";
import { clientForNet } from "./client";
import { isNative } from "./hook";
import {
  amountsForLiquidity,
  getSqrtRatioAtTick,
  liquiditySlot,
  slot0Slot,
  unpackSlot0,
} from "./v4math";

export type PoolState = {
  sqrtPriceX96: bigint;
  tick: number;
  lpFee: number;
  /** the pool's TOTAL active liquidity */
  liquidity: bigint;
  /** whole-pool virtual reserves at the current price (full-range view) */
  reserve0: bigint;
  reserve1: bigint;
  initialized: boolean;
};

const extsloadAbi = [
  {
    type: "function",
    name: "extsload",
    stateMutability: "view",
    inputs: [{ type: "bytes32", name: "slot" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;

export const poolManagerInitializeAbi = [
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [
      {
        type: "tuple",
        name: "key",
        components: [
          { type: "address", name: "currency0" },
          { type: "address", name: "currency1" },
          { type: "uint24", name: "fee" },
          { type: "int24", name: "tickSpacing" },
          { type: "address", name: "hooks" },
        ],
      },
      { type: "uint160", name: "sqrtPriceX96" },
    ],
    outputs: [{ type: "int24" }],
  },
] as const;

/** raw pool state straight out of the PoolManager's storage (no lens needed) */
export async function fetchPoolState(net: Net, poolId: Hex): Promise<PoolState> {
  const client = clientForNet(net);
  const [w0, wl] = await Promise.all([
    client.readContract({
      address: net.poolManager,
      abi: extsloadAbi,
      functionName: "extsload",
      args: [slot0Slot(poolId)],
    }),
    client.readContract({
      address: net.poolManager,
      abi: extsloadAbi,
      functionName: "extsload",
      args: [liquiditySlot(poolId)],
    }),
  ]);
  const { sqrtPriceX96, tick, lpFee } = unpackSlot0(w0 as Hex);
  const liquidity = BigInt(wl as Hex) & ((1n << 128n) - 1n);
  // virtual reserves of the whole pool at the live price:
  // reserve0 = L·Q96/√P, reserve1 = L·√P/Q96
  const Q96 = 2n ** 96n;
  const reserve0 = sqrtPriceX96 > 0n ? (liquidity * Q96) / sqrtPriceX96 : 0n;
  const reserve1 = (liquidity * sqrtPriceX96) / Q96;
  return {
    sqrtPriceX96,
    tick,
    lpFee,
    liquidity,
    reserve0,
    reserve1,
    initialized: sqrtPriceX96 > 0n,
  };
}

export function usePoolState(net: Net, poolId: Hex | null) {
  return useQuery({
    queryKey: ["poolState", net.chain.id, poolId],
    enabled: !!poolId,
    refetchInterval: 12_000,
    queryFn: () => fetchPoolState(net, poolId!),
  });
}

/** the amounts a position (L, ticks) is worth at the pool's live price */
export function positionAmounts(
  state: PoolState | undefined,
  liquidity: bigint | undefined,
  tickLower: number | undefined,
  tickUpper: number | undefined,
): { amount0: bigint; amount1: bigint } {
  if (!state || !liquidity || tickLower === undefined || tickUpper === undefined)
    return { amount0: 0n, amount1: 0n };
  if (liquidity === 0n) return { amount0: 0n, amount1: 0n };
  return amountsForLiquidity(
    state.sqrtPriceX96,
    getSqrtRatioAtTick(tickLower),
    getSqrtRatioAtTick(tickUpper),
    liquidity,
  );
}

/** live ERC20 allowance towards a spender (native needs none — returns unlimited) */
export function useAllowance(
  net: Net,
  token: Address | undefined,
  owner: Address | undefined,
  spender: Address | undefined,
) {
  return useQuery({
    queryKey: ["allowance", net.chain.id, token, owner, spender],
    enabled: !!token && !!owner && !!spender,
    refetchInterval: 15_000,
    queryFn: async (): Promise<bigint> => {
      if (isNative(token!)) return 2n ** 256n - 1n;
      const client = clientForNet(net);
      return (await client.readContract({
        address: token!,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner!, spender!],
      })) as bigint;
    },
  });
}

/** wallet balance of a currency (native or ERC20) */
export function useBalanceOf(net: Net, token: Address | undefined, owner: Address | undefined) {
  return useQuery({
    queryKey: ["bal", net.chain.id, token, owner],
    enabled: !!token && !!owner,
    refetchInterval: 15_000,
    queryFn: async (): Promise<bigint> => {
      const client = clientForNet(net);
      if (isNative(token!)) return client.getBalance({ address: owner! });
      return (await client.readContract({
        address: token!,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner!],
      })) as bigint;
    },
  });
}
