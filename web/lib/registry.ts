import {
  decodeAbiParameters,
  parseAbiItem,
  slice,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import type { Net } from "./chains";
import { clientForNet } from "./client";
import { poolIdOf, type PoolKey } from "./hook";
import { scanLogs } from "./logs";

export type RegisteredPool = {
  poolId: Hex;
  key: PoolKey | null; // null when recovery failed (pot usable, key-bound ops not)
  admin: Address;
  block: number;
};

// v4: viem drops the `args` topic filter for event LISTS, so the PoolManager
// Initialize fallback used to take the FIRST pool since deployBlock — a v3
// cache may hold a WRONG key for a poolId. Rescan clean.
type Cache = {
  v: 4;
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
        if (c.v === 4) return c;
      }
    } catch {
      /* corrupted cache → rescan */
    }
  }
  return { v: 4, lastBlock: "0", pools: {} };
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

/**
 * Recover the PoolKey behind an `initPot` transaction. The normal path decodes
 * the calldata (works through simple wrappers by locating the selector inside
 * the data). Verified against the poolId so a wrong guess can never poison the
 * registry.
 */
function keyFromCalldata(data: Hex, poolId: Hex): PoolKey | null {
  const idx = data.indexOf(INIT_POT_SELECTOR.slice(2));
  if (idx < 2) return null;
  try {
    const argsHex = slice(data, (idx - 2) / 2 + 4);
    const [key] = decodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { type: "address", name: "currency0" },
            { type: "address", name: "currency1" },
            { type: "uint24", name: "fee" },
            { type: "int24", name: "tickSpacing" },
            { type: "address", name: "hooks" },
          ],
        },
        { type: "address" },
        { type: "address" },
      ],
      argsHex,
    );
    const k = key as PoolKey;
    return poolIdOf(k).toLowerCase() === poolId.toLowerCase() ? k : null;
  } catch {
    return null;
  }
}

/** Fallback: ask the PoolManager for the Initialize event of this poolId. */
async function keyFromPoolManager(net: Net, poolId: Hex): Promise<PoolKey | null> {
  const client = clientForNet(net);
  try {
    const latest = await client.getBlockNumber();
    const { logs } = await scanLogs(client, {
      address: net.poolManager,
      events: [pmInitializeEvent],
      args: { id: poolId },
      fromBlock: BigInt(net.deployBlock),
      toBlock: latest,
    });
    // viem ignores the `args` topic filter for event LISTS, so the scan may
    // return EVERY Initialize since deployBlock — match the id ourselves and
    // verify the recovered key hashes back to the poolId (can't be poisoned)
    for (const raw of logs) {
      const l = raw as unknown as {
        args?: {
          id: Hex;
          currency0: Address;
          currency1: Address;
          fee: number;
          tickSpacing: number;
          hooks: Address;
        };
      };
      if (!l?.args || l.args.id?.toLowerCase() !== poolId.toLowerCase()) continue;
      const k: PoolKey = {
        currency0: l.args.currency0,
        currency1: l.args.currency1,
        fee: Number(l.args.fee),
        tickSpacing: Number(l.args.tickSpacing),
        hooks: l.args.hooks,
      };
      if (poolIdOf(k).toLowerCase() === poolId.toLowerCase()) return k;
    }
    return null;
  } catch {
    return null;
  }
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

  if (from <= latest) {
    const { logs, scannedTo } = await scanLogs(client, {
      address: net.hook,
      events: [potOpenedEvent],
      fromBlock: from,
      toBlock: latest,
      onProgress,
    });

    for (const log of logs) {
      const args = (log as unknown as { args?: { poolId: Hex; admin: Address } }).args;
      if (!args?.poolId || !log.transactionHash) continue;
      let key: PoolKey | null = null;
      try {
        const tx = await client.getTransaction({ hash: log.transactionHash });
        key = keyFromCalldata(tx.input, args.poolId);
      } catch {
        /* tx fetch failed → try PoolManager below */
      }
      if (!key) key = await keyFromPoolManager(net, args.poolId);
      cache.pools[args.poolId.toLowerCase()] = {
        key,
        admin: args.admin,
        block: Number(log.blockNumber ?? 0n),
      };
    }
    // persist how far the scan actually GOT — an interrupted scan resumes
    // from the failure point instead of stamping the gap as "done"
    if (scannedTo >= from) {
      cache.lastBlock = scannedTo.toString();
      saveCache(net.chain.id, cache);
    }
  }

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

  const key = await keyFromPoolManager(net, id);
  if (!key) return hit ? { poolId: id, ...hit } : null;
  const entry = { key, admin: (hit?.admin ?? "0x0000000000000000000000000000000000000000") as Address, block: hit?.block ?? net.deployBlock };
  cache.pools[id] = entry;
  saveCache(net.chain.id, cache);
  return { poolId: id, ...entry };
}
