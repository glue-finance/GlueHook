import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { netById, type Net } from "./chains";

/**
 * One public client per chain, built for free public RPCs:
 *
 * - FALLBACK across every verified endpoint in `net.rpcs` (primary first) —
 *   a rate-limited or dead endpoint fails over instead of blocking the app.
 * - JSON-RPC BATCHING per endpoint: calls issued in the same tick ship as
 *   one HTTP request (small batches — public RPCs often cap at ~10-50).
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
            batch: { batchSize: 10, wait: 16 },
            retryCount: 2,
            retryDelay: 500,
            timeout: 15_000,
          }),
        ),
        // keep the declared order (primary = the endpoint we trust most);
        // retries happened inside each transport, so fall through immediately
        { rank: false, retryCount: 0 },
      ),
      batch: { multicall: { batchSize: 1_024, wait: 16 } },
    });
    clients.set(chainId, c);
  }
  return c;
}

export function clientForNet(net: Net): PublicClient {
  return clientFor(net.chain.id);
}
