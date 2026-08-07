/** Build & manage — chapters 12–16. */

import {
  B, C, Callout, Code, Cols, Faq, Flow, H2, H3, Lead, LinkCards, P, Panel, Steps, T,
} from "../ui";

/* --------------------------------------------------------- 12 · launch --- */

export function Launch() {
  return (
    <>
      <Lead>
        One entry does the whole thing: <C>launchPool</C> initializes the pool on the PoolManager,
        declares the pot&apos;s roles and creates the LP program with its seed liquidity —{" "}
        <B>atomically, in one transaction</B>. The three standalone steps still exist for pools
        that want them separately (or want no program at all).
      </Lead>

      <H2>The one-transaction launch</H2>
      <Code title="launchPool — anyone, on a pool that does not exist yet">
        function <span className="g">launchPool</span>({"\n"}
        {"  "}PoolKey key,{"        "}<span className="c">{"// must name this hook"}</span>{"\n"}
        {"  "}uint160 sqrtPriceX96,{" "}<span className="c">{"// the launch price, Q64.96"}</span>{"\n"}
        {"  "}address main,{"        "}<span className="c">{"// the defended currency"}</span>{"\n"}
        {"  "}address recipient,{"   "}<span className="c">{"// 0x0 = burn (ERC20 main only)"}</span>{"\n"}
        {"  "}int24 tickLower,{"     "}<span className="c">{"// (0,0) = full range"}</span>{"\n"}
        {"  "}int24 tickUpper,{"\n"}
        {"  "}uint128 liquidity,{"   "}<span className="c">{"// the program's seed"}</span>{"\n"}
        {"  "}address owner,{"       "}<span className="c">{"// 0x0 = surrendered at birth"}</span>{"\n"}
        {"  "}ProgramConfig config{" "}<span className="c">{"// the split rules"}</span>{"\n"}
        ) external payable returns (uint256 amount0, uint256 amount1);
      </Code>
      <P>
        The caller becomes the pot admin — exactly as if they had called{" "}
        <C>PoolManager.initialize</C> themselves — then the <C>initPot</C> and{" "}
        <C>addLiquidityAdvanced</C> bodies run with the same validation, events and funding rules
        as the standalone entries. It reverts if the pool already exists.
      </P>
      <Callout tone="pink" title="launch configured, not empty">
        <p>
          <C>launchPool</C> takes the FULL <C>ProgramConfig</C> — the same struct{" "}
          <C>addLiquidityAdvanced</C> takes. Set it here and the machine is complete from the
          first trade: fees compound, the pot self-funds from the buyback share, the burn burns —
          no second transaction, no window where the pool trades with the split at zero. A
          zeroed config is a plain LP position that keeps everything for you until the operator
          edits it later.
        </p>
      </Callout>

      <H2>Setting up the settings — the config, field by field</H2>
      <P>
        Ten fields, validated at write-time, editable later by the operator (unless you surrender
        the roles). Shares are WAD numbers: <C>1e18</C> = 100%.
      </P>
      <Code title="a real launch config — flywheel with a treasury remainder">
        IGlueHook.<span className="t">ProgramConfig</span>({"{"}{"\n"}
        {"  "}buybackShareWad:{"     "}0.30e18,{"  "}<span className="c">{"// 30% of secondary-side fees fuel the pot"}</span>{"\n"}
        {"  "}burnShareWad:{"        "}0.20e18,{"  "}<span className="c">{"// 20% of main-side fees walk the burn cascade"}</span>{"\n"}
        {"  "}compoundShareWad:{"    "}0.40e18,{"  "}<span className="c">{"// 40% of BOTH sides re-mint as liquidity"}</span>{"\n"}
        {"  "}potCompoundShareWad:{" "}0.50e18,{"  "}<span className="c">{"// half of what every buyback buys joins the LP carry"}</span>{"\n"}
        {"  "}potBurnShareWad:{"     "}0,{"        "}<span className="c">{"// none force-burned — the rest follows the pot's recipient"}</span>{"\n"}
        {"  "}publicHarvest:{"       "}true,{"     "}<span className="c">{"// anyone may trigger a harvest"}</span>{"\n"}
        {"  "}secondaryRecipient:{"  "}treasury,{" "}<span className="c">{"// remainder of the secondary side (the 30% left)"}</span>{"\n"}
        {"  "}mainRecipient:{"       "}treasury,{" "}<span className="c">{"// remainder of the main side (the 40% left)"}</span>{"\n"}
        {"  "}minMain:{"      "}100e18,{"           "}<span className="c">{"// auto-harvest arms when either side's parked"}</span>{"\n"}
        {"  "}minSecondary:{" "}0.05e18{"           "}<span className="c">{"// fees cross its threshold"}</span>{"\n"}
        {"}"})
      </Code>
      <T
        head={["field", "what it does at launch"]}
        rows={[
          [<C key="f1">buybackShareWad</C>, "the flywheel's fuel line — this slice of secondary-side fees lands in the pot every harvest, so pumping and shielding never depend on donations"],
          [<C key="f2">burnShareWad</C>, <>main-side fees sent down the burn cascade — must be <C>0</C> when main is native</>],
          [<C key="f3">compoundShareWad</C>, "both sides — the share that becomes position liquidity again (the autocompound engine)"],
          [<span key="f4"><C>potCompoundShareWad</C> / <C>potBurnShareWad</C></span>, "the buyback split: how what the pot BUYS is carved between the LP carry, the burn cascade, and the pot's recipient"],
          [<C key="f5">publicHarvest</C>, "open the manual harvest to keepers and the community, or keep it owner/operator-only"],
          [<span key="f6"><C>secondaryRecipient</C> / <C>mainRecipient</C></span>, "each side's remainder needs a live recipient whenever the shares sum below 100%"],
          [<span key="f7"><C>minMain</C> / <C>minSecondary</C></span>, <>the auto-harvest trigger — <C>type(uint256).max</C> on both = disarmed, harvests are manual only</>],
        ]}
      />
      <P>
        The write-time laws: each side&apos;s shares must fit in its own gross (<C>compound +
        buyback</C> ≤ 100%, <C>compound + burn</C> ≤ 100%, <C>potCompound + potBurn</C> ≤ 100%),
        a native main rejects burn shares, and every leg that can carry value needs a live
        recipient. A config that validates at launch keeps validating forever — and the{" "}
        <B>swaps never depend on it</B>: a recipient that starts refusing later just parks its
        money. Full lever-by-lever depth in{" "}
        <a href="/docs/manage" className="text-magenta hover:underline">Manage your program</a>,
        proven presets included.
      </P>

      <H2>One transaction is also cheaper — and atomic</H2>
      <T
        head={["path", "execution gas", "all-in (incl. 21k base per tx)"]}
        rows={[
          [<B key="1">launchPool — one transaction</B>, "530,298", <B key="v1">551,298</B>],
          ["the three-step path (3 transactions)", "514,909", "577,909"],
        ]}
      />
      <P>
        The launch orchestration costs ~15k extra execution gas but saves two transaction base
        costs — <B>~27k cheaper all-in</B>. More importantly it is <B>atomic</B>: a failed step
        rolls the whole launch back (no pool, no half-configured pot left behind), where the
        three-step path can strand a pool between transactions with its roles undeclared.
      </P>
      <Callout tone="info" title="why the admin capture stays sound">
        <p>
          The PoolManager skips hook callbacks when the hook itself is the caller, so{" "}
          <C>beforeInitialize</C> never runs during a launch — and a successful initialize proves
          the pool was fresh, so the admin slot is provably virgin. <C>launchPool</C> records its
          own caller as the admin: exactly what the callback would have recorded had the launcher
          initialized the pool directly. Audited as the LA1–LA10 suite, including the no-spoof
          corner.
        </p>
      </Callout>

      <H2>The checklist</H2>
      <Steps
        items={[
          {
            title: "Build the PoolKey with the hook address",
            body: (
              <>
                Sort the two currencies by address — any ERC20 pair works; if one side is native
                it&apos;s <C>address(0)</C>, which always sorts as <C>currency0</C>. Pick a{" "}
                <B>non-zero</B> fee tier and a tick spacing, set{" "}
                <C>hooks = 0xb216…60C8</C>. A zero-fee pool would never pump.
              </>
            ),
          },
          {
            title: "Pick the price",
            body: (
              <>
                <C>sqrtPriceX96</C> is the launch price in V4&apos;s Q64.96 square-root format. For
                a fresh token this IS the market&apos;s starting point; for an existing token match
                the live market or arbitrage will do it for you (at your LP&apos;s expense).
              </>
            ),
          },
          {
            title: "Declare the machine",
            body: (
              <>
                <C>main</C> must be one of the key&apos;s two currencies — the other becomes
                secondary automatically. A native main must name a live recipient.
              </>
            ),
          },
          {
            title: "Write the split rules",
            body: (
              <>
                Fill the <C>ProgramConfig</C> (the section above, field by field): the buyback
                share that self-funds the pot, the compound share, the burn share, the buyback
                split, the recipients, the auto-harvest trigger. Launching configured means the
                flywheel turns from the first trade — a zeroed config is just a plain LP until the
                operator edits it.
              </>
            ),
          },
          {
            title: "Fund the seed",
            body: (
              <>
                Each side settles by its own kind: an ERC20 side pulls the exact amount from your{" "}
                <B>allowance to the hook</B> (an ERC20/ERC20 pool has two of these); a native
                side, if the pool has one, is prepaid with <C>msg.value</C> and the <B>unused
                excess is refunded</B> — the attached value is a hard cap.
              </>
            ),
          },
        ]}
      />

      <H2>The three-step manual path</H2>
      <Code title="the same result, decomposed">
        <span className="c">{"// 1. initialize the pool — YOU become the pot admin"}</span>{"\n"}
        poolManager.<span className="g">initialize</span>(key, sqrtPriceX96);{"\n\n"}
        <span className="c">{"// 2. declare the roles (one-shot, admin-only)"}</span>{"\n"}
        hook.<span className="g">initPot</span>(key, main, recipient);{"\n\n"}
        <span className="c">{"// 3. create the program WITH its settings (admin-only, one per pool)"}</span>{"\n"}
        hook.<span className="g">addLiquidityAdvanced</span>(key, 0, 0, liquidity, owner, config);{"\n\n"}
        <span className="c">{"// (bare shortcut: a plain position, all shares zero, you keep everything —"}</span>{"\n"}
        <span className="c">{"//  owner AND operator = the caller, so the settings stay editable later)"}</span>{"\n"}
        hook.<span className="g">addLiquidity</span>(key, 0, 0, liquidity, owner);
      </Code>
      <Callout tone="info" title="a pool with no program at all">
        <p>
          Stop after step 2. The pot, the pump and the shield work standalone — the LP program is
          optional. It can be created later at any time (still admin-only, still one per pool).
        </p>
      </Callout>

      <H2>After launch</H2>
      <Flow
        items={[
          { label: "trade — the machine runs on traffic", hot: true, note: "a buyback share self-funds the pot from the very first harvest" },
          { label: "donate — optional turbo for the pot (you, the community, another contract)" },
          { label: "tune — the operator edits the split any time", note: "or freezes it forever" },
        ]}
      />
    </>
  );
}

/* --------------------------------------------------------- 13 · manage --- */

export function Manage() {
  return (
    <>
      <Lead>
        A program&apos;s rules live in one struct, editable by the <B>operator</B> and validated at
        write-time. Everything here can also be done from the app&apos;s settings box — this
        chapter is what each lever actually does.
      </Lead>

      <H2>The config struct</H2>
      <Code title="ProgramConfig — WAD shares, 1e18 = 100%">
        struct <span className="t">ProgramConfig</span> {"{"}{"\n"}
        {"  "}uint64 buybackShareWad;{"    "}<span className="c">{"// secondary side → the pool's pot"}</span>{"\n"}
        {"  "}uint64 burnShareWad;{"       "}<span className="c">{"// main side → the burn cascade"}</span>{"\n"}
        {"  "}uint64 compoundShareWad;{"   "}<span className="c">{"// BOTH sides → the LP budget"}</span>{"\n"}
        {"  "}uint64 potCompoundShareWad;{" "}<span className="c">{"// buyback split: pot output → the carry"}</span>{"\n"}
        {"  "}uint64 potBurnShareWad;{"    "}<span className="c">{"// buyback split: pot output → the cascade"}</span>{"\n"}
        {"  "}bool publicHarvest;{"        "}<span className="c">{"// open harvest(key) to anyone"}</span>{"\n"}
        {"  "}address secondaryRecipient;{" "}<span className="c">{"// gets: gross − compound − buyback"}</span>{"\n"}
        {"  "}address mainRecipient;{"     "}<span className="c">{"// gets: gross − compound − burn"}</span>{"\n"}
        {"  "}uint256 minMain;{"           "}<span className="c">{"// auto-harvest trigger (max = disarmed)"}</span>{"\n"}
        {"  "}uint256 minSecondary;{"\n"}
        {"}"}
      </Code>

      <H2>The validation, spelled out</H2>
      <T
        head={["rule", "why"]}
        rows={[
          [
            <span key="r1"><C>compound + buyback</C> ≤ 100% and <C>compound + burn</C> ≤ 100%</span>,
            "each side's shares must fit in its own gross",
          ],
          [
            <span key="r2"><C>burnShareWad == 0</C> when main is native</span>,
            "the network token cannot be burned",
          ],
          [
            <span key="r2b"><C>potCompound + potBurn</C> ≤ 100%, and <C>potBurn == 0</C> on a native main</span>,
            "the buyback split carves the pot's output — same laws, applied to what the pot buys",
          ],
          [
            "a live recipient behind every leg that can carry value",
            "a side summing below 100% has a remainder — value never goes nowhere",
          ],
          [
            "edits shape FUTURE harvests only",
            "nothing already harvested or carried is re-touched; the standing carry keeps retrying under the new rules",
          ],
        ]}
      />

      <H2>Proven configurations</H2>
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        {[
          {
            t: "plain LP",
            d: "a normal position; harvest manually, keep everything.",
            c: ["compound 0% · buyback 0% · burn 0%", "recipients = you", "auto-harvest disarmed"],
          },
          {
            t: "growth engine",
            d: "fees deepen liquidity and fuel the pot automatically.",
            c: ["compound 50%", "buyback 50% (secondary side)", "auto-harvest armed"],
          },
          {
            t: "deflationary",
            d: "the main side burns, the secondary side fuels defense.",
            c: ["compound 30%", "buyback 40% (sec) · burn 70% (main)", "recipients = treasury"],
          },
          {
            t: "trustless lock",
            d: "surrendered at birth: locked LP, frozen rules, public machine.",
            c: ["owner = 0x0 at creation", "harvest forced public", "nobody can ever edit anything"],
          },
        ].map((r) => (
          <div key={r.t} className="panel p-5">
            <div className="mb-1.5 text-[14.5px] font-bold text-txt">{r.t}</div>
            <p className="mb-3 text-[12px] leading-relaxed text-dim">{r.d}</p>
            <ul className="mono space-y-1 text-[11px] text-green/80">
              {r.c.map((x) => (
                <li key={x}>· {x}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <H2>Moving the roles</H2>
      <Code>
        <span className="c">{"// operator: hand the settings to a DAO, a multisig — or freeze them"}</span>{"\n"}
        hook.<span className="g">setProgramOperator</span>(poolId, newOperator);{" "}
        <span className="c">{"// 0x0 = frozen forever"}</span>{"\n\n"}
        <span className="c">{"// owner: hand the property to a locker, a vault — or lock it"}</span>{"\n"}
        hook.<span className="g">transferProgramOwnership</span>(poolId, newOwner);{" "}
        <span className="c">{"// 0x0 = locked forever + public harvest"}</span>
      </Code>
      <Callout tone="warn" title="surrender is one-way">
        <p>
          There is deliberately no way back from <C>address(0)</C> on either role. Freezing the
          rules does not lock the liquidity, and locking the liquidity does not freeze the rules —
          decide each on its own.
        </p>
      </Callout>

      <H2>Moving the pot&apos;s recipient</H2>
      <P>
        Separate from the program entirely: the <B>pot admin</B> moves where bought/absorbed main
        goes with <C>setRecipient(poolId, recipient)</C> — to a treasury, a rewards contract, or{" "}
        <C>address(0)</C> for burn (ERC20 main only). Anything parked from a refused delivery pays
        the <B>current</B> recipient when retried.
      </P>
    </>
  );
}

/* ------------------------------------------------------ 14 · liquidity --- */

export function Liquidity() {
  return (
    <>
      <Lead>
        The program is one hook-held V4 position with a tick range fixed at creation. The owner
        grows it, shrinks it, or locks it forever — and every add or remove{" "}
        <B>harvests first</B>, so principal and fees never mix.
      </Lead>

      <H2>Funding rules — the same everywhere</H2>
      <P>
        A position settles from its two sides independently, and each side follows the rule for
        its own kind of currency. An ERC20/ERC20 pool simply has two allowance-funded sides; a
        pool with a native side has one of each:
      </P>
      <T
        head={["if a side is…", "it settles like this"]}
        rows={[
          [
            <B key="e">an ERC20</B>,
            <span key="v1">
              the position pulls the <B>exact</B> amount it needs straight from your allowance to
              the hook — approve first, no dust left behind
            </span>,
          ],
          [
            <B key="n">the native token</B>,
            <span key="v2">
              prepaid with <C>msg.value</C> and the <B>unused excess refunded</B> — the attached
              value is a hard cap. (When a pool has a native side, V4 sorts it as <C>currency0</C>{" "}
              — native is <C>address(0)</C>, so it can never sort second.)
            </span>,
          ],
        ]}
      />
      <Callout tone="good" title="pot money never funds positions">
        <p>
          The hook&apos;s own inventory is pot money. Every position is funded by its caller, every
          time — the machine&apos;s solvency accounting depends on it and the invariant suite
          proves it.
        </p>
      </Callout>

      <H2>Growing the position</H2>
      <Code>
        <span className="c">{"// owner-only; harvests pending fees FIRST, then settles pure principal"}</span>{"\n"}
        hook.<span className="g">addProgramLiquidity</span>{"{"}value: cap{"}"}(key, liquidity);
      </Code>

      <H2>Shrinking the position</H2>
      <Code>
        <span className="c">{"// owner-only; harvests first, then returns pure principal to `to`"}</span>{"\n"}
        (uint256 a0, uint256 a1) ={"\n"}
        {"  "}hook.<span className="g">removeProgramLiquidity</span>(key, liquidity, to);
      </Code>
      <P>
        A live owner can <B>always</B> withdraw — no lock is implied by anything except the
        owner&apos;s own surrender. An ownerless program&apos;s liquidity is locked forever; that
        is the whole point of surrendering.
      </P>

      <H2>Why harvest-first matters</H2>
      <Flow
        items={[
          { label: "pending fees exist on the position" },
          { label: "add/remove harvests them through the program's own split", hot: true },
          { label: "THEN the principal moves", hot: true },
          { label: "result: fee value always obeys the split — principal is always pure" },
        ]}
      />
      <P>
        Without this, an owner could time adds and removes to skim fee value past the split (past a
        burn share, past the pot&apos;s fuel). With it, the split is unavoidable: fees settle as
        fees, principal settles as principal.
      </P>

      <H2>The tick range</H2>
      <P>
        Fixed at creation, forever — <C>(0, 0)</C> resolves to full range. A range position
        concentrates the program&apos;s depth (and its fee earnings) around the price you choose;
        full range never goes out of range and suits the lock-forever shapes. Choose once, choose
        deliberately.
      </P>
    </>
  );
}

/* ------------------------------------------------------ 15 · integrate --- */

export function Integrate() {
  return (
    <>
      <Lead>
        Traditional buyback machinery needs a price oracle and a keeper — two trust dependencies.
        Here your contract just <C>donate()</C>s, and the pot executes at real market prices,
        riding real user flow, only when there is real demand. The whole integration is a dozen
        lines.
      </Lead>

      <H2>Route protocol revenue into buybacks</H2>
      <Code title="the entire integration">
        <span className="g">IGlueHook</span> constant HOOK ={"\n"}
        {"  "}IGlueHook(<span className="g">0xb216070c3509047ea597E2E626A29cea427a60C8</span>);{"\n\n"}
        function routeRevenue(uint256 amt) external {"{"}{"\n"}
        {"  "}<span className="c">{"// ERC20 secondary: approve + donate"}</span>{"\n"}
        {"  "}SECONDARY.approve(address(HOOK), amt);{"\n"}
        {"  "}HOOK.donate(key, amt);{"\n"}
        {"}"}{"\n\n"}
        <span className="c">{"// native secondary instead:"}</span>{"\n"}
        HOOK.donate{"{"}value: amt{"}"}(key, amt);
      </Code>
      <P>
        That&apos;s it. No oracle to configure, no keeper to fund, no schedule to design. The pot
        spends itself into real buys and real sells at the pool&apos;s own price — your revenue
        becomes buy pressure exactly when the market shows demand, and sell absorption exactly when
        it shows supply.
      </P>

      <H2>Quote before you act</H2>
      <Code>
        <span className="c">{"// what would the machine do right now?"}</span>{"\n"}
        (uint256 spend, uint256 minOut) = HOOK.<span className="g">quotePump</span>(key, 1 ether);{"\n"}
        (uint256 absorbed, uint256 paid) = HOOK.<span className="g">quoteShield</span>(key, -1e18);{"\n\n"}
        <span className="c">{"// read the machine's state"}</span>{"\n"}
        IGlueHook.Pot memory pot = HOOK.<span className="g">potOf</span>(poolId);{"\n"}
        IGlueHook.Program memory prog = HOOK.<span className="g">programOf</span>(poolId);
      </Code>

      <H2>Index the machine</H2>
      <P>
        Every mechanic emits a dedicated event — an indexer can reconstruct the full history of a
        pool&apos;s machine from logs alone:
      </P>
      <T
        head={["event", "fires when"]}
        rows={[
          [<C key="1">Donated(poolId, donor, amount)</C>, "the pot was fueled"],
          [<C key="2">Pumped(poolId, spent, bought)</C>, "the pot bought main inside a buy"],
          [<C key="3">Shielded(poolId, absorbed, paid)</C>, "the pot absorbed part or all of a sell"],
          [<C key="4">Delivered(poolId, to, amount, mode)</C>, "main left the hook (direct / burned / dead / held / parked)"],
          [<C key="5">Harvested(poolId, mainFees, secondaryFees, burned, fueled)</C>, "a program's fees were collected and split"],
          [<C key="6">Compounded(poolId, liquidity, a0, a1)</C>, "the compound minted liquidity into the position"],
        ]}
      />

      <H2>Being a pot recipient</H2>
      <P>
        Any contract can be a pot&apos;s recipient or a program&apos;s fee recipient. Deliveries are
        push-first with bounded gas: if your contract refuses (or is expensive), the value books —
        per pool in <C>parkedDirectOf</C> for pot deliveries, per <C>(recipient, asset)</C> in{" "}
        <C>owedOf</C> for harvest legs — and you pull it later with <C>flushDirect(poolId)</C> /{" "}
        <C>claim(asset)</C> at your own gas. You can never brick the machine by being slow.
      </P>

      <Callout tone="info" title="one integration, 23 networks">
        <p>
          The hook is at the same address everywhere, so the constant above ports unchanged. Only
          the PoolKey differs per chain (different token addresses), nothing else.
        </p>
      </Callout>
    </>
  );
}

/* ----------------------------------------------------- 16 · build apps --- */

export function BuildApps() {
  return (
    <>
      <Lead>
        The hook is public infrastructure: no fee, no owner, no permission to ask. Launchers,
        lockers, vaults and DAOs compose on three primitives — the <B>one-transaction launch</B>,
        the <B>two surrenderable roles</B>, and the <B>recipient hooks</B>.
      </Lead>

      <H2>Pattern 1 — a token launcher</H2>
      <P>
        A launchpad contract deploys the token and calls <C>launchPool</C> in the same transaction:
        pool, pot and seeded LP program, live from block one. The launcher itself becomes the pot
        admin and the program owner — which means <B>your launcher decides the trust story</B>:
      </P>
      <Code title="a minimal launcher">
        function launch(bytes32 salt, …) external payable {"{"}{"\n"}
        {"  "}token = new Token{"{"}salt: salt{"}"}(…);{"\n"}
        {"  "}<span className="c">{"// pool + pot + seeded program, atomically:"}</span>{"\n"}
        {"  "}HOOK.launchPool{"{"}value: msg.value{"}"}({"\n"}
        {"    "}key(token), sqrtP,{"\n"}
        {"    "}address(token), <span className="t">address(0)</span>,{" "}
        <span className="c">{"// buy-and-burn"}</span>{"\n"}
        {"    "}<span className="l">0</span>, <span className="l">0</span>, seedLiquidity,{"\n"}
        {"    "}<span className="t">address(0)</span>,{" "}
        <span className="c">{"// owner 0x0: locked + frozen + public from birth"}</span>{"\n"}
        {"    "}config{"\n"}
        {"  "});{"\n"}
        {"}"}
      </Code>
      <P>
        With <C>owner = address(0)</C> the whole thing is trustless from birth — the exact
        &quot;liquidity can never leave&quot; guarantee launchpads advertise, enforced by the hook
        rather than by your code.
      </P>

      <H2>Pattern 2 — a locker or vesting vault</H2>
      <P>
        A locker doesn&apos;t need custom integration: it simply <B>becomes the program owner</B>{" "}
        via <C>transferProgramOwnership</C>. The locker&apos;s own release schedule then gates{" "}
        <C>removeProgramLiquidity</C> — a timelock, a vesting curve, a DAO vote, whatever it
        implements. The operator role can stay with the project (tunable fees under a locked LP) or
        be frozen separately.
      </P>

      <H2>Pattern 3 — a rewards or treasury sink</H2>
      <P>
        Point value <B>at</B> your system: make your staking vault the pot&apos;s{" "}
        <C>recipient</C> (bought main streams to stakers), or a program&apos;s{" "}
        <C>mainRecipient</C> / <C>secondaryRecipient</C> (a share of LP fees funds the treasury).
        Implement nothing; receive pushes; <C>claim</C> as fallback if you ever refuse one.
      </P>

      <H2>Pattern 4 — bots & routing</H2>
      <T
        head={["surface", "opportunity"]}
        rows={[
          [<C key="1">quotePump / quoteShield</C>, "routers can price the machine into their paths — a shielded sell has better effective depth than the raw pool"],
          [<C key="2">harvest(key)</C>, "when publicHarvest is on, harvest-calling is a public good anyone can run (the auto-trigger already fires on swaps)"],
          [<C key="3">flushDirect(poolId)</C>, "permissionless retry of parked deliveries — free karma for keepers"],
        ]}
      />

      <H2>What you can rely on</H2>
      <Callout tone="good" title="stability guarantees">
        <p>
          The hook is immutable and un-upgradable: the ABI you integrate today is the ABI forever.
          The address is identical on all 23 networks and will be identical on future ones. The
          licence explicitly authorizes building on the deployed hook — pools, donations,
          integrations, interfaces, tokens adopting it. Deploying your own copy is what it
          restricts.
        </p>
      </Callout>

      <LinkCards
        items={[
          { href: "/docs/api", title: "API reference", body: "Every function, struct, event and error — the full surface you build against." },
          { href: "https://github.com/glue-finance/GlueHook", title: "Source & audit on GitHub", body: "The contracts, the interface, the 123-test campaign and the full self-audit.", external: true },
        ]}
      />
    </>
  );
}
