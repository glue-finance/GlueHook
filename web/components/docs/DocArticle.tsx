import type { ReactNode } from "react";
import { Reveal } from "@/components/Reveal";
import { DOC_PAGES, docIndexOf } from "@/lib/docsNav";
import { DOC_FAQS } from "./faqs";
import { NextPrev } from "./NextPrev";
import { Faq, H2 } from "./ui";

/** The frame every chapter renders inside: kicker, title, blurb, body, FAQ, next/prev. */
export function DocArticle({ slug, children }: { slug: string; children: ReactNode }) {
  const i = docIndexOf(slug);
  const page = DOC_PAGES[i];
  const nn = String(i + 1).padStart(2, "0");
  const faqs = DOC_FAQS[slug];
  return (
    <article className="min-w-0 max-w-3xl">
      <Reveal>
        <div className="mb-10">
          <div className="kicker mb-3">
            {nn} · {page.group}
          </div>
          <h1 className="text-3xl font-extrabold leading-[1.08] tracking-tight text-txt sm:text-5xl">
            {page.title}
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-dim2">{page.blurb}</p>
        </div>
      </Reveal>
      <Reveal delay={80}>
        <div>{children}</div>
      </Reveal>
      {faqs && faqs.length > 0 && (
        <Reveal>
          <div className="mt-14">
            <H2 id="faq">FAQ</H2>
            {faqs.map((f) => (
              <Faq key={f.q} q={f.q}>
                <p>{f.a}</p>
              </Faq>
            ))}
          </div>
        </Reveal>
      )}
      <NextPrev slug={slug} />
    </article>
  );
}
