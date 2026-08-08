/** The autonomous LP — why buybacks + self-harvesting make a hooked pool
 *  independent from teams, keepers and arbitrageurs. The synthesis chapter:
 *  the mechanics live earlier in the book; this is what they add up to. */

import {
  B, C, Callout, Code, Cols, Flow, H2, H3, Lead, LinkCards, P, Panel, Stats, T,
} from "../ui";

/* ------------------------------------------------------------ autopilot --- */

export function Autonomy() {
  return (
    <>
      <Lead>
        Every mechanism in this book — the pot, pump, shield, the burn cascade, the fee split, the
        compound engine — shares one design constraint: <B>none of it needs a human to run</B>.
        Put together, they turn a Uniswap pool into something new: an LP whose tokenomics are a
        property of its own trading, not an activity someone performs on its behalf. This chapter
        is about that independence — what it replaces, how far it goes, and why it survives the
        team that launched it.
      </Lead>

      <H2>Tokenomics as an activity vs tokenomics as a property</H2>
      <P>
        Almost every tokenomic promise in the market today is an <B>activity</B>: someone at the
        project signs the buyback, someone funds the bot, someone remembers to compound the LP,
        someone runs the keeper that harvests the fees. Activities depend on people — on their
        keys, their attention, their funding, and their continued existence. The moment the person
        stops, the tokenomics stop, and holders usually find out from the chart.
      </P>
      <P>
        A hooked pool inverts this. The buyback fires <B>inside the buy</B> that would have
        benefited from it. The harvest fires <B>inside the swap</B> that generated the fees. The
        compound re-mints those fees into the pool&apos;s own position in the same breath. The burn
        happens on delivery, through a cascade that cannot fail a trade. Nothing on that list has
        an operator — the operator is the traffic.
      </P>
      <T
        head={["job", "who does it, classically", "who does it here"]}
        rows={[
          [<B key="a">buy the token back</B>, "treasury signer, market-maker mandate, buyback bot", <span key="r1">the pot, inside the buy — <a className="text-magenta underline" href="/docs/pump">Pump</a></span>],
          [<B key="b">defend a sell-off</B>, "market maker on a retainer, team bids", <span key="r2">the pot, inside the sell — <a className="text-magenta underline" href="/docs/shield">Shield</a></span>],
          [<B key="c">burn supply</B>, "manual burns, announced and trusted", <span key="r3">the cascade, on every delivery — <a className="text-magenta underline" href="/docs/delivery">Burn &amp; delivery</a></span>],
          [<B key="d">collect LP fees</B>, "a keeper network or a weekly multisig call", <span key="r4">the in-swap auto-harvest — <a className="text-magenta underline" href="/docs/harvest">Auto-harvest</a></span>],
          [<B key="e">compound the position</B>, "a vault protocol charging a performance fee", <span key="r5">the compound engine, natively — <a className="text-magenta underline" href="/docs/compound">Autocompound</a></span>],
          [<B key="f">route revenue share</B>, "spreadsheet + payout script", <span key="r6">the recipient legs, to the wei — <a className="text-magenta underline" href="/docs/lp-recipients">The recipients</a></span>],
        ]}
      />

      <H2>The loop, closed</H2>
      <P>
        The reason the machine needs nobody is that its output is its own input. Follow one unit of
        volume around the circle:
      </P>
      <Flow
        items={[
          { label: "a swap happens — the only external event the machine ever needs" },
          { label: "LP fees accrue on both sides of the program's position" },
          { label: "auto-harvest fires in-swap once the minimums are met", hot: true },
          { label: "compound share → deeper liquidity · buyback share → the pot · burn share → destroyed · rest → recipients", hot: true },
          { label: "the pot pumps on buys and shields sells — its purchases burn or deliver", hot: true },
          { label: "deeper liquidity + lower supply → more attractive pool → more volume", note: "back to the top" },
        ]}
      />
      <P>
        Every arrow in that loop is enforced code. There is no step where a human signs, funds,
        schedules, or approves — and therefore no step where a human can be late, wrong, out of
        gas, or gone.
      </P>

      <H2>How far the independence goes</H2>
      <Cols>
        <Panel label="independent from the team">
          <p className="text-[13.5px] leading-relaxed text-dim">
            The two human roles — pot admin and program operator — exist to <B>set policy</B>, not
            to run the machine. Both can be transferred, and both can be surrendered forever. A
            program whose operator is <C>address(0)</C> is an immutable promise: the split, the
            recipients, the burn share — frozen. The pool keeps buying, burning and compounding on
            the same terms whether the team is shipping, sleeping, or dissolved.
          </p>
        </Panel>
        <Panel label="independent from keepers & arbitrageurs">
          <p className="text-[13.5px] leading-relaxed text-dim">
            Nothing here waits for an external actor to find it profitable. A keeperless harvest
            costs the triggering swap a bounded slice of gas; the buyback executes at the
            pool&apos;s own curve rather than needing an arbitrageur to close a gap; the compound
            mints at the live price with the carry absorbing what doesn&apos;t fit. No bounty is
            paid, no spread is leaked, no third party takes a cut for keeping the lights on.
          </p>
        </Panel>
      </Cols>

      <Stats
        items={[
          { v: "0", l: "keepers required", c: "var(--t-green)" },
          { v: "0", l: "off-chain jobs", c: "var(--t-green)" },
          { v: "0%", l: "protocol fee", c: "var(--t-green)" },
          { v: "∞", l: "runtime after surrender", c: "var(--t-magenta)" },
        ]}
      />

      <Callout tone="pink" title="the last human act can be leaving">
        <p>
          This is the deepest version of the promise: a team can launch a pool, set the program,
          seed the pot, surrender both roles — and walk away leaving a market that defends itself,
          burns its own supply and compounds its own liquidity for as long as anyone trades it.
          Holders stop trusting a roadmap and start reading a contract.
        </p>
      </Callout>

      <H2>What still touches the machine — and why that&apos;s fine</H2>
      <P>
        Autonomy doesn&apos;t mean sealed. Anyone can <B>fuel</B> the pot with a donation; anyone
        can trigger the public quote-and-donate integration paths; a live operator can still tune
        the split; a heavy pool can be harvested manually with full gas. But notice the shape of
        every one of these: they are <B>inputs and policy</B>, never dependencies. The machine
        accepts help; it does not require it. Withdraw all of it and the loop above still turns.
      </P>

      <H2>The two engines, taken apart</H2>
      <LinkCards
        items={[
          { href: "/docs/autonomous-buyback", title: "Buybacks nobody has to run", body: "No signer, no bot, no oracle, no arbitrageur — the buy is the trigger and the curve is the price." },
          { href: "/docs/autonomous-compounding", title: "Compounding without keepers", body: "The fee-to-liquidity loop with no keeper network, no vault wrapper, no performance fee." },
        ]}
      />
    </>
  );
}

/* --------------------------------------------------- autonomous buyback --- */

export function AutonomousBuyback() {
  return (
    <>
      <Lead>
        A buyback is the most wanted — and most manual — instrument in tokenomics. This chapter
        counts what a classical buyback quietly depends on, then shows how pump and shield delete
        every dependency: the trigger, the price, the funding, the execution and the delivery all
        live inside the pool, so the buyback runs whether or not anybody shows up to run it.
      </Lead>

      <H2>The dependency audit of a classical buyback</H2>
      <T
        head={["dependency", "what it is", "how it fails"]}
        rows={[
          [<B key="a">a signer</B>, "a treasury key or multisig quorum that approves each buy", "keys rotate, signers leave, quorums stall — the buyback pauses with them"],
          [<B key="b">a bot</B>, "an EOA with gas, uptime and a schedule", "unfunded, unmaintained, or simply switched off when attention moves on"],
          [<B key="c">an oracle</B>, "a price feed telling the bot when to act", "an extra attack surface: bend the feed and the treasury buys the top"],
          [<B key="d">an arbitrageur</B>, "designs that shift a reference price and wait for arbs to realign the market", "the realignment IS a spread — value leaks to the arbitrageur on every cycle"],
          [<B key="e">trust</B>, "the announcement that the buys really happen", "unverifiable by construction — holders audit a promise, not a mechanism"],
        ]}
      />
      <P>
        Each row is a person or a process that must exist, stay funded and stay honest. The
        machine&apos;s answer is not to harden these dependencies — it is to <B>not have them</B>.
      </P>

      <H2>Five dependencies, five deletions</H2>
      <H3>The trigger is the trade itself</H3>
      <P>
        Pump fires <B>inside the buy</B>: the swap that pushes the price is the same transaction
        in which the pot buys behind it. Shield fires <B>inside the sell</B>: the pot absorbs the
        order in the very frame it lands. There is no schedule to keep and no signal to watch —
        the market event and the response are one atomic thing. That atomicity is also the MEV
        answer: there is no gap between &quot;decision&quot; and &quot;execution&quot; for a
        sandwich to open. The mechanics live in{" "}
        <a className="text-magenta underline" href="/docs/pump">Pump</a> and{" "}
        <a className="text-magenta underline" href="/docs/shield">Shield</a>.
      </P>
      <H3>The price is the curve itself</H3>
      <P>
        The pot never asks what the token is worth — it trades against the pool&apos;s own tick
        math, which <B>is</B> the price. No oracle exists to manipulate, and no reference price
        needs an arbitrageur to enforce it. A shielded seller receives the pool&apos;s <B>exact</B>{" "}
        output, fee and tick impact included, so there is no spread for a third party to harvest —
        the value that classical designs leak to arbitrageurs stays in the pot.
      </P>
      <H3>The funding is structural</H3>
      <Code title="how the pot stays full with no treasury operations">
        donations{"        "}<span className="c">{"// anyone, any time — team, community, partner, another contract"}</span>{"\n"}
        buybackShareWad{"  "}<span className="c">{"// a slice of every harvest's SECONDARY-side fees, forever"}</span>
      </Code>
      <P>
        A treasury program needs someone to wire funds before each campaign. The pot accepts value
        from <B>anyone</B> (see{" "}
        <a className="text-magenta underline" href="/docs/donations">Donations</a>) and — the
        autonomous part — refuels <B>itself</B> from trading fees when the program carries a{" "}
        <C>buybackShare</C>. A pool with volume funds its own defense from its own traffic: the
        more it trades, the more firepower it accumulates, with zero treasury operations in the
        loop.
      </P>
      <H3>The execution cannot be forgotten</H3>
      <P>
        A bot that is down skips the dip. The hook cannot skip anything: as long as the pot holds
        balance and the trigger conditions are met, the buyback executes — under a try/catch
        wrapper that means the <B>worst case is a skipped action, never a failed swap</B> (see{" "}
        <a className="text-magenta underline" href="/docs/lp-never-stops">Trading never stops</a>).
        The machine is incapable of both negligence and obstruction.
      </P>
      <H3>The delivery is verifiable, not announced</H3>
      <P>
        What the pot buys goes through the buyback split — a slice compounds into the pool&apos;s
        own liquidity, a slice burns through the cascade, the rest reaches the configured
        recipient (see{" "}
        <a className="text-magenta underline" href="/docs/buyback-management">Buy back
        management</a>). Every leg is an on-chain event; the held-forever ledger even accounts for
        tokens that refuse to die. Holders don&apos;t audit a Medium post — they audit a log.
      </P>

      <H2>Independence, stress-tested</H2>
      <T
        head={["scenario", "classical buyback", "hooked pool"]}
        rows={[
          ["the team disappears", "buybacks end silently", "pump & shield keep firing on every qualifying trade — the pot spends itself down defending the pool, and keeps refueling from fees"],
          ["the bot's key leaks", "treasury drained at market", "there is no key: the pot can only ever spend on buying or defending its own pool — no function exists to withdraw it"],
          ["a volatile night, 3am", "nobody is awake to bid", "shield absorbs the sells in the sells themselves, at the pool's exact price, with no reaction latency"],
          ["the community wants to help", "send funds to a multisig and hope", "donate(key, amount) — permissionless, irreversible, working the moment it lands"],
          ["the operator surrenders", "n/a — someone must keep signing", "the split freezes and the machine runs the frozen policy forever"],
        ]}
      />

      <Callout tone="good" title="the seller loses nothing, the trader risks nothing">
        <p>
          Autonomy would be worthless if it taxed the market that powers it. A shielded seller
          receives <B>precisely</B> what the pool&apos;s math owes them; a pump rides a buy without
          touching the buyer&apos;s amounts; every hook action is fault-tolerant, so a weird token
          or an empty pot degrades to a no-op while the swap completes untouched. The machine
          defends the pool without ever standing in front of a trade.
        </p>
      </Callout>

      <H2>What this means for revenue share</H2>
      <P>
        Modern revenue share increasingly <B>is</B> a buyback: route protocol revenue into open
        market purchases, then burn or compound what was bought. With an autonomous buyback, that
        entire pipeline becomes a standing property of the pool — revenue in (donations from the
        protocol&apos;s contracts, or the fee split itself), purchases out, burn and compound on
        delivery — verifiable end to end and immune to the operational decay that kills manual
        programs. The integration patterns live in{" "}
        <a className="text-magenta underline" href="/docs/integrate">Integrate buybacks</a>.
      </P>
    </>
  );
}

/* ----------------------------------------------- autonomous compounding --- */

export function AutonomousCompounding() {
  return (
    <>
      <Lead>
        Concentrated liquidity had a famous gap: V3-style positions earn fees, but never reinvest
        them — someone must collect, rebalance the amounts, and re-mint. A whole industry of
        keepers and auto-compounding vaults grew inside that gap, each adding a fee and a trust
        assumption. The hook closes the gap where it opened: <B>in the pool itself</B> — no
        keeper, no vault, no performance fee, no one to pay for growth.
      </Lead>

      <H2>The gap, and the industry it spawned</H2>
      <P>
        An LP position&apos;s fees sit outside the position. Left alone they are idle inventory —
        earning nothing, compounding nothing. The classical fixes all import an operator:
      </P>
      <T
        head={["fix", "who operates it", "what it costs"]}
        rows={[
          [<B key="a">do it yourself</B>, "you, on a schedule", "gas per round trip, attention forever, and every missed week is growth foregone"],
          [<B key="b">keeper networks</B>, "bots paid a bounty per execution", "the bounty — plus the job simply not running when it isn't profitable for the keeper"],
          [<B key="c">auto-compounding vaults</B>, "a protocol wrapping your position", "typically a performance fee on your yield, a new contract to trust, often a new token to hold"],
        ]}
      />
      <P>
        Note the shape: in every case the compounding is <B>someone&apos;s business</B>. It
        happens when it pays <B>them</B>, and it costs a margin that comes out of your growth.
      </P>

      <H2>The hook&apos;s answer: compounding as a side effect</H2>
      <P>
        The program&apos;s position compounds because <B>trading happens</B> — full stop. The
        auto-harvest fires inside a swap once pending fees pass the minimums; the compound share of
        both sides becomes the LP budget; the engine re-mints that budget into the position at the
        pool&apos;s live price, in the same transaction. Nobody is paid to do this, because nobody
        does it.
      </P>
      <Flow
        items={[
          { label: "swap — fees cross minMain / minSecondary" },
          { label: "auto-harvest fires inside the swap, under a hard gas budget", hot: true },
          { label: "compoundShare of both sides → the LP budget" },
          { label: "engine mints max liquidity the two-sided constraint allows, at the live tick", hot: true },
          { label: "what doesn't fit → the carry, first in line for the next round", note: "nothing leaks" },
          { label: "deeper position → more fees per unit of volume → back to the top" },
        ]}
      />
      <P>
        Two details make this keeperless loop actually safe. The <B>gas budget</B>: an auto-run
        that would be too heavy reverts atomically — fees stay pending, the swap completes
        untouched, and the pool gravitates to the (optional, full-gas) manual{" "}
        <C>harvest(key)</C>. The <B>carry</B>: minting needs both tokens in the ratio the current
        tick dictates, so the unmatched remainder is never sold, never donated to the market as
        slippage — it waits, and it compounds next round. The exact math lives in{" "}
        <a className="text-magenta underline" href="/docs/compound-math">The compounding math</a>.
      </P>

      <H2>No arbitrageur in the loop</H2>
      <P>
        This matters more than it looks. Vault-style compounders often <B>swap</B> the fee
        inventory to rebalance it before minting — and every swap pays the fee tier and crosses
        the spread, leaking a slice of your yield to the market (and to whoever arbitrages the
        vault&apos;s predictable flow). The hook&apos;s engine <B>never swaps to rebalance</B>: it
        mints what the budget allows at the live price and carries the rest. Growth costs zero
        spread, zero arbitrage leakage, zero rebalancing fee — the only thing between the fee and
        the position is a floor division.
      </P>

      <Stats
        items={[
          { v: "0", l: "keeper bounties", c: "var(--t-green)" },
          { v: "0%", l: "performance fee", c: "var(--t-green)" },
          { v: "0", l: "rebalancing swaps", c: "var(--t-green)" },
          { v: "100%", l: "of the budget mints or carries", c: "var(--t-magenta)" },
        ]}
      />

      <H2>Growth that survives everyone</H2>
      <P>
        Because the loop&apos;s only input is volume, it inherits volume&apos;s indifference to
        the project&apos;s org chart. A live operator can tune <C>compoundShareWad</C> up and down
        as strategy changes (see{" "}
        <a className="text-magenta underline" href="/docs/compound-strategies">Compound
        strategies</a>); a surrendered program compounds at the frozen share forever. Either way,
        the position&apos;s growth is <B>geometric in cumulative volume</B> — each harvest deepens
        the liquidity that earns the next harvest — and no one&apos;s continued employment is a
        term in that equation.
      </P>

      <Callout tone="pink" title="the LP that owns itself">
        <p>
          Combine this chapter with the last one and the full picture appears: a position that
          harvests its own fees, deepens its own liquidity, fuels its own buyback pot and burns its
          own supply — owned, in the surrendered limit, by nobody at all. Not a product that
          manages your LP: <B>an LP that manages itself</B>.
        </p>
      </Callout>

      <H2>Keep reading</H2>
      <LinkCards
        items={[
          { href: "/docs/compound", title: "The compound engine", body: "The mechanism this chapter celebrates: the mint constraint, the carry, and the budget." },
          { href: "/docs/harvest", title: "How harvesting works", body: "The in-swap trigger, the minimums, the gas budget, and the manual full-gas path." },
        ]}
      />
    </>
  );
}
