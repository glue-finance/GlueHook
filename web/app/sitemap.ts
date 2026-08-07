import type { MetadataRoute } from "next";
import { DOC_TREE } from "@/lib/docsNav";

const BASE = "https://gluehook.trade";

export default function sitemap(): MetadataRoute.Sitemap {
  const docs = DOC_TREE.flatMap((g) => g.pages).map((p) => ({
    url: p.slug ? `${BASE}/docs/${p.slug}` : `${BASE}/docs`,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));
  return [
    { url: BASE, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/app`, changeFrequency: "weekly", priority: 0.9 },
    ...docs,
  ];
}
