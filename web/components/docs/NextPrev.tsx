import Link from "next/link";
import { DOC_PAGES, docHref, docIndexOf } from "@/lib/docsNav";

/** Reading-order footer: previous and next chapter cards. */
export function NextPrev({ slug }: { slug: string }) {
  const i = docIndexOf(slug);
  const prev = i > 0 ? DOC_PAGES[i - 1] : null;
  const next = i >= 0 && i < DOC_PAGES.length - 1 ? DOC_PAGES[i + 1] : null;
  return (
    <div className="mt-16 grid gap-4 border-t border-[var(--line)] pt-8 sm:grid-cols-2">
      {prev ? (
        <Link href={docHref(prev.slug)} className="panel group p-5 transition-transform duration-200 hover:-translate-y-1">
          <div className="mono mb-1 text-[10.5px] uppercase tracking-[0.16em] text-dim2">← previous</div>
          <div className="text-[15px] font-extrabold text-txt group-hover:text-magenta">{prev.title}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-dim">{prev.blurb}</div>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link
          href={docHref(next.slug)}
          className="panel panel-hi group p-5 text-right transition-transform duration-200 hover:-translate-y-1"
        >
          <div className="mono mb-1 text-[10.5px] uppercase tracking-[0.16em] text-dim2">next →</div>
          <div className="text-[15px] font-extrabold text-txt group-hover:text-magenta">{next.title}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-dim">{next.blurb}</div>
        </Link>
      ) : (
        <div />
      )}
    </div>
  );
}
