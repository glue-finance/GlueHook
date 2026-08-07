import { parseAbiItem, type AbiEvent, type Hex } from "viem";
import type { Net } from "./chains";
import { clientForNet } from "./client";
import { scanLogs } from "./logs";

export type PoolEventKind =
  | "Pumped"
  | "Shielded"
  | "Donated"
  | "Harvested"
  | "Compounded"
  | "ProgramLiquidityAdded"
  | "ProgramLiquidityRemoved"
  | "ProgramCreated";

export type PoolEvent = {
  kind: PoolEventKind;
  block: number;
  txHash: Hex;
  logIndex: number;
  timestamp: number | null; // unix seconds, resolved lazily
  data: Record<string, string>; // bigints stringified for storage
};

const EVENTS: AbiEvent[] = [
  parseAbiItem("event Pumped(bytes32 indexed poolId, uint256 spent, uint256 bought)"),
  parseAbiItem("event Shielded(bytes32 indexed poolId, uint256 absorbed, uint256 paid)"),
  parseAbiItem("event Donated(bytes32 indexed poolId, address indexed donor, uint256 amount)"),
  parseAbiItem(
    "event Harvested(bytes32 indexed poolId, uint256 mainFees, uint256 secondaryFees, uint256 burned, uint256 fueled)",
  ),
  parseAbiItem(
    "event Compounded(bytes32 indexed poolId, uint128 liquidity, uint256 amount0Used, uint256 amount1Used)",
  ),
  parseAbiItem(
    "event ProgramLiquidityAdded(bytes32 indexed poolId, uint128 liquidity, uint256 amount0Used, uint256 amount1Used)",
  ),
  parseAbiItem(
    "event ProgramLiquidityRemoved(bytes32 indexed poolId, uint128 liquidity, uint256 amount0, uint256 amount1, address to)",
  ),
  parseAbiItem(
    "event ProgramCreated(bytes32 indexed poolId, address indexed owner, int24 tickLower, int24 tickUpper)",
  ),
];

// v2: the frontier is the block the scan actually REACHED (a v1 cache could
// be stamped "done" with events missing after one bad RPC day — rescan those)
type FeedCache = { v: 2; lastBlock: string; events: PoolEvent[] };

const feedKey = (chainId: number, poolId: string) => `gh.feed.${chainId}.${poolId.toLowerCase()}`;

function loadFeed(chainId: number, poolId: string): FeedCache {
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(feedKey(chainId, poolId));
      if (raw) {
        const c = JSON.parse(raw) as FeedCache;
        if (c.v === 2) return c;
      }
    } catch {
      /* rescan */
    }
  }
  return { v: 2, lastBlock: "0", events: [] };
}

function saveFeed(chainId: number, poolId: string, c: FeedCache) {
  if (typeof localStorage !== "undefined") {
    try {
      // keep storage bounded: most recent 2000 events
      const trimmed = { ...c, events: c.events.slice(-2000) };
      localStorage.setItem(feedKey(chainId, poolId), JSON.stringify(trimmed));
    } catch {
      /* quota */
    }
  }
}

/**
 * Fetch (incrementally) all hook events for one pool. Uses the indexed poolId
 * topic, so even a wide scan is cheap for the node. Cached in localStorage.
 */
export async function fetchPoolEvents(
  net: Net,
  poolId: Hex,
  fromBlockDefault: number,
  onProgress?: (scanned: bigint, total: bigint) => void,
): Promise<PoolEvent[]> {
  const client = clientForNet(net);
  const cache = loadFeed(net.chain.id, poolId);
  const from = BigInt(cache.lastBlock) > 0n ? BigInt(cache.lastBlock) + 1n : BigInt(fromBlockDefault);
  const latest = await client.getBlockNumber();

  if (from <= latest) {
    const { logs, scannedTo } = await scanLogs(client, {
      address: net.hook,
      events: EVENTS,
      args: { poolId },
      fromBlock: from,
      toBlock: latest,
      onProgress,
    });

    for (const log of logs) {
      const l = log as unknown as {
        eventName?: string;
        args?: Record<string, unknown>;
        blockNumber?: bigint;
        transactionHash?: Hex;
        logIndex?: number;
      };
      if (!l.eventName || !l.args) continue;
      const data: Record<string, string> = {};
      for (const [k, v] of Object.entries(l.args)) data[k] = String(v);
      cache.events.push({
        kind: l.eventName as PoolEventKind,
        block: Number(l.blockNumber ?? 0n),
        txHash: (l.transactionHash ?? "0x") as Hex,
        logIndex: l.logIndex ?? 0,
        timestamp: null,
        data,
      });
    }
    cache.events.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
    // persist how far the scan actually GOT — an interrupted scan resumes
    // from the failure point instead of stamping the gap as "done"
    if (scannedTo >= from) {
      cache.lastBlock = scannedTo.toString();
      saveFeed(net.chain.id, poolId, cache);
    }
  }

  return cache.events;
}

/**
 * Resolve unix timestamps for the newest `limit` events that lack one
 * (one getBlock per unique block, capped), then persist.
 */
export async function resolveTimestamps(
  net: Net,
  poolId: Hex,
  events: PoolEvent[],
  limit = 120,
): Promise<PoolEvent[]> {
  const client = clientForNet(net);
  const pending = [...new Set(events.filter((e) => e.timestamp === null).map((e) => e.block))]
    .sort((a, b) => b - a)
    .slice(0, limit);
  if (pending.length === 0) return events;

  const stamps = new Map<number, number>();
  await Promise.all(
    pending.map(async (b) => {
      try {
        const blk = await client.getBlock({ blockNumber: BigInt(b) });
        stamps.set(b, Number(blk.timestamp));
      } catch {
        /* leave null */
      }
    }),
  );
  for (const e of events) {
    if (e.timestamp === null && stamps.has(e.block)) e.timestamp = stamps.get(e.block)!;
  }
  const cache = loadFeed(net.chain.id, poolId);
  cache.events = events;
  saveFeed(net.chain.id, poolId, cache);
  return events;
}
