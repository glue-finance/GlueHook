"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOC_TREE, docHref } from "@/lib/docsNav";

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="space-y-6">
      {DOC_TREE.map((g) => (
        <div key={g.label}>
          <div className="label mb-2">{g.label}</div>
          <ul className="space-y-0.5">
            {g.pages.map((p) => {
              const href = docHref(p.slug);
              const active = path === href;
              return (
                <li key={p.slug}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    className={`block rounded-lg border-l-[3px] py-1.5 pl-3 pr-2 text-[13px] transition-colors ${
                      active
                        ? "border-magenta bg-[color-mix(in_srgb,var(--t-magenta)_6%,transparent)] font-bold text-magenta"
                        : "border-transparent text-dim hover:border-[var(--line2)] hover:text-txt"
                    }`}
                  >
                    {p.short ?? p.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function DocsSidebar() {
  const path = usePathname();
  const current = DOC_TREE.flatMap((g) => g.pages).find((p) => docHref(p.slug) === path);
  return (
    <>
      {/* desktop: sticky rail */}
      <aside className="sticky top-28 hidden max-h-[calc(100vh-9rem)] overflow-y-auto pb-8 pr-4 lg:block">
        <NavList />
      </aside>

      {/* mobile: collapsible chapter picker */}
      <details className="panel mb-6 p-4 lg:hidden">
        <summary className="mono flex cursor-pointer items-center justify-between text-[12px] uppercase tracking-[0.14em] text-dim">
          <span>
            chapters{current ? <span className="ml-2 text-magenta">· {current.short ?? current.title}</span> : null}
          </span>
          <span>☰</span>
        </summary>
        <div className="pt-4">
          <NavList />
        </div>
      </details>
    </>
  );
}
