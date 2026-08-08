// One-off diagnostic: for every mainnet, scan the hook's PotOpened logs from
// the deploy block with the app's own per-chain settings, and report every
// pool found (or the error that hid it). Run: node scripts/check-pools.mjs [slug]
import { createPublicClient, http, parseAbiItem, toEventSelector } from "viem";

const HOOK = "0xb216070c3509047ea597E2E626A29cea427a60C8";
const POT_OPENED = toEventSelector(parseAbiItem("event PotOpened(bytes32 indexed poolId, address indexed admin)"));

// slug, primary rpc, deployBlock, logRange — mirrors lib/chains.ts
const NETS = [
  ["ethereum", "https://gateway.tenderly.co/public/mainnet", 25703029, 50000],
  ["base", "https://mainnet.base.org", 49657824, 10000],
  ["unichain", "https://unichain.drpc.org", 55356883, 10000],
  ["arbitrum", "https://arb1.arbitrum.io/rpc", 492046075, 50000],
  ["optimism", "https://optimism-rpc.publicnode.com", 155253116, 50000],
  ["bnb", "https://bsc-mainnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3", 114546905, 50000],
  ["polygon", "https://polygon-bor-rpc.publicnode.com", 91600016, 10000],
  ["worldchain", "https://worldchain-mainnet.gateway.tenderly.co", 33384712, 50000],
  ["zora", "https://rpc.zora.energy", 49705618, 50000],
  ["soneium", "https://rpc.soneium.org", 26485168, 50000],
  ["megaeth", "https://mainnet.megaeth.com/rpc", 23308084, 50000],
  ["robinhood", "https://rpc.mainnet.chain.robinhood.com", 30206983, 50000],
  ["tempo", "https://rpc.tempo.xyz", 33657201, 50000],
  ["avalanche", "https://avalanche-c-chain-rpc.publicnode.com", 92242906, 50000],
  ["blast", "https://blast-rpc.publicnode.com", 38647660, 50000],
  ["celo", "https://celo-rpc.publicnode.com", 74204388, 50000],
  ["monad", "https://monad.drpc.org", 93918120, 1000],
  ["xlayer", "https://xlayer.drpc.org", 67336132, 10000],
];

const only = process.argv[2];

async function scan([slug, rpc, deployBlock, logRange]) {
  const client = createPublicClient({ transport: http(rpc, { timeout: 20000 }) });
  try {
    const latest = await client.getBlockNumber();
    const from0 = BigInt(deployBlock);
    const span = latest - from0 + 1n;
    const win = BigInt(logRange);
    const found = [];
    let failed = 0;
    for (let from = from0; from <= latest; from += win) {
      const to = from + win - 1n > latest ? latest : from + win - 1n;
      try {
        const logs = await client.request({
          method: "eth_getLogs",
          params: [{ address: HOOK, topics: [POT_OPENED], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
        });
        for (const l of logs) found.push({ poolId: l.topics[1], block: Number(BigInt(l.blockNumber)) });
      } catch (e) {
        failed++;
        if (failed <= 2) console.log(`   [${slug}] window ${from}-${to} failed: ${String(e.message ?? e).slice(0, 120)}`);
        await new Promise((r) => setTimeout(r, 800));
        from -= win; // retry same window once after backoff
        if (failed > 6) throw new Error("too many window failures");
      }
    }
    console.log(`${slug.padEnd(11)} latest=${latest} span=${span} pools=${found.length}${failed ? ` (retries:${failed})` : ""}`);
    for (const p of found) console.log(`   pool ${p.poolId} @ block ${p.block}`);
  } catch (e) {
    console.log(`${slug.padEnd(11)} ERROR: ${String(e.message ?? e).slice(0, 160)}`);
  }
}

for (const net of NETS) {
  if (only && net[0] !== only) continue;
  await scan(net);
}
