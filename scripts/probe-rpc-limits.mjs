#!/usr/bin/env node
/**
 * Measure what each public RPC in `web/lib/chains.ts` actually allows, so the
 * app can be configured from data instead of guesses.
 *
 * Per endpoint it reports:
 *   - liveness + chainId match
 *   - eth_getLogs max block range (binary search against the real hook address)
 *   - JSON-RPC batch acceptance (does a batch of N come back as an array?)
 *   - concurrency tolerance (how many simultaneous getLogs before 429/5xx)
 *   - median latency
 *
 * Usage:
 *   node scripts/probe-rpc-limits.mjs                # every mainnet
 *   node scripts/probe-rpc-limits.mjs monad xlayer   # selected slugs
 *   node scripts/probe-rpc-limits.mjs --json out.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHAINS_TS = join(HERE, "..", "web", "lib", "chains.ts");

const TIMEOUT_MS = 20_000;
const RANGE_CANDIDATES = [
  50_000n, 20_000n, 10_000n, 5_000n, 2_000n, 1_000n, 500n, 200n, 100n, 50n, 10n,
];

/* ------------------------------------------------------------ chain parsing */

/**
 * Parse the NETS table straight out of chains.ts. Importing it would drag in
 * viem + Next's env handling for what is three regexes worth of data.
 */
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
    const chainId = Number(rpcLine[1]);
    const rpcs = [...rpcLine[2].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const hook = /hook: CANONICAL_HOOK/.test(block)
      ? /export const CANONICAL_HOOK = "([^"]+)"/.exec(src)[1]
      : null;
    const deployBlock = Number(/deployBlock: (\d+)/.exec(block)?.[1] ?? 0);
    nets.push({ slug, chainId, rpcs, hook, deployBlock, testnet });
  }
  return nets;
}

/* --------------------------------------------------------------- rpc plumbing */

let idc = 1;

async function rpc(url, method, params, { timeout = TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: idc++, method, params }),
      signal: ctl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* html error page */
    }
    return {
      ok: res.ok && json && !json.error,
      status: res.status,
      error: json?.error?.message ?? (res.ok ? null : text.slice(0, 120)),
      result: json?.result,
      ms: Date.now() - started,
    };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.name === "AbortError" ? "timeout" : e), ms: Date.now() - started };
  } finally {
    clearTimeout(t);
  }
}

async function rpcBatch(url, calls) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(calls.map((c) => ({ jsonrpc: "2.0", id: idc++, ...c }))),
      signal: ctl.signal,
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok && Array.isArray(json) && json.length === calls.length, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(t);
  }
}

const hex = (n) => "0x" + BigInt(n).toString(16);

/* ----------------------------------------------------------------- the probes */

async function probeRange(url, hook, from, to) {
  const r = await rpc(url, "eth_getLogs", [
    { address: hook, fromBlock: hex(from), toBlock: hex(to) },
  ]);
  return r;
}

const isOverload = (r) => r.status === 429 || r.status >= 500 || r.error === "timeout";

/**
 * Largest range the endpoint serves. Walks a fixed candidate ladder (rather
 * than a true binary search) because providers advertise round caps.
 *
 * CRITICAL: a 429/5xx is a LOAD verdict, not a range verdict. Descending the
 * ladder on one would "measure" a throttled endpoint at 50 blocks and bake
 * that lie into the app config, so an overload is retried with a long backoff
 * and, if it persists, reported as `throttled` instead of a range.
 */
async function findMaxRange(url, hook, latest) {
  for (const span of RANGE_CANDIDATES) {
    const to = latest - 10n;
    const from = to - span + 1n < 0n ? 0n : to - span + 1n;

    let r = null;
    let throttled = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      r = await probeRange(url, hook, from, to);
      if (!isOverload(r)) break;
      throttled = true;
      await sleep(2_000 * (attempt + 1));
    }
    if (r.ok) return { range: span, ms: r.ms };
    if (isOverload(r)) return { range: 0n, throttled: true, why: `throttled (${r.status || r.error})` };
    if (throttled) {
      // recovered from throttling only to get a real range error — keep going
    }
    if (span === RANGE_CANDIDATES.at(-1)) {
      return { range: 0n, why: `${r.status} ${r.error ?? ""}`.trim() };
    }
    await sleep(250);
  }
  return { range: 0n, why: "no range accepted" };
}

/**
 * How many simultaneous getLogs the endpoint serves without 429/5xx.
 * Probes low → high so the endpoint is never left in a throttled state that
 * would contaminate the next measurement (many providers share one IP bucket
 * across all their chain subdomains).
 */
async function probeConcurrency(url, hook, latest, range) {
  let best = 0;
  for (const n of [1, 2, 3, 4, 6]) {
    const jobs = [];
    for (let i = 0; i < n; i++) {
      const to = latest - 10n - BigInt(i) * range;
      jobs.push(probeRange(url, hook, to - range + 1n, to));
    }
    const rs = await Promise.all(jobs);
    if (!rs.every((r) => r.ok)) break;
    best = n;
    await sleep(800);
  }
  return best;
}

async function probeBatch(url) {
  for (const n of [20, 10, 5, 3]) {
    const r = await rpcBatch(url, Array.from({ length: n }, () => ({ method: "eth_blockNumber", params: [] })));
    if (r.ok) return n;
  }
  return 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------- driver */

async function probeEndpoint(net, url) {
  const out = { url, live: false };

  const cid = await rpc(url, "eth_chainId", []);
  if (!cid.ok) {
    out.why = `chainId: ${cid.status} ${cid.error ?? ""}`.trim();
    return out;
  }
  if (Number(cid.result) !== net.chainId) {
    out.why = `wrong chain ${Number(cid.result)} != ${net.chainId}`;
    return out;
  }
  out.live = true;
  out.latency = cid.ms;

  const bn = await rpc(url, "eth_blockNumber", []);
  if (!bn.ok) {
    out.why = "blockNumber failed";
    return out;
  }
  const latest = BigInt(bn.result);
  out.latest = latest;

  out.batch = await probeBatch(url);

  const range = await findMaxRange(url, net.hook, latest);
  out.range = range.range;
  out.throttled = !!range.throttled;
  if (range.range === 0n) {
    out.why = range.why;
    return out;
  }
  out.rangeMs = range.ms;

  out.parallel = await probeConcurrency(url, net.hook, latest, range.range);
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const jsonAt = argv.indexOf("--json");
  const jsonOut = jsonAt >= 0 ? argv[jsonAt + 1] : null;
  const slugs = argv.filter((a) => !a.startsWith("--") && a !== jsonOut);

  const nets = loadNets().filter(
    (n) => n.hook && (slugs.length ? slugs.includes(n.slug) : !n.testnet),
  );

  const report = {};
  for (const net of nets) {
    console.log(`\n=== ${net.slug} (${net.chainId}) ===`);
    report[net.slug] = [];
    for (const url of net.rpcs) {
      const r = await probeEndpoint(net, url);
      report[net.slug].push({ ...r, range: r.range ? Number(r.range) : 0, latest: undefined });
      const tag = !r.live
        ? `DEAD          ${r.why}`
        : r.range === 0n
          ? `${r.throttled ? "THROTTLED" : "NO-LOGS  "}     ${r.why}`
          : `range=${String(r.range).padStart(6)} par=${r.parallel} batch=${r.batch} ${r.latency}ms`;
      console.log(`  ${tag}  ${url}`);
      // let a shared provider bucket refill before the next endpoint
      await sleep(2_000);
    }
  }

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(report, null, 2));
    console.log(`\nwrote ${jsonOut}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
