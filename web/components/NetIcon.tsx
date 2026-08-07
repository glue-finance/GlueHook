"use client";

import { useState } from "react";
import type { Net } from "@/lib/chains";

/** stable per-chain identity colour — the fallback when an icon is missing */
export function netColor(n: Net): string {
  return `hsl(${(n.chain.id * 47) % 360} 78% 46%)`;
}

/**
 * Small round network logo (public/nets/<slug>.png), colored dot on error.
 * Takes only serializable props so server components (landing/docs tables)
 * can render it without dragging a viem chain object across the boundary.
 */
export function NetIcon({
  slug,
  label,
  chainId,
  size = 16,
}: {
  slug: string;
  label: string;
  chainId: number;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    const color = `hsl(${(chainId * 47) % 360} 78% 46%)`;
    return (
      <span
        className="inline-block flex-shrink-0 rounded-full"
        style={{
          width: size,
          height: size,
          background: color,
          boxShadow: `0 0 ${size / 2}px ${color}66`,
        }}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/nets/${slug}.png`}
      alt={label}
      width={size}
      height={size}
      className="flex-shrink-0 rounded-full"
      style={{ width: size, height: size }}
      onError={() => setBroken(true)}
    />
  );
}
