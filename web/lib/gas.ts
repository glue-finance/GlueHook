"use client";

import { useQuery } from "@tanstack/react-query";
import type { Net } from "./chains";
import { clientForNet } from "./client";

/**
 * Gas budget behind a native-side MAX: the launch path's worst case —
 * launchPool (~530k measured) + two approvals — with headroom for a fee
 * spike between pressing MAX and signing. Priced live from the chain.
 */
const LAUNCH_GAS_UNITS = 700_000n;
const SPIKE_BUFFER = 2n;

/** Live wei reserve to keep behind when MAXing the network token. */
export function useGasReserve(net: Net) {
  return useQuery({
    queryKey: ["gasReserve", net.chain.id],
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: async (): Promise<bigint> => {
      const client = clientForNet(net);
      let price: bigint;
      try {
        // EIP-1559 chains: the max fee actually payable right now
        const fees = await client.estimateFeesPerGas();
        price = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
      } catch {
        price = await client.getGasPrice();
      }
      return price * LAUNCH_GAS_UNITS * SPIKE_BUFFER;
    },
  });
}
