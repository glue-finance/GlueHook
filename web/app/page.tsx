import Link from "next/link";
import { DUNE_DASHBOARD_URL, DuneIcon } from "@/components/DuneIcon";
import { Footer } from "@/components/Footer";
import { Hookmark } from "@/components/Hookmark";
import { Nav } from "@/components/Nav";
import { Reveal } from "@/components/Reveal";
import { AddressesTable } from "@/components/landing/AddressesTable";
import { HookChip } from "@/components/landing/HookChip";
import {
  CompoundVisual,
  HarvestVisual,
  IntegrateVisual,
  PotVisual,
  PumpVisual,
  RolesVisual,
  ShieldVisual,
} from "@/components/landing/visuals";

type Feature = {
  kicker: string;
  title: React.ReactNode;
  body: React.ReactNode;
  bullets: string[];
  visual: React.ReactNode;
};

const FEATURES: Feature[] = [
  {
    kicker: "01 · it starts with a pot",
    title: (
      <>
        Fees and deposits fill a <span className="grad-text">pot</span> inside
        your pool.
      </>
    ),
    body: (
      <>
        Every hooked pool gets its own pot of collateral. It fills up from three
        taps: a slice of the pool&apos;s own trading fees, deposits from your
        project or treasury, and donations from anyone — a community member, a
        partner protocol, another contract. That pot is the fuel for everything
        below.
      </>
    ),
    bullets: [
      "fed by trading fees, project deposits, and open donations",
      "one pot per pool, held by the hook itself — no multisig, no custodian",
      "you decide how it's used; the machine does the using",
    ],
    visual: <PotVisual />,
  },
  {
    kicker: "02 · side one — attack",
    title: (
      <>
        The pot <span className="grad-text">buys back</span> your token.
        Automatically.
      </>
    ),
    body: (
      <>
        When someone buys your token, the pot buys a little more of it — inside
        that same trade, at the real market price. No oracle telling it what the
        price is, no bot waking up on a schedule, no one on the team pressing a
        button. And the bought tokens go wherever you choose — <b className="text-txt">burn
        them</b>, recompound them into the pool as more liquidity, send them to
        staking rewards or your treasury — or split them across all three at once.
      </>
    ),
    bullets: [
      "buybacks ride real buys — demand amplifies demand",
      "split the output: a slice burned, a slice back into liquidity, the rest to your recipient",
      "sized so it can't be gamed: a tiny buy only ever unlocks a tiny buyback",
    ],
    visual: <PumpVisual />,
  },
  {
    kicker: "03 · side two — defense",
    title: (
      <>
        The same pot <span className="grad-text">absorbs the sells</span>.
      </>
    ),
    body: (
      <>
        When someone sells, the pot can step in and buy that sell itself — at
        exactly the price the pool would have paid, so the seller loses nothing.
        The difference: the pool&apos;s price <b className="text-txt">doesn&apos;t
        move</b>. Red candles get eaten. And since the pot bought the tokens, they
        go to the same place as the buybacks — including the burn.
      </>
    ),
    bullets: [
      "sells are absorbed at the pool's exact price — zero seller friction",
      "the chart doesn't drop for what the pot absorbs",
      "one pot, two directions: it pumps the buys and cushions the sells",
    ],
    visual: <ShieldVisual />,
  },
  {
    kicker: "04 · growth",
    title: (
      <>
        Liquidity that <span className="grad-text">feeds itself</span>.
      </>
    ),
    body: (
      <>
        Your pool&apos;s trading fees don&apos;t have to sit there waiting to be
        collected. Choose a percentage and the hook re-invests it straight back
        into the pool as more liquidity — every harvest makes the pool deeper,
        deeper pools mean better prices, better prices mean more volume. A
        flywheel made of fees.
      </>
    ),
    bullets: [
      "pick a % of fees to autocompound — the rest goes where you route it",
      "works on any price range and pairs with the buyback: fees can fuel the pot too",
      "whatever can't be placed this round rolls into the next one — nothing is lost",
    ],
    visual: <CompoundVisual />,
  },
  {
    kicker: "05 · automagic",
    title: (
      <>
        Everything happens <span className="grad-text">between trades</span>.
      </>
    ),
    body: (
      <>
        This is the part that makes it magic: there is no crank to turn. The
        buybacks, the burns, the defense, the compounding, the fee collection —
        all of it runs <b className="text-txt">inside the swaps themselves</b>, as
        people trade. You set the rules once; the market executes them forever.
      </>
    ),
    bullets: [
      "no keeper bots, no cron jobs, no oracles, no team actions",
      "set minimum thresholds so it only fires when it's worth the gas",
      "trades stay cheap: heavy work is deferred instead of taxing swappers",
    ],
    visual: <HarvestVisual />,
  },
  {
    kicker: "06 · your rules",
    title: (
      <>
        <span className="grad-text">Personalize it.</span> Or make it
        untouchable.
      </>
    ),
    body: (
      <>
        Every knob is yours: the buyback share, the burn share, the compound
        share, who receives the rest, when things trigger. Ownership and
        settings are two separate keys, and either can be thrown away — surrender
        the settings to freeze the rules, or surrender the ownership to{" "}
        <b className="text-txt">lock the LP forever</b>: an instant, trustless
        liquidity lock with the machine still running on top.
      </>
    ),
    bullets: [
      "fee splits, recipients and thresholds — all configurable, all optional",
      "owner and operator are separate roles, each independently renounceable",
      "renounce the owner → liquidity locked forever, provably",
    ],
    visual: <RolesVisual />,
  },
  {
    kicker: "07 · for every project",
    title: (
      <>
        Built once, so <span className="grad-text">nobody</span> has to build it
        again.
      </>
    ),
    body: (
      <>
        Building a V4 hook is hard. Getting Uniswap&apos;s interface and the
        aggregators to route through it is harder. Most projects don&apos;t have
        the budget to act like an AMM just to give their token buybacks or
        self-growing liquidity. <Hookmark /> is <b className="text-txt">fully general
        purpose</b>: any token pair, any chain, zero fee, open source — already
        deployed and verified everywhere, ready to be pointed at.
      </>
    ),
    bullets: [
      "one donate() call gives any contract oracle-free buybacks",
      "works for any pair — your token vs ETH, stables, or another token",
      "no fee, no owner, no upgrade keys — the code you see is the code that runs",
    ],
    visual: <IntegrateVisual />,
  },
];

export default function Landing() {
  return (
    <div className="relative min-h-screen">
      <div className="blob-layer" />
      <div className="relative z-10">
        <Nav
          right={
            <Link href="/app" className="btn btn-primary btn-sm">
              Launch App
            </Link>
          }
        />

        {/* hero */}
        <header className="relative mx-auto max-w-7xl px-5 pb-14 pt-32 text-center sm:pb-24 sm:pt-44">
          <Reveal>
            <h1 className="mx-auto max-w-4xl text-5xl font-extrabold leading-[1.04] tracking-tight sm:text-7xl">
              <span className="grad-text">Buy back</span> and{" "}
              <span className="grad-text">autocompound</span>
              <br />
              your V4 LP.
            </h1>
            <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-dim">
              Everyone wants buybacks and self-growing liquidity. Almost nobody
              can automate them — it always ends in price oracles, keeper bots,
              or someone on the team pressing buttons. <Hookmark /> is a free,
              open-source Uniswap V4 hook that runs both{" "}
              <b className="text-txt">fully on-chain, inside the trades
              themselves</b>. No oracles. No keys. No trust.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link href="/app" className="btn btn-primary">
                Launch App →
              </Link>
              <Link href="/docs" className="btn btn-ghost">
                Read the Docs
              </Link>
              <a
                href={DUNE_DASHBOARD_URL}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost inline-flex items-center gap-2"
              >
                <DuneIcon className="h-[1.1em] w-[1.1em] shrink-0" />
                Data ↗
              </a>
              <a
                href="https://github.com/glue-finance/GlueHook"
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost"
              >
                GitHub ↗
              </a>
            </div>
            <HookChip />
          </Reveal>

          {/* the 60-second story — one combined panel */}
          <Reveal delay={150}>
            <div className="panel mt-12 grid gap-0 overflow-hidden text-left sm:mt-20 sm:grid-cols-3">
              {[
                {
                  c: "#fe0087",
                  t: "a pot fills up",
                  d: "trading fees and deposits build a pot of collateral inside your pool.",
                  g: <StoryPot />,
                },
                {
                  c: "#2b46e8",
                  t: "it works both sides",
                  d: "it buys back (and burns) on the way up, and absorbs sells without moving the price on the way down.",
                  g: <StoryBothSides />,
                },
                {
                  c: "#17b512",
                  t: "liquidity compounds",
                  d: "meanwhile a share of the fees re-invests itself as deeper liquidity — automagically, between trades.",
                  g: <StoryCompound />,
                },
              ].map((s, i) => (
                <div
                  key={s.t}
                  className={`relative p-7 ${i > 0 ? "border-t border-[var(--line)] sm:border-l sm:border-t-0" : ""}`}
                >
                  <div
                    className="absolute left-0 right-0 top-0 h-[3px]"
                    style={{ background: s.c }}
                  />
                  <div className="mb-4 h-[104px]">{s.g}</div>
                  <div className="mb-1.5 flex items-center gap-2.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: s.c, boxShadow: `0 3px 10px ${s.c}66` }}
                    />
                    <span className="text-[16px] font-extrabold text-txt">{s.t}</span>
                  </div>
                  <p className="text-[13.5px] leading-relaxed text-dim">{s.d}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </header>

        {/* feature sections */}
        <main className="mx-auto max-w-7xl space-y-20 px-5 pb-16 pt-8 sm:space-y-44">
          {FEATURES.map((f, i) => (
            <Reveal key={f.kicker}>
              <section
                className={`grid items-center gap-8 sm:gap-12 lg:grid-cols-2 lg:gap-16 ${
                  i % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""
                }`}
              >
                <div>
                  <div className="kicker mb-4">{f.kicker}</div>
                  <h2 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-[42px] sm:leading-[1.12]">
                    {f.title}
                  </h2>
                  <p className="mt-5 text-[16px] leading-relaxed text-dim">{f.body}</p>
                  <ul className="mt-6 space-y-3">
                    {f.bullets.map((b, j) => (
                      <li key={b} className="flex gap-3 text-[14.5px] text-dim">
                        <span
                          className="mt-[7px] h-2 w-2 flex-shrink-0 rounded-full"
                          style={{
                            background: ["#fe0087", "#2b46e8", "#17b512"][j % 3],
                          }}
                        />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>{f.visual}</div>
              </section>
            </Reveal>
          ))}

          {/* addresses */}
          <Reveal>
            <section id="deployments">
              <div className="mb-10 text-center">
                <div className="kicker mb-3">08 · everywhere</div>
                <h2 className="text-3xl font-extrabold tracking-tight sm:text-[42px]">
                  One hook. <span className="grad-text">Twenty-three chains.</span>
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-[15.5px] text-dim">
                  Deployed at the same address on every network, verified on
                  every explorer. Integrate once, ship everywhere.
                </p>
              </div>
              <AddressesTable />
            </section>
          </Reveal>

          {/* final CTA — two paths */}
          <Reveal>
            <section className="text-center">
              <p className="mx-auto mb-14 max-w-3xl text-[17px] leading-relaxed text-dim">
                <Hookmark /> has <b className="text-txt">no owner</b>, is{" "}
                <b className="text-txt">not upgradable</b> and takes{" "}
                <b className="text-txt">no protocol fee</b>. It&apos;s public
                infrastructure, designed to be used by anyone who wants to bring
                buybacks or self-compounding liquidity to their project.
              </p>
              <div className="grid gap-6 text-left lg:grid-cols-2">
                {/* use it */}
                <div className="panel panel-hi group relative flex flex-col overflow-hidden p-10 transition-transform duration-300 hover:-translate-y-1.5">
                  <div
                    className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full opacity-60 blur-2xl transition-opacity group-hover:opacity-90"
                    style={{ background: "radial-gradient(circle, rgba(254,0,135,.22), transparent 70%)" }}
                  />
                  <CtaWave color="#fe0087" />
                  <div className="kicker mb-4">use the hook</div>
                  <h2 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
                    Empower your <span className="grad-text">liquidity</span>.
                  </h2>
                  <p className="mt-4 flex-1 text-[15.5px] leading-relaxed text-dim">
                    Add liquidity through the hook and switch the machine on:
                    buybacks, burns, sell defense and self-compounding fees —
                    your pool, your rules, running by itself from the first
                    trade.
                  </p>
                  <div className="mt-8">
                    <Link href="/app" className="btn btn-primary">
                      Add Liquidity →
                    </Link>
                  </div>
                </div>
                {/* build on it */}
                <div className="panel panel-hi group relative flex flex-col overflow-hidden p-10 transition-transform duration-300 hover:-translate-y-1.5">
                  <div
                    className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full opacity-60 blur-2xl transition-opacity group-hover:opacity-90"
                    style={{ background: "radial-gradient(circle, rgba(43,70,232,.20), transparent 70%)" }}
                  />
                  <CtaWave color="#2b46e8" />
                  <div className="kicker mb-4">build on it</div>
                  <h2 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
                    Build on top of the <span className="grad-text">hook</span>.
                  </h2>
                  <p className="mt-4 flex-1 text-[15.5px] leading-relaxed text-dim">
                    Launchpads, token factories, treasury managers, trading apps:
                    create hooked pools straight from your own contracts and ship
                    products where every token launches with buybacks, sell
                    defense and self-growing liquidity built in — same address on
                    all 23 chains, nothing to deploy, nothing to pay.
                  </p>
                  <div className="mt-8">
                    <Link href="/docs" className="btn btn-ghost">
                      Read the Docs →
                    </Link>
                  </div>
                </div>
              </div>
            </section>
          </Reveal>
        </main>

        <Footer />
      </div>
    </div>
  );
}

/* ------------------------------------------------------- story graphics */
/* small self-animating SVGs for the combined 60-second-story panel */

function StoryPot() {
  return (
    <svg viewBox="0 0 220 104" className="h-full w-full" aria-hidden>
      {/* three taps */}
      {[38, 110, 182].map((x, i) => (
        <g key={x}>
          <rect x={x - 22} y={6} width={44} height={16} rx={8} fill="none" stroke="var(--line2)" strokeWidth="1.5" />
          <circle cx={x} cy={34} r={3} fill={["#fe0087", "#2b46e8", "#17b512"][i]}>
            <animate attributeName="cy" values="30;46;30" dur="1.6s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;0;1" dur="1.6s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
          </circle>
        </g>
      ))}
      {/* the pot */}
      <path d="M70 56 h80 v22 a18 18 0 0 1 -18 18 h-44 a18 18 0 0 1 -18 -18 z" fill="none" stroke="var(--line2)" strokeWidth="2" />
      <clipPath id="potClip">
        <path d="M72 58 h76 v20 a16 16 0 0 1 -16 16 h-44 a16 16 0 0 1 -16 -16 z" />
      </clipPath>
      <g clipPath="url(#potClip)">
        <rect x={72} y={70} width={76} height={26} fill="#fe0087" opacity={0.85}>
          <animate attributeName="y" values="76;64;76" dur="4s" repeatCount="indefinite" />
        </rect>
      </g>
    </svg>
  );
}

function StoryBothSides() {
  return (
    <svg viewBox="0 0 220 104" className="h-full w-full" aria-hidden>
      {/* up side: green candles + pink pump arrow */}
      <rect x={30} y={58} width={10} height={26} rx={2} fill="#17b512" opacity={0.85} />
      <rect x={46} y={44} width={10} height={40} rx={2} fill="#17b512" opacity={0.85} />
      <rect x={62} y={28} width={10} height={56} rx={2} fill="#17b512" opacity={0.85} />
      <path d="M34 20 l30 0 m0 0 l-8 -7 m8 7 l-8 7" stroke="#fe0087" strokeWidth="3" strokeLinecap="round" fill="none" transform="rotate(-24 49 20)">
        <animateTransform attributeName="transform" type="translate" values="0 2; 0 -2; 0 2" additive="sum" dur="1.8s" repeatCount="indefinite" />
      </path>
      {/* divider */}
      <line x1={110} y1={14} x2={110} y2={90} stroke="var(--line)" strokeWidth="1.5" strokeDasharray="3 5" />
      {/* down side: red sell absorbed by blue shield */}
      <rect x={132} y={30} width={10} height={26} rx={2} fill="#e23a3a" opacity={0.8}>
        <animate attributeName="opacity" values=".8;.25;.8" dur="2.2s" repeatCount="indefinite" />
      </rect>
      <path d="M172 30 l16 6 v14 c0 12 -7 20 -16 24 c-9 -4 -16 -12 -16 -24 v-14 z" fill="rgba(43,70,232,.14)" stroke="#2b46e8" strokeWidth="2.5">
        <animate attributeName="stroke-width" values="2.5;3.5;2.5" dur="2.2s" repeatCount="indefinite" />
      </path>
      <path d="M165 52 l5 5 l10 -11" stroke="#2b46e8" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StoryCompound() {
  return (
    <svg viewBox="0 0 220 104" className="h-full w-full" aria-hidden>
      {/* deepening liquidity bars */}
      {[0, 1, 2, 3, 4].map((i) => (
        <rect
          key={i}
          x={34 + i * 26}
          y={84 - (26 + i * 12)}
          width={16}
          height={26 + i * 12}
          rx={3}
          fill="#17b512"
          opacity={0.35 + i * 0.16}
        />
      ))}
      {/* the fee loop arrow feeding back in */}
      <path
        d="M158 26 c26 0 26 30 4 34"
        fill="none"
        stroke="#fe0087"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="5 6"
      >
        <animate attributeName="stroke-dashoffset" values="22;0" dur="1.4s" repeatCount="indefinite" />
      </path>
      <path d="M166 58 l-9 4 l2 -10" fill="#fe0087" />
      <text x={168} y={20} className="mono" fontSize="10" fontWeight="700" fill="#fe0087">fees</text>
    </svg>
  );
}

/** subtle wave line along the bottom of a CTA card */
function CtaWave({ color }: { color: string }) {
  return (
    <svg
      viewBox="0 0 400 24"
      preserveAspectRatio="none"
      className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 w-full opacity-30"
      aria-hidden
    >
      <path
        d="M0 18 q 25 -12 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 v10 h-400 z"
        fill={color}
      />
    </svg>
  );
}
