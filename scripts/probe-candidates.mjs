#!/usr/bin/env node
/**
 * Vet candidate public endpoints before adding them to `web/lib/chains.ts`.
 *
 * Checks the four things that actually decide whether an endpoint is usable
 * for this app: right chain, CORS (the app is browser-side), eth_getLogs range
 * cap, and — the one that catches "free tier" endpoints — whether it serves
 * logs at the DEPLOY block rather than only near the tip.
 *
 * Usage: node scripts/probe-candidates.mjs <chainId> <deployBlock> <hook> <url...>
 */

const [chainIdArg, deployBlockArg, hook, ...urls] = process.argv.slice(2);
const chainId = Number(chainIdArg);
const deployBlock = BigInt(deployBlockArg);

const hex = (n) => "0x" + BigInt(n).toString(16);

async function call(url, method, params, extraHeaders = {}) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let j = null;
    try {
      j = JSON.parse(text);
    } catch {
      /* html */
    }
    return {
      ok: res.ok && j && !j.error,
      status: res.status,
      cors: res.headers.get("access-control-allow-origin"),
      error: j?.error?.message ?? (res.ok ? null : text.slice(0, 100).replace(/\s+/g, " ")),
      result: j?.result,
    };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.name === "TimeoutError" ? "timeout" : e).slice(0, 80) };
  }
}

for (const url of urls) {
  const cid = await call(url, "eth_chainId", []);
  if (!cid.ok) {
    console.log(`DEAD      ${url}  ${cid.status} ${cid.error ?? ""}`);
    continue;
  }
  if (Number(cid.result) !== chainId) {
    console.log(`WRONGCHAIN ${url}  got ${Number(cid.result)}`);
    continue;
  }

  // browser reachability: the app calls these from the page, so a missing
  // CORS header makes an otherwise perfect endpoint useless
  const cors = cid.cors ?? "(none)";

  const bn = await call(url, "eth_blockNumber", []);
  const latest = BigInt(bn.result ?? "0x0");

  let range = 0;
  for (const span of [50_000n, 10_000n, 5_000n, 2_000n, 1_000n, 500n, 100n]) {
    const to = latest - 10n;
    const r = await call(url, "eth_getLogs", [
      { address: hook, fromBlock: hex(to - span + 1n), toBlock: hex(to) },
    ]);
    if (r.ok) {
      range = Number(span);
      break;
    }
  }

  // the deciding test: can it read the oldest range the app needs?
  const deep = await call(url, "eth_getLogs", [
    { address: hook, fromBlock: hex(deployBlock), toBlock: hex(deployBlock + BigInt(Math.max(range, 100) - 1)) },
  ]);

  console.log(
    `${deep.ok ? "OK      " : "NO-ARCHIVE"} range=${String(range).padStart(6)} cors=${cors}  ${url}` +
      (deep.ok ? "" : `  [${deep.status} ${deep.error ?? ""}]`),
  );
}
