#!/usr/bin/env node
/**
 * Reproduce the registry's PoolKey recovery for one chain, with every error
 * printed verbatim instead of swallowed.
 *
 * Walks the exact same path web/lib/registry.ts does:
 *   1. scan the hook's PotOpened logs (forward, chunked)
 *   2. per pool: getTransaction(potTx) -> look for the initPot selector
 *   3. fallback: backwards Initialize lookup on the PoolManager with the
 *      poolIds in a topic OR-list
 *
 * Usage: node scripts/probe-key-recovery.mjs polygon monad xlayer
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// viem lives in web/node_modules — resolve it from there
const {
  createPublicClient,
  decodeEventLog,
  http,
  keccak256,
  encodeAbiParameters,
  parseAbiItem,
  toEventSelector,
  toFunctionSelector,
} = await import(pathToFileURL(join(ROOT, "web/node_modules/viem/_esm/index.js")).href);
const chainsTs = readFileSync(join(ROOT, "web/lib/chains.ts"), "utf8");

const HOOK = chainsTs.match(/CANONICAL_HOOK = "(0x[0-9a-fA-F]{40})"/)[1];

function netFor(slug) {
  // slice the object literal for the slug out of chains.ts
  const at = chainsTs.indexOf(`slug: "${slug}"`);
  if (at < 0) throw new Error(`no net ${slug}`);
  const block = chainsTs.slice(at, at + 1200);
  const rpcs = [...block.matchAll(/"(https:\/\/[^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !u.includes("scan") && !u.includes("oklink") && !u.includes("vision") && !u.includes("explorer"));
  return {
    slug,
    rpcs,
    poolManager: block.match(/poolManager: "(0x[0-9a-fA-F]{40})"/)[1],
    deployBlock: Number(block.match(/deployBlock: ([\d_]+)/)[1].replaceAll("_", "")),
    logRange: Number(block.match(/logRange: ([\d_]+)/)[1].replaceAll("_", "")),
  };
}

const potOpenedEvent = parseAbiItem("event PotOpened(bytes32 indexed poolId, address indexed admin)");
const pmInitializeEvent = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
);
const POT_TOPIC = toEventSelector(potOpenedEvent);
const INIT_TOPIC = toEventSelector(pmInitializeEvent);
const INIT_POT_SELECTOR = toFunctionSelector("initPot((address,address,uint24,int24,address),address,address)");

const POOL_KEY_ABI = [
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
];
const poolIdOf = (k) => keccak256(encodeAbiParameters(POOL_KEY_ABI, [k]));

async function getLogs(client, address, topics, from, to) {
  return client.request({
    method: "eth_getLogs",
    params: [{ address, topics, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
  });
}

async function run(slug) {
  const net = netFor(slug);
  console.log(`\n=== ${slug} ===  pm=${net.poolManager} deploy=${net.deployBlock} range=${net.logRange}`);
  console.log(`rpcs: ${net.rpcs.join(", ")}`);
  const client = createPublicClient({ transport: http(net.rpcs[0], { timeout: 20_000, retryCount: 0 }) });

  const latest = await client.getBlockNumber();
  const range = BigInt(net.logRange);

  // 1. PotOpened scan
  const pots = [];
  for (let from = BigInt(net.deployBlock); from <= latest; from += range) {
    const to = from + range - 1n > latest ? latest : from + range - 1n;
    try {
      const logs = await getLogs(client, HOOK, [POT_TOPIC], from, to);
      pots.push(...logs);
    } catch (e) {
      console.log(`  PotOpened scan window ${from}-${to} FAILED: ${e.message?.slice(0, 160)}`);
    }
  }
  console.log(`  PotOpened: ${pots.length} pots`);

  for (const log of pots) {
    const { args } = decodeEventLog({ abi: [potOpenedEvent], topics: log.topics, data: log.data });
    const id = args.poolId.toLowerCase();
    const block = BigInt(log.blockNumber);
    console.log(`\n  pool ${id.slice(0, 10)}… pot-block ${block} tx ${log.transactionHash?.slice(0, 14)}…`);

    // 2. calldata path
    try {
      const tx = await client.getTransaction({ hash: log.transactionHash });
      const idx = tx.input.indexOf(INIT_POT_SELECTOR.slice(2));
      let firstArg = "n/a";
      try {
        const { decodeAbiParameters, slice } = await import(
          pathToFileURL(join(ROOT, "web/node_modules/viem/_esm/index.js")).href
        );
        const [k] = decodeAbiParameters(POOL_KEY_ABI, slice(tx.input, 4, 4 + 160));
        firstArg = poolIdOf(k).toLowerCase() === id ? "MATCH" : `mismatch (${poolIdOf(k).slice(0, 10)})`;
      } catch (e2) {
        firstArg = `decode-failed: ${e2.shortMessage ?? e2.message}`.slice(0, 80);
      }
      console.log(
        `    calldata: to=${tx.to} selector=${tx.input.slice(0, 10)} initPot-inside=${idx >= 2} firstArgKey=${firstArg}`,
      );
    } catch (e) {
      console.log(`    calldata: getTransaction FAILED: ${e.message?.slice(0, 160)}`);
    }

    // 3. PoolManager backwards Initialize lookup — exactly the app's query
    let end = block;
    let found = null;
    let spent = 0;
    while (end >= BigInt(net.deployBlock) && spent < 40 && !found) {
      const start = end - range + 1n > BigInt(net.deployBlock) ? end - range + 1n : BigInt(net.deployBlock);
      spent++;
      try {
        const logs = await getLogs(client, net.poolManager, [INIT_TOPIC, [id]], start, end);
        if (logs.length > 0) found = logs[0];
      } catch (e) {
        console.log(`    Initialize window ${start}-${end} FAILED: ${e.message?.slice(0, 200)}`);
        break;
      }
      if (start === BigInt(net.deployBlock)) break;
      end = start - 1n;
    }
    if (!found) {
      console.log(`    Initialize (id-filtered): NOT FOUND after ${spent} windows — probing without the id filter…`);
      // is the topic filter the problem, or is the log genuinely absent?
      try {
        const raw = await getLogs(client, net.poolManager, [INIT_TOPIC], block - 2n, block + 2n);
        console.log(`    Initialize near pot-block WITHOUT id filter: ${raw.length} logs`);
        for (const l of raw) {
          console.log(`      topics[1]=${l.topics[1]} block=${BigInt(l.blockNumber)}`);
        }
      } catch (e) {
        console.log(`    unfiltered probe FAILED: ${e.message?.slice(0, 200)}`);
      }
      continue;
    }
    const dec = decodeEventLog({ abi: [pmInitializeEvent], topics: found.topics, data: found.data });
    const key = {
      currency0: dec.args.currency0,
      currency1: dec.args.currency1,
      fee: Number(dec.args.fee),
      tickSpacing: Number(dec.args.tickSpacing),
      hooks: dec.args.hooks,
    };
    const ok = poolIdOf(key).toLowerCase() === id;
    console.log(
      `    Initialize found in ${spent} window(s) at block ${BigInt(found.blockNumber)} — verify ${ok ? "OK" : "MISMATCH"} (${key.currency0.slice(0, 8)}/${key.currency1.slice(0, 8)} fee=${key.fee})`,
    );
  }
}

for (const slug of process.argv.slice(2)) {
  await run(slug).catch((e) => console.log(`  ${slug} FATAL: ${e.message}`));
}
