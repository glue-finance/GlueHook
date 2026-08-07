#!/usr/bin/env node
/**
 * Exact JSON-RPC batch-size limit per endpoint.
 *
 * viem ships one HTTP request per batch, so a transport configured above an
 * endpoint's batch cap fails EVERY grouped call — which surfaces as blanket
 * 500s that look like the node is broken rather than like a config error.
 *
 * Usage: node scripts/probe-batch-limit.mjs <url> [url...]
 */

async function tryBatch(url, n) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        Array.from({ length: n }, (_, i) => ({
          jsonrpc: "2.0",
          id: i + 1,
          method: "eth_blockNumber",
          params: [],
        })),
      ),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-json error body */
    }
    if (!res.ok) return { ok: false, why: `${res.status} ${text.slice(0, 90)}` };
    if (!Array.isArray(json)) return { ok: false, why: `not an array: ${text.slice(0, 90)}` };
    if (json.length !== n) return { ok: false, why: `got ${json.length}/${n}` };
    const bad = json.find((r) => r.error);
    if (bad) return { ok: false, why: bad.error.message?.slice(0, 90) };
    return { ok: true };
  } catch (e) {
    return { ok: false, why: String(e.name === "TimeoutError" ? "timeout" : e).slice(0, 90) };
  }
}

for (const url of process.argv.slice(2)) {
  let best = 0;
  let why = "";
  for (const n of [1, 2, 3, 4, 5, 8, 10, 15, 20, 30, 50]) {
    const r = await tryBatch(url, n);
    if (!r.ok) {
      why = `${n} -> ${r.why}`;
      break;
    }
    best = n;
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`${String(best).padStart(3)}  ${url}${why ? `   (${why})` : ""}`);
}
