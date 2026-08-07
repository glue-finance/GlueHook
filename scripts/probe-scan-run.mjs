#!/usr/bin/env node
/**
 * End-to-end rehearsal of the app's registry scan against a real chain, using
 * the same shape the browser uses: topic-filtered eth_getLogs, the chain's
 * configured `logRange`, and the same fan-out width.
 *
 * Reports wall time, request count and — the number that matters — how many
 * requests FAILED. A clean run here is a clean browser console.
 *
 * Usage: node scripts/probe-scan-run.mjs monad xlayer
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const CHAINS_TS = join(HERE, "..", "web", "lib", "chains.ts");

const PARALLEL = Number(process.env.PAR ?? 4);
/** keccak256("PotOpened(bytes32,address)") */
const POT_OPENED = "0x0b1805a2a2d444856f9d64ad1693826cc51023abe99cddf83f065c9152465a2d";

function loadNets() {
  const src = readFileSync(CHAINS_TS, "utf8");
  const hook = /export const CANONICAL_HOOK = "([^"]+)"/.exec(src)[1];
  const body = src.slice(src.indexOf("export const NETS"));
  const nets = [];
  for (const block of body.split(/\n  \{\n/).slice(1)) {
    const slug = /slug: "([^"]+)"/.exec(block)?.[1];
    const rpcLine = /rpcs: rpcsFor\((\d+),([^)]*)\)/.exec(block);
    if (!slug || !rpcLine) continue;
    nets.push({
      slug,
      chainId: Number(rpcLine[1]),
      rpcs: [...rpcLine[2].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
      hook,
      deployBlock: Number(/deployBlock: (\d+)/.exec(block)?.[1] ?? 0),
      logRange: Number((/logRange: ([\d_]+)/.exec(block)?.[1] ?? "10000").replace(/_/g, "")),
      logEndpoints: Number(/logEndpoints: (\d+)/.exec(block)?.[1] ?? 1),
    });
  }
  return nets;
}

const stats = { requests: 0, failures: 0, byStatus: {} };

async function getLogs(url, address, topics, from, to) {
  stats.requests++;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: stats.requests,
        method: "eth_getLogs",
        params: [
          { address, topics, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      stats.failures++;
      const body = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
      const k = `${res.status}: ${body}`;
      stats.byStatus[k] = (stats.byStatus[k] ?? 0) + 1;
      throw new Error(`HTTP ${res.status}`);
    }
    const j = await res.json();
    if (j.error) {
      stats.failures++;
      const k = `rpc ${j.error.code}: ${String(j.error.message).slice(0, 100)}`;
      stats.byStatus[k] = (stats.byStatus[k] ?? 0) + 1;
      throw new Error(j.error.message);
    }
    return j.result;
  } catch (e) {
    if (!/HTTP |error/.test(String(e))) {
      stats.failures++;
      stats.byStatus.network = (stats.byStatus.network ?? 0) + 1;
    }
    throw e;
  }
}

async function blockNumber(url) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    signal: AbortSignal.timeout(15_000),
  });
  return BigInt((await res.json()).result);
}

async function run(net) {
  const urls = net.rpcs.slice(0, net.logEndpoints);
  const latest = await blockNumber(urls[0]);
  const from = BigInt(net.deployBlock);
  const window = BigInt(net.logRange);
  const totalReq = Math.ceil(Number(latest - from) / net.logRange);
  const width = PARALLEL * urls.length;

  console.log(
    `\n=== ${net.slug} === range=${net.logRange} span=${(latest - from).toLocaleString()} ` +
      `expect ~${totalReq} requests across ${urls.length} endpoint(s), ${width} in flight`,
  );

  const t0 = Date.now();
  const logs = [];
  let cursor = from;
  let turn = 0;
  while (cursor <= latest) {
    const jobs = [];
    let c = cursor;
    for (let i = 0; i < width && c <= latest; i++) {
      const end = c + window - 1n > latest ? latest : c + window - 1n;
      jobs.push(getLogs(urls[turn++ % urls.length], net.hook, [POT_OPENED], c, end));
      c = end + 1n;
    }
    const rs = await Promise.allSettled(jobs);
    for (const r of rs) if (r.status === "fulfilled") logs.push(...r.value);
    cursor = c;
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `    ${secs}s  ${stats.requests} requests  ${stats.failures} failed  ${logs.length} PotOpened logs`,
  );
  for (const [k, n] of Object.entries(stats.byStatus)) console.log(`      ${n}x ${k}`);
  const ids = new Set(logs.map((l) => l.topics[1]));
  console.log(`    ${ids.size} distinct pools`);
  // how far back each pool's own feed scan has to reach — the registry scan
  // is only half the first-load cost, the per-pool feed is the other half
  for (const l of logs) {
    const b = Number(BigInt(l.blockNumber));
    console.log(
      `      pool opened at ${b} — feed spans ${(Number(latest) - b).toLocaleString()} blocks ` +
        `(~${Math.ceil((Number(latest) - b) / net.logRange)} requests)`,
    );
  }
  stats.requests = 0;
  stats.failures = 0;
  stats.byStatus = {};
}

const argv = process.argv.slice(2);
const nets = loadNets().filter((n) => (argv.length ? argv.includes(n.slug) : false));
if (nets.length === 0) {
  console.error("pass one or more slugs, e.g. monad xlayer");
  process.exit(1);
}
for (const net of nets) await run(net);
