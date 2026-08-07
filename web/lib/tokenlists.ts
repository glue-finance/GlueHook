"use client";

import { useQuery } from "@tanstack/react-query";
import { getAddress, type Address } from "viem";
import { DEXSCREENER_CHAIN, type Net } from "./chains";

/**
 * Token discovery via the Token Lists standard (https://tokenlists.org) — the
 * same public lists Uniswap ships today. No DB, no server: the lists are
 * fetched straight from Uniswap's endpoints, filtered per chain, and cached in
 * localStorage for a day. Anyone forking this UI gets the exact same data.
 */

export type ListedToken = {
  chainId: number;
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
};

/** Uniswap Labs lists, in priority order (first list wins on a duplicate). */
const LIST_URLS = [
  "https://tokens.uniswap.org", // Uniswap Labs Default
  "https://extendedtokens.uniswap.org", // Uniswap Labs Extended
];

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cacheKey = (url: string) => `gh.tokenlist.${url}`;

/** Rewrite ipfs:// logo URIs to a public gateway. */
export function resolveLogoURI(uri?: string): string | undefined {
  if (!uri) return undefined;
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  return uri;
}

type RawList = { tokens: ListedToken[] };

async function fetchList(url: string): Promise<ListedToken[]> {
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(cacheKey(url));
      if (raw) {
        const { at, tokens } = JSON.parse(raw) as { at: number; tokens: ListedToken[] };
        if (Date.now() - at < CACHE_TTL_MS) return tokens;
      }
    } catch {
      /* corrupted cache → refetch */
    }
  }
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`token list ${url}: ${res.status}`);
  const list = (await res.json()) as RawList;
  const tokens = (list.tokens ?? []).map((t) => ({
    chainId: t.chainId,
    address: t.address,
    name: t.name,
    symbol: t.symbol,
    decimals: t.decimals,
    logoURI: t.logoURI,
  }));
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(cacheKey(url), JSON.stringify({ at: Date.now(), tokens }));
    } catch {
      /* quota — non-fatal */
    }
  }
  return tokens;
}

/** All listed tokens for one chain, first-list-wins de-duplicated by address. */
export function useTokenList(net: Net) {
  return useQuery({
    queryKey: ["tokenlist", net.chain.id],
    staleTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<ListedToken[]> => {
      const results = await Promise.allSettled(LIST_URLS.map(fetchList));
      const byAddr = new Map<string, ListedToken>();
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        for (const t of r.value) {
          if (t.chainId !== net.chain.id) continue;
          const k = t.address.toLowerCase();
          if (!byAddr.has(k)) byAddr.set(k, t);
        }
      }
      return [...byAddr.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
    },
  });
}

/** The wrapped-native entry of a chain's list — its logo doubles as the native logo. */
export function wrappedNativeOf(net: Net, tokens: ListedToken[] | undefined): ListedToken | undefined {
  const wsym = `W${net.chain.nativeCurrency.symbol}`.toLowerCase();
  return tokens?.find((t) => t.symbol.toLowerCase() === wsym);
}

/** Well-known native-coin logos (TrustWallet's chain info icons — stable CDN). */
const TW = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";
const NATIVE_LOGOS: Record<string, string> = {
  ETH: `${TW}/ethereum/info/logo.png`,
  BNB: `${TW}/smartchain/info/logo.png`,
  POL: `${TW}/polygon/info/logo.png`,
  MATIC: `${TW}/polygon/info/logo.png`,
  AVAX: `${TW}/avalanchec/info/logo.png`,
  CELO: `${TW}/celo/info/logo.png`,
  OKB: `${TW}/okexchain/info/logo.png`,
};

/** TrustWallet asset folder per chain slug (only chains their repo covers). */
const TW_CHAIN: Record<string, string> = {
  ethereum: "ethereum",
  base: "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
  bnb: "smartchain",
  polygon: "polygon",
  avalanche: "avalanchec",
  celo: "celo",
  blast: "blast",
};

/**
 * ALL logo candidates for an address, best first. The icon component walks
 * the list on load errors, so a token missing from the Uniswap lists (every
 * token on Robinhood/MegaETH/Tempo…) still resolves through TrustWallet's
 * repo or DexScreener's token-image CDN.
 */
export function useTokenLogos(net: Net, addr: Address | null | undefined): string[] {
  const { data: tokens } = useTokenList(net);
  if (!addr) return [];
  const out: string[] = [];
  const push = (u?: string) => {
    if (u && !out.includes(u)) out.push(u);
  };

  if (addr === "0x0000000000000000000000000000000000000000") {
    push(resolveLogoURI(wrappedNativeOf(net, tokens)?.logoURI));
    push(NATIVE_LOGOS[net.chain.nativeCurrency.symbol.toUpperCase()]);
    return out;
  }

  const hit = tokens?.find((t) => t.address.toLowerCase() === addr.toLowerCase());
  push(resolveLogoURI(hit?.logoURI));
  const tw = TW_CHAIN[net.slug];
  if (tw) {
    try {
      push(`${TW}/${tw}/assets/${getAddress(addr)}/logo.png`);
    } catch {
      /* not a valid address — skip */
    }
  }
  const ds = DEXSCREENER_CHAIN[net.slug];
  if (ds) push(`https://dd.dexscreener.com/ds-data/tokens/${ds}/${addr.toLowerCase()}.png`);
  return out;
}

/** Logo for any address on a chain (native → the wrapped-native's logo). */
export function useTokenLogo(net: Net, addr: Address | null | undefined): string | undefined {
  return useTokenLogos(net, addr)[0];
}

/** The pinned quick-pick row: native first, then the classics that exist on this chain. */
const PINNED_SYMBOLS = ["USDC", "USDT", "DAI", "WBTC", "WETH", "UNI"];

export function pinnedTokens(net: Net, tokens: ListedToken[] | undefined): ListedToken[] {
  if (!tokens) return [];
  const out: ListedToken[] = [];
  for (const sym of PINNED_SYMBOLS) {
    const hit = tokens.find((t) => t.symbol === sym);
    if (hit) out.push(hit);
    if (out.length >= 5) break;
  }
  return out;
}
