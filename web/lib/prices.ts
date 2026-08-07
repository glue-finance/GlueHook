"use client";

import { useEffect, useState } from "react";
import type { Net } from "./chains";

/** The network currency's ticker + icon, shared by the simulator and the USD helpers. */
export function nativeCurrencyOf(net: Net): { sym: string; icon: string } {
  const id = net.chain.id;
  if (id === 56 || id === 97) return { sym: "BNB", icon: "/tokens/bnb.png" };
  if (id === 137 || id === 80002) return { sym: "POL", icon: "/tokens/pol.png" };
  if (id === 4217 || id === 42431) return { sym: "USD", icon: "/tokens/usdc.png" };
  if (id === 43114) return { sym: "AVAX", icon: "/tokens/eth.png" };
  if (id === 42220) return { sym: "CELO", icon: "/tokens/eth.png" };
  if (id === 143) return { sym: "MON", icon: "/tokens/eth.png" };
  return { sym: "ETH", icon: "/tokens/eth.png" };
}

/** CoinGecko ids for the network currencies the simulator uses */
const IDS: Record<string, string> = {
  ETH: "ethereum",
  BNB: "binancecoin",
  POL: "polygon-ecosystem-token",
  AVAX: "avalanche-2",
  CELO: "celo",
  MON: "monad",
};

const TTL = 10 * 60 * 1000; // 10 minutes
const LS_KEY = "gluehook.usd-prices.v1";

let inflight: Promise<Record<string, number>> | null = null;
let mem: { at: number; data: Record<string, number> } | null = null;

function readLs(): { at: number; data: Record<string, number> } | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as { at: number; data: Record<string, number> };
  } catch {
    /* ignore */
  }
  return null;
}

async function fetchPrices(): Promise<Record<string, number>> {
  if (mem && Date.now() - mem.at < TTL) return mem.data;
  const ls = readLs();
  if (ls && Date.now() - ls.at < TTL) {
    mem = ls;
    return ls.data;
  }

  if (!inflight) {
    inflight = fetchLlama()
      .catch(() => fetchCoinGecko())
      .catch(() => {
        // both sources down: an expired cache beats no price at all
        const stale = mem?.data ?? readLs()?.data;
        if (stale && Object.keys(stale).length > 0) return stale;
        throw new Error("no price source");
      })
      .then((data) => {
        mem = { at: Date.now(), data };
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(mem));
        } catch {
          /* ignore */
        }
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * Primary: DefiLlama — keyless, CORS-open, no shared rate limit. It accepts
 * `coingecko:<id>` identifiers, so the same IDS map drives both sources.
 */
async function fetchLlama(): Promise<Record<string, number>> {
  const ids = Object.values(IDS).map((id) => `coingecko:${id}`).join(",");
  const r = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
  if (!r.ok) throw new Error(String(r.status));
  const j = (await r.json()) as { coins?: Record<string, { price?: number }> };
  const data: Record<string, number> = {};
  for (const [sym, id] of Object.entries(IDS)) {
    const px = j.coins?.[`coingecko:${id}`]?.price;
    if (px) data[sym] = px;
  }
  if (Object.keys(data).length === 0) throw new Error("empty");
  return data;
}

/**
 * Fallback: anonymous CoinGecko. Its free limits are PER CLIENT IP, and every
 * browser calls from its own IP at most once per cache window — so this scales
 * with users instead of sharing one key's quota.
 */
async function fetchCoinGecko(): Promise<Record<string, number>> {
  const ids = Object.values(IDS).join(",");
  const r = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
  );
  if (!r.ok) throw new Error(String(r.status));
  const j = (await r.json()) as Record<string, { usd?: number }>;
  const data: Record<string, number> = {};
  for (const [sym, id] of Object.entries(IDS)) {
    if (j[id]?.usd) data[sym] = j[id].usd!;
  }
  if (Object.keys(data).length === 0) throw new Error("empty");
  return data;
}

/**
 * Live USD price of a network currency (DefiLlama primary, anonymous CoinGecko
 * fallback, 10-minute cache — fully keyless).
 * `USD` (Tempo) is 1 by definition; null while loading or if every source fails.
 */
export function useUsdPrice(sym: string): number | null {
  const [px, setPx] = useState<number | null>(sym === "USD" ? 1 : null);
  useEffect(() => {
    if (sym === "USD") {
      setPx(1);
      return;
    }
    let alive = true;
    fetchPrices()
      .then((m) => {
        if (alive) setPx(m[sym] ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sym]);
  return px;
}
