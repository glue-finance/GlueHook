"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { DUNE_DASHBOARD_URL, DuneIcon } from "@/components/DuneIcon";

const links = [
  { href: "/", label: "Home" },
  { href: "/app", label: "App" },
  { href: "/docs", label: "Docs" },
];

export function Nav({ right }: { right?: React.ReactNode }) {
  const path = usePathname();
  return (
    <nav className="glassnav fixed top-0 left-0 right-0 z-50">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5">
        <Link href="/" className="flex items-center">
          <Image
            src="/gluehook-logo.png"
            alt="Glue Hook"
            width={92}
            height={56}
            priority
            className="h-14 w-auto"
          />
        </Link>
        <div className="hidden items-center gap-1 sm:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`mono rounded-lg px-4 py-2 text-[12px] uppercase tracking-[0.14em] transition-colors ${
                path === l.href ? "text-magenta" : "text-dim hover:text-magenta"
              }`}
            >
              {l.label}
            </Link>
          ))}
          <a
            href={DUNE_DASHBOARD_URL}
            target="_blank"
            rel="noreferrer"
            className="mono flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] uppercase tracking-[0.14em] text-dim transition-colors hover:text-txt"
          >
            <DuneIcon className="h-3.5 w-3.5 shrink-0" />
            Data ↗
          </a>
          <a
            href="https://github.com/glue-finance/GlueHook"
            target="_blank"
            rel="noreferrer"
            className="mono rounded-lg px-4 py-2 text-[12px] uppercase tracking-[0.14em] text-dim transition-colors hover:text-txt"
          >
            GitHub ↗
          </a>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {/* .btn's own display beats the hidden utility (unlayered CSS wins),
              so the mobile-only gate lives on a wrapper */}
          <span className="sm:hidden">
            <Link href="/docs" className="btn btn-ghost btn-sm">
              Docs
            </Link>
          </span>
          {right}
        </div>
      </div>
    </nav>
  );
}