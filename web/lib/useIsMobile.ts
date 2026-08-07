"use client";

import { useEffect, useState } from "react";

/** The `lg` breakpoint Tailwind uses, so JS and CSS always agree on "mobile". */
const MOBILE = "(max-width: 1023px)";

/**
 * `null` until the media query has been read on the client. Callers that only
 * pick a layout can treat null as desktop, but anything EXPENSIVE to mount
 * should wait for the real answer rather than mounting the desktop version and
 * throwing it away a tick later.
 */
export function useIsMobile(): boolean | null {
  const [mobile, setMobile] = useState<boolean | null>(null);
  useEffect(() => {
    const q = window.matchMedia(MOBILE);
    const sync = () => setMobile(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);
  return mobile;
}
