/** The documentation tree: groups → chapters. Order here IS the reading order
 *  (the sidebar, the next/prev footer and the static params all derive from it). */

export type DocPageMeta = {
  /** URL slug under /docs — "" is the index chapter. */
  slug: string;
  title: string;
  /** Short label used in the sidebar (defaults to title). */
  short?: string;
  /** One-line teaser shown in next/prev cards and page headers. */
  blurb: string;
};

export type DocGroup = { label: string; pages: DocPageMeta[] };

export const DOC_TREE: DocGroup[] = [
  {
    label: "Getting started",
    pages: [
      {
        slug: "",
        title: "What is GlueHook",
        short: "What is GlueHook",
        blurb: "One hook, a pot per pool, buybacks and sell defense powered by the traffic itself.",
      },
      {
        slug: "why",
        title: "Why this hook exists",
        short: "Why it exists",
        blurb: "Manual buybacks, oracle bots, and the two gaps this machine closes without trust.",
      },
      {
        slug: "quick-start",
        title: "Quick start",
        blurb: "Launch a hooked pool from the app in one transaction, or plug into an existing one.",
      },
      {
        slug: "networks",
        title: "Networks & addresses",
        short: "Networks",
        blurb: "One canonical address on all 23 networks — and why the address itself is the permission.",
      },
    ],
  },
  {
    label: "Buy back",
    pages: [
      {
        slug: "the-pot",
        title: "The pot",
        blurb: "MAIN, SECONDARY, the recipient, and the permissionless war chest every hooked pool carries.",
      },
      {
        slug: "donations",
        title: "Donations — fueling the pot",
        short: "Donations",
        blurb: "Anyone funds the machine: native or ERC20, measured on arrival, irreversible by design.",
      },
      {
        slug: "pump",
        title: "Pump — the buyback",
        short: "Pump",
        blurb: "How buys trigger buybacks inside their own transaction, and why it can't be sandwiched.",
      },
      {
        slug: "shield",
        title: "Shield — sell defense",
        short: "Shield",
        blurb: "Sells absorbed at the pool's exact price: the seller is indifferent, the price doesn't move.",
      },
      {
        slug: "delivery",
        title: "Burn & delivery",
        blurb: "The burn cascade, parked deliveries, the held-forever ledger, and why a swap never bricks.",
      },
      {
        slug: "buyback-management",
        title: "Buy back management",
        short: "Managing the buyback",
        blurb: "The buyback split: compound a share of every purchase into liquidity, burn a share, deliver the rest.",
      },
    ],
  },
  {
    label: "LP fees management",
    pages: [
      {
        slug: "lp-fees",
        title: "How LP fees flow",
        short: "The flow",
        blurb: "Both sides of every fee, end to end: compound + buyback + recipient, compound + burn + recipient.",
      },
      {
        slug: "lp-recipients",
        title: "The recipients",
        short: "Recipients",
        blurb: "One address per side, the exact remainder, and every pattern a recipient can implement.",
      },
      {
        slug: "lp-burn",
        title: "The burn share",
        short: "The burn",
        blurb: "Main-side fees destroyed at the source: the cascade, the native-main rule, burn vs buyback.",
      },
      {
        slug: "lp-never-stops",
        title: "Trading never stops",
        short: "Never stops",
        blurb: "Every failure mode of the fee machine, and why none of them can ever touch a swap.",
      },
    ],
  },
  {
    label: "Autocompound",
    pages: [
      {
        slug: "compound",
        title: "The compound engine",
        short: "The engine",
        blurb: "The auto-compounding V3/V4 never had, and the carry that makes sure nothing ever leaks.",
      },
      {
        slug: "compound-math",
        title: "The compounding math",
        short: "The math",
        blurb: "The two-sided mint constraint, why the carry must exist, and the geometry of growth.",
      },
      {
        slug: "compound-strategies",
        title: "Compound strategies",
        short: "Strategies",
        blurb: "Choosing the share, the 100% corner, range effects, and how to read the carry.",
      },
    ],
  },
  {
    label: "Auto-harvest",
    pages: [
      {
        slug: "harvest",
        title: "How harvesting works",
        short: "How it works",
        blurb: "The in-swap trigger, the minimums, the gas budget, and the manual full-gas path.",
      },
      {
        slug: "harvest-math",
        title: "The split math",
        short: "The math",
        blurb: "Gross-referenced WAD shares, floor rounding, where the dust lands, and exact conservation.",
      },
      {
        slug: "harvest-payouts",
        title: "Payouts & the owed ledger",
        short: "Payouts",
        blurb: "Bounded-gas pushes, refusals that book instead of revert, and pulling with claim().",
      },
    ],
  },
  {
    label: "Build & manage",
    pages: [
      {
        slug: "roles",
        title: "Roles & surrender",
        short: "Roles",
        blurb: "Pot admin, program owner, program operator — each surrenders on its own terms.",
      },
      {
        slug: "launch",
        title: "Launch a pool",
        blurb: "launchPool in one transaction — or the three standalone steps, your choice.",
      },
      {
        slug: "manage",
        title: "Manage your program",
        short: "Manage a program",
        blurb: "Edit the split, arm the auto-harvest, open the harvest, move or freeze the roles.",
      },
      {
        slug: "liquidity",
        title: "Add & remove liquidity",
        short: "Liquidity",
        blurb: "Funding rules, harvest-first settlement, native refunds, and the locked-forever case.",
      },
      {
        slug: "integrate",
        title: "Integrate buybacks",
        short: "Integrate",
        blurb: "Contract-to-contract donations and quotes: oracle-free buybacks in a dozen lines.",
      },
      {
        slug: "build-apps",
        title: "Build launchers & apps",
        short: "Build on top",
        blurb: "Launchpads, lockers, vaults and DAOs that compose on the hook's roles and one-tx launch.",
      },
    ],
  },
  {
    label: "Reference",
    pages: [
      {
        slug: "api",
        title: "API reference",
        blurb: "Every function, struct, event and error on the hook, with who may call what.",
      },
      {
        slug: "security",
        title: "Security & audit",
        short: "Security",
        blurb: "The threat model, the invariant catalogue, 123 tests, and what you actually trust.",
      },
      {
        slug: "glossary",
        title: "Glossary",
        blurb: "The words this documentation uses precisely — one line each, no ambiguity.",
      },
      {
        slug: "license",
        title: "License",
        blurb: "BUSL-1.1: free to read, audit and build on — not free to fork into a competing product.",
      },
    ],
  },
];

export const DOC_PAGES: (DocPageMeta & { group: string })[] = DOC_TREE.flatMap((g) =>
  g.pages.map((p) => ({ ...p, group: g.label })),
);

export function docHref(slug: string): string {
  return slug ? `/docs/${slug}` : "/docs";
}

export function docIndexOf(slug: string): number {
  return DOC_PAGES.findIndex((p) => p.slug === slug);
}
