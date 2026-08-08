import Image from "next/image";
import Link from "next/link";

import { DUNE_DASHBOARD_URL } from "@/components/DuneIcon";

export function Footer() {
  return (
    <footer className="mt-12 border-t border-[var(--line)] sm:mt-24">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-5 py-8 sm:flex-row sm:justify-between sm:py-12">
        <div className="flex flex-col items-center gap-2 sm:items-start">
          <Image src="/gluehook-logo.png" alt="Glue Hook" width={112} height={68} className="h-[68px] w-auto" />
          <div className="mono text-[10.5px] text-dim2">buy back &amp; autocompound your V4 LP</div>
        </div>
        <div className="flex flex-col items-center gap-4 sm:items-end">
          <div className="mono flex flex-wrap items-center justify-center gap-5 text-[12px] text-dim">
            <Link href="/app" className="hover:text-magenta">App</Link>
            <Link href="/docs" className="hover:text-magenta">Docs</Link>
            <a href={DUNE_DASHBOARD_URL} target="_blank" rel="noreferrer" className="hover:text-magenta">Dune</a>
            <a href="https://github.com/glue-finance/GlueHook" target="_blank" rel="noreferrer" className="hover:text-magenta">GitHub</a>
            <a href="https://x.com/glue_fi" target="_blank" rel="noreferrer" className="hover:text-magenta">X</a>
            <a href="https://github.com/glue-finance/GlueHook/blob/main/LICENCE.txt" target="_blank" rel="noreferrer" className="hover:text-magenta">Licence</a>
          </div>
          <a
            href="https://glue.finance"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 opacity-90 transition-opacity hover:opacity-100"
          >
            <span className="mono text-[10.5px] uppercase tracking-[0.14em] text-dim2">built by</span>
            <Image src="/glue-logo.png" alt="Glue" width={64} height={30} className="h-[30px] w-auto" />
          </a>
        </div>
      </div>
    </footer>
  );
}
