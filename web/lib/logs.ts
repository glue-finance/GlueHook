import type { AbiEvent, Address, Log, PublicClient } from "viem";

/**
 * Chunk-adaptive eth_getLogs: public RPCs cap block ranges anywhere from 500
 * to "unlimited". Start optimistic, halve the window on failure, grow it back
 * on success. Never throws for a single bad window — it retries smaller.
 */
export async function scanLogs(
  client: PublicClient,
  params: {
    address: Address;
    events: AbiEvent[];
    args?: Record<string, unknown>;
    fromBlock: bigint;
    toBlock: bigint;
    onProgress?: (scanned: bigint, total: bigint) => void;
  },
): Promise<Log[]> {
  const { address, events, args, fromBlock, toBlock, onProgress } = params;
  const total = toBlock - fromBlock + 1n;
  if (total <= 0n) return [];

  const out: Log[] = [];
  let cursor = fromBlock;
  let window = 45_000n;
  const MIN_WINDOW = 400n;

  while (cursor <= toBlock) {
    const end = cursor + window - 1n > toBlock ? toBlock : cursor + window - 1n;
    try {
      const logs = await client.getLogs({
        address,
        events,
        args,
        fromBlock: cursor,
        toBlock: end,
      } as Parameters<PublicClient["getLogs"]>[0]);
      out.push(...(logs as Log[]));
      cursor = end + 1n;
      onProgress?.(cursor - fromBlock, total);
      // grow back gently after a success
      if (window < 45_000n) window = window * 2n;
    } catch {
      if (window <= MIN_WINDOW) {
        // skip a hopeless window rather than spin forever
        cursor = end + 1n;
        continue;
      }
      window = window / 4n;
      if (window < MIN_WINDOW) window = MIN_WINDOW;
    }
  }
  return out;
}
