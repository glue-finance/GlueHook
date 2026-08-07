"use client";

import { useState } from "react";

const HOOK = "0xb216070c3509047ea597E2E626A29cea427a60C8";

/** Hero chip for the canonical hook address: live dot, shine sweep, click-to-copy. */
export function HookChip() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="hookchip mono group mt-10 inline-flex items-center gap-2.5 text-[12px]"
      onClick={() => {
        navigator.clipboard.writeText(HOOK).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      title="copy the hook address"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
      </span>
      <span className="uppercase tracking-[0.18em] text-dim2">hook</span>
      <span className="font-bold text-magenta">
        <span className="sm:hidden">{HOOK.slice(0, 10)}…{HOOK.slice(-6)}</span>
        <span className="hidden sm:inline">{HOOK}</span>
      </span>
      <span className="text-dim2 transition-colors group-hover:text-txt">
        {copied ? "✓ copied" : "⧉"}
      </span>
    </button>
  );
}
