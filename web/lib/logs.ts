import type { Address, Hex, Log, PublicClient } from "viem";

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
 * Bounds for the scan window. The upper bound is the widest range any
 * measured endpoint serves (`scripts/probe-rpc-limits.mjs`); per-chain caps
 * arrive via `Net.logRange`, so this only matters for an unmeasured chain.
 */
const MAX_WINDOW = 50_000n;
const MIN_WINDOW = 100n;
/**
 * Stable-window fan-out. Every measured endpoint serves 6 concurrent getLogs
 * cleanly; 4 leaves room for the reads the rest of the app issues at the same
 * time, since a fan-out that trips a rate limit costs far more than it saves.
 */
const PARALLEL = 4;

/**
 * What a failed getLogs actually tells us.
 *
 * - `range`: the endpoint refused the WIDTH of the query. Shrinking is the
 *   only thing that helps. Providers phrase this a dozen ways, so it is
 *   detected by message rather than status (drpc answers with a JSON-RPC
 *   error, thirdweb with -32005, Blast with a 400, others with a 413).
 * - `transient`: rate limit, upstream hiccup, timeout. Shrinking here is
 *   actively harmful — it MULTIPLIES the request count against an endpoint
 *   that just said it was busy — so the same window is retried after a backoff.
 *
 * Defaulting to `transient` matters: worldchain's provider fails roughly half
 * its requests with "Temporary internal error", and reading that as a range
 * verdict would ratchet a perfectly good 10k window down to the minimum.
 */
type Verdict = "range" | "transient";

const RANGE_SIGNAL =
  /\brange\b|too many blocks|response size|limit exceeded|exceeds? the (max|limit)|more than \d+ results|query returned more than|block range/i;

function classify(e: unknown): Verdict {
  for (
    let err = e as { status?: number; message?: string; details?: string; cause?: unknown } | undefined;
    err;
    err = err.cause as typeof err
  ) {
    if (err.status === 413) return "range";
    for (const text of [err.message, err.details]) {
      if (typeof text === "string" && RANGE_SIGNAL.test(text)) return "range";
    }
  }
  return "transient";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** eth_getLogs wire shape — every numeric field arrives as a hex string. */
type RawLog = {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  transactionIndex: Hex | null;
  logIndex: Hex | null;
  removed: boolean;
};

/**
 * Raw eth_getLogs. Deliberately bypasses `client.getLogs`: viem DROPS the
 * `args` topic filter whenever a LIST of events is passed, which turns a
 * one-pool query into "stream me every log this contract ever emitted".
 * Speaking the wire format directly keeps the filter on the node.
 */
function makeGetRange(client: PublicClient, address: Address, topics: (Hex | Hex[] | null)[]) {
  return async (from: bigint, to: bigint): Promise<Log[]> => {
    const raw = (await client.request({
      method: "eth_getLogs",
      params: [
        {
          address,
          topics,
          fromBlock: `0x${from.toString(16)}`,
          toBlock: `0x${to.toString(16)}`,
        },
      ],
    } as never)) as unknown as RawLog[];
    return raw.map(
      (l) =>
        ({
          ...l,
          blockNumber: l.blockNumber == null ? null : BigInt(l.blockNumber),
          logIndex: l.logIndex == null ? null : Number(l.logIndex),
          transactionIndex: l.transactionIndex == null ? null : Number(l.transactionIndex),
        }) as unknown as Log,
    );
  };
}

/** Window a chain is known to serve, floored/capped to the scanner's bounds. */
function effectiveCap(maxRange: bigint | undefined): bigint {
  if (!maxRange) return MAX_WINDOW;
  if (maxRange < MIN_WINDOW) return MIN_WINDOW;
  return maxRange < MAX_WINDOW ? maxRange : MAX_WINDOW;
}

/**
 * Chunk-adaptive eth_getLogs.
 *
 * - Starts at the chain's MEASURED cap (`Net.logRange`, from
 *   `scripts/probe-rpc-limits.mjs`) rather than probing down from a guess —
 *   a chain capped at 1k used to burn a ladder of rejected requests on every
 *   scan just to rediscover its own limit.
 * - Shrinks ÷4 only on a genuine range verdict, and records a failure CEILING
 *   for the scan so growth never re-probes a width that already failed.
 * - Backs off and retries the same width on a transient failure.
 * - Fans out across the chain's scan endpoints once the width is stable.
 * - A width that still fails STOPS the scan (reporting how far it got) — it
 *   is never skipped, so no event can be silently lost.
 */
export async function scanLogs(
  clients: PublicClient | PublicClient[],
  params: {
    address: Address;
    /**
     * Raw eth_getLogs topics. Position 0 accepts an ARRAY (topic0 OR-list =
     * "any of these events"), later positions filter indexed args. Passing
     * topics rather than viem's `events`/`args` is deliberate: viem DROPS the
     * `args` filter whenever a list of events is given, so the node would
     * stream back every pool's logs and leave the filtering to the browser.
     */
    topics: (Hex | Hex[] | null)[];
    fromBlock: bigint;
    toBlock: bigint;
    /** cap discovered for this chain's endpoints — skips the probe ladder */
    maxRange?: bigint;
    onProgress?: (scanned: bigint, total: bigint) => void;
  },
): Promise<ScanResult> {
  const { address, topics, fromBlock, toBlock, maxRange, onProgress } = params;
  const total = toBlock - fromBlock + 1n;
  if (total <= 0n) return { logs: [], scannedTo: toBlock };

  const pool = Array.isArray(clients) ? clients : [clients];
  const out: Log[] = [];
  let cursor = fromBlock;
  const cap = effectiveCap(maxRange);
  let window = cap;
  // the smallest width that FAILED this scan — never grow back into it
  let ceiling = cap + 1n;
  let streak = 0;
  let strikes = 0;
  // a real range cap is REPRODUCIBLE, so one range verdict is not enough to
  // shrink on — worldchain's provider intermittently routes to an upstream
  // capped at 100 blocks, and reacting to a single one of those would drop a
  // healthy 10k window to a 182-request crawl for the rest of the scan
  let rangeVerdicts = 0;

  // one fetcher per endpoint; the fan-out below deals them round-robin so a
  // parallel round spreads over sibling endpoints instead of stacking on one
  const fetchers = pool.map((c) => makeGetRange(c, address, topics));
  let turn = 0;
  const nextFetcher = () => fetchers[turn++ % fetchers.length];
  const getRange = (from: bigint, to: bigint) => fetchers[0](from, to);

  /**
   * Handle a failed range. Returns true to keep scanning, false to stop.
   *
   * Stopping is safe by design: `scannedTo` records the real frontier, the
   * caller persists it, and the next poll resumes from there. That is what
   * lets a chain whose free RPC budget cannot cover a full history in one
   * visit (BNB) still converge over a few polls instead of either hammering
   * the endpoint or silently skipping blocks.
   */
  const onError = async (e: unknown): Promise<boolean> => {
    if (classify(e) === "range" && window > MIN_WINDOW) {
      streak = 0;
      if (++rangeVerdicts < 2) return true; // retry the same width once
      rangeVerdicts = 0;
      ceiling = window < ceiling ? window : ceiling;
      window = window / 4n;
      if (window < MIN_WINDOW) window = MIN_WINDOW;
      return true;
    }
    strikes++;
    if (strikes >= 5) return false;
    streak = 0;
    await sleep(Math.min(500 * 2 ** strikes, 8_000));
    return true;
  };

  // widen the fan-out with the endpoint count — the per-endpoint load stays
  // at PARALLEL either way
  const width = PARALLEL * fetchers.length;

  while (cursor <= toBlock) {
    if (streak >= 2 && cursor + window <= toBlock) {
      // stable window → fan out N ranges; consume results in order and fall
      // back to the sequential path at the first failure
      const jobs: { from: bigint; to: bigint; p: Promise<Log[]> }[] = [];
      let c = cursor;
      for (let i = 0; i < width && c <= toBlock; i++) {
        const end = c + window - 1n > toBlock ? toBlock : c + window - 1n;
        jobs.push({ from: c, to: end, p: nextFetcher()(c, end) });
        c = end + 1n;
      }
      const results = await Promise.allSettled(jobs.map((j) => j.p));
      let firstError: unknown = null;
      for (let i = 0; i < jobs.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled") {
          out.push(...r.value);
          cursor = jobs[i].to + 1n;
          strikes = 0;
          rangeVerdicts = 0;
          onProgress?.(cursor - fromBlock, total);
        } else {
          firstError = r.reason;
          break;
        }
      }
      if (firstError !== null) {
        if (!(await onError(firstError))) break;
      } else {
        // brief pacing between full parallel rounds keeps free endpoints
        // from reading the fan-out as an attack
        await sleep(120);
      }
      continue;
    }

    const end = cursor + window - 1n > toBlock ? toBlock : cursor + window - 1n;
    try {
      const logs = await getRange(cursor, end);
      out.push(...logs);
      cursor = end + 1n;
      streak++;
      strikes = 0;
      rangeVerdicts = 0;
      onProgress?.(cursor - fromBlock, total);
      // grow gently after a few stable successes — but never back into a
      // width this scan already saw fail
      if (streak % 3 === 0 && window * 2n < ceiling && window < cap) {
        window = window * 2n;
      }
    } catch (e) {
      if (!(await onError(e))) break;
    }
  }

  return { logs: out, scannedTo: cursor - 1n };
}

/**
 * Targeted lookup: walk NEWEST → OLDEST and stop as soon as `done` is happy.
 *
 * For "find the event that created this thing" the answer is almost always
 * near the block you already know about, so a backwards walk costs one or two
 * requests where a forward scan from the deploy block costs the chain's whole
 * history. `budget` bounds the walk so a genuinely missing event degrades to
 * "not found" instead of replaying every block on a capped RPC.
 */
export async function findLogsBackward(
  clients: PublicClient | PublicClient[],
  params: {
    address: Address;
    topics: (Hex | Hex[] | null)[];
    fromBlock: bigint;
    toBlock: bigint;
    maxRange?: bigint;
    /** stop once the logs collected so far are enough */
    done: (logs: Log[]) => boolean;
    /** max requests before giving up */
    budget?: number;
  },
): Promise<Log[]> {
  const { address, topics, fromBlock, toBlock, maxRange, done, budget = 40 } = params;
  const window = effectiveCap(maxRange);
  const pool = Array.isArray(clients) ? clients : [clients];
  const getRange = makeGetRange(pool[0], address, topics);

  const out: Log[] = [];
  let end = toBlock;
  let spent = 0;

  while (end >= fromBlock && spent < budget) {
    const start = end - window + 1n > fromBlock ? end - window + 1n : fromBlock;
    spent++;
    try {
      out.push(...(await getRange(start, end)));
      if (done(out)) return out;
    } catch (e) {
      // a width the endpoint refuses is a dead end for this walk; anything
      // else is worth one paced retry of the same window
      if (classify(e) === "range") break;
      await sleep(1_000);
      continue;
    }
    if (start === fromBlock) break;
    end = start - 1n;
  }
  return out;
}
