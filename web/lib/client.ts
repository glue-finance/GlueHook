import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { netById, type Net } from "./chains";

/**
 * Per-provider JSON-RPC batch caps, MEASURED by
 * `scripts/probe-batch-limit.mjs`. The limit belongs to the provider, not the
 * chain, so it is keyed by host suffix.
 *
 * This is not a tuning knob — exceeding the cap fails the WHOLE batch. dRPC
 * answers a 4-call batch with an HTTP 500 ("Batch of more than 3 requests are
 * not allowed"), so a client batching 10 turns every grouped read on every
 * dRPC-primary chain into a 500, which reads like a broken node rather than a
 * misconfigured client.
 */
const BATCH_LIMITS: [suffix: string, size: number][] = [
  ["drpc.org", 3],
  // hard cap 10, but 429s under concurrent scans — leave headroom
  ["gateway.tenderly.co", 5],
  ["base.org", 10],
  ["unichain.org", 10],
  ["optimism.io", 10],
  ["xlayer.tech", 10],
  ["48.club", 10],
  ["publicnode.com", 20],
  ["thirdweb.com", 20],
  ["nodereal.io", 20],
];

/** Conservative default for an endpoint we have not measured. */
const DEFAULT_BATCH = 8;

function batchSizeFor(url: string): number {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return DEFAULT_BATCH;
  }
  for (const [suffix, size] of BATCH_LIMITS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return size;
  }
  return DEFAULT_BATCH;
}

/**
 * One public client per chain, built for free public RPCs:
 *
 * - FALLBACK across every verified endpoint in `net.rpcs` (primary first) —
 *   a rate-limited or dead endpoint fails over instead of blocking the app.
 * - JSON-RPC BATCHING sized per endpoint against its measured cap.
 * - MULTICALL AGGREGATION: readContract calls collapse into single
 *   Multicall3 calls (verified deployed on ALL 23 networks), so a screen
 *   full of balances/metadata costs one RPC request, not thirty.
 * - Bounded retries with backoff so a transient 429 heals itself without
 *   hammering the endpoint that just asked us to slow down.
 */
const clients = new Map<number, PublicClient>();

export function clientFor(chainId: number): PublicClient {
  let c = clients.get(chainId);
  if (!c) {
    const net = netById(chainId);
    if (!net) throw new Error(`unknown chain ${chainId}`);
    c = createPublicClient({
      chain: net.chain,
      transport: fallback(
        net.rpcs.map((url) =>
          http(url, {
            batch: { batchSize: batchSizeFor(url), wait: 16 },
            retryCount: 2,
            retryDelay: 500,
            timeout: 15_000,
          }),
        ),
        // keep the declared order (primary = the endpoint we trust most);
        // retries happened inside each transport, so fall through immediately
        { rank: false, retryCount: 0 },
      ),
      // multicall aggregates INTO one eth_call, so this is a calldata budget,
      // not a request-count budget — the batch cap above is what bounds HTTP
      batch: { multicall: { batchSize: 1_024, wait: 16 } },
    });
    clients.set(chainId, c);
  }
  return c;
}

export function clientForNet(net: Net): PublicClient {
  return clientFor(net.chain.id);
}

const scanClients = new Map<number, PublicClient[]>();

/**
 * Clients for a log scan, one per endpoint proven to serve archive
 * `eth_getLogs` (the leading `net.logEndpoints` entries of `net.rpcs`).
 *
 * The regular client is a FALLBACK: it only moves off the primary when the
 * primary fails, so a parallel fan-out lands entirely on one endpoint and its
 * rate limit sets the ceiling for the whole scan. Spreading the fan-out across
 * sibling endpoints multiplies throughput on exactly the chains that need it
 * — Monad caps getLogs at 1k blocks, so its history is ~120 requests that no
 * single free endpoint will serve quickly.
 *
 * Each client here is single-endpoint on purpose: the scanner interprets an
 * error as a verdict about the endpoint it just used, so a silent fallback
 * would make it draw conclusions about the wrong node.
 */
export function scanClientsFor(net: Net): PublicClient[] {
  let cs = scanClients.get(net.chain.id);
  if (!cs) {
    const count = Math.min(Math.max(net.logEndpoints ?? 1, 1), net.rpcs.length);
    cs = net.rpcs.slice(0, count).map((url) =>
      createPublicClient({
        chain: net.chain,
        transport: http(url, {
          batch: { batchSize: batchSizeFor(url), wait: 16 },
          retryCount: 1,
          retryDelay: 500,
          timeout: 20_000,
        }),
      }),
    );
    scanClients.set(net.chain.id, cs);
  }
  return cs;
}
