"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, isAddress, zeroAddress, type Address } from "viem";
import type { Net } from "@/lib/chains";
import { clientForNet } from "@/lib/client";
import { short } from "@/lib/format";
import {
  pinnedTokens,
  resolveLogoURI,
  useTokenList,
  type ListedToken,
} from "@/lib/tokenlists";
import { TokenIcon, TokenIconFor } from "./TokenIcon";

/**
 * Uniswap-style token selector: a trigger chip that opens a modal with search,
 * pinned quick-picks, the chain's token list, and paste-an-address import for
 * anything the lists don't know (your own token, typically).
 */
export function TokenSelect({
  net,
  value,
  symbol,
  onChange,
  allowNative = false,
  exclude,
  placeholder = "Select token",
}: {
  net: Net;
  value: Address | null;
  /** live symbol of the current value (the caller already resolves metadata) */
  symbol?: string;
  onChange: (addr: Address) => void;
  /** offer the chain's native coin as the first row */
  allowNative?: boolean;
  /** hide one address (the other side of the pair) */
  exclude?: Address | null;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const isNativeSel = value === zeroAddress;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all hover:border-green/60 ${
          value ? "border-[var(--line)] bg-panel2" : "border-dashed border-[var(--line2)]"
        }`}
      >
        {value ? (
          <>
            <TokenIconFor
              net={net}
              address={value}
              symbol={isNativeSel ? net.chain.nativeCurrency.symbol : symbol ?? "?"}
              size={30}
            />
            <span className="min-w-0">
              <span className="block text-[14.5px] font-extrabold leading-tight">
                {isNativeSel ? net.chain.nativeCurrency.symbol : symbol ?? short(value)}
              </span>
              <span className="mono block text-[10px] text-dim2">
                {isNativeSel ? "network token" : short(value)}
              </span>
            </span>
          </>
        ) : (
          <span className="text-[14px] font-bold text-dim">{placeholder}</span>
        )}
        <svg width="12" height="12" viewBox="0 0 12 12" className="ml-auto flex-shrink-0 text-dim" aria-hidden>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <TokenModal
          net={net}
          allowNative={allowNative}
          exclude={exclude}
          onClose={() => setOpen(false)}
          onPick={(addr) => {
            onChange(addr);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function TokenModal({
  net,
  allowNative,
  exclude,
  onClose,
  onPick,
}: {
  net: Net;
  allowNative: boolean;
  exclude?: Address | null;
  onClose: () => void;
  onPick: (addr: Address) => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: tokens, isLoading } = useTokenList(net);

  useEffect(() => {
    inputRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const excludeLc = exclude?.toLowerCase();
  const query = q.trim().toLowerCase();
  const queryIsAddress = isAddress(q.trim());

  const filtered = useMemo(() => {
    if (!tokens) return [];
    const pool = tokens.filter((t) => t.address.toLowerCase() !== excludeLc);
    if (!query) return pool.slice(0, 120);
    return pool
      .filter(
        (t) =>
          t.symbol.toLowerCase().includes(query) ||
          t.name.toLowerCase().includes(query) ||
          t.address.toLowerCase() === query,
      )
      .slice(0, 120);
  }, [tokens, query, excludeLc]);

  // paste-an-address import: resolve unknown tokens live from the chain
  const unknownAddr =
    queryIsAddress && !tokens?.some((t) => t.address.toLowerCase() === query)
      ? (q.trim() as Address)
      : null;
  const importMeta = useQuery({
    queryKey: ["token-import", net.chain.id, unknownAddr],
    enabled: !!unknownAddr,
    retry: 0,
    queryFn: async () => {
      const client = clientForNet(net);
      const [symbol, name, decimals] = await Promise.all([
        client.readContract({ address: unknownAddr!, abi: erc20Abi, functionName: "symbol" }),
        client.readContract({ address: unknownAddr!, abi: erc20Abi, functionName: "name" }),
        client.readContract({ address: unknownAddr!, abi: erc20Abi, functionName: "decimals" }),
      ]);
      return { symbol: symbol as string, name: name as string, decimals: Number(decimals) };
    },
  });

  const pinned = useMemo(() => pinnedTokens(net, tokens), [net, tokens]);
  const showNative =
    allowNative &&
    excludeLc !== zeroAddress &&
    (!query ||
      net.chain.nativeCurrency.symbol.toLowerCase().includes(query) ||
      net.chain.nativeCurrency.name.toLowerCase().includes(query));

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-[rgba(28,36,71,0.45)] p-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="panel panel-hi flex max-h-[72vh] w-full max-w-[420px] flex-col overflow-hidden !p-0">
        <div className="border-b border-[var(--line)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[15px] font-extrabold">Select a token</span>
            <button className="text-dim transition-colors hover:text-txt" onClick={onClose} aria-label="close">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <input
            ref={inputRef}
            className="input"
            placeholder="search name, symbol or paste address"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {(showNative || pinned.length > 0) && !query && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {showNative && (
                <button
                  className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-panel2 py-1 pl-1.5 pr-3 text-[12px] font-bold transition-all hover:border-green/60"
                  onClick={() => onPick(zeroAddress)}
                >
                  <TokenIconFor net={net} address={zeroAddress} symbol={net.chain.nativeCurrency.symbol} size={20} />
                  {net.chain.nativeCurrency.symbol}
                </button>
              )}
              {pinned
                .filter((t) => t.address.toLowerCase() !== excludeLc)
                .map((t) => (
                  <button
                    key={t.address}
                    className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-panel2 py-1 pl-1.5 pr-3 text-[12px] font-bold transition-all hover:border-green/60"
                    onClick={() => onPick(t.address)}
                  >
                    <TokenIcon src={resolveLogoURI(t.logoURI)} symbol={t.symbol} size={20} />
                    {t.symbol}
                  </button>
                ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {showNative && query && (
            <TokenRow
              icon={<TokenIconFor net={net} address={zeroAddress} symbol={net.chain.nativeCurrency.symbol} size={30} />}
              symbol={net.chain.nativeCurrency.symbol}
              name={`${net.chain.nativeCurrency.name} — network token`}
              onPick={() => onPick(zeroAddress)}
            />
          )}
          {isLoading && (
            <div className="mono px-3 py-8 text-center text-[12px] text-dim2">loading token lists…</div>
          )}
          {filtered.map((t: ListedToken) => (
            <TokenRow
              key={t.address}
              icon={<TokenIcon src={resolveLogoURI(t.logoURI)} symbol={t.symbol} size={30} />}
              symbol={t.symbol}
              name={t.name}
              detail={short(t.address)}
              onPick={() => onPick(t.address)}
            />
          ))}
          {unknownAddr && importMeta.data && (
            <TokenRow
              icon={<TokenIconFor net={net} address={unknownAddr} symbol={importMeta.data.symbol} size={30} />}
              symbol={importMeta.data.symbol}
              name={importMeta.data.name}
              detail={short(unknownAddr)}
              badge="not on any list — verify the address"
              onPick={() => onPick(unknownAddr)}
            />
          )}
          {unknownAddr && importMeta.isLoading && (
            <div className="mono px-3 py-6 text-center text-[12px] text-dim2">reading token from {net.label}…</div>
          )}
          {unknownAddr && importMeta.isError && (
            <div className="mono px-3 py-6 text-center text-[12px] text-bad">
              no ERC20 at this address on {net.label}
            </div>
          )}
          {!isLoading && !unknownAddr && filtered.length === 0 && !(showNative && query) && (
            <div className="mono px-3 py-8 text-center text-[12px] leading-relaxed text-dim2">
              nothing on the lists for “{q}”.
              <br />
              paste a token address to import it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TokenRow({
  icon,
  symbol,
  name,
  detail,
  badge,
  onPick,
}: {
  icon: React.ReactNode;
  symbol: string;
  name: string;
  detail?: string;
  badge?: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-green/5"
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-extrabold">{symbol}</span>
          {badge && (
            <span className="mono rounded-full border border-warn/50 bg-warn/10 px-2 py-0.5 text-[9.5px] font-bold text-warn">
              {badge}
            </span>
          )}
        </span>
        <span className="block truncate text-[11.5px] text-dim">{name}</span>
      </span>
      {detail && <span className="mono flex-shrink-0 text-[10.5px] text-dim2">{detail}</span>}
    </button>
  );
}
