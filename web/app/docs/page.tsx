import type { Metadata } from "next";
import { DocArticle } from "@/components/docs/DocArticle";
import { DOC_CONTENT } from "@/components/docs/registry";

export const metadata: Metadata = {
  title: "What is GlueHook — Docs",
  description:
    "GlueHook is a free, open-source Uniswap V4 hook: automatic buybacks, sell defense and self-compounding liquidity, running fully on-chain inside the trades themselves.",
};

export default function DocsIndex() {
  const Body = DOC_CONTENT[""];
  return (
    <DocArticle slug="">
      <Body />
    </DocArticle>
  );
}
