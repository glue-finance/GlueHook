import { defineChain, type Chain } from "viem";
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  base,
  baseSepolia,
  blast,
  bsc,
  celo,
  mainnet,
  optimism,
  polygon,
  sepolia,
  soneium,
  unichain,
  unichainSepolia,
  worldchain,
  xLayer,
  zora,
} from "viem/chains";

// ---------------------------------------------------------------------------
// Chains without a viem definition
// ---------------------------------------------------------------------------

/** canonical Multicall3 — verified deployed on every custom chain below */
const MULTICALL3 = {
  multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" as const },
};

export const megaeth = defineChain({
  id: 4326,
  name: "MegaETH",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.megaeth.com/rpc"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://megaeth.blockscout.com" },
  },
  contracts: MULTICALL3,
});

export const tempo = defineChain({
  id: 4217,
  name: "Tempo",
  // Tempo has no native gas token; fees are paid in USD stablecoins.
  nativeCurrency: { name: "Tempo", symbol: "TEMPO", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.tempo.xyz"] } },
  blockExplorers: {
    default: { name: "Tempo Explorer", url: "https://explore.tempo.xyz" },
  },
  contracts: MULTICALL3,
});

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Robinscan", url: "https://robinscan.io" },
  },
  contracts: MULTICALL3,
});

export const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://monadvision.com" },
  },
  contracts: MULTICALL3,
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  contracts: MULTICALL3,
  testnet: true,
});

// ---------------------------------------------------------------------------
// Registry — one entry per deployed network
// ---------------------------------------------------------------------------

export const CANONICAL_HOOK = "0xb216070c3509047ea597E2E626A29cea427a60C8" as const;
export const CANONICAL_LIB = "0x26CD66aDec6176c11f894A9DE5bC504235c90241" as const;

export type Net = {
  chain: Chain;
  /** short id used in UI + env var names */
  slug: string;
  label: string;
  testnet: boolean;
  /**
   * public RPCs (browser-safe), primary first — requests fall through the
   * list on failure/rate-limit; every URL is chain-id-verified before being
   * added here. env NEXT_PUBLIC_RPC_<CHAINID> prepends a private endpoint.
   */
  rpcs: string[];
  hook: `0x${string}`;
  poolManager: `0x${string}`;
  /** block the hook was deployed at — log scans never look earlier */
  deployBlock: number;
  explorer: string;
  /** Uniswap Universal Router (V4_SWAP entry) — absent = no swap UI on this net */
  universalRouter?: `0x${string}`;
  /**
   * The chain has NO spendable native coin (Tempo: fees are paid in USD
   * stablecoins, "TEMPO" is not a real asset) — never offer the native side
   * in token pickers and never pre-select it.
   */
  noNative?: boolean;
};

/** canonical Permit2 — same address on every chain */
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

function rpcsFor(chainId: number, ...urls: string[]): string[] {
  if (typeof process !== "undefined") {
    const v = process.env[`NEXT_PUBLIC_RPC_${chainId}`];
    if (v) return [v, ...urls];
  }
  return urls;
}

export const NETS: Net[] = [
  {
    chain: mainnet, slug: "ethereum", label: "Ethereum", testnet: false,
    // tenderly + mevblocker serve eth_getLogs (45k / 10k ranges); publicnode
    // and drpc refuse getLogs on mainnet entirely — kept as read fallbacks only
    rpcs: rpcsFor(1, "https://gateway.tenderly.co/public/mainnet", "https://rpc.mevblocker.io", "https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"),
    hook: CANONICAL_HOOK, poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    deployBlock: 25703029, explorer: "https://etherscan.io",
    universalRouter: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
  },
  {
    chain: base, slug: "base", label: "Base", testnet: false,
    rpcs: rpcsFor(8453, "https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"),
    hook: CANONICAL_HOOK, poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
    deployBlock: 49657824, explorer: "https://basescan.org",
    universalRouter: "0x6ff5693b99212da76ad316178a184ab56d299b43",
  },
  {
    chain: unichain, slug: "unichain", label: "Unichain", testnet: false,
    // publicnode, NOT mainnet.unichain.org — the official endpoint has been seen accepting
    // eth_sendRawTransaction and silently dropping it.
    // reads may fall back to mainnet.unichain.org — writes go through the wallet, never here
    rpcs: rpcsFor(130, "https://unichain-rpc.publicnode.com", "https://unichain.drpc.org", "https://mainnet.unichain.org"),
    hook: CANONICAL_HOOK, poolManager: "0x1F98400000000000000000000000000000000004",
    deployBlock: 55356883, explorer: "https://uniscan.xyz",
    universalRouter: "0xef740bf23acae26f6492b10de645d6b98dc8eaf3",
  },
  {
    chain: arbitrum, slug: "arbitrum", label: "Arbitrum", testnet: false,
    rpcs: rpcsFor(42161, "https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com", "https://arbitrum.drpc.org"),
    hook: CANONICAL_HOOK, poolManager: "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32",
    deployBlock: 492046075, explorer: "https://arbiscan.io",
    universalRouter: "0xa51afafe0263b40edaef0df8781ea9aa03e381a3",
  },
  {
    chain: optimism, slug: "optimism", label: "Optimism", testnet: false,
    // publicnode first: mainnet.optimism.io rate-limits (429) under scan load
    rpcs: rpcsFor(10, "https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io", "https://optimism.drpc.org"),
    hook: CANONICAL_HOOK, poolManager: "0x9a13F98Cb987694C9F086b1F5eB990EeA8264Ec3",
    deployBlock: 155253116, explorer: "https://optimistic.etherscan.io",
    universalRouter: "0x851116d9223fabed8e56c0e6b8ad0c31d98b3507",
  },
  {
    chain: bsc, slug: "bnb", label: "BNB Chain", testnet: false,
    // publicnode first: bsc-dataseed answers getLogs with "limit exceeded" at ANY range
    rpcs: rpcsFor(56, "https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org", "https://bsc.drpc.org"),
    hook: CANONICAL_HOOK, poolManager: "0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF",
    deployBlock: 114546905, explorer: "https://bscscan.com",
    universalRouter: "0x1906c1d672b88cd1b9ac7593301ca990f94eae07",
  },
  {
    chain: polygon, slug: "polygon", label: "Polygon", testnet: false,
    // publicnode first (10k getLogs range); polygon-rpc.com returns 401 outright
    rpcs: rpcsFor(137, "https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org", "https://polygon-rpc.com"),
    hook: CANONICAL_HOOK, poolManager: "0x67366782805870060151383F4BbFF9daB53e5cD6",
    deployBlock: 91600016, explorer: "https://polygonscan.com",
    universalRouter: "0x1095692a6237d83c6a72f3f5efedb9a670c49223",
  },
  {
    chain: worldchain, slug: "worldchain", label: "World Chain", testnet: false,
    // drpc first (10k getLogs range); the alchemy public gateway refuses getLogs at any range
    rpcs: rpcsFor(480, "https://worldchain.drpc.org", "https://worldchain-mainnet.g.alchemy.com/public"),
    hook: CANONICAL_HOOK, poolManager: "0xb1860D529182ac3BC1F51Fa2ABd56662b7D13f33",
    deployBlock: 33384712, explorer: "https://worldscan.org",
    universalRouter: "0x8ac7bee993bb44dab564ea4bc9ea67bf9eb5e743",
  },
  {
    chain: zora, slug: "zora", label: "Zora", testnet: false,
    rpcs: rpcsFor(7777777, "https://rpc.zora.energy", "https://zora.drpc.org"),
    hook: CANONICAL_HOOK, poolManager: "0x0575338e4C17006aE181B47900A84404247CA30f",
    deployBlock: 49705618, explorer: "https://explorer.zora.energy",
    universalRouter: "0x3315ef7ca28db74abadc6c44570efdf06b04b020",
  },
  {
    chain: soneium, slug: "soneium", label: "Soneium", testnet: false,
    rpcs: rpcsFor(1868, "https://rpc.soneium.org", "https://soneium.drpc.org"),
    hook: CANONICAL_HOOK, poolManager: "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32",
    deployBlock: 26485168, explorer: "https://soneium.blockscout.com",
    universalRouter: "0x4cded7edf52c8aa5259a54ec6a3ce7c6d2a455df",
  },
  {
    chain: megaeth, slug: "megaeth", label: "MegaETH", testnet: false,
    rpcs: rpcsFor(4326, "https://mainnet.megaeth.com/rpc"),
    hook: CANONICAL_HOOK, poolManager: "0xaCB7e78fa05D562e0A5D3089ec896D57D057d38E",
    deployBlock: 23308084, explorer: "https://megaeth.blockscout.com",
    universalRouter: "0x47837eb80db5908eabba9105626d9b348bea7b02",
  },
  {
    chain: robinhood, slug: "robinhood", label: "Robinhood", testnet: false,
    rpcs: rpcsFor(4663, "https://rpc.mainnet.chain.robinhood.com"),
    hook: CANONICAL_HOOK, poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    deployBlock: 30206983, explorer: "https://robinscan.io",
    universalRouter: "0x8876789976decbfcbbbe364623c63652db8c0904",
  },
  {
    chain: tempo, slug: "tempo", label: "Tempo", testnet: false,
    rpcs: rpcsFor(4217, "https://rpc.tempo.xyz"),
    hook: CANONICAL_HOOK, poolManager: "0x33620f62C5b9B2086dD6b62F4A297A9f30347029",
    deployBlock: 33657201, explorer: "https://explore.tempo.xyz",
    universalRouter: "0xa2dc7d0266f0cc50b3eeaf36c9bfcecff1beea91",
    noNative: true,
  },
  {
    chain: avalanche, slug: "avalanche", label: "Avalanche", testnet: false,
    // publicnode first (unlimited getLogs); the official api caps ranges at 2048
    rpcs: rpcsFor(43114, "https://avalanche-c-chain-rpc.publicnode.com", "https://api.avax.network/ext/bc/C/rpc", "https://avalanche.drpc.org"),
    hook: CANONICAL_HOOK, poolManager: "0x06380C0e0912312B5150364B9DC4542BA0DbBc85",
    deployBlock: 92242906,
    explorer: "https://snowscan.xyz",
    universalRouter: "0x94b75331ae8d42c1b61065089b7d48fe14aa73b7",
  },
  {
    chain: blast, slug: "blast", label: "Blast", testnet: false,
    // publicnode first (unlimited getLogs); rpc.blast.io 413s on wide ranges
    rpcs: rpcsFor(81457, "https://blast-rpc.publicnode.com", "https://rpc.blast.io", "https://blast.drpc.org"),
    // Ring Protocol's v4-core deployment — runtime bytecode is byte-identical to the canonical
    // PoolManager (only the embedded self-address immutable differs); verified on-chain.
    hook: CANONICAL_HOOK, poolManager: "0x1631559198A9e474033433b2958daBC135ab6446",
    deployBlock: 38647660,
    explorer: "https://blastscan.io",
    universalRouter: "0xeabbcb3e8e415306207ef514f660a3f820025be3",
  },
  {
    chain: celo, slug: "celo", label: "Celo", testnet: false,
    // publicnode first (unlimited getLogs); forno caps ranges around 2k
    rpcs: rpcsFor(42220, "https://celo-rpc.publicnode.com", "https://forno.celo.org", "https://celo.drpc.org"),
    hook: CANONICAL_HOOK, poolManager: "0x288dc841A52FCA2707c6947B3A777c5E56cd87BC",
    deployBlock: 74204388,
    explorer: "https://celoscan.io",
    universalRouter: "0xcb695bc5d3aa22cad1e6df07801b061a05a0233a",
  },
  {
    chain: monad, slug: "monad", label: "Monad", testnet: false,
    // every public Monad endpoint caps getLogs at ~1k blocks — the scanner
    // learns that and fans out in parallel; three scan-capable endpoints
    // spread the load. rpc.monad.xyz refuses getLogs entirely (413) — read
    // fallback only
    rpcs: rpcsFor(143, "https://monad.drpc.org", "https://monad.gateway.tenderly.co", "https://143.rpc.thirdweb.com", "https://rpc.monad.xyz"),
    hook: CANONICAL_HOOK, poolManager: "0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e",
    deployBlock: 93918120,
    explorer: "https://monadvision.com",
    universalRouter: "0x0d97dc33264bfc1c226207428a79b26757fb9dc3",
  },
  {
    chain: xLayer, slug: "xlayer", label: "X Layer", testnet: false,
    // drpc first (10k getLogs range); rpc.xlayer.tech refuses getLogs at any range
    rpcs: rpcsFor(196, "https://xlayer.drpc.org", "https://rpc.xlayer.tech"),
    hook: CANONICAL_HOOK, poolManager: "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32",
    deployBlock: 67336132,
    explorer: "https://www.oklink.com/x-layer",
    universalRouter: "0xda00ae15d3a71466517129255255db7c0c0956d3",
  },
  {
    chain: sepolia, slug: "sepolia", label: "Sepolia", testnet: true,
    rpcs: rpcsFor(11155111, "https://ethereum-sepolia-rpc.publicnode.com", "https://1rpc.io/sepolia"),
    hook: CANONICAL_HOOK, poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
    deployBlock: 11438219, explorer: "https://sepolia.etherscan.io",
    universalRouter: "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b",
  },
  {
    chain: baseSepolia, slug: "base-sepolia", label: "Base Sepolia", testnet: true,
    rpcs: rpcsFor(84532, "https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com", "https://base-sepolia.drpc.org"),
    hook: CANONICAL_HOOK, poolManager: "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408",
    deployBlock: 45168277, explorer: "https://sepolia.basescan.org",
    universalRouter: "0x492e6456d9528771018deb9e87ef7750ef184104",
  },
  {
    chain: unichainSepolia, slug: "unichain-sepolia", label: "Unichain Sepolia", testnet: true,
    rpcs: rpcsFor(1301, "https://unichain-sepolia-rpc.publicnode.com", "https://unichain-sepolia.drpc.org", "https://sepolia.unichain.org"),
    hook: CANONICAL_HOOK, poolManager: "0x00B036B58a818B1BC34d502D3fE730Db729e62AC",
    deployBlock: 59252497, explorer: "https://sepolia.uniscan.xyz",
    universalRouter: "0xf70536b3bcc1bd1a972dc186a2cf84cc6da6be5d",
  },
  {
    chain: arbitrumSepolia, slug: "arbitrum-sepolia", label: "Arbitrum Sepolia", testnet: true,
    rpcs: rpcsFor(421614, "https://sepolia-rollup.arbitrum.io/rpc", "https://arbitrum-sepolia-rpc.publicnode.com", "https://arbitrum-sepolia.drpc.org"),
    hook: CANONICAL_HOOK, poolManager: "0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317",
    deployBlock: 295676509, explorer: "https://sepolia.arbiscan.io",
    universalRouter: "0xefd1d4bd4cf1e86da286bb4cb1b8bced9c10ba47",
  },
  {
    chain: robinhoodTestnet, slug: "robinhood-testnet", label: "Robinhood Testnet", testnet: true,
    rpcs: rpcsFor(46630, "https://rpc.testnet.chain.robinhood.com"),
    hook: CANONICAL_HOOK, poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    deployBlock: 97982800, explorer: "https://explorer.testnet.chain.robinhood.com",
  },
];

export const MAINNETS = NETS.filter((n) => !n.testnet);
export const TESTNETS = NETS.filter((n) => n.testnet);

export function netById(chainId: number): Net | undefined {
  return NETS.find((n) => n.chain.id === chainId);
}

export function netBySlug(slug: string): Net | undefined {
  return NETS.find((n) => n.slug === slug);
}

/**
 * DexScreener chain slug per network — the chains DexScreener actually
 * indexes (probed against their pairs API). Feeds the embedded chart and
 * their token-image CDN; absent = no DexScreener coverage.
 */
export const DEXSCREENER_CHAIN: Record<string, string> = {
  ethereum: "ethereum",
  base: "base",
  unichain: "unichain",
  arbitrum: "arbitrum",
  optimism: "optimism",
  bnb: "bsc",
  polygon: "polygon",
  worldchain: "worldchain",
  soneium: "soneium",
  avalanche: "avalanche",
  blast: "blast",
  celo: "celo",
  monad: "monad",
  megaeth: "megaeth",
  robinhood: "robinhood",
};
