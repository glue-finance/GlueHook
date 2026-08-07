/** LP fees management — the policy layer: where every harvested fee is allowed to go. */

import {
  B, C, Callout, Code, Cols, Flow, H2, H3, Lead, LinkCards, P, Panel, T,
} from "../ui";

/* ------------------------------------------------------------- the flow --- */

export function FeesFlow() {
  return (
    <>
      <Lead>
        The pool&apos;s LP program earns swap fees in <B>both</B> currencies, and each side has its
        own three-way waterfall — chosen by you, validated at write time, executed identically on
        every harvest. This chapter is the management view: the two flows end to end, why they are
        deliberately asymmetric, and which lever controls what.
      </Lead>

      <H2>The two waterfalls, side by side</H2>
      <Cols>
        <Panel label="SECONDARY-side fees (e.g. the ETH side) — gross">
          <Flow
            items={[
              { label: "compoundShare → re-minted as deeper liquidity", hot: true },
              { label: "buybackShare → donated to the pool's own pot", hot: true },
              { label: "the exact rest → secondaryRecipient" },
            ]}
          />
          <p className="mono mt-3 text-[11px] text-dim2">compound + buyback ≤ 100%</p>
        </Panel>
        <Panel label="MAIN-side fees (the defended token) — gross">
          <Flow
            items={[
              { label: "compoundShare → re-minted as deeper liquidity", hot: true },
              { label: "burnShare → destroyed through the burn cascade", hot: true },
              { label: "the exact rest → mainRecipient" },
            ]}
          />
          <p className="mono mt-3 text-[11px] text-dim2">compound + burn ≤ 100% · burn = 0 on a native main</p>
        </Panel>
      </Cols>

      <H2>Why the two sides are different</H2>
      <P>
        The asymmetry is the machine&apos;s logic, not an arbitrary menu. The <B>secondary</B> side
        is the buyback currency — so its special destination is the <B>pot</B>: a{" "}
        <C>buybackShare</C> makes the pool fund its own buyback pressure from its own traffic,
        forever. The <B>main</B> side is the defended asset — so its special destination is{" "}
        <B>destruction</B>: a <C>burnShare</C> cuts supply at the source, before those tokens ever
        circulate. Sending main to the pot would be pointless (the pot only spends secondary), and
        burning secondary would burn the wrong asset. Each side gets exactly the lever that makes
        sense for what it is.
      </P>
      <T
        head={["destination", "side", "what it does", "deep dive"]}
        rows={[
          [<B key="a">compound</B>, "both", "re-mints as liquidity in the program's own position; what doesn't fit carries", <a key="l1" className="text-magenta underline" href="/docs/compound">Autocompound</a>],
          [<B key="b">buyback</B>, "secondary", "credits the pool's own pot — self-fueling pump & shield", <a key="l2" className="text-magenta underline" href="/docs/the-pot">The pot</a>],
          [<B key="c">burn</B>, "main", "destroys the fees through the verified burn cascade", <a key="l3" className="text-magenta underline" href="/docs/lp-burn">The burn share</a>],
          [<B key="d">recipient</B>, "both (one each)", "receives the exact remainder — treasury, rewards, vesting, anything", <a key="l4" className="text-magenta underline" href="/docs/lp-recipients">The recipients</a>],
        ]}
      />

      <H2>One config, seven WAD numbers</H2>
      <Code title="the whole fee policy of a pool">
        compoundShareWad{"      "}<span className="c">{"// both sides — the growth dial"}</span>{"\n"}
        buybackShareWad{"       "}<span className="c">{"// secondary side — the pot dial"}</span>{"\n"}
        burnShareWad{"          "}<span className="c">{"// main side — the supply dial"}</span>{"\n"}
        potCompoundShareWad{"   "}<span className="c">{"// the buyback split — pot output → liquidity"}</span>{"\n"}
        potBurnShareWad{"       "}<span className="c">{"// the buyback split — pot output → burn"}</span>{"\n"}
        mainRecipient{"         "}<span className="c">{"// where the main-side remainder goes"}</span>{"\n"}
        secondaryRecipient{"    "}<span className="c">{"// where the secondary-side remainder goes"}</span>
      </Code>
      <P>
        The last two dials govern not the fees but <B>what the pot buys with them</B> — the buyback
        split, taken apart in{" "}
        <a className="text-magenta underline" href="/docs/buyback-management">Buy back management</a>.
      </P>
      <P>
        All of it lives in one struct, written by one call (<C>setProgramConfig</C>), owned by one
        role (the <B>program operator</B>), and checked <B>when it is written</B> — over-100% sums,
        a missing recipient under a real remainder, a burn on a native main: every invalid shape is
        rejected at the door, so harvest time is pure arithmetic. Edits are forward-only: fees
        already pending split under whatever config is live when the harvest actually runs.
      </P>
      <Callout tone="pink" title="policy here, mechanics there">
        <p>
          This section is <B>where fees are allowed to go</B>. When harvests fire and the exact
          formulas live in{" "}
          <a className="text-magenta underline" href="/docs/harvest">Auto-harvest</a>; how the
          compound budget becomes liquidity lives in{" "}
          <a className="text-magenta underline" href="/docs/compound">Autocompound</a>. The three
          chapters after this one take each destination apart.
        </p>
      </Callout>

      <H2>The three chapters of this section</H2>
      <LinkCards
        items={[
          { href: "/docs/lp-recipients", title: "The recipients", body: "One address per side, the exact remainder, and every pattern a recipient can implement." },
          { href: "/docs/lp-burn", title: "The burn share", body: "Main-side fees destroyed at the source — the cascade, the native rule, burn vs buyback." },
          { href: "/docs/lp-never-stops", title: "Trading never stops", body: "Every failure mode of the fee machine, and why none can ever touch a swap." },
        ]}
      />
    </>
  );
}

/* ----------------------------------------------------------- recipients --- */

export function FeesRecipients() {
  return (
    <>
      <Lead>
        Each side of the fee split names <B>one recipient</B> for its remainder — and because the
        remainder is computed by exact subtraction, &quot;the rest&quot; means the rest to the wei.
        A recipient is just an address, which makes it the program&apos;s most composable slot:
        anything that can receive tokens can be a fee policy.
      </Lead>

      <H2>Three recipients in a pool&apos;s life — don&apos;t conflate them</H2>
      <T
        head={["slot", "set by", "receives"]}
        rows={[
          [
            <B key="a">pot recipient</B>,
            <span key="s1">the pot admin (<C>initPot</C> / <C>setRecipient</C>)</span>,
            <span key="r1">the <B>main the pot buys and absorbs</B> — pumps and shields. <C>address(0)</C> = burn</span>,
          ],
          [
            <B key="b">mainRecipient</B>,
            <span key="s2">the program operator (<C>setProgramConfig</C>)</span>,
            "the main-side fee remainder after compound + burn",
          ],
          [
            <B key="c">secondaryRecipient</B>,
            <span key="s3">the program operator (<C>setProgramConfig</C>)</span>,
            "the secondary-side fee remainder after compound + buyback",
          ],
        ]}
      />
      <P>
        The pot recipient is a <B>buyback delivery target</B>; the two program recipients are{" "}
        <B>fee payees</B>. They can be the same address or three different ones — the roles that
        control them are independent by design.
      </P>

      <H2>The remainder is exact — and the dust is yours</H2>
      <Code title="per side, every harvest">
        recipient leg{"  "}={"  "}gross{"  "}−{"  "}⌊compound⌋{"  "}−{"  "}⌊buyback or burn⌋{"\n\n"}
        <span className="c">{"// subtraction, not a third multiplication: the share legs round DOWN,"}</span>{"\n"}
        <span className="c">{"// so every wei of division dust lands with the recipient — never orphaned."}</span>
      </Code>
      <P>
        This is also why the validation insists on a <B>live recipient whenever the shares sum
        below 100%</B>: below-100% means a remainder can exist, and the design has no
        &quot;nowhere&quot; for value to go. At exactly 100% the remainder is structurally zero and
        the recipient slot may be empty. The full derivation is in{" "}
        <a className="text-magenta underline" href="/docs/harvest-math">The split math</a>.
      </P>

      <H2>How the money actually arrives</H2>
      <Flow
        items={[
          { label: "harvest books the leg — state final before any external call" },
          { label: "bounded-gas push to the recipient", hot: true },
          { label: "success → Paid · refusal → the exact amount books as owed", hot: true },
          { label: "owed folds into the next push, or the recipient pulls with claim(asset)", note: "full gas, any time" },
        ]}
      />
      <P>
        A recipient therefore needs <B>nothing special</B> to work — an EOA, a Safe, a contract
        with a plain <C>receive()</C> all just get paid. And a recipient that is heavy or hostile
        hurts only itself: its legs accumulate in the owed ledger until it claims. The plumbing is
        detailed in{" "}
        <a className="text-magenta underline" href="/docs/harvest-payouts">Payouts &amp; the owed ledger</a>.
      </P>

      <H2>What a recipient can be — the pattern library</H2>
      <T
        head={["pattern", "how"]}
        rows={[
          [<B key="a">treasury</B>, "the plain shape: a Safe or governance treasury receives the remainder as protocol revenue"],
          [<B key="b">staking rewards</B>, "point the remainder at a rewards distributor — LP fee flow becomes staking yield with zero keepers"],
          [<B key="c">splitter / vesting</B>, "any payment-splitter or vesting contract works unmodified — the hook just sends; policy lives in the recipient"],
          [<B key="d">cross-pool routing</B>, <span key="v">a tiny adapter whose <C>receive()</C>/sweep calls <C>donate</C> on ANOTHER pool&apos;s pot — one pool&apos;s fees become another pool&apos;s buyback pressure</span>],
          [<B key="e">buyback-and-make</B>, "an adapter that adds the remainder back as liquidity elsewhere, or market-buys a different asset — the recipient slot is where custom strategy composes"],
        ]}
      />
      <Callout tone="info" title="design your recipient for the pull path too">
        <p>
          A recipient contract should be able to call <C>claim(asset)</C> (or at least receive from
          a bounded-gas push). If your recipient&apos;s <C>receive()</C> does heavy work, it will
          be booked as owed every time — fine, but then <B>something</B> must eventually claim.
          The cheap pattern: accept plainly, do the work in a separate poke.
        </p>
      </Callout>

      <H2>Changing and freezing</H2>
      <P>
        Recipients move with a <C>setProgramConfig</C> call by the operator — instantly, affecting
        future harvests only. And like every program rule, they can be made <B>permanent</B>: an
        operator that surrenders (<C>setProgramOperator(poolId, address(0))</C>) freezes the
        recipients along with the shares, forever — the strongest revenue-share promise a project
        can make on-chain. See{" "}
        <a className="text-magenta underline" href="/docs/roles">Roles &amp; surrender</a>.
      </P>
    </>
  );
}

/* ----------------------------------------------------------------- burn --- */

export function FeesBurn() {
  return (
    <>
      <Lead>
        The <C>burnShare</C> destroys a slice of the main-side fees <B>at the source</B> — the
        tokens the pool just earned are removed from supply before they ever circulate again. It
        is the machine&apos;s second deflation engine, and it works completely differently from
        the first.
      </Lead>

      <H2>Why burn lives on the main side only</H2>
      <P>
        Burning is for the asset you are defending. Main-side fees arrive <B>already denominated
        in the token whose supply you want to cut</B> — destroying them needs no trade, no price,
        no counterparty. The secondary side has no equivalent lever on purpose: burning the buyback
        currency would destroy the wrong asset, so the secondary side&apos;s special destination is
        the <B>pot</B> instead, where those fees buy main at market before the pot&apos;s own
        burn-or-deliver decision applies.
      </P>
      <Callout tone="warn" title="the native-main rule">
        <p>
          A native main (the network token) has no supply to destroy, so the validation forces{" "}
          <C>burnShare = 0</C> when main is native — rejected when the config is written, never
          discovered as a silent no-op at harvest time. A native-main pool expresses deflation
          intent through the pot&apos;s buyback + a live recipient instead.
        </p>
      </Callout>

      <H2>Burn vs buyback — two engines, one goal</H2>
      <T
        head={["", "burnShare (fees)", "buyback (the pot)"]}
        rows={[
          [<B key="a">input</B>, "main-side LP fees, already in main", "pot secondary — donations + the buybackShare"],
          [<B key="b">market touch</B>, "none — no trade, no impact, no MEV surface at all", "buys through the pool at market price, fee-bounded per buy"],
          [<B key="c">effect shape</B>, "pure supply cut, volume-indexed (fees scale with trading)", "supply cut AND direct bid pressure riding every buy"],
          [<B key="d">timing</B>, "at every harvest", "at every buy, paced by the spending curve"],
        ]}
      />
      <P>
        They compose: a config with both a <C>burnShare</C> and a <C>buybackShare</C> (into a
        burn-recipient pot) attacks supply from two directions — fees burned directly, plus market
        buys whose output is burned. The <B>volume-indexed</B> nature is the elegant part: burned
        amount = <C>burnShareWad · mainFees</C>, and main fees are proportional to trading volume —
        so the token deflates <B>exactly as fast as it is used</B>, with zero discretion anywhere.
      </P>

      <H2>How the destruction actually happens</H2>
      <P>
        The burn leg goes through the same verified cascade as the pot&apos;s burns — cheapest and
        most final first, with each probe <B>verified, never trusted</B>:
      </P>
      <Flow
        items={[
          { label: "1 · the token's own burn(amount)", hot: true, note: "accepted only on a MEASURED balance drop" },
          { label: "2 · transfer to 0xdEaD" },
          { label: "3 · held forever on the hook — custody IS the burn", note: "no withdrawal path exists" },
        ]}
      />
      <P>
        A token that fakes its burn function falls through on the measured check; a token that
        blocklists <C>0xdEaD</C> falls through to the held-forever ledger; and after the first
        fall-through the asset is flagged so later burns settle straight to the ledger without
        re-probing. Every outcome is out of circulation; every outcome emits its mode. The full
        pipeline — including why the terminal hold is <B>stronger</B> than any retrievable
        alternative — is in{" "}
        <a className="text-magenta underline" href="/docs/delivery">Burn &amp; delivery</a>.
      </P>

      <H2>Reading the burn</H2>
      <Code title="what to index">
        <span className="g">Harvested</span>(poolId, mainFees, secondaryFees, <span className="l">burned</span>, fueled){"  "}<span className="c">{"// the burn leg, per harvest"}</span>{"\n"}
        <span className="g">Delivered</span>(poolId, to, amount, mode){"                      "}<span className="c">{"// BURNED · DEAD · HELD — how it died"}</span>{"\n"}
        <span className="g">heldOf</span>(asset){"                                           "}<span className="c">{"// the held-forever ledger, live"}</span>
      </Code>
      <P>
        Summing the <C>burned</C> field across <C>Harvested</C> events gives a token&apos;s exact
        cumulative fee-burn — a supply-reduction figure a community can verify without trusting a
        single reported number.
      </P>
    </>
  );
}

/* ---------------------------------------------------------- never stops --- */

export function FeesNeverStops() {
  return (
    <>
      <Lead>
        One rule outranks every feature in the fee machine: <B>a swap must land no matter what</B>.
        Every mechanic in this section — the split, the payouts, the burn, the compound — is built
        to fail <B>sideways</B>, never backwards into the trade that carried it. This chapter is
        the complete inventory of how.
      </Lead>

      <H2>Why this is a hard requirement, not politeness</H2>
      <P>
        A hook that can revert swaps is a denial-of-service surface: one broken recipient could
        freeze a pool&apos;s trading, and one adversarial token could hold every trader hostage.
        It is also a routing death sentence — aggregators simulate before they route, and a pool
        that ever reverts on them silently drops out of every route. So the design treats
        &quot;the machine can never block a trade&quot; as a <B>safety invariant</B>, enforced
        structurally, not as error handling sprinkled on top.
      </P>

      <H2>The inventory — every surface, every failure, every landing</H2>
      <T
        head={["surface", "what can go wrong", "what happens instead of a revert"]}
        rows={[
          [
            <B key="a">auto-harvest</B>,
            "a heavy token, a gas-expensive run",
            <span key="v1">runs in its own frame under a <B>hard gas budget</B>; exceeding it reverts <B>atomically inside that frame</B> — fees stay pending, nothing is half-split, the swap completes; the manual path picks it up</span>,
          ],
          [
            <B key="b">the compound mint</B>,
            "a mint that would revert or over-consume",
            <span key="v2">isolated frame with a strict budget check — any failure leaves the <B>whole budget in the carry</B>, retried next harvest; the harvest itself never blocks on it</span>,
          ],
          [
            <B key="c">recipient payouts</B>,
            "a reverting receive(), a blocklist, a gas guzzler",
            <span key="v3">bounded-gas push; a refusal books the identical amount as <B>owed</B> — folds into the next push, claimable any time with full gas</span>,
          ],
          [
            <B key="d">the burn cascade</B>,
            "a fake burn(), a blocklisted dead address",
            <span key="v4">verified probes fall through — burn → <C>0xdEaD</C> → held-forever custody; every landing is out of circulation, none reverts the harvest</span>,
          ],
          [
            <B key="e">pot fuel (buybackShare)</B>,
            "—",
            "an internal balance credit on the hook itself; there is no external call to fail",
          ],
          [
            <B key="f">the pump (buy side)</B>,
            "pool state that would revert the buyback",
            <span key="v6"><C>try/catch</C> self-call — the pump is <B>skipped</B>, the buyer&apos;s swap lands untouched</span>,
          ],
          [
            <B key="g">the shield (sell side)</B>,
            "empty pot, unconfigured pot, a leg rounding to zero",
            "quotes zeros and steps aside — the sell executes through the pool as a normal swap",
          ],
          [
            <B key="h">pot deliveries</B>,
            "a hostile pot recipient",
            <span key="v8">native pushes carry a 30,000-gas stipend; a refusal <B>parks</B> the amount, retryable by anyone via <C>flushDirect</C></span>,
          ],
        ]}
      />

      <H2>The pattern behind all eight rows</H2>
      <P>
        Every row is the same three-part shape. <B>Isolate</B>: anything that can fail runs in its
        own frame (a self-call, a bounded push, a gas budget), so a failure&apos;s blast radius is
        that frame alone. <B>Book, don&apos;t lose</B>: the failed value lands in a named ledger —
        pending fees, the carry, the owed ledger, the parked ledger, the held ledger — each one a
        term of <C>obligationOf</C>, each one covered by custody at all times. <B>Retry
        permissionlessly</B>: the next harvest, the next push, a <C>claim</C>, a{" "}
        <C>flushDirect</C> — someone with an incentive can always finish the job later, with their
        own gas and no special role.
      </P>
      <Callout tone="good" title="the floor is a vanilla pool">
        <p>
          Compose every failure at once — hostile recipients on both sides, an unburnable token, a
          carry that never fits, an empty pot — and the result is a pool that trades{" "}
          <B>exactly like a hookless Uniswap pool</B>, with value parked in ledgers waiting to be
          claimed. Misconfiguration wastes its own opportunity; it never taxes, delays or blocks a
          trader.
        </p>
      </Callout>

      <H2>What this means for a trader, concretely</H2>
      <P>
        The machine adds <B>no new revert path</B> to a swap: no token behaviour, no configuration,
        no recipient and no pot state can make a trade fail that would have succeeded on a vanilla
        pool. The only overhead a trader ever carries is bounded gas — the pump&apos;s inline
        execution and an occasional auto-harvest under its budget — and the minimums exist
        precisely so the program tunes that cost consciously (see{" "}
        <a className="text-magenta underline" href="/docs/harvest">How harvesting works</a>).
        Trade-side guarantees like &quot;the shield pays pool-exact&quot; are proven wei-exact in
        the{" "}
        <a className="text-magenta underline" href="/docs/security">test campaign</a>.
      </P>
    </>
  );
}
