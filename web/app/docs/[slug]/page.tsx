import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocArticle } from "@/components/docs/DocArticle";
import { DOC_CONTENT } from "@/components/docs/registry";
import { DOC_PAGES } from "@/lib/docsNav";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_PAGES.filter((p) => p.slug !== "").map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = DOC_PAGES.find((p) => p.slug === slug);
  if (!page) return {};
  return { title: `${page.title} — GlueHook Docs`, description: page.blurb };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const Body = DOC_CONTENT[slug];
  if (!Body) notFound();
  return (
    <DocArticle slug={slug}>
      <Body />
    </DocArticle>
  );
}
