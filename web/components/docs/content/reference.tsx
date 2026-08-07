/** Reference — chapters 17–19. */

import {
  B, C, Callout, Code, H2, H3, Lead, P, Stats, T,
} from "../ui";

/* ------------------------------------------------------------ 17 · api --- */

function Fn({
  sig,
  who,
  children,
}: {
  sig: string;
  who: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel mb-4 p-5">
      <div className="mono mb-2 overflow-x-auto whitespace-pre text-[12px] font-bold text-txt">{sig}</div>
      <div className="mono mb-2 inline-block rounded-full border border-[var(--line)] bg-bg/50 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-teal">
        {who}
      </div>
      <div className="text-[13px] leading-relaxed text-dim [&>p]:mb-2 [&>p:last-child]:mb-0">{children}</div>
    </div>
  );
}

export function Api() {
  return (
    <>
      <Lead>
        The complete external surface of <C>IGlueHook</C> — every function with who may call it,
        the structs, the events and the errors. The interface source is{" "}
        <a
          className="text-magenta underline"
          href="https://github.com/glue-finance/GlueHook/blob/main/contracts/interfaces/IGlueHook.sol"
          target="_blank"
          rel="noreferrer"
        >
          IGlueHook.sol
        </a>
        .
      </Lead>

      <H2>Launch & pot configuration</H2>
      <Fn
        sig="launchPool(key, sqrtPriceX96, main, recipient, tickLower, tickUpper, liquidity, owner, config) payable → (amount0, amount1)"
        who="anyone, on a pool that does not exist yet"
      >
        <p>
          The whole launch in one transaction: initializes the pool (the caller becomes the pot
          admin), declares the roles and creates the seeded LP program — same validation, events
          and funding rules as the standalone entries. <C>(0,0)</C> ticks = full range; ERC20
          sides settle from the caller&apos;s allowance, a native side (if the pool has one) via{" "}
          <C>msg.value</C> with excess refunded.
        </p>
      </Fn>
      <Fn sig="initPot(key, main, recipient)" who="the pool's initializer, once">
        <p>
          Declares the roles; the key&apos;s other currency becomes secondary automatically. Until
          this runs the hook is passive on the pool. A native main rejects burn intent
          (<C>address(0)</C> recipient).
        </p>
      </Fn>
      <Fn sig="setRecipient(poolId, recipient)" who="the pot admin">
        <p>
          Moves the delivery target. <C>address(0)</C> = burn (ERC20 main only); anything else is a
          literal target.
        </p>
      </Fn>
      <Fn sig="donate(key, amount) payable → credited" who="anyone">
        <p>
          Funds the pot in its SECONDARY currency. Native: <C>amount == msg.value</C>. ERC20:
          approve first; the credit is the <B>measured balance delta</B> (fee-on-transfer safe).
          Irreversible.
        </p>
      </Fn>
      <Fn sig="flushDirect(poolId) → delivered" who="anyone">
        <p>
          Retries a delivery the pot&apos;s live recipient refused; pays the pot&apos;s{" "}
          <B>current</B> recipient. Reverts if nothing is parked, the pot moved to burn intent, or
          the recipient refuses again (the park stays intact).
        </p>
      </Fn>

      <H2>LP program — liquidity</H2>
      <Fn sig="addLiquidity(key, tickLower, tickUpper, liquidity, owner) payable → (amount0, amount1)" who="the pot admin, once per pool">
        <p>
          Creates the program with <B>everything off</B>: zero shares, recipients defaulting to the
          owner, auto-harvest disarmed. The owner must be live here (the defaults point at it). Tick
          range fixed forever; <C>(0,0)</C> = full range.
        </p>
      </Fn>
      <Fn sig="addLiquidityAdvanced(key, tickLower, tickUpper, liquidity, owner, config) payable → (amount0, amount1)" who="the pot admin, once per pool">
        <p>
          Creates the program with <B>full rules at creation</B>. <C>owner == address(0)</C> ships
          it surrendered at birth: frozen rules, locked liquidity, public harvest.
        </p>
      </Fn>
      <Fn sig="addProgramLiquidity(key, liquidity) payable → (amount0, amount1)" who="the program owner">
        <p>Grows the position. Harvests pending fees first, then settles pure principal from the caller.</p>
      </Fn>
      <Fn sig="removeProgramLiquidity(key, liquidity, to) → (amount0, amount1)" who="the program owner">
        <p>
          Shrinks the position; principal goes to <C>to</C>. Harvests first. A live owner can
          always withdraw; an ownerless program is locked forever.
        </p>
      </Fn>

      <H2>LP program — rules & harvest</H2>
      <Fn sig="setProgramConfig(poolId, config)" who="the program operator">
        <p>
          Replaces the split rules — the LP fee shares AND the buyback split; validated like the
          advanced entry. Shapes future harvests and buybacks only — the standing carry keeps
          retrying under the new rules.
        </p>
      </Fn>
      <Fn sig="setProgramOperator(poolId, newOperator)" who="the program operator">
        <p>
          Moves the settings role. <C>address(0)</C> freezes the rules forever without touching the
          owner&apos;s property. No way back.
        </p>
      </Fn>
      <Fn sig="transferProgramOwnership(poolId, newOwner)" who="the program owner">
        <p>
          Moves the property; the operator role does <B>not</B> travel with it.{" "}
          <C>address(0)</C> locks the liquidity forever and forces the manual harvest public.
        </p>
      </Fn>
      <Fn sig="harvest(key) → (mainFees, secondaryFees)" who="the owner — or anyone when publicHarvest">
        <p>
          Collects the program&apos;s fees and runs the split with the caller&apos;s full gas — the
          same path the auto-harvest runs. The natural entry for heavy tokens.
        </p>
      </Fn>
      <Fn sig="claim(asset) → amount" who="any owed recipient">
        <p>Pulls everything booked to the caller in <C>asset</C> after refused pushes. Full-gas, reverting delivery.</p>
      </Fn>

      <H2>Views</H2>
      <Code>
        <span className="g">potOf</span>(poolId) → Pot{"\n"}
        <span className="g">programOf</span>(poolId) → Program{"\n"}
        <span className="g">quotePump</span>(key, userAmountIn) → (spend, minOut){"\n"}
        <span className="g">quoteShield</span>(key, amountSpecified) → (absorbed, paid){"\n"}
        <span className="g">parkedOf</span>(asset) → amount{"          "}<span className="c">{"// refused deliveries, all pools"}</span>{"\n"}
        <span className="g">parkedDirectOf</span>(poolId) → amount{"   "}<span className="c">{"// refused deliveries, this pool"}</span>{"\n"}
        <span className="g">heldOf</span>(asset) → amount{"            "}<span className="c">{"// held-forever ledger (custody = burn)"}</span>{"\n"}
        <span className="g">owedOf</span>(to, asset) → amount{"        "}<span className="c">{"// refused harvest legs, claimable"}</span>{"\n"}
        <span className="g">obligationOf</span>(asset) → amount{"      "}<span className="c">{"// everything the hook owes in `asset`"}</span>
      </Code>

      <H2>Structs</H2>
      <Code title="Pot">
        address admin;{"      "}<span className="c">{"// the pool's initializer"}</span>{"\n"}
        address main;{"       "}<span className="c">{"// the defended currency"}</span>{"\n"}
        address secondary;{"  "}<span className="c">{"// the buyback currency — the pot's only asset"}</span>{"\n"}
        address recipient;{"  "}<span className="c">{"// 0x0 = burn"}</span>{"\n"}
        bool configured;{"    "}<span className="c">{"// liveness flag (main may legally be 0x0 = native)"}</span>{"\n"}
        uint256 balance;{"    "}<span className="c">{"// pot inventory, in secondary"}</span>
      </Code>
      <Code title="ProgramConfig — the operator-editable half">
        uint64 buybackShareWad;{"     "}<span className="c">{"// secondary gross → the pot"}</span>{"\n"}
        uint64 burnShareWad;{"        "}<span className="c">{"// main gross → the burn cascade"}</span>{"\n"}
        uint64 compoundShareWad;{"    "}<span className="c">{"// both sides' gross → the LP budget"}</span>{"\n"}
        uint64 potCompoundShareWad;{" "}<span className="c">{"// buyback split: pot output → the carry"}</span>{"\n"}
        uint64 potBurnShareWad;{"     "}<span className="c">{"// buyback split: pot output → the cascade"}</span>{"\n"}
        bool publicHarvest;{"\n"}
        address secondaryRecipient;{"  "}<span className="c">{"// gross − compound − buyback"}</span>{"\n"}
        address mainRecipient;{"       "}<span className="c">{"// gross − compound − burn"}</span>{"\n"}
        uint256 minMain;{"             "}<span className="c">{"// auto-harvest trigger; max = disarmed"}</span>{"\n"}
        uint256 minSecondary;
      </Code>
      <Code title="Program — the full record (programOf)">
        uint128 liquidity;{"   "}int24 tickLower;{"   "}int24 tickUpper;{"\n"}
        bool exists;{"   "}bool publicHarvest;{"\n"}
        uint64 buybackShareWad;{"   "}uint64 burnShareWad;{"   "}uint64 compoundShareWad;{"\n"}
        uint64 potCompoundShareWad;{"   "}uint64 potBurnShareWad;{" "}
        <span className="c">{"// the buyback split"}</span>{"\n"}
        address owner;{"      "}<span className="c">{"// 0x0 = locked forever"}</span>{"\n"}
        address operator;{"   "}<span className="c">{"// 0x0 = rules frozen forever"}</span>{"\n"}
        address secondaryRecipient;{"   "}address mainRecipient;{"\n"}
        uint256 minMain;{"   "}uint256 minSecondary;{"\n"}
        uint256 carryMain;{"   "}uint256 carrySecondary;{" "}
        <span className="c">{"// compound budget waiting to fit"}</span>
      </Code>

      <H2>Events</H2>
      <Code>
        <span className="g">PotOpened</span>(poolId, admin){"\n"}
        <span className="g">PotInitialized</span>(poolId, main, secondary, recipient){"\n"}
        <span className="g">RecipientSet</span>(poolId, recipient){"\n"}
        <span className="g">Donated</span>(poolId, donor, amount){"\n"}
        <span className="g">Pumped</span>(poolId, spent, bought){"\n"}
        <span className="g">Shielded</span>(poolId, absorbed, paid){"\n"}
        <span className="g">Delivered</span>(poolId, to, amount, mode){"\n"}
        <span className="g">FlushedDirect</span>(poolId, to, amount){"\n"}
        <span className="g">ProgramCreated</span>(poolId, owner, tickLower, tickUpper){"\n"}
        <span className="g">ProgramConfigured</span>(poolId, config){"\n"}
        <span className="g">ProgramOwnershipTransferred</span>(poolId, newOwner){"\n"}
        <span className="g">ProgramOperatorSet</span>(poolId, newOperator){"\n"}
        <span className="g">ProgramLiquidityAdded</span>(poolId, liquidity, amount0Used, amount1Used){"\n"}
        <span className="g">ProgramLiquidityRemoved</span>(poolId, liquidity, amount0, amount1, to){"\n"}
        <span className="g">Harvested</span>(poolId, mainFees, secondaryFees, burned, fueled){"\n"}
        <span className="g">Compounded</span>(poolId, liquidity, amount0Used, amount1Used){"\n"}
        <span className="g">Paid</span>(to, asset, amount){"\n"}
        <span className="g">Owed</span>(to, asset, amount){"\n"}
        <span className="g">Claimed</span>(to, asset, amount)
      </Code>

      <H2>Errors</H2>
      <T
        head={["error", "meaning"]}
        rows={[
          [<C key="1">NotAllowed()</C>, "the caller may not perform this action"],
          [<C key="2">Reentrancy()</C>, "a reentrant call was blocked"],
          [<C key="3">PotNotReady()</C>, "initPot has not run yet"],
          [<C key="4">PotAlreadyReady()</C>, "the pot or the program already exists — both are one-shot"],
          [<C key="5">BadRoles()</C>, "main is not one of the pool's currencies, or the recipient is unusable"],
          [<C key="6">BadDonation()</C>, "attached value doesn't match the declared donation"],
          [<C key="7">QuoteMismatch()</C>, "a quote and its execution disagreed; the operation was abandoned"],
          [<C key="8">BadConfig()</C>, "share sums above 100%, burn share on a native main, a payable leg without a live recipient, or a malformed liquidity request"],
        ]}
      />
    </>
  );
}

/* ------------------------------------------------------- 18 · security --- */

export function Security() {
  return (
    <>
      <Lead>
        The full self-audit — scope, threat model, the pump/shield math with proofs, the invariant
        catalogue, findings and trust assumptions — lives in{" "}
        <a
          className="text-magenta underline"
          href="https://github.com/glue-finance/GlueHook/blob/main/audit/AUDIT.md"
          target="_blank"
          rel="noreferrer"
        >
          audit/AUDIT.md
        </a>
        . This chapter is the shape of it.
      </Lead>

      <Stats
        items={[
          { v: "123", l: "forge tests, 0 fail", c: "var(--t-green)" },
          { v: "12", l: "stateful invariants", c: "var(--t-blue)" },
          { v: "12", l: "fuzzed theorems", c: "var(--t-magenta)" },
          { v: "5", l: "live-fork proofs", c: "var(--t-teal)" },
        ]}
      />

      <H2>What you trust, exactly</H2>
      <T
        head={["you trust", "you do NOT trust"]}
        rows={[
          [
            "the verified bytecode at the canonical address, and Uniswap V4's PoolManager",
            "any oracle, any keeper, any admin key, any upgrade path — none exist",
          ],
          [
            "the roles YOU configured on YOUR pool (your pot admin, owner, operator)",
            "the hook's deployer (powerless after deployment), other pools' roles (fully isolated)",
          ],
        ]}
      />

      <H2>The invariants that hold, always</H2>
      <T
        head={["invariant", "meaning"]}
        rows={[
          [<B key="1">pot solvency</B>, <span key="v1">the hook&apos;s balance of every asset covers <C>obligationOf(asset)</C> — every unit is attributed</span>],
          [<B key="2">donation conservation</B>, "every donated unit is spent on the market, delivered, parked, or still in the pot — never lost, never skimmed"],
          [<B key="3">price immobility on a full absorb</B>, "a fully-shielded sell leaves the pool's sqrtPrice exactly unchanged"],
          [<B key="4">pump boundedness</B>, "the pump never spends beyond min(pot, fee·depth, buy input) · 80%"],
          [<B key="5">main attribution</B>, "parked + held + carry + owed always reconciles to what entered minus what left"],
          [<B key="6">monotone program liquidity</B>, "a program's position only grows from compounds; only the owner ever removes"],
        ]}
      />

      <H2>The adversarial campaign</H2>
      <P>
        Differential twin-pool parity (a hooked pool must behave wei-identically to a plain one for
        the trader, including under spot manipulation), self-sandwich unprofitability across every
        posture, hostile recipients and tokens (reverting <C>receive()</C>, blocklists,
        fee-on-transfer, no burn function), reentrant donations and reentrant harvest recipients,
        zero-fee refusal, direction discipline, pot isolation across pools, mixed-decimal pairs
        (6/18, 8/18, roles both ways) with magnitude proofs, and the buyback split&apos;s own
        never-stop matrix (a refusing recipient, an unburnable main under a burn share, a hostile
        native recipient, a re-entering recipient — every one fails sideways while the swap lands).
      </P>

      <H2>GH-1 — the one informational finding, in full</H2>
      <P>
        The audit&apos;s single finding walks every sandwich posture around an on-buy buyback, with
        the complete two-sided accounting. The frame that makes it legible:{" "}
        <B>the pot is not a treasury the hook defends — it is a standing buy order.</B> Its mandate
        is to convert its entire inventory into bought-and-burned main at the pool&apos;s own
        execution price, as demand arrives. Every &quot;attack&quot; below is an attempt to make
        the pot trade; the question in each case is not <i>&quot;did the attacker gain?&quot;</i>{" "}
        but <i>&quot;did the pot pay a fair price for real main, capped by real demand?&quot;</i> —
        and in every posture the answer is yes.
      </P>

      <H3>Posture 1 — farming the pump itself: closed</H3>
      <P>
        The attacker buys to summon the pump, then dumps the bag into the bump they financed. The
        sandwich algebra reduces to <C>profitable ⟺ pump spend &gt; f·R</C> — the attacker&apos;s
        own size cancels out — and the pump never spends more than <C>0.8·f·R</C>, strictly inside
        the break-even (the full derivation is in the{" "}
        <a className="text-magenta underline" href="/docs/pump">Pump chapter</a>). Proven
        unprofitable at every size from dust to pool-scale, and refused structurally on zero-fee
        pools where the bound would not hold.
      </P>

      <H3>Posture 2 — sandwiching an unrelated victim&apos;s buy: bounded uplift on a pre-existing attack</H3>
      <P>
        Any buy that lands behind a <B>separate</B> large buy makes that buy marginally more
        profitable to sandwich, because the back-runner sells into a price lifted by both. Measured
        against the fee-ceiling tuning, the uplift is roughly <B>15–27%</B> over what the same
        sandwich earned with no hook at all. The victim was sandwichable with or without the hook —
        the pump does not create the opportunity, it adds a bounded fraction to one that already
        existed. And the attacker cannot summon the pump for this: it only rides behind the
        victim&apos;s genuine buy, capped by the victim&apos;s own input.
      </P>

      <H3>Posture 3 — self-sandwiching through a partially-absorbing shield: the attacker buys the pot its burn</H3>
      <P>
        The subtlest surface, stated honestly: when a shield quote is tick-bounded, the pot absorbs
        a slice of a dump at the current (attacker-elevated) price without moving the pool, and the
        remainder executes from the un-moved price. A large buy followed by a full dump can
        therefore exit at a better blended price than a hookless pool would give — in the fuzz
        campaign&apos;s worst case, a 60 ETH buy against a ~480 ETH pot netted the attacker{" "}
        <B>~7 ETH</B> while the pot spent <B>~13 ETH</B>. Now read the same episode from the
        hook&apos;s side of the ledger:
      </P>
      <T
        head={["what happened", "why it's the machine working"]}
        rows={[
          [
            "the pot paid pool-equivalent price for every token it absorbed",
            "the exact terms the pool itself would have demanded at that moment — and ~5,580 tokens were bought and BURNED. The mandate (buy back as much main as possible with the donors' inventory) was executed, not subverted",
          ],
          [
            "the extraction is never leveraged",
            "the ETH the attacker takes out is strictly LESS than what the pot deliberately spent buying main — with the difference captured by the pool's LPs as fees (fuzzed over 512 runs: profit ≤ pot spend, every pot spend converts into bought main)",
          ],
          [
            "the attacker's cost is real and at-risk",
            "a pool-scale open position held across two legs, double fees paid to LPs — and while that inventory is open, anyone ELSE can sandwich them. The attacker takes on exactly the MEV risk they hoped to impose",
          ],
          [
            "the pot cannot be milked idle",
            "with no pot inventory nothing fires, and the pump leg spends only behind real, fee-paying buys",
          ],
        ]}
      />
      <Callout tone="pink" title="why every extraction path empowers the burn">
        <p>
          This is the finding&apos;s core inversion: every path that &quot;extracts&quot; ETH from
          the pot <B>hands the pot the burned main it exists to acquire</B>, at pool-equivalent
          price, capped by the pot&apos;s own spend. An attacker running posture 3 is, from the
          machine&apos;s ledger, a large seller filling the standing buy order — the pot converts
          inventory into burn <B>faster</B>, at fair price, while the attacker finances the
          pool&apos;s LPs and carries open MEV risk to do it. The residual is inherent to{" "}
          <B>every</B> buyback that trades behind user flow; here it is bounded, measured, and
          pays for supply destruction.
        </p>
      </Callout>
      <P>
        <B>Resolution:</B> accepted and documented. The fee ceiling <C>V ≤ f·R</C> is the
        load-bearing bound on posture 1 and is unchanged; the haircut trades buyback
        aggressiveness against the size of the posture-2/3 residuals.
      </P>

      <H2>What a swap actually costs</H2>
      <T
        head={["circumstance", "overhead vs bare V4"]}
        rows={[
          ["hooked pool, pot empty, no program (idle)", "+8–12k gas — one pot read + callback plumbing; the only cost every swap pays"],
          ["pump fires on a buy", "+88k gas — the pot's own swap + delivery, paid by the buy that triggered it"],
          ["shield fires on a sell", "+38k gas — pool-exact quote + fill + delivery"],
          ["auto-harvest + compound inside a swap", "+111k gas — collect + split + compound mint, only on the swap that crosses the minimums"],
        ]}
      />
      <P>
        The heavy circumstances only ever run on the swaps that trigger them, each behind a{" "}
        <C>try/catch</C> that skips the work rather than reverting the carrying swap.
      </P>

      <H2>Reproduce it</H2>
      <Code>
        git clone https://github.com/glue-finance/GlueHook && cd GlueHook{"\n"}
        forge install OpenZeppelin/openzeppelin-contracts{"\n"}
        forge clean && forge test{"          "}<span className="c">{"// 123 tests, 0 failures"}</span>{"\n"}
        FORK_RPC_URL=… forge test{"          "}<span className="c">{"// 128: +5 against the LIVE PoolManager"}</span>
      </Code>

      <H2>Licence</H2>
      <P>
        Business Source License 1.1. Licensed Work: <B>GlueHook</B>, © 2026 gluefinance.eth, owned
        by Glue Labs Inc. (Delaware). Change Date: the earlier of <B>2030-08-05</B> or a date set
        at <C>gluehook-license-date.gluefinance.eth</C>; Change License: GPL-2.0-or-later. The{" "}
        <C>GluedMath</C> and <C>GluedV4Core</C> libraries are MIT.
      </P>
      <Callout tone="good" title="what the licence means for you">
        <p>
          Building on the officially deployed hook — pools, donations, integrations, interfaces,
          tokens adopting it — is <B>authorized and encouraged</B>. Deploying your own copy of the
          contract is what&apos;s restricted until the change date.
        </p>
      </Callout>
    </>
  );
}

/* ------------------------------------------------------------ 19 · faq --- */

export function GlossaryPage() {
  return (
    <>
      <Lead>
        The words this documentation uses precisely — one line each. If a term is missing,{" "}
        <a className="text-magenta underline" href="https://github.com/glue-finance/GlueHook/issues" target="_blank" rel="noreferrer">
          open an issue
        </a>
        .
      </Lead>

      <H2>Glossary</H2>
      <T
        head={["term", "meaning"]}
        rows={[
          [<B key="1">MAIN</B>, "the defended currency: bought on pumps, absorbed from sells, delivered to the recipient"],
          [<B key="2">SECONDARY</B>, "the buyback currency: the only asset the pot holds and donate accepts"],
          [<B key="3">pot</B>, "a pool's permissionless war chest, denominated in secondary"],
          [<B key="4">pump</B>, "the pot buying more main inside a buy's own transaction (afterSwap)"],
          [<B key="5">shield</B>, "the pot absorbing a sell at the pool's exact execution price (beforeSwap)"],
          [<B key="6">burn cascade</B>, "burn() → 0xdEaD → held forever; how burn-intent main leaves circulation"],
          [<B key="7">LP program</B>, "the pool's single hook-held liquidity position plus its split rules"],
          [<B key="8">harvest</B>, "collecting the program's fees and running the split (auto in-swap, or manual)"],
          [<B key="9">compound</B>, "the share of harvested fees re-minted into the position itself"],
          [<B key="10">carry</B>, "compound budget the mint couldn't place yet — retried at every next harvest"],
          [<B key="11">pot admin</B>, "the pool's initializer: declares roles, moves the recipient, creates the program"],
          [<B key="12">owner</B>, "the program's property holder: liquidity, harvest, transfer; 0x0 = locked forever"],
          [<B key="13">operator</B>, "the program's settings editor; 0x0 = rules frozen forever"],
          [<B key="14">owed ledger</B>, "refused harvest pushes, booked per (recipient, asset), claimable any time"],
          [<B key="15">parked</B>, "a refused pot delivery, retryable by anyone via flushDirect"],
          [<B key="16">held</B>, "unburnable burn-intent main held on the hook forever — custody is the burn"],
          [<B key="17">WAD</B>, "the 1e18 fixed-point scale: 1e18 = 100%"],
        ]}
      />
    </>
  );
}

/* -------------------------------------------------------- 20 · license --- */

export function LicensePage() {
  return (
    <>
      <Lead>
        GlueHook is published under the <B>Business Source License 1.1</B> (BUSL-1.1). The short
        version: the deployed hook is free infrastructure for everyone to <B>use and build on</B> —
        but copying the source to ship your own competing deployment is a different act, and that
        one needs a licence.
      </Lead>

      <H2>The one distinction that matters</H2>
      <P>
        Everything in this documentation — launching pools, integrating donations and quotes,
        building launchpads, lockers, vaults and UIs on top of the canonical deployments — is{" "}
        <B>using</B> the hook. Using a deployed contract is not governed by the source licence at
        all: no permission, no fee, no attribution required. It is exactly what the hook was
        designed for.
      </P>
      <P>
        What the licence restricts is <B>forking</B>: taking the source (or a modified copy of it),
        deploying it yourself, and turning it into a product. That is production use of the
        Licensed Work, and under BUSL-1.1 it requires a grant from the licensor until the Change
        Date. If your plan is &ldquo;this hook, but ours&rdquo; — talk to us first.
      </P>

      <Callout tone="good" title="build on it — that's the point">
        Calling <C>launchPool</C>, <C>donate</C>, <C>quotePump</C>, <C>harvest</C> or any other
        function on the canonical address, from any product, commercial or not, is unconditionally
        fine. The address is the same on every network precisely so that building on it is easy.
      </Callout>
      <Callout tone="warn" title="don't fork it into a product">
        Re-deploying this code (or a derivative of it) as your own hook, protocol or service is
        outside the licence grant. Reading, auditing, modifying and testing the source — any
        non-production use — is explicitly free for everyone, today.
      </Callout>

      <H2>The parameters</H2>
      <T
        head={["parameter", "value"]}
        rows={[
          [<B key="1">License</B>, "Business Source License 1.1"],
          [<B key="2">Licensor</B>, "Glue Labs Inc. (Delaware)"],
          [<B key="3">Licensed Work</B>, "GlueHook — (c) 2026 gluefinance.eth"],
          [<B key="4">Additional Use Grants</B>, "published at gluehook-license-grants.gluefinance.eth"],
          [<B key="5">Change Date</B>, "the earlier of 2030-08-05 or a date set at gluehook-license-date.gluefinance.eth"],
          [<B key="6">Change License</B>, "GNU General Public License v2.0 or later"],
        ]}
      />
      <P>
        On the Change Date the licence converts automatically: the whole codebase becomes GPL
        v2.0-or-later and every restriction above ends. Until then, additional production grants
        can be published on-chain at the ENS record — so a grant, once given, is as public and
        verifiable as the code itself.
      </P>

      <H2>What this means in practice</H2>
      <T
        head={["you want to…", "licence answer"]}
        rows={[
          ["launch pools, donate, integrate quotes, run a UI on the deployed hook", "free — always, for anyone, commercially too"],
          ["build a launchpad / locker / vault that composes on the roles", "free — this is the intended use"],
          ["read, audit, run the tests, experiment on a devnet", "free — non-production use is granted to all"],
          ["fork the source and deploy your own competing hook", "needs a grant until the Change Date"],
          ["wait until the Change Date and use it under GPL", "fine — that conversion is automatic and irrevocable"],
        ]}
      />
      <P>
        The full text lives in <C>LICENCE.txt</C> at the repository root and in the verified source
        on every explorer. When in doubt, the test is simple: if your product <B>calls</B> the
        canonical address, you are a user; if your product <B>is</B> a copy of this code, you need
        a grant.
      </P>
    </>
  );
}
