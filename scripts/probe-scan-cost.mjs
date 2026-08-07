#!/usr/bin/env node
/**
 * How expensive is a full history scan on each chain?
 *
 * requests = (latest - deployBlock) / bestRange, across the endpoints that
 * actually serve eth_getLogs. A chain that needs tens of thousands of
 * requests can never be scanned block-by-block from the browser and needs a
 * different strategy (indexer, or a much narrower scan floor).
 *
 * Usage: node scripts/probe-scan-cost.mjs [slug...]
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHAINS_TS = join(HERE, "..", "web", "lib", "chains.ts");

function loadNets() {
  const src = readFileSync(CHAINS_TS, "utf8");
  const body = src.slice(src.indexOf("export const NETS"));
  const nets = [];
  for (const block of body.split(/\n  \{\n/).slice(1)) {
    const slug = /slug: "([^"]+)"/.exec(block)?.[1];
    if (!slug) continue;
    const testnet = /testnet: (true|false)/.exec(block)?.[1] === "true";
    const rpcLine = /rpcs: rpcsFor\((\d+),([^)]*)\)/.exec(block);
    if (!rpcLine) continue;
    nets.push({
      slug,
      chainId: Number(rpcLine[1]),
      rpcs: [...rpcLine[2].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
      deployBlock: Number(/deployBlock: (\d+)/.exec(block)?.[1] ?? 0),
      testnet,
    });
  }
  return nets;
}

async function blockNumber(url) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: AbortSignal.timeout(12_000),
    });
    const j = await res.json();
    return j.result ? Number(BigInt(j.result)) : null;
  } catch {
    return null;
  }
}

const argv = process.argv.slice(2);
const nets = loadNets().filter((n) => (argv.length ? argv.includes(n.slug) : !n.testnet));

console.log("slug".padEnd(12), "span".padStart(12), "@1k".padStart(9), "@10k".padStart(8), "@45k".padStart(7));
for (const net of nets) {
  let latest = null;
  for (const url of net.rpcs) {
    latest = await blockNumber(url);
    if (latest) break;
  }
  if (!latest) {
    console.log(net.slug.padEnd(12), "unreachable");
    continue;
  }
  const span = latest - net.deployBlock;
  const req = (r) => Math.ceil(span / r).toLocaleString();
  console.log(
    net.slug.padEnd(12),
    span.toLocaleString().padStart(12),
    req(1_000).padStart(9),
    req(10_000).padStart(8),
    req(45_000).padStart(7),
  );
}
