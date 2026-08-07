/** The machine: the Buy back, Autocompound and Auto-harvest chapters, plus Roles. */

import {
  B, C, Callout, Code, Cols, Faq, Flow, H2, H3, Lead, P, Panel, Stats, Steps, T,
} from "../ui";

/* -------------------------------------------------------- 05 · the pot --- */

export function ThePot() {
  return (
    <>
      <Lead>
        Every hooked pool declares two roles for its two currencies, and carries one{" "}
        <B>pot</B> — a permissionless war chest that anyone can fuel and that spends itself through
        the pump and the shield. Until <C>initPot</C> runs, the hook is completely passive on the
        pool.
      </Lead>

      <H2>MAIN and SECONDARY</H2>
      <T
        head={["role", "meaning"]}
        rows={[
          [
            <B key="m">MAIN</B>,
            <span key="mv">
              the asset being <B>defended</B>. It is what the pot buys on pumps, what it absorbs on
              sells, and what the pot&apos;s recipient receives. <C>address(0)</C> as recipient
              means <B>burn</B>.
            </span>,
          ],
          [
            <B key="s">SECONDARY</B>,
            <span key="sv">
              the <B>buyback currency</B>. The ONLY asset the pot ever holds and the ONLY asset{" "}
              <C>donate</C> accepts — native or any ERC20, whichever side of the pair it is.
            </span>,
          ],
        ]}
      />
      <P>
        Either currency may be main, so the hook is <B>pair-agnostic</B>: an ETH-quoted token is one
        configuration among many, not a requirement. Token/token pools, stable-quoted pools,
        native-defended pools — all legal. The one asymmetry: a <B>native main</B> (the network
        token) cannot be burned, so its pot must always name a live recipient.
      </P>

      <H2>Funding the pot</H2>
      <Code title="donate — permissionless, measured on arrival">
        <span className="c">{"// native secondary: amount == msg.value"}</span>{"\n"}
        hook.donate{"{"}value: amt{"}"}(key, amt);{"\n\n"}
        <span className="c">{"// ERC20 secondary: approve, then donate"}</span>{"\n"}
        SECONDARY.approve(address(hook), amt);{"\n"}
        hook.donate(key, amt);{" "}
        <span className="c">{"// credits the MEASURED balance delta"}</span>
      </Code>
      <Callout tone="info" title="fee-on-transfer safe">
        <p>
          The credit is the measured balance delta, so a fee-on-transfer secondary credits exactly
          what arrived — the pot never books tokens it doesn&apos;t hold.
        </p>
      </Callout>
      <Callout tone="warn" title="donations are irreversible">
        <p>
          There is no withdrawal path for a pot — not for the donor, not for the admin, not for
          anyone. The pot exists to be spent on the market, and only the market can spend it. The
          full funding guide — strategies, safety checks, integrations — is the next chapter:{" "}
          <a className="text-magenta underline" href="/docs/donations">Donations</a>.
        </p>
      </Callout>

      <H2>The recipient</H2>
      <P>
        The pot&apos;s <C>recipient</C> decides where bought and absorbed main goes.{" "}
        <C>address(0)</C> means <B>burn</B> — the burn cascade runs (see{" "}
        <a className="text-magenta underline" href="/docs/delivery">Burn &amp; delivery</a>).
        Anything else is a literal delivery target: a treasury, a staking vault, a rewards contract,
        a locker. The pot admin can move it at any time with <C>setRecipient</C>. And when the pool
        carries an LP program, its operator can carve the output <B>before</B> it reaches the
        recipient — a share into the pool&apos;s own liquidity, a share into the burn — with the{" "}
        <a className="text-magenta underline" href="/docs/buyback-management">buyback split</a>.
      </P>

      <H2>Who is the pot admin?</H2>
      <P>
        Whoever initialized the pool on the PoolManager — the hook records it in{" "}
        <C>beforeInitialize</C> (or, on a <C>launchPool</C>, the launcher itself). The admin
        declares the roles once (<C>initPot</C> is one-shot), can move the recipient, and is the
        only address that may create the pool&apos;s LP program. The admin has <B>no other
        power</B>: it cannot touch the pot&apos;s balance, block trades, or change the mechanics.
      </P>
      <Callout tone="warn" title="what admin trust actually means for donors">
        <p>
          Admin trust is scoped to <B>configuration, not funds</B>: a malicious admin can at worst
          re-point where a <B>future</B> buyback&apos;s main is delivered — including to
          themselves. It can never reach donated secondary or parked main. So before donating to a
          pool you don&apos;t control, check <C>potOf(poolId).recipient</C> and who the admin is —
          exactly as you would verify any on-chain destination. A pool whose recipient is{" "}
          <C>address(0)</C> (burn) with a renounce-style admin story is the trustless shape.
        </p>
      </Callout>

      <H2>The pot&apos;s spending curve — the math of pacing</H2>
      <P>
        The pot never decides to spend; buys unlock it. Each pump spends at most{" "}
        <C>0.8 · min(pot, f·R, userIn)</C> — three ceilings at once — and that shape gives the pot
        two clean aggregate laws you can compute in your head:
      </P>
      <Code title="two laws of the pot, derived from the per-buy bound">
        <span className="c">{"// law 1 — demand pacing: spend ≤ 0.8·userIn on every buy, so over any window"}</span>{"\n"}
        total spend{"  "}≤{"  "}0.8 · total organic buy volume{"\n"}
        <span className="c">{"// → a pot of B can only ever be spent by ≥ 1.25·B of REAL buys"}</span>{"\n\n"}
        <span className="c">{"// law 2 — depth pacing: spend ≤ 0.8·f·R on every buy, so per swap"}</span>{"\n"}
        max pump{"  "}={"  "}0.8 · fee · tangent depth{"\n"}
        <span className="c">{"// 0.30% pool, 1,000 ETH tangent depth → at most 2.4 ETH per buy"}</span>
      </Code>
      <P>
        Put together: a <B>100 ETH pot</B> on that pool takes at least <B>42 pump-carrying buys</B>{" "}
        and at least <B>125 ETH of genuine buy volume</B> to spend down. The pot cannot be emptied
        in one block, cannot front-run itself, and always meters its firepower into real demand —
        the drain rate is a function of <B>traffic</B>, not of anyone&apos;s decision. And because{" "}
        <C>R</C> is read live, the ceiling breathes with the pool: deeper liquidity earns bigger
        pumps automatically, a thinning pool throttles itself.
      </P>

      <H2>Reading a pot</H2>
      <Code title="views">
        <span className="g">potOf</span>(poolId) → Pot{"{"} admin, main, secondary, recipient, configured, balance {"}"}{"\n"}
        <span className="g">quotePump</span>(key, buyIn) → (spend, minOut){"\n"}
        <span className="g">quoteShield</span>(key, amountSpecified) → (absorbed, paid)
      </Code>
    </>
  );
}

/* ------------------------------------------------------------ donations --- */

export function Donations() {
  return (
    <>
      <Lead>
        The pot has exactly one inflow besides the harvest&apos;s buyback share:{" "}
        <C>donate</C> — <B>permissionless, secondary-only, measured on arrival, and one-way</B>.
        This chapter is the full funding guide: the mechanics, the safety checks before you fund a
        pool you don&apos;t control, and the strategies that fit how the pot actually spends.
      </Lead>

      <H2>The mechanics</H2>
      <Code title="donate(key, amount) — anyone, any time, once the pot is configured">
        <span className="c">{"// native secondary: the donation IS the attached value"}</span>{"\n"}
        hook.donate{"{"}value: amt{"}"}(key, amt);{"          "}<span className="c">{"// msg.value must equal amount"}</span>{"\n\n"}
        <span className="c">{"// ERC20 secondary: no value, an allowance instead"}</span>{"\n"}
        SECONDARY.approve(address(hook), amt);{"\n"}
        uint256 credited = hook.donate(key, amt);{" "}
        <span className="c">{"// returns what actually landed"}</span>
      </Code>
      <T
        head={["rule", "why"]}
        rows={[
          [
            <span key="a">the pot must be <B>configured</B> first (<C>PotNotReady</C>)</span>,
            "before initPot there is no \"secondary\" to credit — a donation to an undeclared pot would be a guess about roles that don't exist yet",
          ],
          [
            <span key="b">value XOR allowance, never both (<C>BadDonation</C>)</span>,
            "a native pot is funded with attached value, an ERC20 pot through an allowance — mixing them is always a caller bug, so it reverts loudly",
          ],
          [
            <B key="c">the credit is the measured balance delta</B>,
            "a fee-on-transfer secondary credits exactly what arrived; a donation that nets to zero reverts instead of emitting a lie",
          ],
          [
            <span key="d">only <B>secondary</B> can ever be donated</span>,
            "the pot is a war chest denominated in the buyback currency — main enters the pot only by being bought or absorbed, never deposited",
          ],
        ]}
      />
      <P>
        Every donation emits <C>Donated(poolId, donor, amount)</C> with the <B>credited</B> amount,
        and the credit immediately joins the hook&apos;s <C>obligationOf(secondary)</C> accounting
        — custody covers every donated wei from the moment it lands until the market spends it.
      </P>

      <H2>Before you donate — the two checks</H2>
      <Steps
        items={[
          {
            title: "Read where the main will go",
            body: (
              <>
                <C>potOf(poolId).recipient</C> is where every pump&apos;s and shield&apos;s main is
                delivered. <C>address(0)</C> means burn — the trustless shape. A live address means
                you are trusting whoever the admin points it at, <B>including future re-pointing</B>.
              </>
            ),
          },
          {
            title: "Know what the admin can and cannot do",
            body: (
              <>
                The admin can move the recipient — that is the whole attack surface. It can{" "}
                <B>never</B> reach the pot&apos;s balance, pause the machine, or change the pricing:
                your donated secondary can only ever leave by buying main at the pool&apos;s own
                price. Worst case is delivery capture of <B>future</B> buybacks, never fund theft.
              </>
            ),
          },
        ]}
      />

      <H2>Donation strategy — the pot spends on the market&apos;s clock</H2>
      <P>
        Because of the{" "}
        <a className="text-magenta underline" href="/docs/the-pot">spending curve</a>, a donation
        is never a market order: a 100 ETH donation on a 0.30% pool with 1,000 ETH of tangent depth
        can spend at most 2.4 ETH per buy, and only against ≥ 125 ETH of genuine buy demand. That
        changes what &quot;good funding&quot; looks like:
      </P>
      <T
        head={["strategy", "when it fits"]}
        rows={[
          [
            <B key="a">lump-sum</B>,
            "simplest, and safe by construction — the pacing laws stream it into the market for you. One transaction, one thing for the community to verify.",
          ],
          [
            <B key="b">scheduled tranches</B>,
            "when you want the POT's balance (which is public) to signal sustained commitment rather than a one-off — a vesting contract or a Sablier-style stream calling donate() on a schedule",
          ],
          [
            <B key="c">revenue routing</B>,
            <span key="v">
              the deepest shape: a protocol sends a slice of its actual revenue to <C>donate</C>{" "}
              every period, making the buyback proportional to real usage —{" "}
              <a className="text-magenta underline" href="/docs/integrate">Integrate buybacks</a>{" "}
              is the dozen-line version
            </span>,
          ],
          [
            <B key="d">self-fueling</B>,
            <span key="v2">
              zero external funding at all: a non-zero <C>buybackShare</C> makes every harvest
              donate the pool&apos;s own secondary-side fees to its own pot — the machine feeds
              itself from traffic
            </span>,
          ],
        ]}
      />
      <Callout tone="warn" title="donate what you mean to spend">
        <p>
          One-way means one-way: no donor refund, no admin sweep, no governance override — the
          design deliberately gives donors <B>zero residual claim</B>, because any claim path would
          be a rug path. A donation is a market commitment, not a deposit.
        </p>
      </Callout>

      <H2>Reading a pot&apos;s funding history</H2>
      <Code title="the funding surface, for dashboards and diligence">
        <span className="g">Donated</span>(poolId, donor, amount){"                "}<span className="c">{"// every external credit, with its real size"}</span>{"\n"}
        <span className="g">Harvested</span>(poolId, …, fueled){"                  "}<span className="c">{"// the buybackShare leg landing in the same balance"}</span>{"\n"}
        <span className="g">potOf</span>(poolId).balance{"                        "}<span className="c">{"// the live war chest, one read"}</span>
      </Code>
      <P>
        A community can audit a project&apos;s buyback promise entirely on-chain: sum the{" "}
        <C>Donated</C> events, watch the balance, and compare against the pump volume — no trust in
        reported numbers, ever.
      </P>
    </>
  );
}

/* ----------------------------------------------------------- 06 · pump --- */

export function Pump() {
  return (
    <>
      <Lead>
        On a SECONDARY → MAIN buy, <C>afterSwap</C> makes the pot buy more main{" "}
        <B>inside the buyer&apos;s own transaction</B> and hands it to the recipient. The sizing
        rule is one line — and that one line is the entire anti-sandwich model.
      </Lead>

      <Code title="the sizing rule">
        <span className="c">{"// the slice this buy unlocks"}</span>{"\n"}
        unlocked = min(pot, fee·depth, the secondary this buy actually paid){"\n"}
        <span className="c">{"// the safety haircut keeps the spend strictly"}</span>{"\n"}
        <span className="c">{"// inside the sandwich break-even"}</span>{"\n"}
        spend{"    "}= unlocked · <span className="l">80%</span>
      </Code>
      <P>
        Nothing in that line is hardcoded to a pool shape: <C>fee·depth</C> is computed{" "}
        <B>live</B> as the pool&apos;s current swap fee times its tangent reserve at the live price
        — so a deeper pool or a fatter fee tier earns a proportionally larger pump, automatically.
        And <C>userIn</C> is the <B>measured</B> secondary leg of the buyer&apos;s own swap delta,
        not a re-quote — a dust buy can only ever unlock a dust pump, and the pot follows real
        demand instead of emptying all at once.
      </P>

      <H2>A buy, step by step</H2>
      <Flow
        items={[
          { label: "user swaps SECONDARY → MAIN" },
          { label: "pool executes the user's swap", note: "user pays the pool fee" },
          { label: "afterSwap: pot spends ≤ 80% of the unlocked slice", hot: true },
          { label: "pot's MAIN → recipient (or the burn cascade)", hot: true },
        ]}
      />

      <H2>Why it can&apos;t be sandwiched — the actual math</H2>
      <P>
        The sandwich shape: an attacker opens with a buy of size <C>X</C> to summon the pump, the
        pump of size <C>V</C> lands behind it, and the attacker closes by dumping the bag into the
        price bump they financed. Model the pool as depth <C>R</C> (the tangent reserve at the live
        price) with fee <C>f</C>. To leading order:
      </P>
      <Code title="the break-even, derived">
        <span className="c">{"// gross price-impact profit of bracketing a pump of size V"}</span>{"\n"}
        profit ≈ 2·X·V / R{"\n\n"}
        <span className="c">{"// the attacker pays the pool's fee on BOTH legs"}</span>{"\n"}
        fees{"   "}≈ 2·f·X{"\n\n"}
        <span className="c">{"// profitable  ⟺  2·X·V/R > 2·f·X  ⟺  V > f·R"}</span>{"\n"}
        <span className="c">{"// the attacker's own size X cancels out entirely"}</span>
      </Code>
      <P>
        The attacker&apos;s size <B>cancels out of the inequality</B> — so one single bound on the
        pump&apos;s spend closes the attack for <B>every attacker size, pot depth and price at
        once</B>. The hook caps the pump at <C>f·R</C> and then takes only 80% of it, putting the
        realised spend at <C>0.8·f·R</C> — strictly <B>inside</B> the break-even. No cooldown, no
        per-swap state, no reference price. This is proven at sizes from dust to pool-scale in the
        test campaign (<C>test_A2</C>), and it is exactly why a <B>zero-fee pool never pumps</B>:
        with <C>f = 0</C> the ceiling is zero, and the design refuses to host a sandwichable
        buyback.
      </P>
      <P>
        Intuition for the same thing: forcing a bigger pump requires a bigger real buy, which pays
        the pool&apos;s fee and impact <B>twice</B> — and the haircut means the pump moves the
        price by less than the attacker paid to trigger it. The &quot;attack&quot; is
        self-financing a donation to the pool&apos;s LPs, while the pot gets its tokens at market
        price either way.
      </P>

      <H2>The 80-cent theorem</H2>
      <P>
        Push the derivation one step further and the haircut turns into a statement you can quote:
        substitute the hook&apos;s actual spend <C>V = 0.8 · min(f·R, X)</C> into the profit
        formula and divide by the fee bill —
      </P>
      <Code title="the attacker's recapture ratio, both regimes">
        <span className="c">{"// big attacker (X ≥ f·R): the cap binds"}</span>{"\n"}
        profit/fees = (2X · 0.8fR/R) / (2fX) = <span className="l">0.80</span>{"\n\n"}
        <span className="c">{"// small attacker (X < f·R): their own size binds"}</span>{"\n"}
        profit/fees = (2X · 0.8X/R) / (2fX) = 0.8·X/(f·R) {"<"} <span className="l">0.80</span>
      </Code>
      <P>
        Every sandwich round-trip against the pump recovers <B>at most 80 cents of every fee
        dollar it pays</B> — a guaranteed loss of at least 20% of the fee bill, at every attacker
        size, every pot depth, every price, before gas. There is no size to optimize toward: the
        ratio is flat at 0.8 for everyone big enough to hit the cap, and strictly worse below it.
      </P>

      <H2>Worked numbers &amp; the impact ceiling</H2>
      <P>
        <C>R</C> is the <B>tangent reserve</B>: the reserve an equivalent constant-product pool
        would show at the pool&apos;s live price and liquidity (<C>L·√P</C> on the secondary side).
        With it, everything above becomes concrete:
      </P>
      <Code title="a 0.30% pool with 500 ETH of tangent depth">
        cap{"        "}= f·R{"           "}= 0.003 · 500{"  "}= <span className="l">1.5 ETH</span>{"\n"}
        max spend{"  "}= 0.8·f·R{"       "}={"               "}<span className="l">1.2 ETH</span> per buy{"\n"}
        max impact{" "}≈ 2V/R{"          "}= 2·1.2/500{"    "}= <span className="l">0.48%</span>{"\n\n"}
        <span className="c">{"// in general: 2V/R ≤ 2·(0.8·f·R)/R = 1.6·f"}</span>{"\n"}
        <span className="c">{"// the pump can NEVER move the price by more than 1.6× the pool's fee"}</span>
      </Code>
      <P>
        That last line is the second theorem hiding in the sizing rule: on any pool, the pump&apos;s
        price move is bounded by <B>1.6× the fee tier</B> — 0.48% on a 0.30% pool, 1.6% on a 1%
        pool — per buy, no matter how large the pot is. The pot expresses itself as a steady
        stream of small, fee-bounded buybacks riding real demand, not as one visible candle a bot
        can hunt.
      </P>
      <Callout tone="info" title="the adjacent surfaces, honestly">
        <p>
          This bound governs sandwiching <B>the pump itself</B>. Two adjacent surfaces — a third
          party sandwiching an unrelated victim&apos;s buy, and a self-sandwicher dumping through a
          partially-absorbing shield — are economically different (bounded, and in every posture
          the pot still buys its main at fair price). They are written up in full in{" "}
          <a className="text-magenta underline" href="/docs/security">Security &amp; audit</a>{" "}
          as finding GH-1.
        </p>
      </Callout>

      <Callout tone="good" title="two more properties, free">
        <p>
          The <B>buyer pays the pump&apos;s gas</B> — executing inline in <C>afterSwap</C> means
          there is no separate transaction to front-run. And the pump runs through a{" "}
          <C>try/catch</C> self-call, so a pool state that would revert the buyback{" "}
          <B>skips the pump instead of reverting the buyer</B>.
        </p>
      </Callout>

      <Callout tone="warn" title="zero-fee pools never pump">
        <p>
          A fee-less pool makes round trips free, which breaks the sandwich arithmetic above. The
          hook refuses to pump on them by design — pick any non-zero fee tier.
        </p>
      </Callout>

      <H2>Quoting a pump</H2>
      <Code>
        <span className="c">{"// what would the pot do alongside a 1-ETH buy, right now?"}</span>{"\n"}
        (uint256 spend, uint256 minOut) = hook.<span className="g">quotePump</span>(key, 1 ether);
      </Code>
      <P>
        <C>quotePump</C> mirrors the live decision against current pool state — a UI, a bot or a
        test can preview the machine without executing a swap. The live pump enforces{" "}
        <C>minOut</C> on itself: if execution would deliver less, it abandons the round (
        <C>QuoteMismatch</C> semantics) rather than overpay.
      </P>
    </>
  );
}

/* --------------------------------------------------------- 07 · shield --- */

export function Shield() {
  return (
    <>
      <Lead>
        On a MAIN → SECONDARY sell, <C>beforeSwap</C> lets the pot absorb the sell at the
        pool&apos;s <B>exact execution price</B> — LP fee and tick impact included. The seller
        receives precisely what the pool would have paid; the pool&apos;s price simply does not
        move; the absorbed main goes to the recipient instead of the curve.
      </Lead>

      <H2>A sell, step by step</H2>
      <Flow
        items={[
          { label: "user swaps MAIN → SECONDARY" },
          { label: "beforeSwap: pot computes the pool's exact fill price", hot: true },
          { label: "pot pays the seller from its balance, takes the MAIN", hot: true },
          { label: "uncovered remainder swaps through the pool normally", note: "only if the pot ran out" },
        ]}
      />
      <P>
        Technically: the shield does not invent a price. It quotes the fill with the{" "}
        <B>identical arithmetic the PoolManager itself runs</B> when it executes a swap (a thin
        wrapper over Uniswap&apos;s own <C>computeSwapStep</C>), against live <C>slot0</C> and
        liquidity. It then returns a <C>BeforeSwapDelta</C> that shrinks the pool leg by exactly{" "}
        <C>(absorbed, paid)</C>: the pot takes the main, settles the secondary, and the pool&apos;s
        reserves and price are untouched — the supply the pot absorbed never reaches the curve. A
        thin pot absorbs its affordable prefix and the remainder executes as a normal swap in the
        same call — <B>partial defense, zero seller friction</B>.
      </P>
      <P>
        The test campaign proves this <B>wei-exact</B>: a hooked pool and a hookless twin (same
        currencies, fee, price, liquidity) pay a seller identical amounts across sell sizes, and a
        fully-absorbed sell leaves the pool&apos;s price <B>bit-identical</B> (invariant PP3).
      </P>

      <H2>Why it can&apos;t be played</H2>
      <Callout tone="pink" title="no reference price to lag">
        <p>
          The shield&apos;s fill price IS the pool&apos;s execution price, read live. Moving spot
          inside your own transaction moves your own fill with it — there is no oracle, no TWAP, no
          gap to arbitrage.
        </p>
      </Callout>
      <P>
        Consider the alternative to see why this matters: a pot that filled at <B>spot</B> (no fee,
        no impact) would be strictly better than the pool — so an attacker would pump spot up
        inside their own transaction and dump into the pot at the inflated price. Pricing at{" "}
        <B>execution</B> removes that edge with no oracle and no TWAP: the audit&apos;s
        manipulation test pushes the price up first and the shield still pays exactly what the
        (manipulated) pool itself would have paid — never a wei more.
      </P>
      <P>
        Because the shield never pays <B>above</B> the pool&apos;s own price, selling into the pot
        is never better than selling into the pool. The pot cannot be drained at a discount — it
        can only ever buy at the market&apos;s own terms. Three more mechanical guards: the shield
        never pays more than the pot holds, never absorbs more than the seller offered, and never
        settles a one-sided fill (if either leg rounds to zero the swap simply goes to the pool).
      </P>
      <Callout tone="warn" title="one input assumption">
        <p>
          Fee-on-transfer or rebasing <B>MAIN</B> tokens should be wrapped before pooling: the
          shield&apos;s pool-exact settlement assumes the main that leaves the PoolManager is the
          main the hook receives. (A fee-on-transfer <B>secondary</B> is fine — donations credit
          what actually arrived.)
        </p>
      </Callout>

      <H2>The math of absorption</H2>
      <P>
        Model the pool locally as its tangent constant-product reserves <C>(x, y)</C> at the live
        price (<C>x = L/√P</C> of main, <C>y = L·√P</C> of secondary), fee <C>f</C>. A sell of{" "}
        <C>s</C> main pays out along the curve:
      </P>
      <Code title="what the pool pays — and therefore what the shield pays">
        quote(s) = (1−f)·s·y / (x + (1−f)·s){"\n\n"}
        <span className="c">{"// fee applied, impact included: dquote/ds is strictly decreasing,"}</span>{"\n"}
        <span className="c">{"// so a bigger sell earns a worse average price — on the pool AND on the pot."}</span>
      </Code>
      <P>
        The shield pays <B>exactly</B> <C>quote(s)</C> — computed by the identical{" "}
        <C>computeSwapStep</C> arithmetic, tick-precise where the constant-product sketch above is
        the intuition. Seller indifference is therefore an <B>identity, not an approximation</B>:{" "}
        <C>payout_shield(s) ≡ payout_pool(s)</C>, wei-exact, proven against a hookless twin across
        sell sizes.
      </P>
      <H3>Partial absorption — the price only sees the overflow</H3>
      <Code title="pot affords a prefix a of a sell s">
        seller receives{"   "}= quote(a){"  "}+{"  "}pool-executes(s − a){"\n"}
        price move{"        "}∝ (s − a){"    "}<span className="c">{"// not s — the absorbed prefix never touches the curve"}</span>{"\n\n"}
        <span className="c">{"// defense factor: the down-move shrinks by a/s."}</span>{"\n"}
        <span className="c">{"// full absorb (a = s): price is bit-identical before and after the sell."}</span>
      </Code>
      <P>
        Because the pool leg of a partial fill starts from an <B>un-moved</B> price, the
        seller&apos;s blended payout is never worse than the hookless pool — marginally better, in
        fact, which is the one bounded economic surface a self-sandwicher can rent (written up
        honestly as{" "}
        <a className="text-magenta underline" href="/docs/security">GH-1, posture 3</a>: bounded by
        the pot&apos;s affordability, fair-priced for the pot in every posture).
      </P>

      <H2>What the shield achieves economically</H2>
      <P>
        Absorbed supply <B>never reaches the curve</B>: the sell that would have pushed the price
        down is converted into pot inventory delivered to the recipient (or burned). For holders
        this reads as downside doing less damage while the pot lasts; for the seller nothing changes
        at all. The pot is a bid wall that costs nothing to cross and cannot be spoofed — it pays
        out exactly at market.
      </P>

      <H2>Quoting the shield</H2>
      <Code>
        <span className="c">{"// how much of a 1000-token sell would the pot absorb right now?"}</span>{"\n"}
        (uint256 absorbed, uint256 paid) ={"\n"}
        {"  "}hook.<span className="g">quoteShield</span>(key, -1000e18);{" "}
        <span className="c">{"// negative = exact input (V4 convention)"}</span>
      </Code>
      <P>
        Returns zeros when the pot is unconfigured, empty, or the direction isn&apos;t the shielded
        one — safe to call blindly from UIs and routers.
      </P>
    </>
  );
}

/* ------------------------------------------------------- 08 · delivery --- */

export function Delivery() {
  return (
    <>
      <Lead>
        Everything the pot buys or absorbs must go <B>somewhere</B> — and no destination, however
        hostile, may ever revert the swap that carried it. This chapter is the full delivery
        pipeline: the burn cascade, parked deliveries, and the held-forever ledger.
      </Lead>

      <H2>The two framing rules</H2>
      <Callout tone="warn" title="a native main can never burn">
        <p>
          The network token has no supply to destroy, so <C>initPot</C> and <C>setRecipient</C>{" "}
          reject <C>address(0)</C> when main is native — a native-main pot always names a live
          recipient.
        </p>
      </Callout>
      <Callout tone="good" title="a refused delivery is never lost">
        <p>
          A live recipient that bounces the transfer (a blocklist, a reverting <C>receive()</C>)
          parks the main on the hook, booked per pool in <C>parkedDirectOf</C>. Anyone may retry it
          any time with <C>flushDirect(poolId)</C> — it pays the pot&apos;s <B>current</B>{" "}
          recipient. Native main is pushed with a 30,000-gas stipend so a hostile treasury can never
          brick the carrying swap.
        </p>
      </Callout>

      <H2>The burn cascade</H2>
      <P>
        When the recipient is <C>address(0)</C>, a burn runs a cascade — cheapest and most final
        first:
      </P>
      <Flow
        items={[
          { label: "1 · native burn — the token's own burn(amount)", hot: true, note: "accepted only on a verified balance drop" },
          { label: "2 · dead route — transfer to 0xdEaD" },
          { label: "3 · held forever — custody on the hook itself", note: "no withdrawal path exists — custody IS the burn" },
        ]}
      />
      <P>
        Step 3 exists for deliberately &quot;weird&quot; tokens — a blocklisted dead address, no
        burn function. The amount is booked in <C>heldOf</C> and is out of circulation as surely as
        a <C>0xdEaD</C> balance: the hook has <B>no withdrawal path of any kind</B> for it. On the
        first fall-through the asset is flagged unburnable, and every later burn of it settles
        straight to the held ledger without re-running the probes.
      </P>
      <Callout tone="pink" title="why the terminal hold is deliberate">
        <p>
          It can look like stranding; it is the opposite. The alternative — any retrieval path,
          however gated — would be a burn <B>someone can reverse</B>, and a reversible burn is not
          a burn. Custody with provably no exit is the strongest destruction available for a token
          that refuses both of its own exits. Step 1&apos;s native burn is also verified, not
          trusted: it is accepted only on a <B>measured balance drop</B>, so a token faking its
          burn function falls through the cascade instead of pretending.
        </p>
      </Callout>

      <H2>The delivery modes, named</H2>
      <T
        head={["mode", "meaning"]}
        rows={[
          [<C key="1">DIRECT</C>, "sent straight to the pot's live recipient"],
          [<C key="2">BURNED</C>, <span key="v2">burned through the token&apos;s own <C>burn(amount)</C></span>],
          [<C key="3">DEAD</C>, <span key="v3">transferred to <C>0xdEaD</C></span>],
          [<C key="4">HELD</C>, "neither burnable nor dead-sendable: held on the hook forever, out of circulation by custody"],
          [<C key="5">PARKED</C>, <span key="v5">a refused live-recipient delivery — retryable by anyone via <C>flushDirect</C></span>],
          [<C key="6">COMPOUNDED</C>, <span key="v6">credited to the LP program&apos;s carry by the buyback split — becomes pool liquidity on the next harvest (see <B>Buy back management</B>)</span>],
        ]}
      />
      <P>
        Every delivery emits <C>Delivered(poolId, to, amount, mode)</C>, so an indexer can account
        for every unit of main the machine ever moved.
      </P>

      <H2>Full attribution — the solvency view</H2>
      <Code>
        <span className="g">obligationOf</span>(asset) ={"\n"}
        {"    "}Σ every pot holding it{"\n"}
        {"  "}+ everything parked or held in it{"\n"}
        {"  "}+ every harvest leg booked for a recipient ({"owedOf"}){"\n"}
        {"  "}+ every program&apos;s compound carry in it{"\n\n"}
        <span className="c">{"// the hook's balance of `asset` always covers this —"}</span>{"\n"}
        <span className="c">{"// every unit the hook holds is attributed to somebody."}</span>
      </Code>
    </>
  );
}

/* --------------------------------------------- 08b · buyback management --- */

export function BuybackManagement() {
  return (
    <>
      <Lead>
        The pot decides <B>how much</B> main to buy; the LP program&apos;s operator decides{" "}
        <B>what happens to it</B>. The buyback split carves every pot purchase — pump or shield
        alike — into three legs: a share that <B>compounds into the pool&apos;s own liquidity</B>, a
        share that <B>burns</B>, and the exact rest that follows the pot&apos;s recipient. Two
        sliders, and the buyback stops being just a payout: it becomes a flywheel.
      </Lead>

      <H2>The waterfall</H2>
      <Flow
        items={[
          { label: "the pot buys (pump) or absorbs (shield) an amount of MAIN", hot: true },
          { label: "potCompoundShareWad → credited to the program's carry", note: "waiting LP budget — minted into the position on the next harvest" },
          { label: "potBurnShareWad → the burn cascade", note: "burn() → 0xdEaD → held-forever, exactly the delivery chapter's walk" },
          { label: "the exact rest → the pot's recipient", note: "a live address is delivered to; address(0) burns; a refusal parks" },
        ]}
      />
      <P>
        Shares are WAD fractions of the output (<C>1e18</C> = 100%), floored individually; the rest
        is computed by <B>subtraction</B>, so the three legs always sum to the output to the wei.
        Both shares at zero is the classic behaviour bit-for-bit: the whole purchase follows the
        pot&apos;s recipient.
      </P>

      <H2>Who sets it, and the rules at set-time</H2>
      <P>
        The two shares live in the same <C>ProgramConfig</C> as the LP fee split, and follow the
        same law: <B>only the program&apos;s operator can edit them</B>, via{" "}
        <C>setProgramConfig</C> or up-front in <C>addLiquidityAdvanced</C> / <C>launchPool</C>.
        Plain <C>addLiquidity</C> names its owner as BOTH owner and operator with every share at
        zero — nothing is armed behind your back, and the owner can opt in later. Zeroing the
        operator (<C>setProgramOperator(id, address(0))</C>) freezes the split forever, sliders
        included.
      </P>
      <T
        head={["rule", "why"]}
        rows={[
          [<C key="1">potCompound + potBurn ≤ 100%</C>, "the two carve-outs can never exceed the output"],
          [<C key="2">potBurn = 0 on a native main</C>, "the network token has no supply to destroy — same law as the pot's own recipient rule"],
          ["a program must exist", "no program means both shares read zero: the whole output follows the pot's recipient"],
        ]}
      />

      <H2>The compound leg — buyback becomes liquidity</H2>
      <P>
        The compounded share is credited to the program&apos;s <C>carryMain</C> — the same carry
        the autocompounder already uses for mint remainders. It is <B>not</B> minted mid-swap
        (minting inside the carrying swap&apos;s unlock would re-enter the PoolManager); it waits,
        custody-covered and attributed in <C>obligationOf</C>, and the next harvest folds it into
        the mint budget alongside that harvest&apos;s own compound slice. The result is a loop the
        machine could not close before:
      </P>
      <Code title="the flywheel">
        fees fuel the pot → the pot buys MAIN on real buys{"\n"}
        → a share of every purchase becomes pool liquidity{"\n"}
        → deeper liquidity → less impact per trade → more volume fits{"\n"}
        → more fees fuel the pot ...
      </Code>
      <Callout tone="good" title="it survives a full exit">
        <p>
          Remove ALL program liquidity and the pot keeps pumping — the compound legs keep
          accumulating as carry. Re-add any liquidity later and the next harvest mints the whole
          waiting budget. Nothing leaks, nothing strands; this exact cycle is a test (
          <C>SP9</C>).
        </p>
      </Callout>

      <H2>The burn leg and the rest</H2>
      <P>
        The burn leg walks the <B>same verified cascade</B> as a burn-intent pot: the token&apos;s
        own <C>burn(amount)</C> accepted only on a measured balance drop, then <C>0xdEaD</C>, then
        the held-forever ledger. And when the pot&apos;s recipient is itself <C>address(0)</C>, the
        machine doesn&apos;t walk the cascade twice — the burn share and the rest merge into{" "}
        <B>one</B> cascade walk. On a native main the burn slider is locked at zero, but the
        compound slider still works: an ETH-main program can compound its buybacks even though it
        can&apos;t burn them.
      </P>

      <H2>Recipes</H2>
      <T
        head={["intent", "potCompound", "potBurn", "pot recipient"]}
        rows={[
          ["classic burn-everything", "0%", "0%", <C key="r1">address(0)</C>],
          ["classic treasury payout", "0%", "0%", "your treasury"],
          ["the flywheel — buyback → liquidity", "50–100%", "0%", "anything"],
          ["burn AND deepen", "50%", "50%", "anything (nothing reaches it)"],
          ["mostly burn, some liquidity", "25%", "0%", <C key="r2">address(0)</C>],
        ]}
      />

      <H2>Never-stop, unchanged</H2>
      <P>
        The split adds <B>zero</B> new ways to revert a swap. The carry credit is pure accounting
        (it cannot fail); the burn leg already fails sideways to the held ledger; the delivered
        rest already fails sideways to the parked ledger; and the whole placement still runs inside
        the same <C>try/catch</C> isolation as before. The adversarial matrix for the new legs — a
        refusing recipient, an unburnable main under a burn share, a hostile native recipient, a
        re-entering recipient — is the <C>NS</C> series of the <C>GlueHookPotSplit</C> suite, and
        the split is exercised against live PoolManagers on Ethereum and Tempo in the fork suite.
      </P>
      <Stats
        items={[
          { v: "2", l: "new sliders — same operator, same struct" },
          { v: "0", l: "new swap-revert paths" },
          { v: "1", l: "settlement identity: comp + burn + rest = output" },
        ]}
      />
    </>
  );
}

/* -------------------------------------------------------- 09 · harvest --- */

export function Harvest() {
  return (
    <>
      <Lead>
        The pool&apos;s LP program accrues swap fees on both sides. A harvest — automatic inside
        swaps once fees pass your minimums, or manual — splits each side <B>from the gross</B>, so
        the percentages mean exactly what they say.
      </Lead>

      <H2>The waterfall, per side</H2>
      <Cols>
        <Panel label="SECONDARY-side fees (gross)">
          <Flow
            items={[
              { label: "compoundShare → the LP budget", hot: true },
              { label: "buybackShare → credited to the pool's own pot", hot: true },
              { label: "the exact rest → secondaryRecipient" },
            ]}
          />
          <p className="mono mt-3 text-[11px] text-dim2">compound + buyback ≤ 100%, enforced at set-time</p>
        </Panel>
        <Panel label="MAIN-side fees (gross)">
          <Flow
            items={[
              { label: "compoundShare → the LP budget", hot: true },
              { label: "burnShare → the burn cascade", hot: true },
              { label: "the exact rest → mainRecipient" },
            ]}
          />
          <p className="mono mt-3 text-[11px] text-dim2">compound + burn ≤ 100% · burn must be 0 on a native main</p>
        </Panel>
      </Cols>

      <P>
        Shares are WAD-scaled (<C>1e18</C> = 100%). A side whose two shares sum below 100%{" "}
        <B>must name a live recipient</B> — below-100% means a remainder can exist, and value never
        goes nowhere. All of it is validated when the config is set, not discovered at harvest time.
        The exact formulas, the rounding direction and the conservation proof live in{" "}
        <a className="text-magenta underline" href="/docs/harvest-math">The split math</a>; what
        happens when a recipient refuses its leg lives in{" "}
        <a className="text-magenta underline" href="/docs/harvest-payouts">Payouts &amp; the owed ledger</a>.
      </P>

      <H2>Auto vs manual</H2>
      <T
        head={["path", "trigger", "who", "gas"]}
        rows={[
          [
            <B key="a">auto-harvest</B>,
            <span key="t1">a swap, once either side&apos;s pending fees reach its <C>minMain</C> / <C>minSecondary</C></span>,
            "inherently public — any swap triggers it",
            "hard budget; a heavy run reverts atomically (fees stay safe) and waits for the manual path",
          ],
          [
            <B key="m">manual harvest(key)</B>,
            "a direct call, any time",
            <span key="t2">owner-only, unless <C>publicHarvest</C> opens it to anyone</span>,
            "the caller's full gas — the natural path for heavy tokens",
          ],
        ]}
      />
      <P>
        <C>type(uint256).max</C> on a minimum disarms that side&apos;s auto-trigger. Both paths run
        the <B>same split code</B> — the rules apply identically whether the machine fired itself
        or someone called it.
      </P>

      <H2>Choosing the minimums</H2>
      <P>
        <C>minMain</C> / <C>minSecondary</C> are a pure economics dial: every auto-harvest costs
        the triggering swapper some gas overhead, so the minimums decide the trade-off between
        harvest freshness and per-swap cost. Set them so a typical harvest is comfortably worth
        more than the gas it rides on; on a quiet pool, higher minimums plus an occasional manual{" "}
        <C>harvest(key)</C> is the cheapest shape. Since both paths run identical code, no value is
        ever at stake in this choice — only timing.
      </P>

      <Callout tone="good" title="swaps are never held hostage">
        <p>
          The auto-harvest runs under a <B>hard gas budget</B> in its own frame: a run that would
          exceed it reverts atomically — fees stay pending, nothing is half-split — and the
          carrying swap completes untouched. A pool with pathological tokens simply gravitates to
          the manual path; it can never make trading worse.
        </p>
      </Callout>

      <H2>Go deeper</H2>
      <P>
        The next two chapters take the split apart:{" "}
        <a className="text-magenta underline" href="/docs/harvest-math">The split math</a> derives
        every leg, the rounding direction and the conservation identity;{" "}
        <a className="text-magenta underline" href="/docs/harvest-payouts">Payouts &amp; the owed
        ledger</a> follows the money out of the hook — including what happens when a recipient
        refuses it.
      </P>
    </>
  );
}

/* -------------------------------------------------------- harvest math --- */

export function HarvestMath() {
  return (
    <>
      <Lead>
        Five numbers in, five legs out, and an identity that holds to the wei: every harvest is a
        pure function of the gross fees and the four WAD shares — floors on the shares, exact
        subtraction on the remainders, dust always landing with a named recipient.
      </Lead>

      <H2>The five legs, derived</H2>
      <P>
        Every share is WAD-scaled (<C>1e18</C> = 100%), and every share leg is the <B>floor</B> of
        its WAD product against the gross of its own side. The two recipient legs are then computed
        by <B>subtraction</B>, never by a third multiplication:
      </P>
      <Code title="one harvest of fMain + fSec, under (compound, buyback, burn)">
        cMain{"  "}= ⌊fMain · compoundShareWad / 1e18⌋{"\n"}
        cSec{"   "}= ⌊fSec{"  "}· compoundShareWad / 1e18⌋{"\n"}
        fueled = ⌊fSec{"  "}· buybackShareWad{"  "}/ 1e18⌋{"   "}<span className="c">{"// → the pool's own pot"}</span>{"\n"}
        burned = ⌊fMain · burnShareWad{"     "}/ 1e18⌋{"   "}<span className="c">{"// → the burn cascade"}</span>{"\n\n"}
        secondaryRecipient ← fSec{"  "}− cSec{"  "}− fueled{"  "}<span className="c">{"// exact — dust lands here"}</span>{"\n"}
        mainRecipient{"      "}← fMain − cMain − burned
      </Code>
      <Callout tone="pink" title="why subtraction and not a third multiply">
        <p>
          If the remainder were computed as <C>⌊gross · restShareWad / 1e18⌋</C>, three independent
          floors could under-count the gross by up to 2 wei per side, every harvest — value slowly
          orphaned on the hook. Subtraction makes conservation <B>structural</B>: the legs sum to
          the gross byte-for-byte because the last leg is <B>defined</B> as whatever makes them.
        </p>
      </Callout>

      <H2>The conservation identity</H2>
      <Code title="holds for every harvest, every config — fuzzed over 512 arbitrary share pairs">
        cMain + burned + mainRecipientLeg{"  "}≡ fMain{"\n"}
        cSec{"  "}+ fueled + secondaryRecipientLeg ≡ fSec{"\n\n"}
        <span className="c">{"// no leg is ever re-derived after a failure: a bounced push books"}</span>{"\n"}
        <span className="c">{"// the IDENTICAL amount as owed — the identity survives refusals too."}</span>
      </Code>
      <P>
        The floors always round <B>against</B> the automated legs and <B>toward</B> the named
        recipient — division dust is at most 1 wei per share leg per harvest, it lands in a real
        address&apos;s pocket, and it is never minted and never lost. The stateful fuzz campaign
        interleaves harvests with pumps and shields in the same frames — exactly where a
        bookkeeping slip between the ledgers would hide — and the identity holds throughout.
      </P>

      <H2>The set-time validation, per side</H2>
      <T
        head={["rule", "why it exists"]}
        rows={[
          [
            <C key="a">compound + buyback ≤ 1e18 (secondary) · compound + burn ≤ 1e18 (main)</C>,
            "shares over 100% would make the subtraction underflow — rejected at write time, not discovered mid-harvest",
          ],
          [
            <span key="b">shares sum <B>below</B> 100% ⟹ that side&apos;s recipient must be live</span>,
            "below-100% means a remainder can exist, and value never goes nowhere",
          ],
          [
            <span key="c"><C>burnShare</C> must be 0 when main is native</span>,
            "the network token has no supply to destroy — the config is rejected rather than the burn silently failing later",
          ],
        ]}
      />
      <P>
        Because everything is checked when <C>setProgramConfig</C> writes the rules, harvest-time
        is <B>calculation only</B> — there is no configuration state a harvest can discover to be
        invalid, which is one of the reasons a swap can carry one safely.
      </P>

      <H2>Edits and their timing</H2>
      <P>
        A config edit is <B>forward-only</B>: fees already pending under the old rules are still
        split by whatever config is live at the moment the harvest actually runs — the split is a
        function of <C>(gross, config-now)</C>, with no memory. If precise attribution across a
        rule change matters to you, harvest manually first, then edit.
      </P>
    </>
  );
}

/* ----------------------------------------------------- harvest payouts --- */

export function HarvestPayouts() {
  return (
    <>
      <Lead>
        The split decides who is owed what; this chapter is how the money actually leaves. One
        design rule governs all of it: <B>a recipient&apos;s behaviour is never allowed to become
        the pool&apos;s problem</B> — refusals book, they don&apos;t revert.
      </Lead>

      <H2>The push, bounded</H2>
      <Flow
        items={[
          { label: "harvest books every leg first — checks-effects-interactions", note: "state is final before the first external call" },
          { label: "push to the recipient with bounded gas", hot: true },
          { label: "success → Paid(to, asset, amount)" },
          { label: "refusal → the exact amount books to the owed ledger", hot: true, note: "Owed(to, asset, amount) — the harvest continues" },
        ]}
      />
      <P>
        Native legs are pushed with a fixed 30,000-gas stipend, ERC20 legs with a normal transfer —
        either way a hostile or merely heavy recipient (a blocklist, a reverting <C>receive()</C>,
        a gas-guzzling callback) cannot brick the harvest or the swap carrying it. The refused
        amount is booked in a per-<C>(recipient, asset)</C> ledger, <B>identical to the wei</B> to
        the leg that bounced — nothing is re-derived after a failure.
      </P>

      <H2>The owed ledger</H2>
      <Code title="two ways out — both permissionless for the money's rightful owner">
        <span className="c">{"// 1 · it folds itself into the next successful push automatically:"}</span>{"\n"}
        next payout to (to, asset){"  "}={"  "}new leg + owedOf(to, asset){"\n\n"}
        <span className="c">{"// 2 · or the recipient pulls it, any time, with FULL gas:"}</span>{"\n"}
        hook.<span className="g">claim</span>(asset);{" "}
        <span className="c">{"// msg.sender's whole owed balance — reverts on failure, caller chose the destination"}</span>
      </Code>
      <Callout tone="good" title="owed money is real money">
        <p>
          Every owed booking is a term of the hook&apos;s <C>obligationOf(asset)</C> accounting,
          and the hook&apos;s balance covers that sum at all times — the solvency invariant of the
          whole delivery system. &quot;Owed&quot; is a parking state, never a haircut.
        </p>
      </Callout>

      <H2>Why pull-over-push is the right default</H2>
      <P>
        The push-first, book-on-refusal shape gives well-behaved recipients zero friction (money
        just arrives) while making hostile ones <B>pay for their own hostility</B>: the only party
        inconvenienced by a reverting treasury is the treasury. Compare the alternatives — pushing
        with full gas lets one recipient revert everyone&apos;s harvest; pulling exclusively makes
        every honest treasury run a claim bot. The hybrid is strictly better than both.
      </P>

      <H2>What to index</H2>
      <Code title="the payout event surface">
        <span className="g">Harvested</span>(poolId, mainFees, secondaryFees, burned, fueled){"\n"}
        <span className="g">Compounded</span>(poolId, liquidity, amount0Used, amount1Used){"\n"}
        <span className="g">Paid</span>(to, asset, amount){"\n"}
        <span className="g">Owed</span>(to, asset, amount){"  "}<span className="c">{"// a refusal — watch these to know when to claim()"}</span>
      </Code>
      <P>
        A dashboard that sums <C>Paid + Owed</C> per recipient reconstructs every wei a program
        ever distributed; <C>owedOf(to, asset)</C> is the live outstanding balance at any moment.
      </P>
    </>
  );
}

/* ------------------------------------------------------- 10 · compound --- */

export function Compound() {
  return (
    <>
      <Lead>
        The compound share is the auto-compounding concentrated-liquidity venues never gave LPs,
        selectable as a simple percentage: at every harvest, the budget of both sides is re-minted
        into the program&apos;s <B>own position</B> at the live price. What doesn&apos;t fit is
        never lost — it <B>carries</B>.
      </Lead>

      <H2>The mint attempt</H2>
      <P>
        A concentrated-liquidity mint needs both sides in the ratio the current price dictates —
        so the compound is a mint <B>attempt</B>: whichever side binds caps it, and part of the
        budget may not fit this time. Whatever the mint does not consume — on either side — is
        saved on the hook (<C>carryMain</C> / <C>carrySecondary</C>) and added to the{" "}
        <B>next</B> harvest&apos;s compound budget.
      </P>
      <Flow
        items={[
          { label: "harvest: compound budget = this slice + the standing carry" },
          { label: "mint at the live price — whichever side binds caps it", hot: true },
          { label: "consumed budget → liquidity in the program's position", hot: true },
          { label: "unconsumed budget → the carry, retried next harvest", note: "never leaks to the pot or a recipient" },
        ]}
      />

      <Callout tone="good" title="the carry's three guarantees">
        <p>
          It <B>retries forever</B> — every future harvest adds the carry to its budget. It{" "}
          <B>never leaks</B> — carried value can only ever become liquidity. And it{" "}
          <B>never double-counts</B> — fuel that a harvest already sent to the pot sits in the pot,
          not in the next compound.
        </p>
      </Callout>

      <P>
        The mint runs in its <B>own isolated frame</B> with a hard budget check: it can never
        consume more than its budget (the execution is abandoned if a quote and its settlement ever
        disagree), and a revert simply leaves the whole budget in the carry — the harvest never
        blocks on the compound. The carry is updated from the mint&apos;s <B>real settlement
        deltas</B>, not re-derived from a second multiplication, so over any sequence of harvests
        the compound slices equal the mint consumption plus the final carry, per side, to the wei
        (fuzzed as FM12, 512 runs).
      </P>
      <P>
        A config edit only changes how <B>future</B> harvests split; the standing carry keeps
        retrying under the new rules. Even a harvest with zero new fees will retry a standing
        carry. And because the carry is a per-asset term of the hook&apos;s{" "}
        <C>obligationOf</C> accounting, custody covers it at all times.
      </P>

      <H2>Why this matters</H2>
      <P>
        With a 50% compound share, half of every fee the pool earns becomes <B>more depth</B>{" "}
        without anyone paying gas for it, deciding when, or running a keeper. Deeper liquidity means
        less slippage, which attracts more volume, which earns more fees — the loop every project
        wants, running by itself between trades. The simulator on the app page lets you replay a
        year of trading with and without it.
      </P>

      <H2>Reading the compound</H2>
      <Code>
        Program p = hook.<span className="g">programOf</span>(poolId);{"\n"}
        p.liquidity{"      "}<span className="c">{"// current position size (only ever grows from compounds)"}</span>{"\n"}
        p.carryMain{"      "}<span className="c">{"// main-side budget waiting to fit"}</span>{"\n"}
        p.carrySecondary{" "}<span className="c">{"// secondary-side budget waiting to fit"}</span>
      </Code>

      <H2>Go deeper</H2>
      <P>
        <a className="text-magenta underline" href="/docs/compound-math">The compounding math</a>{" "}
        derives the two-sided mint constraint and the geometry of growth;{" "}
        <a className="text-magenta underline" href="/docs/compound-strategies">Compound
        strategies</a> is the practical guide to choosing the share and reading the carry.
      </P>
    </>
  );
}

/* ------------------------------------------------------- compound math --- */

export function CompoundMath() {
  return (
    <>
      <Lead>
        Two pieces of math run the compound: the <B>mint constraint</B> — the geometry that decides
        how much of a budget fits and forces the carry to exist — and the <B>growth loop</B> — why
        a percentage of fees re-minted beats the same percentage paid out, compounding into
        exponential depth.
      </Lead>

      <H2>The mint constraint — why the carry must exist</H2>
      <P>
        A concentrated position over <C>[P_lower, P_upper]</C> holding liquidity <C>L</C>, with the
        live price <C>P</C> inside the range, is worth exactly:
      </P>
      <Code title="the amounts one unit of liquidity demands (Uniswap's own formulas)">
        amount0 = L · (√P_upper − √P) / (√P · √P_upper){"   "}<span className="c">{"// the main-or-token0 side"}</span>{"\n"}
        amount1 = L · (√P − √P_lower){"                    "}<span className="c">{"// the other side"}</span>
      </Code>
      <P>
        The ratio <C>amount0 : amount1</C> is fixed by the <B>price alone</B> — but a harvest hands
        the compound two budgets fixed by the <B>fee flow</B>, which follows trading direction, not
        price geometry. Two independent constraints, one liquidity number:
      </P>
      <Code title="the mint solves for the binding side">
        L_minted = min( budget0 / need0-per-L,{"  "}budget1 / need1-per-L ){"\n\n"}
        <span className="c">{"// one side binds and is consumed in full (to rounding);"}</span>{"\n"}
        <span className="c">{"// the other side's remainder CANNOT become liquidity this round."}</span>{"\n"}
        carry += budget − consumed{"   "}<span className="c">{"// per side — the remainder, exactly"}</span>
      </Code>
      <Callout tone="pink" title="the carry is geometry, not a workaround">
        <p>
          No implementation could avoid it: unless the fee flow happens to arrive in the exact
          ratio the live price dictates — measure zero — every compound leaves a one-sided
          remainder. The only design choices are <B>where it waits</B> (on the hook, attributed to
          the program) and <B>when it retries</B> (every future harvest, forever). Swapping the
          remainder into ratio instead would leak value to fees and impact, and open the very MEV
          surface the rest of the machine closes.
        </p>
      </Callout>
      <P>
        If the price has left the range entirely, the position is one-sided — <C>need</C> on the
        abandoned side is zero, the mint consumes only the side the range still wants, and the
        other budget simply carries until the price comes back. Nothing special-cases this; the
        formulas above already say it.
      </P>

      <H2>The conservation identity</H2>
      <Code title="over ANY sequence of harvests, per side, to the wei (fuzzed as FM12, 512 runs)">
        Σ compound slices{"  "}≡{"  "}Σ mint consumption{"  "}+{"  "}final carry{"\n\n"}
        <span className="c">{"// the carry is updated from the mint's REAL settlement deltas,"}</span>{"\n"}
        <span className="c">{"// never re-derived from a second multiplication — so the identity"}</span>{"\n"}
        <span className="c">{"// is structural, and obligationOf custody covers the carry at all times."}</span>
      </Code>

      <H2>The growth loop — compounding vs paying out</H2>
      <P>
        Idealize a pool where each harvest cycle earns fees worth a fraction <C>r</C> of the
        position, and the program compounds share <C>c</C> of them. The position&apos;s value
        obeys:
      </P>
      <Code title="geometric growth from a flat percentage">
        V(n) = V(0) · (1 + c·r)ⁿ{"          "}<span className="c">{"// compounding: exponential"}</span>{"\n"}
        vs{"\n"}
        V(0) + payouts of n·r·V(0){"       "}<span className="c">{"// paying out: the position never grows"}</span>{"\n\n"}
        doubling time{"  "}n_double ≈ ln 2 / (c·r){"  "}cycles{"\n"}
        <span className="c">{"// c = 50%, r = 0.5% per cycle → the position doubles every ~277 cycles,"}</span>{"\n"}
        <span className="c">{"// with zero keeper gas and zero decisions — traffic does all of it."}</span>
      </Code>
      <P>
        The exponent is the whole argument: over enough cycles, <B>any</B> non-zero compound share
        beats <B>any</B> payout-only configuration in depth — and depth is what cuts slippage,
        attracts routing, and earns the next round of fees. The idealization is honest about what
        it ignores (fees scale with volume, not with your liquidity alone; impermanent loss applies
        to the added depth like any LP), which is why the{" "}
        <a className="text-magenta underline" href="/app">app&apos;s simulator</a> replays the loop
        against real parameters instead of a formula.
      </P>
    </>
  );
}

/* ------------------------------------------------- compound strategies --- */

export function CompoundStrategies() {
  return (
    <>
      <Lead>
        One WAD number — the compound share — spans every posture from &quot;pay me everything&quot;
        to a liquidity black hole. This chapter is the practical guide: what each region of the
        dial means, what the 100% corner does, how the range interacts, and how to read the carry
        like a gauge.
      </Lead>

      <H2>The dial, region by region</H2>
      <T
        head={["compoundShare", "posture", "what it implies"]}
        rows={[
          [
            <C key="a">0%</C>,
            <B key="a2">pure payout</B>,
            "the program is a fee router: everything splits between buyback/burn and the recipients. Depth only ever grows when someone adds liquidity by hand.",
          ],
          [
            <C key="b">25–75%</C>,
            <B key="b2">the balanced middle</B>,
            "fees fund both the present (payouts, pot fuel, burns) and the future (depth). 50% is the canonical shape: half of every fee becomes more pool.",
          ],
          [
            <C key="c">100%</C>,
            <B key="c2">the black-hole corner</B>,
            "every harvested wei either becomes liquidity now or waits in the carry to become liquidity later. No recipient is even required — there is no remainder to name one for.",
          ],
        ]}
      />
      <Callout tone="info" title="the 100% corner, precisely">
        <p>
          <C>compound + buyback ≤ 100%</C> (secondary) and <C>compound + burn ≤ 100%</C> (main)
          mean a 100% compound share forces the other shares to zero, and the remainder legs
          vanish — the set-time validation drops the live-recipient requirement because value can
          no longer flow to one. Pair it with a surrendered owner and the pool&apos;s fees are{" "}
          <B>provably incapable of ever leaving the pool</B>.
        </p>
      </Callout>

      <H2>How the range changes the game</H2>
      <T
        head={["range", "compounding behaviour"]}
        rows={[
          [
            <B key="f">full range</B>,
            "always in range, so every compound is two-sided and the carry stays small — the set-and-forget shape, and what launchPool's (0,0) gives you.",
          ],
          [
            <B key="c">concentrated</B>,
            "each unit of budget buys MORE depth near the price (that's the point of concentration) — but when the price leaves the range, compounds go one-sided and the abandoned side's carry grows until the price returns.",
          ],
        ]}
      />
      <P>
        The range is fixed at program creation, so this is a launch-time decision: full range
        optimizes for the compound loop&apos;s consistency, a tight range optimizes each
        mint&apos;s depth-per-wei at the cost of carry volatility. Neither is wrong — they are
        different products.
      </P>

      <H2>Reading the carry like a gauge</H2>
      <Code title="the two numbers to watch">
        p.carryMain{"       "}<span className="c">{"// main-side budget waiting to fit"}</span>{"\n"}
        p.carrySecondary{"  "}<span className="c">{"// secondary-side budget waiting to fit"}</span>
      </Code>
      <T
        head={["reading", "what it tells you"]}
        rows={[
          ["both small, both turning over", "healthy: fee flow roughly matches the price's ratio, mints consume nearly everything"],
          ["one side large and growing", "fee flow is directional (heavy one-way volume) or the price has drifted from your range's center — the mint keeps binding on the same side"],
          ["both large, liquidity flat", "the price is outside a concentrated range — compounds are waiting for it to come back (or the pool is simply quiet)"],
        ]}
      />
      <P>
        A standing carry is never stuck value — every future harvest retries it, even a harvest
        with zero new fees — but it IS information: persistent one-sided carry on a concentrated
        range is the machine telling you the range no longer matches the market. The lever is the
        owner&apos;s, not the machine&apos;s: liquidity choices stay human, budgets stay automated.
      </P>

      <H2>Sizing the share against your goals</H2>
      <P>
        The share competes with the pot and the recipients for the same gross, so set it from the
        goal backwards: a <B>launch</B> wanting a price floor leans buyback-heavy (the pot works
        immediately, depth pays off later); a <B>mature pool</B> wanting routing share leans
        compound-heavy (depth is what aggregators price); a <B>treasury-funded</B> project can run
        100% compound and let donations do the buyback work. And because the operator can retune
        the shares at any time (until surrendered), the dial is a strategy, not a commitment —{" "}
        <a className="text-magenta underline" href="/docs/manage">Manage your program</a> walks
        through the edit path.
      </P>
    </>
  );
}

/* ---------------------------------------------------------- 11 · roles --- */

export function Roles() {
  return (
    <>
      <Lead>
        Three roles, three scopes, and a deliberate design rule: <B>each surrenders on its own
        terms</B>. Nobody is ever forced to give up the pool just to lock the rules — or to freeze
        the rules just to lock the pool.
      </Lead>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {[
          {
            t: "pot admin",
            c: "#17b512",
            who: "whoever initialized the pool on the PoolManager",
            can: ["initPot — declare MAIN + recipient (one-shot)", "setRecipient (0x0 = burn)", "create the pool's ONE LP program"],
            zero: "fixed at pool creation — there is no admin transfer, and no admin power over balances",
          },
          {
            t: "program owner",
            c: "#7ab800",
            who: "an explicit parameter at program creation",
            can: ["add / remove liquidity", "harvest (when not public)", "transferProgramOwnership"],
            zero: "owner = 0x0 → liquidity locked FOREVER, manual harvest forced public",
          },
          {
            t: "program operator",
            c: "#00987f",
            who: "starts as the owner; moves via setProgramOperator",
            can: ["setProgramConfig — shares, recipients, minimums", "toggle publicHarvest", "reassign itself"],
            zero: "operator = 0x0 → the split rules are frozen forever, owner untouched",
          },
        ].map((r) => (
          <div key={r.t} className="panel p-5">
            <div className="label mb-1" style={{ color: r.c }}>{r.t}</div>
            <div className="mono mb-3 text-[10.5px] leading-relaxed text-dim2">{r.who}</div>
            <ul className="mono space-y-1.5 text-[11.5px] text-dim">
              {r.can.map((x) => (
                <li key={x}>· {x}</li>
              ))}
            </ul>
            <div className="mono mt-3 rounded-lg border border-[var(--line)] bg-bg/40 px-2.5 py-2 text-[10.5px] text-dim2">
              {r.zero}
            </div>
          </div>
        ))}
      </div>

      <Callout tone="pink" title="the hook itself is ownerless">
        <p>
          No role above has power over the hook — only over their own pool&apos;s pot or program.
          There is no global admin, no pause switch, no fee switch, no upgrade path.
        </p>
      </Callout>

      <H2>Owner vs operator — why two roles</H2>
      <P>
        The <B>owner</B> holds the property: liquidity, harvests, and the right to transfer or
        surrender. The <B>operator</B> edits the rules: the split shares, the recipients, the
        minimums, the harvest gate. Splitting them makes the two most-wanted trust promises{" "}
        <B>independent</B>:
      </P>
      <T
        head={["promise", "how", "what survives"]}
        rows={[
          [
            <B key="a">immutable fees, keep the LP</B>,
            <span key="v">set the config, then <C>setProgramOperator(poolId, address(0))</C></span>,
            "the owner still adds, removes and harvests — under rules nobody can ever change",
          ],
          [
            <B key="b">locked LP, keep the levers</B>,
            <span key="v2"><C>transferProgramOwnership(poolId, address(0))</C></span>,
            "the liquidity is locked forever and harvest is forced public — but a live operator can still tune the split",
          ],
          [
            <B key="c">full surrender at birth</B>,
            <span key="v3"><C>addLiquidityAdvanced(…, owner = address(0), config)</C></span>,
            "rules nobody can edit, liquidity nobody can pull, harvest public — trustless from block one",
          ],
        ]}
      />

      <H2>Custody is composable</H2>
      <P>
        Richer policy — timelocks, vesting, DAO control — is built <B>on top</B> by making such a
        contract the owner: a locker simply becomes the owner and implements whatever release
        schedule it wants. The hook doesn&apos;t need to know; ownership is just an address. See{" "}
        <a className="text-magenta underline" href="/docs/build-apps">Build launchers &amp; apps</a>.
      </P>
    </>
  );
}
