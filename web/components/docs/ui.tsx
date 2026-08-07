/** The docs design vocabulary. Every chapter is composed exclusively from these
 *  blocks so the whole book reads as one visual system. All server-safe. */

import Link from "next/link";
import type { ReactNode } from "react";

/* ---------------------------------------------------------------- text --- */

export function Lead({ children }: { children: ReactNode }) {
  return (
    <p className="mb-10 text-[17px] leading-relaxed text-dim sm:text-[18px]">{children}</p>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mb-4 text-[14.5px] leading-relaxed text-dim">{children}</p>;
}

export function H2({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="mb-4 mt-12 scroll-mt-28 text-[22px] font-extrabold tracking-tight text-txt first:mt-0 sm:text-[26px]"
    >
      {children}
    </h2>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-3 mt-8 text-[16px] font-extrabold tracking-tight text-txt">{children}</h3>
  );
}

/** Inline code token. */
export function C({ children, tone = "green" }: { children: ReactNode; tone?: "green" | "teal" | "pink" | "plain" }) {
  const color =
    tone === "green" ? "text-green" : tone === "teal" ? "text-teal" : tone === "pink" ? "text-magenta" : "text-txt";
  return <code className={`mono text-[0.92em] ${color}`}>{children}</code>;
}

export function B({ children }: { children: ReactNode }) {
  return <b className="font-bold text-txt">{children}</b>;
}

/* ------------------------------------------------------------- layout --- */

export function Cols({ children }: { children: ReactNode }) {
  return <div className="mb-6 grid gap-6 last:mb-0 lg:grid-cols-2">{children}</div>;
}

export function Panel({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="panel p-5">
      {label && <div className="label mb-3">{label}</div>}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ callout --- */

const CALLOUT_TONES = {
  info: { border: "var(--t-blue)", icon: "ℹ", label: "good to know" },
  warn: { border: "var(--t-warn)", icon: "⚠", label: "careful" },
  good: { border: "var(--t-green)", icon: "✓", label: "guarantee" },
  pink: { border: "var(--t-magenta)", icon: "★", label: "key idea" },
} as const;

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: keyof typeof CALLOUT_TONES;
  title?: string;
  children: ReactNode;
}) {
  const t = CALLOUT_TONES[tone];
  return (
    <div
      className="mb-6 rounded-xl border-l-4 bg-white/70 p-4 pl-5 shadow-[0_6px_18px_rgba(28,36,71,0.06)]"
      style={{ borderColor: t.border, borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderTopColor: "var(--line)", borderRightColor: "var(--line)", borderBottomColor: "var(--line)" }}
    >
      <div className="mono mb-1.5 text-[10.5px] uppercase tracking-[0.16em]" style={{ color: t.border }}>
        {t.icon} {title ?? t.label}
      </div>
      <div className="text-[13.5px] leading-relaxed text-dim [&>p]:mb-2 [&>p:last-child]:mb-0">{children}</div>
    </div>
  );
}

/* --------------------------------------------------------------- flow --- */

export function Flow({ items }: { items: { label: string; hot?: boolean; note?: string }[] }) {
  return (
    <div className="mb-8 space-y-1.5 last:mb-0">
      {items.map((it, i) => (
        <div key={i}>
          <div className={`flowbox ${it.hot ? "hot" : ""}`}>
            {it.label}
            {it.note && <span className="ml-2 text-dim2">· {it.note}</span>}
          </div>
          {i < items.length - 1 && <div className="flow-arrow py-0.5">↓</div>}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------- stat grid --- */

export function Stats({ items }: { items: { v: string; l: string; c?: string }[] }) {
  return (
    <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((s) => (
        <div key={s.l} className="panel p-4 text-center transition-transform duration-200 hover:-translate-y-1">
          <div className="mono text-[20px] font-extrabold tracking-tight" style={{ color: s.c ?? "var(--t-txt)" }}>
            {s.v}
          </div>
          <div className="mono mt-1 text-[10px] uppercase tracking-[0.1em] text-dim2">{s.l}</div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- code --- */

/** Dark code card. Children carry their own <span className="g|t|l|c"> tokens. */
export function Code({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      {title && (
        <div className="mono mb-0 inline-block rounded-t-lg border border-b-0 border-[rgba(28,36,71,0.6)] bg-[#0b1426] px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[#64719c]">
          {title}
        </div>
      )}
      <div className={`codeblock text-[11.5px] ${title ? "rounded-tl-none" : ""}`}>{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------- table --- */

export function T({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="panel mb-6 overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-[var(--line)]">
            {head.map((h) => (
              <th key={h} className="label whitespace-nowrap px-4 py-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[var(--line)] align-top leading-relaxed text-dim last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-3">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- FAQ --- */

export function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="doc-faq group mb-3">
      <summary className="flex cursor-pointer items-center justify-between gap-4 text-[14.5px] font-bold text-txt">
        {q}
        <span className="mono text-dim2 transition-transform duration-200 group-open:rotate-45">+</span>
      </summary>
      <div className="pt-3 text-[13.5px] leading-relaxed text-dim [&>p]:mb-2 [&>p:last-child]:mb-0">{children}</div>
    </details>
  );
}

/* ---------------------------------------------------------- checklist --- */

export function Steps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <div className="mb-6">
      {items.map((s, i) => (
        <div key={i} className="flex gap-4">
          <div className="flex flex-col items-center">
            <div className="mono flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border-2 border-[var(--line2)] bg-white text-[13px] font-extrabold text-green shadow-[0_3px_0_rgba(28,36,71,0.25)]">
              {i + 1}
            </div>
            {i < items.length - 1 && <div className="w-px flex-1 bg-[var(--line)]" />}
          </div>
          <div className="min-w-0 flex-1 pb-7">
            <div className="mb-1.5 pt-1.5 text-[15px] font-bold text-txt">{s.title}</div>
            <div className="text-[13.5px] leading-relaxed text-dim">{s.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- link cards --- */

export function LinkCards({
  items,
}: {
  items: { href: string; title: string; body: string; external?: boolean }[];
}) {
  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2">
      {items.map((c) =>
        c.external ? (
          <a key={c.href} href={c.href} target="_blank" rel="noreferrer" className="panel group p-5 transition-transform duration-200 hover:-translate-y-1">
            <div className="mb-1 text-[14.5px] font-bold text-txt group-hover:text-magenta">{c.title} ↗</div>
            <div className="text-[12.5px] leading-relaxed text-dim">{c.body}</div>
          </a>
        ) : (
          <Link key={c.href} href={c.href} className="panel group p-5 transition-transform duration-200 hover:-translate-y-1">
            <div className="mb-1 text-[14.5px] font-bold text-txt group-hover:text-magenta">{c.title} →</div>
            <div className="text-[12.5px] leading-relaxed text-dim">{c.body}</div>
          </Link>
        ),
      )}
    </div>
  );
}
