"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { fallback, http, type Chain, type Transport } from "viem";
import { NETS } from "./chains";

// same hardened stack as lib/client.ts: verified fallbacks + request batching
const transports: Record<number, Transport> = {};
for (const n of NETS)
  transports[n.chain.id] = fallback(
    n.rpcs.map((url) =>
      http(url, { batch: { batchSize: 10, wait: 16 }, retryCount: 2, retryDelay: 500, timeout: 15_000 }),
    ),
    { rank: false, retryCount: 0 },
  );

export const wagmiConfig = getDefaultConfig({
  appName: "GlueHook",
  projectId:
    process.env.NEXT_PUBLIC_WALLETCONNECT_ID ?? "95d7aff92d5c52c741dca1a012a0d4f7",
  chains: NETS.map((n) => n.chain) as unknown as readonly [Chain, ...Chain[]],
  transports,
  ssr: true,
});
