import { decodeEventLog, parseAbiItem, toEventSelector, type AbiEvent, type Hex, type Log } from "viem";
import type { Net } from "./chains";
import { clientForNet, scanClientsFor } from "./client";
import { scanLogs } from "./logs";

export type PoolEventKind =
  | "Pumped"
  | "Shielded"
  | "Donated"
  | "Harvested"
  | "Compounded"
  | "Delivered"
  | "ProgramLiquidityAdded"
  | "ProgramLiquidityRemoved"
  | "ProgramCreated";

/** IGlueHook.Delivery — `Delivered.mode` values that take main out of circulation forever. */
export const BURN_MODES = new Set(["1", "2", "3"]); // BURNED · DEAD · HELD

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
  // Delivery enum canonicalizes to uint8 in the signature — selector matches on-chain
  parseAbiItem("event Delivered(bytes32 indexed poolId, address indexed to, uint256 amount, uint8 mode)"),
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

/**
 * topic0 of every hook event. Every one of them carries `poolId` as its FIRST
 * indexed parameter, so `[TOPIC0S, poolIdTopic]` is a complete server-side
 * filter: the node returns this pool's events and nothing else.
 */
const TOPIC0S: Hex[] = EVENTS.map((e) => toEventSelector(e));
const BY_TOPIC0 = new Map<Hex, AbiEvent>(EVENTS.map((e, i) => [TOPIC0S[i], e]));

// v5: Delivered joined the topic filter — v4 caches were scanned without it,
// so their frontier silently misses every burn/delivery log; rescan clean.
type FeedCache = { v: 5; lastBlock: string; events: PoolEvent[] };

const feedKey = (chainId: number, poolId: string) => `gh.feed.${chainId}.${poolId.toLowerCase()}`;

function loadFeed(chainId: number, poolId: string): FeedCache {
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(feedKey(chainId, poolId));
      if (raw) {
        const c = JSON.parse(raw) as FeedCache;
        if (c.v === 5) return c;
      }
    } catch {
      /* rescan */
    }
  }
  return { v: 5, lastBlock: "0", events: [] };
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
    const { logs, scannedTo } = await scanLogs(scanClientsFor(net), {
      address: net.hook,
      topics: [TOPIC0S, poolId],
      fromBlock: from,
      toBlock: latest,
      maxRange: BigInt(net.logRange),
      onProgress,
    });

    for (const log of logs) {
      const l = log as Log;
      const abi = BY_TOPIC0.get(l.topics[0] as Hex);
      if (!abi) continue;
      let args: Record<string, unknown>;
      let eventName: string;
      try {
        const d = decodeEventLog({ abi: [abi], topics: l.topics as [Hex, ...Hex[]], data: l.data });
        eventName = d.eventName as string;
        args = (d.args ?? {}) as Record<string, unknown>;
      } catch {
        continue;
      }
      const data: Record<string, string> = {};
      for (const [k, v] of Object.entries(args)) data[k] = String(v);
      cache.events.push({
        kind: eventName as PoolEventKind,
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
  const blocks = [...new Set(events.filter((e) => e.timestamp === null).map((e) => e.block))]
    .sort((a, b) => a - b);
  if (blocks.length === 0) return events;
  // Sample EVENLY across the whole unresolved range (always including the
  // oldest and newest blocks) rather than taking only the newest `limit`:
  // the charts interpolate the rest from these anchors, so spread anchors
  // date an entire busy history where a newest-only batch left everything
  // older than ~120 blocks undatable.
  let pending: number[];
  if (blocks.length <= limit) {
    pending = blocks;
  } else {
    const picked = new Set<number>();
    for (let i = 0; i < limit; i++) {
      picked.add(blocks[Math.round((i * (blocks.length - 1)) / (limit - 1))]);
    }
    pending = [...picked];
  }

  // chunked, NOT one Promise.all over all 120: a free RPC reads a fan-out of
  // that size as abuse and answers 429/500, which loses every timestamp at once
  const stamps = new Map<number, number>();
  const CHUNK = 8;
  for (let i = 0; i < pending.length; i += CHUNK) {
    const batch = pending.slice(i, i + CHUNK);
    const got = await Promise.all(
      batch.map(async (b) => {
        try {
          const blk = await client.getBlock({ blockNumber: BigInt(b) });
          return [b, Number(blk.timestamp)] as const;
        } catch {
          return null;
        }
      }),
    );
    let failed = 0;
    for (const g of got) {
      if (g) stamps.set(g[0], g[1]);
      else failed++;
    }
    // the endpoint is refusing — stop rather than grind through 100 more
    if (failed === batch.length) break;
  }
  for (const e of events) {
    if (e.timestamp === null && stamps.has(e.block)) e.timestamp = stamps.get(e.block)!;
  }
  const cache = loadFeed(net.chain.id, poolId);
  cache.events = events;
  saveFeed(net.chain.id, poolId, cache);
  return events;
}
