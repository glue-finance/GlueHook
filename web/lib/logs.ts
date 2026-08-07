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

const MAX_WINDOW = 45_000n;
const MIN_WINDOW = 400n;
/** stable-window fan-out — 6 ranges in flight cuts a capped chain's scan ~6× */
const PARALLEL = 6;

/* ---------------------------------------------------- learned window cache */
// Public RPCs cap eth_getLogs ranges anywhere from ~500 to "unlimited", and
// the cap is a property of the CHAIN's endpoints — remember what worked so
// the next scan starts right at it instead of re-discovering it through a
// ladder of failed (and console-spamming) probes.

const winKey = (chainId: number) => `gh.scanwin.${chainId}`;

function loadWindow(chainId: number | undefined): bigint | null {
  if (chainId === undefined || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(winKey(chainId));
    if (!raw) return null;
    const w = BigInt(raw);
    return w >= MIN_WINDOW && w <= MAX_WINDOW ? w : null;
  } catch {
    return null;
  }
}

function saveWindow(chainId: number | undefined, w: bigint) {
  if (chainId === undefined || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(winKey(chainId), w.toString());
  } catch {
    /* quota — non-fatal */
  }
}

/**
 * Chunk-adaptive eth_getLogs.
 *
 * - Starts at the chain's REMEMBERED working window (localStorage), so a
 *   range-capped chain (Monad ~1k, Avalanche 2k, …) never replays the
 *   failure ladder on later visits.
 * - Shrinks ÷4 on failure and records a failure CEILING for the session —
 *   growth never re-probes a size that already failed, which is what used
 *   to thrash capped RPCs with a 400/413 every couple of requests.
 * - Once the window is proven stable, fans out PARALLEL ranges per round.
 * - A window that still fails at the minimum size STOPS the scan (reporting
 *   how far it got) — it is never skipped, so no event can be silently lost.
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

  const chainId = client.chain?.id;
  const out: Log[] = [];
  let cursor = fromBlock;
  let window = loadWindow(chainId) ?? MAX_WINDOW;
  // the smallest window size that FAILED this session — never grow back to it
  let ceiling = MAX_WINDOW + 1n;
  let streak = 0;
  let failsAtMin = 0;

  const getRange = (from: bigint, to: bigint) =>
    client.getLogs({
      address,
      events,
      args,
      fromBlock: from,
      toBlock: to,
    } as Parameters<PublicClient["getLogs"]>[0]) as Promise<Log[]>;

  const onFail = () => {
    streak = 0;
    ceiling = window < ceiling ? window : ceiling;
    window = window / 4n;
    if (window < MIN_WINDOW) window = MIN_WINDOW;
  };

  while (cursor <= toBlock) {
    if (streak >= 2 && cursor + window <= toBlock) {
      // stable window → fan out N ranges; consume results in order and fall
      // back to the sequential shrink path at the first failure
      const jobs: { from: bigint; to: bigint; p: Promise<Log[]> }[] = [];
      let c = cursor;
      for (let i = 0; i < PARALLEL && c <= toBlock; i++) {
        const end = c + window - 1n > toBlock ? toBlock : c + window - 1n;
        jobs.push({ from: c, to: end, p: getRange(c, end) });
        c = end + 1n;
      }
      const results = await Promise.allSettled(jobs.map((j) => j.p));
      let failed = false;
      for (let i = 0; i < jobs.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled") {
          out.push(...r.value);
          cursor = jobs[i].to + 1n;
          onProgress?.(cursor - fromBlock, total);
        } else {
          failed = true;
          break;
        }
      }
      if (failed) onFail();
      continue;
    }

    const end = cursor + window - 1n > toBlock ? toBlock : cursor + window - 1n;
    try {
      const logs = await getRange(cursor, end);
      out.push(...logs);
      cursor = end + 1n;
      streak++;
      failsAtMin = 0;
      onProgress?.(cursor - fromBlock, total);
      // grow gently after a few stable successes — but never back into a
      // size this session already saw fail
      if (streak % 3 === 0 && window * 2n < ceiling && window < MAX_WINDOW) {
        window = window * 2n;
      }
    } catch {
      if (window <= MIN_WINDOW) {
        // the smallest window failed — retry it a couple of times (transient
        // 429s heal), then STOP without advancing past the failed block
        failsAtMin++;
        if (failsAtMin >= 3) break;
        await new Promise((r) => setTimeout(r, 600 * failsAtMin));
        continue;
      }
      onFail();
    }
  }

  // remember the window that was working so the next scan starts there
  if (cursor > fromBlock) saveWindow(chainId, window);
  return { logs: out, scannedTo: cursor - 1n };
}
