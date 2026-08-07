import type { AbiEvent, Address, Log, PublicClient } from "viem";

export type ScanResult = {
  logs: Log[];
  /**
   * The last block that was ACTUALLY scanned. Equals `toBlock` on a full
   * pass; earlier when the RPC kept failing. Callers MUST persist this (not
   * `toBlock`) as their cache frontier — otherwise one bad visit stamps the
   * cache "done to latest" with the events silently missing, and the pool
   * looks empty forever after.
   */
  scannedTo: bigint;
};

/**
 * Chunk-adaptive eth_getLogs: public RPCs cap block ranges anywhere from 500
 * to "unlimited". Start optimistic, shrink the window on failure, grow it
 * back on success. A window that still fails at the minimum size STOPS the
 * scan (reporting how far it got) — it is never skipped, so no event can be
 * silently lost.
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
): Promise<ScanResult> {
  const { address, events, args, fromBlock, toBlock, onProgress } = params;
  const total = toBlock - fromBlock + 1n;
  if (total <= 0n) return { logs: [], scannedTo: toBlock };

  const out: Log[] = [];
  let cursor = fromBlock;
  let window = 45_000n;
  const MIN_WINDOW = 400n;
  let failsAtMin = 0;

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
      failsAtMin = 0;
      onProgress?.(cursor - fromBlock, total);
      // grow back gently after a success
      if (window < 45_000n) window = window * 2n;
    } catch {
      if (window <= MIN_WINDOW) {
        // the smallest window failed — retry it a couple of times (transient
        // 429s heal), then STOP without advancing past the failed block
        failsAtMin++;
        if (failsAtMin >= 3) break;
        await new Promise((r) => setTimeout(r, 600 * failsAtMin));
        continue;
      }
      window = window / 4n;
      if (window < MIN_WINDOW) window = MIN_WINDOW;
    }
  }
  return { logs: out, scannedTo: cursor - 1n };
}
