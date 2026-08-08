import {
  decodeAbiParameters,
  decodeEventLog,
  parseAbiItem,
  slice,
  toEventSelector,
  toFunctionSelector,
  type Address,
  type Hex,
  type Log,
} from "viem";
import type { Net } from "./chains";
import { clientForNet, scanClientsFor } from "./client";
import { poolIdOf, type PoolKey } from "./hook";
import { findLogsBackward, scanLogs } from "./logs";

export type RegisteredPool = {
  poolId: Hex;
  key: PoolKey | null; // null when recovery failed (pot usable, key-bound ops not)
  admin: Address;
  block: number;
};

// v5: the PotOpened scan and the Initialize fallback both filter by topic on
// the NODE now, and the fallback is a single batched lookup instead of one
// full-history scan per pool. Rescan clean.
type Cache = {
  v: 5;
  lastBlock: string;
  pools: Record<string, { key: PoolKey | null; admin: Address; block: number }>;
};

const potOpenedEvent = parseAbiItem(
  "event PotOpened(bytes32 indexed poolId, address indexed admin)",
);
// Uniswap V4 PoolManager pool-creation event — the authoritative poolId -> PoolKey map
const pmInitializeEvent = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
);

const INIT_POT_SELECTOR = toFunctionSelector(
  "initPot((address,address,uint24,int24,address),address,address)",
);

const cacheKey = (chainId: number) => `gh.pools.${chainId}`;

function loadCache(chainId: number): Cache {
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(cacheKey(chainId));
      if (raw) {
        const c = JSON.parse(raw) as Cache;
        if (c.v === 5) return c;
      }
    } catch {
      /* corrupted cache → rescan */
    }
  }
  return { v: 5, lastBlock: "0", pools: {} };
}

function saveCache(chainId: number, c: Cache) {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(cacheKey(chainId), JSON.stringify(c));
    } catch {
      /* quota — non-fatal */
    }
  }
}

const POOL_KEY_TUPLE = {
  type: "tuple",
  components: [
    { type: "address", name: "currency0" },
    { type: "address", name: "currency1" },
    { type: "uint24", name: "fee" },
    { type: "int24", name: "tickSpacing" },
    { type: "address", name: "hooks" },
  ],
} as const;

/**
 * Recover the PoolKey from the calldata of the transaction that opened the
 * pot. Two shapes are tried, and BOTH are verified by hashing the candidate
 * back to the poolId, so a wrong guess can never poison the registry:
 *
 * 1. FIRST ARGUMENT. Every hook entrypoint that opens a pot (`launchPool`,
 *    `initPot`, `addLiquidity…`) takes the PoolKey first, and a PoolKey is a
 *    STATIC tuple — its five words sit inline right after the selector,
 *    whatever the function. This is the path that actually fires for pools
 *    created through the app, which call `launchPool`, not `initPot`.
 * 2. An `initPot` call embedded ANYWHERE in the data (multicall wrappers).
 */
function keyFromCalldata(data: Hex, poolId: Hex): PoolKey | null {
  const id = poolId.toLowerCase();
  const heads: Hex[] = [];
  if (data.length >= 2 + 8 + 320) heads.push(slice(data, 4, 4 + 160));
  const idx = data.indexOf(INIT_POT_SELECTOR.slice(2));
  if (idx >= 2 && (idx - 2) % 2 === 0) {
    const at = (idx - 2) / 2 + 4;
    if (data.length >= 2 + at * 2 + 320) heads.push(slice(data, at, at + 160));
  }
  for (const head of heads) {
    try {
      const [key] = decodeAbiParameters([POOL_KEY_TUPLE], head);
      const k = key as PoolKey;
      if (poolIdOf(k).toLowerCase() === id) return k;
    } catch {
      /* not this shape — try the next candidate */
    }
  }
  return null;
}

const POT_OPENED_TOPIC0 = toEventSelector(potOpenedEvent);
const INITIALIZE_TOPIC0 = toEventSelector(pmInitializeEvent);

/** Decode an Initialize log into a PoolKey, verified against its own poolId. */
function keyFromInitializeLog(log: Log): { id: Hex; key: PoolKey } | null {
  try {
    const { args } = decodeEventLog({
      abi: [pmInitializeEvent],
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data,
    });
    const a = args as unknown as {
      id: Hex;
      currency0: Address;
      currency1: Address;
      fee: number;
      tickSpacing: number;
      hooks: Address;
    };
    const key: PoolKey = {
      currency0: a.currency0,
      currency1: a.currency1,
      fee: Number(a.fee),
      tickSpacing: Number(a.tickSpacing),
      hooks: a.hooks,
    };
    // the key must hash back to the id it was filed under — a mismatched or
    // spoofed log can never poison the registry
    return poolIdOf(key).toLowerCase() === a.id.toLowerCase() ? { id: a.id, key } : null;
  } catch {
    return null;
  }
}

/**
 * Fallback key recovery: ask the PoolManager for the `Initialize` events of
 * the given poolIds.
 *
 * ONE lookup resolves the whole batch — the ids ride in a topic OR-list
 * (`[topic0, [id...]]`) so the NODE does the filtering and returns at most one
 * log per pool. The walk runs BACKWARDS from the newest block a pot was opened
 * at, because a pool is always initialized at or before its own pot opens and
 * in practice in the same transaction. That turns what used to be a full
 * PoolManager history replay PER POOL into a couple of requests for all of them.
 */
async function keysFromPoolManager(
  net: Net,
  ids: Hex[],
  toBlock: bigint,
): Promise<Map<string, PoolKey>> {
  const found = new Map<string, PoolKey>();
  if (ids.length === 0) return found;
  try {
    const logs = await findLogsBackward(scanClientsFor(net), {
      address: net.poolManager,
      topics: [INITIALIZE_TOPIC0, ids.map((i) => i.toLowerCase() as Hex)],
      fromBlock: BigInt(net.deployBlock),
      toBlock,
      maxRange: BigInt(net.logRange),
      done: (ls) => ls.length >= ids.length,
    });
    for (const log of logs) {
      const hit = keyFromInitializeLog(log);
      if (hit) found.set(hit.id.toLowerCase(), hit.key);
    }
  } catch (e) {
    // unresolved is retried on the next scan — but say WHY it failed now,
    // because a silent null here reads as "pool broken" in the UI
    console.warn(`[registry] PoolKey recovery failed for ${ids.length} pool(s):`, e);
  }
  return found;
}

/**
 * Scan the hook's PotOpened logs from the deploy block (or the cached
 * frontier) and recover each pool's PoolKey. Results persist in localStorage
 * so revisits are instant.
 */
export async function scanPools(
  net: Net,
  onProgress?: (scanned: bigint, total: bigint) => void,
): Promise<RegisteredPool[]> {
  const client = clientForNet(net);
  const cache = loadCache(net.chain.id);
  const from = BigInt(cache.lastBlock) > BigInt(net.deployBlock)
    ? BigInt(cache.lastBlock) + 1n
    : BigInt(net.deployBlock);
  const latest = await client.getBlockNumber();

  let dirty = false;

  if (from <= latest) {
    const { logs, scannedTo } = await scanLogs(scanClientsFor(net), {
      address: net.hook,
      topics: [POT_OPENED_TOPIC0],
      fromBlock: from,
      toBlock: latest,
      maxRange: BigInt(net.logRange),
      onProgress,
    });

    // resolve what calldata can (one getTransaction each) — misses land in
    // the cache as key:null and are picked up by the batched retry below
    for (const log of logs) {
      let poolId: Hex;
      let admin: Address;
      try {
        const { args } = decodeEventLog({
          abi: [potOpenedEvent],
          topics: log.topics as [Hex, ...Hex[]],
          data: log.data,
        });
        ({ poolId, admin } = args as unknown as { poolId: Hex; admin: Address });
      } catch {
        continue;
      }
      if (!poolId || !log.transactionHash) continue;
      const block = Number(log.blockNumber ?? 0n);

      let key: PoolKey | null = null;
      try {
        const tx = await client.getTransaction({ hash: log.transactionHash });
        key = keyFromCalldata(tx.input, poolId);
      } catch {
        /* tx fetch failed → PoolManager fallback */
      }
      cache.pools[poolId.toLowerCase()] = { key, admin, block };
      dirty = true;
    }
    // persist how far the scan actually GOT — an interrupted scan resumes
    // from the failure point instead of stamping the gap as "done"
    if (scannedTo >= from) {
      cache.lastBlock = scannedTo.toString();
      dirty = true;
    }
  }

  // EVERY pool still missing its key gets retried, every scan — not just the
  // ones found above. Recovery can fail transiently (a rate-limited first
  // visit), and a null that nothing revisits would otherwise be permanent:
  // the scan frontier has moved on, so no future pass would ever look again.
  // One batched, id-filtered backwards lookup covers the whole set.
  const unresolved: Hex[] = [];
  let newestMiss = BigInt(net.deployBlock);
  for (const [id, p] of Object.entries(cache.pools)) {
    if (p.key) continue;
    unresolved.push(id as Hex);
    const b = p.block > 0 ? BigInt(p.block) : latest;
    if (b > newestMiss) newestMiss = b;
  }
  if (unresolved.length > 0) {
    // every Initialize sits at or before its own pot block, so the newest pot
    // block is a complete upper bound for the backwards walk
    const recovered = await keysFromPoolManager(net, unresolved, newestMiss);
    for (const [id, key] of recovered) {
      const entry = cache.pools[id];
      if (entry) {
        entry.key = key;
        dirty = true;
      }
    }
  }

  if (dirty) saveCache(net.chain.id, cache);

  return Object.entries(cache.pools).map(([poolId, p]) => ({
    poolId: poolId as Hex,
    ...p,
  }));
}

/**
 * Register a pool the user just created in this browser — written straight
 * into the localStorage cache so it shows up instantly (the log scan would
 * find it anyway on the next visit).
 */
export function registerPool(net: Net, key: PoolKey, admin: Address, block: number): RegisteredPool {
  const poolId = poolIdOf(key).toLowerCase() as Hex;
  const cache = loadCache(net.chain.id);
  cache.pools[poolId] = { key, admin, block };
  saveCache(net.chain.id, cache);
  return { poolId, key, admin, block };
}

/**
 * Import a single pool by poolId: registry first, then a targeted
 * PoolManager Initialize lookup.
 */
export async function importPool(net: Net, poolId: Hex): Promise<RegisteredPool | null> {
  const id = poolId.toLowerCase() as Hex;
  const cache = loadCache(net.chain.id);
  const hit = cache.pools[id];
  if (hit?.key) return { poolId: id, ...hit };

  const latest = await clientForNet(net).getBlockNumber();
  const key = (await keysFromPoolManager(net, [id], latest)).get(id);
  if (!key) return hit ? { poolId: id, ...hit } : null;
  const entry = { key, admin: (hit?.admin ?? "0x0000000000000000000000000000000000000000") as Address, block: hit?.block ?? net.deployBlock };
  cache.pools[id] = entry;
  saveCache(net.chain.id, cache);
  return { poolId: id, ...entry };
}
