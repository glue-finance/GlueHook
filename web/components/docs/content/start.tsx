/** Getting started — chapters 01–04. */

import { Hookmark } from "@/components/Hookmark";
import { AddressesTable } from "@/components/landing/AddressesTable";
import { NETS } from "@/lib/chains";
import {
  B, C, Callout, Code, Cols, Faq, Flow, H2, H3, Lead, LinkCards, P, Panel, Stats, Steps, T,
} from "../ui";

/* ------------------------------------------------------ 01 · what is --- */

export function WhatIs() {
  return (
    <>
      <Lead>
        <Hookmark /> is a free, open-source Uniswap V4 hook that gives any pool an{" "}
        <B>automatic buyback machine</B> and <B>self-compounding liquidity</B> — running fully
        on-chain, inside the trades themselves. No price oracles. No keeper bots. No admin keys.
        One contract, at the same address on 23 networks.
      </Lead>

      <Stats
        items={[
          { v: "0%", l: "protocol fee", c: "var(--t-green)" },
          { v: String(NETS.length), l: "networks, 1 address", c: "var(--t-blue)" },
          { v: "0", l: "oracles & keepers", c: "var(--t-magenta)" },
          { v: "0", l: "keys over the hook", c: "var(--t-teal)" },
        ]}
      />

      <H2>Four things, one contract</H2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            t: "Buy back",
            c: "var(--t-magenta)",
            d: "A permissionless pot pumps every buy and shields every sell — priced by the pool's own arithmetic, un-sandwichable by construction.",
            href: "/docs/the-pot",
          },
          {
            t: "Autocompounding",
            c: "var(--t-green)",
            d: "A share of every fee re-mints itself as deeper liquidity inside the swaps that earned it — the compounding V3 and V4 never had.",
            href: "/docs/compound",
          },
          {
            t: "Auto-harvesting",
            c: "var(--t-blue)",
            d: "Fees are collected, split from the gross and paid out automatically once they pass your minimums. No keeper, no button.",
            href: "/docs/harvest",
          },
          {
            t: "Customization",
            c: "var(--t-teal)",
            d: "Every share, recipient, minimum and role is yours to set, hand over — or surrender forever for a trustless endgame.",
            href: "/docs/roles",
          },
        ].map((f) => (
          <a key={f.t} href={f.href} className="panel group p-5 transition-transform duration-200 hover:-translate-y-1">
            <div className="mono mb-2 text-[11px] font-extrabold uppercase tracking-[0.14em]" style={{ color: f.c }}>
              {f.t}
            </div>
            <div className="text-[12.5px] leading-relaxed text-dim">{f.d}</div>
          </a>
        ))}
      </div>

      <H2>One pool, one pot, two mechanics</H2>
      <P>
        Every pool that adopts the hook gets a <B>pot</B>: a permissionless war chest denominated in
        the pool&apos;s buyback currency. Anyone can fuel it — the token team, a protocol treasury,
        a community member, another contract. The pot spends itself through two mechanics, both
        triggered by ordinary traders doing what they came to do:
      </P>
      <Cols>
        <Panel label="pump — on buys">
          <Flow
            items={[
              { label: "someone buys the token" },
              { label: "the pot buys MORE in the same tx", hot: true },
              { label: "bought tokens → recipient or burn", hot: true },
            ]}
          />
          <p className="mono mt-3 text-[11px] leading-relaxed text-dim2">
            buyers amplify the up-move — sized so it can never be sandwiched.
          </p>
        </Panel>
        <Panel label="shield — on sells">
          <Flow
            items={[
              { label: "someone sells the token" },
              { label: "the pot absorbs it at the pool's exact price", hot: true },
              { label: "the pool's price does not move", hot: true },
            ]}
          />
          <p className="mono mt-3 text-[11px] leading-relaxed text-dim2">
            sellers get exactly what the pool would have paid — supply never hits the curve.
          </p>
        </Panel>
      </Cols>

      <H2>Plus the thing V3 and V4 never had: compounding</H2>
      <P>
        Concentrated-liquidity pools park trading fees <B>outside</B> the position — they sit idle
        until someone pays gas to collect and re-mint them. Each hooked pool can run one{" "}
        <B>LP program</B>: a hook-held position whose fees are harvested automatically inside swaps
        and split by rules you choose — a share <B>re-mints itself as deeper liquidity</B>, a share
        fuels the pot, a share burns, and the rest pays whoever you name.
      </P>

      <Callout tone="pink" title="the core idea">
        <p>
          Every activation is a real market participant paying their own gas to move in the
          direction the pot amplifies. The machine needs no privileged actor — <B>only traffic</B>.
        </p>
      </Callout>

      <H2>Swaps are never stopped — no matter your settings</H2>
      <P>
        Every mechanic in the hook is a <B>passenger</B> on somebody&apos;s trade, and a passenger
        never gets to crash the ride. A bad configuration, a hostile recipient, a token with a
        broken burn function — none of it can revert, delay or brick a swap:
      </P>
      <T
        head={["surface", "what happens instead of a revert"]}
        rows={[
          [<B key="p">the pump</B>, <span key="v1">runs in a <C>try/catch</C> self-call — a state that would revert the buyback <B>skips the pump</B>, the buyer&apos;s swap lands untouched</span>],
          [<B key="s">the shield</B>, "quotes zeros when the pot is empty, unconfigured, or a leg rounds to nothing — the sell simply executes through the pool as normal"],
          [<B key="h">auto-harvest</B>, "runs under a hard gas budget; a heavy run reverts atomically inside its own frame, fees stay pending, the swap completes"],
          [<B key="d">deliveries & payouts</B>, <span key="v4">a refused transfer <B>parks</B> or is <B>booked as owed</B> — retryable and claimable later, never blocking the carrying trade</span>],
        ]}
      />
      <Callout tone="good" title="the worst a bad setting can do">
        <p>
          Waste its own opportunity. Misconfigure every share and recipient you have and the pool
          still trades exactly like a vanilla Uniswap pool — the machine degrades to a no-op, never
          to a roadblock. The complete failure-mode inventory is a chapter of its own:{" "}
          <a className="text-magenta underline" href="/docs/lp-never-stops">Trading never stops</a>.
        </p>
      </Callout>

      <H2>The life of a hooked pool</H2>
      <Flow
        items={[
          { label: "launchPool — pool + pot + seeded LP program, ONE transaction", hot: true },
          { label: "donate — anyone fuels the pot, any time" },
          { label: "trade — every buy pumps, every sell is shielded", hot: true },
          { label: "harvest — fees split & compound automatically inside swaps" },
          { label: "surrender (optional) — lock the LP or freeze the rules forever", note: "trustless endgame" },
        ]}
      />

      <H2>Pick your path</H2>
      <LinkCards
        items={[
          { href: "/docs/quick-start", title: "Quick start", body: "Launch a hooked pool from the app in one transaction, or plug into an existing one." },
          { href: "/docs/the-pot", title: "Understand the machine", body: "MAIN, SECONDARY, the pot, the pump, the shield — chapter by chapter." },
          { href: "/docs/integrate", title: "Integrate buybacks", body: "Your contract donates, the market executes. Oracle-free, in a dozen lines." },
          { href: "/docs/build-apps", title: "Build on top", body: "Launchpads, lockers and vaults that compose on the hook's roles." },
        ]}
      />

      <H2>FAQ</H2>
      <Faq q="Is GlueHook a token or a protocol with fees?">
        <p>
          Neither. It is a single immutable contract with <B>zero protocol fee</B>, no token, no
          owner and no upgrade path. The only fee anywhere is the pool&apos;s own Uniswap LP fee,
          which goes to liquidity providers as always.
        </p>
      </Faq>
      <Faq q="Do I have to use every feature?">
        <p>
          No. A pool can run just the pot (buybacks only), just the LP program (compounding only),
          both, or neither side armed — every rule is opt-in and most can be changed later by the
          roles that own them.
        </p>
      </Faq>
      <Faq q="Who can trigger the machine?">
        <p>
          Nobody has to. The pump and the shield fire inside ordinary swaps; the auto-harvest fires
          inside ordinary swaps once fees pass your minimums. Manual entries (<C>harvest</C>,{" "}
          <C>flushDirect</C>, <C>claim</C>) exist as permissionless or role-gated fallbacks.
        </p>
      </Faq>
    </>
  );
}

/* ---------------------------------------------------------- 02 · why --- */

export function Why() {
  return (
    <>
      <Lead>
        Everyone wants buybacks and self-growing liquidity. Almost nobody can automate them —
        because every known design ends in a <B>price oracle</B>, a <B>keeper bot</B>, or{" "}
        <B>someone on the team pressing buttons</B>. This chapter is the argument for doing it
        inside the trades instead.
      </Lead>

      <H2>The two ways buybacks are done today</H2>
      <T
        head={["approach", "how it works", "what you trust"]}
        rows={[
          [
            <B key="m">manual</B>,
            "a multisig watches the price and clicks",
            "the team's judgment, honesty and availability — forever",
          ],
          [
            <B key="o">oracle-fed</B>,
            "a keeper bot reads a price feed and fires a transaction",
            "the oracle, the keeper, AND the gap between them (a lagging feed is an arbitrage faucet)",
          ],
          [
            <B key="g">GlueHook</B>,
            "the pot executes inside other people's swaps, priced by the pool's own arithmetic at the moment of execution",
            "the code — verified, immutable, at one address everywhere",
          ],
        ]}
      />

      <P>
        The trade-off is stated plainly: the mechanism narrows <B>who decides when</B> — nobody
        decides, the market does — which removes discretionary control, and in exchange it
        automates the buyback on the users&apos; <B>own financial incentives</B>. Buyers trigger
        pumps because buying is what they came to do; sellers trigger the shield because selling is
        what they came to do.
      </P>

      <H2>The second gap: fees that never compound</H2>
      <P>
        In Uniswap V2, fees accrued <B>inside</B> the reserves and every LP position grew
        automatically. V3 and V4 park fees <B>outside</B> the position, so in practice they are
        collected by keeper services, position managers… or never. The hook&apos;s LP program gives
        a pool <B>native auto-compounding</B>: a configurable share of every harvest is re-minted
        into the position <B>inside the swaps that generated the fees</B> — same no-keeper,
        no-oracle, traffic-powered trigger as the buyback itself.
      </P>

      <Callout tone="good" title="what immutability buys you">
        <p>
          The hook has no owner, is not upgradable and takes no protocol fee. Nothing you build on
          it can be rugged from above: no parameter anyone can flip on you, no fee switch, no proxy
          admin. The code you see is the code that runs, on every network, forever.
        </p>
      </Callout>

      <H2>Why a V4 hook and not a wrapper or a router</H2>
      <P>
        Only a hook executes <B>inside</B> the swap: the shield needs to intercept the sell before
        the pool prices it (<C>beforeSwap</C>), and the pump needs to ride the buy that unlocked it
        (<C>afterSwap</C>). A router can be bypassed; a wrapper fragments liquidity. The hook is
        part of the pool&apos;s identity — every venue, aggregator and bot that routes through the
        pool feeds the machine, whether it knows it or not.
      </P>
    </>
  );
}

/* -------------------------------------------------- 03 · quick start --- */

export function QuickStart() {
  return (
    <>
      <Lead>
        Three ways in, fastest first: launch a fresh hooked pool from the app in{" "}
        <B>one transaction</B>, adopt the hook for a token that already trades elsewhere, or just
        fuel an existing pot. You need a wallet and the network&apos;s gas token — nothing else.
      </Lead>

      <H2>Launch a new hooked pool (one transaction)</H2>
      <Steps
        items={[
          {
            title: "Open the app and pick your network",
            body: (
              <>
                Go to <a className="text-magenta underline" href="/app">gluehook.trade/app</a>, hit{" "}
                <B>+ new pool</B>, and choose the chain. The hook is at the same address everywhere,
                so nothing else changes between networks.
              </>
            ),
          },
          {
            title: "Pick the pair, the fee tier and the starting price",
            body: (
              <>
                Choose your token and its quote side (native or any ERC20). The fee must be{" "}
                <B>non-zero</B> — a fee-less pool would make round trips free and the pump refuses
                that by design. Set the initial price; for a fresh token this IS the launch price.
              </>
            ),
          },
          {
            title: "Choose the machine preset",
            body: (
              <>
                Which side is defended (<B>MAIN</B>), where bought tokens go (an address, or{" "}
                <B>burn</B>), the compound / buyback / burn shares, and the auto-harvest minimums.
                Presets cover the common shapes; everything is editable later by the operator.
              </>
            ),
          },
          {
            title: "Launch",
            body: (
              <>
                One click calls <C>launchPool</C>: the pool is initialized, the pot roles are
                declared, and the LP program is created with your seed liquidity — atomically. The
                pool trades from that block, machine armed.
              </>
            ),
          },
        ]}
      />
      <Code title="the same thing, from a contract or a script">
        <span className="c">{"// one transaction: init + roles + seeded LP program"}</span>{"\n"}
        hook.launchPool{"{"}value: 5 ether{"}"}({"\n"}
        {"  "}key,{" "}<span className="l">SQRT_PRICE_1_1</span>,{"\n"}
        {"  "}<span className="t">TOKEN</span>, <span className="t">address(0)</span>,{" "}
        <span className="c">{"// MAIN + burn intent"}</span>{"\n"}
        {"  "}<span className="l">0</span>, <span className="l">0</span>, liquidity,{" "}
        <span className="c">{"// (0,0) = full range"}</span>{"\n"}
        {"  "}msg.sender, config{"\n"}
        );
      </Code>

      <H2>Adopt the hook for an existing token</H2>
      <P>
        A token that already trades elsewhere just gets a <B>second pool</B> — a hooked one. Launch
        it at the current market price and route liquidity there over time; arbitrage keeps the two
        in line, and every trade that touches the hooked pool feeds the machine. Nothing about the
        token itself needs to change.
      </P>

      <H2>Fuel an existing pot</H2>
      <Code title="anyone, any time — donations are irreversible">
        <span className="c">{"// native secondary: attach the value"}</span>{"\n"}
        hook.donate{"{"}value: 10 ether{"}"}(key, 10 ether);{"\n\n"}
        <span className="c">{"// ERC20 secondary: approve first"}</span>{"\n"}
        SECONDARY.approve(address(hook), amt);{"\n"}
        hook.donate(key, amt);
      </Code>
      <Callout tone="warn">
        <p>
          Donations are <B>one-way</B>: there is no withdrawal path for a pot, by design. Fuel it
          with amounts you mean to spend on the market.
        </p>
      </Callout>

      <H2>Where next</H2>
      <LinkCards
        items={[
          { href: "/docs/launch", title: "Launch a pool, in depth", body: "Every launchPool parameter, the manual three-step path, and the funding rules." },
          { href: "/docs/manage", title: "Manage your program", body: "Edit the split, arm auto-harvest, move or surrender the roles." },
        ]}
      />
    </>
  );
}

/* ----------------------------------------------------- 04 · networks --- */

export function Networks() {
  return (
    <>
      <Lead>
        The hook and its linked library live at the <B>same canonical addresses on every network</B>
        , source-verified on each chain&apos;s explorer. Integrate once; the same bytes run
        everywhere.
      </Lead>

      <Code title="canonical addresses — every network, no exceptions">
        GlueHook{"       "}<span className="g">0xb216070c3509047ea597E2E626A29cea427a60C8</span>{"\n"}
        GlueLiquidity{"  "}<span className="g">0x26CD66aDec6176c11f894A9DE5bC504235c90241</span>
      </Code>

      <AddressesTable />

      <H2 id="address-is-permission">The address IS the permission</H2>
      <P>
        Uniswap V4 encodes a hook&apos;s permissions in the <B>low 14 bits of its address</B>. The
        hook&apos;s address carries exactly the four flags it needs:
      </P>
      <Code>
        beforeInitialize | beforeSwap | afterSwap | beforeSwapReturnsDelta{"  "}={"  "}
        <span className="l">0x20C8</span>{"\n\n"}
        <span className="c">{"// 0x…60C8 & 0x3FFF == 0x20C8 — check it yourself"}</span>
      </Code>
      <P>
        The deployer key was <B>mined</B> so that its second-ever transaction (nonce 1) lands on an
        address with those bits, and the constructor asserts its own address — a mis-deployment
        fails at deploy time. Plain <C>CREATE</C> (not CREATE2) is what makes the address identical
        on every chain: it commits only to <C>(deployer, nonce)</C>, never to the init code, so the
        per-chain PoolManager constructor argument doesn&apos;t change the address.
      </P>

      <Callout tone="info" title="a chain ships V4 later?">
        <p>
          The same deployer key deploys there whenever its PoolManager exists, and the addresses
          still match — the deployment is repeatable by construction.
        </p>
      </Callout>

      <H2>Verifying you&apos;re talking to the real hook</H2>
      <Steps
        items={[
          { title: "Check the address", body: <>It must be exactly <C>0xb216070c3509047ea597E2E626A29cea427a60C8</C> — on every network.</> },
          { title: "Check the flag bits", body: <>The low 14 bits must equal <C>0x20C8</C>.</> },
          { title: "Check the source", body: <>Every deployment is source-verified; diff it against the repository if you like.</> },
        ]}
      />
    </>
  );
}
