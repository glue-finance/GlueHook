# GlueHook — Security Audit

**Contract:** `contracts/GlueHook.sol` (contract `GlueHook`, a Uniswap V4 buyback-and-burn hook) + its
DELEGATECALL-linked `contracts/libs/GlueLiquidity.sol` harvest engine
**Version reviewed:** commit at the tip of `main` at the time of this report
**Compiler:** solc `0.8.35`, EVM target `prague`, `viaIR`, `optimizer_runs = 1`, revert strings stripped
**Runtime size:** `GlueHook` 23,465 bytes (under the 24,576-byte EIP-170 limit), `GlueLiquidity`
11,843 bytes
**License:** BUSL-1.1 (`LICENCE.txt`)

This is a self-audit performed alongside development. It is written to be independently
reproducible: every claim below is backed by a test in `test/` that a reader can run with
`forge test`. Where a property is a theorem it is stated as one and then discharged by a fuzzed or
stateful test; where the review found a real, non-obvious behaviour it is written up as a finding
with its exact economic bound.

---

## 1. Scope

### In scope
- `contracts/GlueHook.sol` — the hook: pot factory, the pump (`afterSwap`), the shield
  (`beforeSwap`), donations, the burn/delivery cascade, the LP PROGRAM layer (single owner-controlled
  liquidity position per pool with auto-harvest, auto-compound, and a per-side fee split), the
  ONE-TRANSACTION launch (`launchPool`: initialise + roles + program + seed in a single call), and
  all views.
- `contracts/libs/GlueLiquidity.sol` — the hook's DELEGATECALL-linked engine (the pot role
  declaration and recipient move, program creation and the seed/add liquidity mint, the two role
  hand-offs, the two fee collects, config validation, the flat harvest split,
  the compound mint, and the whole DELIVERY engine — the buyback split's placement, the burn
  cascade, recipient pushes and the parked/held/owed booking). It declares no state of its own:
  every function runs in the hook's own storage,
  address and balance through storage pointers passed from the hook's declarations, and `msg.sender`
  is preserved so the admin/owner gates are unchanged — it is security-equivalent to inlined hook
  code and is reviewed as part of the hook.
- `contracts/interfaces/IGlueHook.sol` — the external surface.
- `contracts/libs/GluedV4Core.sol` — the V4 primitives the hook relies on (`computeSwapStep`,
  `quoteSwapStep`, `tangentReserve`, `swapFee`, `toBeforeSwapDelta`, liquidity math, the unlock
  callback frame, slot0/liquidity reads).
- `contracts/libs/GluedMath.sol` — 512-bit muldiv.

### Out of scope (dependencies, trusted)
- The Uniswap V4 `PoolManager` itself. The suite etches the real Sepolia runtime bytecode and trades
  against it, so the hook's interaction with the real venue is exercised, but the PoolManager is not
  the subject of this review.
- OpenZeppelin's `SafeERC20`/`Address` (vendored as a git submodule at a release tag).

---

## 2. System model

A single hook singleton is deployed once per chain to a mined address whose low 14 bits equal the
four permission flags the PoolManager reads (`beforeInitialize | beforeSwap | afterSwap |
beforeSwapReturnsDelta`). The constructor asserts this, so a mis-mined address fails at deploy time.
The recommended deployment is two plain-CREATE transactions from a mined fresh key — the
`GlueLiquidity` library at nonce 0, the hook (linked against it) at nonce 1 — giving the same two
addresses on every EVM chain regardless of the per-chain PoolManager constructor argument.

Any pool that names the hook gets a **pot**. The pool's initialiser is captured as the pot's
**admin** (`beforeInitialize`), and the admin declares the roles once (`initPot`): one of the pool's
two currencies is **MAIN** (defended, bought back, delivered) and the other is **SECONDARY** (the
only currency the pot holds and the only currency `donate` accepts). Either side may be native ETH,
so the hook is pair-agnostic — a token-quoted-in-ETH pool is one configuration, not a requirement.

The same three steps collapse into ONE transaction through **`launchPool`**: the hook calls
`PoolManager.initialize` itself, then runs the `initPot` and `addLiquidityAdvanced` bodies with
identical validation, events and funding rules. The admin capture stays sound because the
PoolManager **skips hook callbacks when the hook itself is the caller**: `beforeInitialize` never
runs on a launch, the pot's admin slot is provably virgin (a successful initialise proves the pool
was fresh, and only `beforeInitialize` — one shot per pool — could ever have written it), and
`launchPool` records its own caller as the admin, exactly what the callback would have recorded
had the launcher initialised the pool directly. A hook-driven initialise OUTSIDE `launchPool` is
unreachable in production (the hook calls `initialize` nowhere else); forced in a test, it leaves
an inert pot (admin never set, `initPot` permanently refused) rather than one the hook owns.

Two mechanics spend the pot, both settled inside a third party's swap:

| Mechanic | Trigger | Effect |
|---|---|---|
| **Pump** (`afterSwap`) | a SECONDARY → MAIN buy | spends pot secondary to buy more main and deliver it |
| **Shield** (`beforeSwap`) | a MAIN → SECONDARY sell | absorbs the sell at the pool's own execution price, paying the seller from the pot |

Everything the two mechanics acquire is routed through the **delivery cascade** to the pot's
recipient. `recipient == address(0)` means BURN and runs, cheapest-first: the token's own `burn`
(verified by a balance drop) → a transfer to `0xdead` → **held on the hook FOREVER** for a token that
refuses both. The hold is terminal by design: there is no withdrawal path for it, so custody IS the
burn (`heldOf`), and the asset is flagged unburnable on the first fall-through so the probes never
run again. A live recipient is a literal target; a refusal parks per-pool, retryable through
`flushDirect`. A pot whose MAIN is the network token can never be set to burn (`initPot`/
`setRecipient` reject it) — its bought ETH is pushed to the recipient with a 30,000-gas stipend and
parks on refusal.

**The LP PROGRAM layer.** The pot admin may additionally create the pool's ONE hook-held liquidity
position (`addLiquidity` = everything off, `addLiquidityAdvanced` = full rules at creation, both
naming an explicit `owner`). The program carries TWO INDEPENDENT roles: the OWNER holds the
property (add/remove liquidity, harvest, transferable via `transferProgramOwnership`) and the
OPERATOR edits the split rules (`setProgramConfig`; the role starts on the owner and moves via
`setProgramOperator`). Each surrenders on its own terms: a zeroed operator freezes the rules
forever while the owner keeps the position, and a zeroed owner (at creation or by transfer) locks
the liquidity forever and force-opens the manual harvest. The program's fees are harvested —
automatically inside `afterSwap`
when the accrued fees reach the configured minimums (inherently public: any swap triggers it), or
manually through `harvest(key)`, which is OWNER-ONLY unless the config's `publicHarvest` opens it
to anyone. The
split is FLAT: every share reads off the GROSS fees of its side, and the two shares that can claim
a side (`compound + buyback` on the secondary, `compound + burn` on the main) must sum to at most
100% at set-time. The buyback share is credited straight to the pool's own pot (the buyback fuel),
the burn share walks the burn cascade, and each side's exact remainder goes to its single
recipient (which must be live whenever the side's shares sum below 100%). The COMPOUND budget —
`compoundShareWad` of both sides PLUS the program's CARRY (whatever earlier mints could not
place) — is re-minted into the program's own position at the live price across its fixed range;
whichever side binds caps the mint, and the unplaced rest returns to the carry, retried at every
next harvest without ever leaking to the pot or a recipient. The mint runs in its own external
frame with a hard budget check — it can never consume more than its budget or block the harvest;
any revert simply leaves the budget in the carry. Recipient pushes are bounded-gas;
a refusal books in a per-`(recipient, asset)` owed ledger that folds into the next successful push
and is always claimable with full gas (`claim`). The two surrenders are independent one-way
levers, both by the same mechanism (`msg.sender` can never be zero): the operator's
`setProgramOperator(poolId, address(0))` freezes the split rules forever without touching the
owner's property, and the owner's zero (creation or `transferProgramOwnership(poolId, address(0))`)
locks the liquidity forever with `publicHarvest` forced on so an ownerless program is never
manually unharvestable. Richer custody policy (timelocks, vesting, DAO control) is built ON TOP by
transferring ownership to a contract that implements it. All booking precedes every external send
(CEI), and a native-main program mirrors the pot's rule: its `burnShareWad` must be zero.

**The BUYBACK SPLIT.** The same operator additionally owns two shares over the POT'S OUTPUT
(`potCompoundShareWad`, `potBurnShareWad`): before the pot's recipient logic runs, every delivery
of bought or absorbed main carves `⌊out·potCompound/1e18⌋` into the program's compound CARRY
(booked as delivery mode `COMPOUNDED`, it becomes position liquidity at the next harvest's mint)
and `⌊out·potBurn/1e18⌋` into the burn cascade; the exact subtraction remainder follows the pot's
recipient unchanged. Set-time laws mirror the fee split: the two shares sum to at most 100%, a
native main forces `potBurn = 0`, and a pool with no program reads both shares as zero (the whole
output follows the pot's recipient — plain `addLiquidity` also ships with both at zero, so nothing
is armed without the operator's explicit opt-in). When the pot's recipient is itself `address(0)`,
the burn share and the remainder merge into ONE cascade walk. The carry credit is pure accounting
inside the already-`try/catch`-isolated placement, so the split introduces no new swap-revert path;
the carry is a term of `obligationOf`, so custody covers it at all times, and it survives a full
liquidity exit (pumps keep filling the carry while the position is empty; a later re-add re-mints
it).

---

## 3. Threat model

The hook holds other people's money (donations) and spends it inside strangers' swaps. The attacker
surface is therefore:

1. **Drain the pot at an artificial price** by manipulating the pool before selling into the shield.
2. **Farm the pump** by sandwiching it (front-run the buy that triggers it, back-run the price bump).
3. **Brick a pool** so the hook makes its swaps revert (griefing).
4. **Steal or strand main** through a hostile main token or recipient in the delivery cascade.
5. **Double-spend or invent secondary** through reentrancy or accounting drift.
6. **Hijack a pot's configuration** (admin capture, role re-declaration).
7. **Abuse the LP program** (harvest-split drift, re-entering a bounded push, editing rules after
   the operator role was zeroed, taking another owner's liquidity, mixing principal with fees on an
   add/remove).

Each is addressed below and mapped to the test that exercises it.

---

## 4. Formal properties (the math, with proofs)

### 4.1 The shield pays the pool-equivalent price — exactly

**Claim.** For a sell the pot absorbs in full, the seller receives *precisely* what the same pool
would have paid for the same input at the same price — LP fee and price impact included — and the
pool's price does not move.

**Why.** The shield does not invent a price. It quotes the fill with
`GluedV4Core.quoteSwapStep`, which is a thin wrapper over Uniswap's own `computeSwapStep` — the
identical arithmetic the PoolManager runs when it executes a swap. The absorbed input and the paid
output are that function's outputs. Because the pot takes the main out of the PoolManager with
`take` and settles the secondary back with `settle`, and the swapper's leg is reduced by a
`BeforeSwapDelta` of exactly `(absorbed, paid)`, the pool's reserves and price are untouched: the
supply the pot absorbed never reaches the curve.

An internal fill priced at *spot* (no fee, no impact) would be strictly better than the pool and
therefore manipulable: move spot up inside your own transaction, then dump into the pot at the
inflated spot. Pricing at *execution* removes that edge with no oracle and no TWAP — the seller is
indifferent between the pot and the pool, so there is nothing to arbitrage.

**Discharge.**
- `test_A1_shieldPaysPoolEquivalent` — three sell sizes, each measured under a state snapshot against
  a hookless twin pool (same currencies, fee, spacing, price, liquidity). Wei-exact equality; hooked
  price unmoved.
- `testFuzz_FM3_fullAbsorbParity` — the same property over 512 random sell sizes.
- `test_A3_spotManipulationNoExcessPayout` — the price is pushed up first on both pools; the shield
  still pays exactly the (manipulated) twin's execution, never a wei more.

### 4.2 The shield never overpays and never settles a one-sided fill

**Claim.** `paid ≤ pot`, `absorbed ≤ offered`, and a fill is never one-sided
(`absorbed == 0 ⟺ paid == 0`).

**Why.** `_shieldQuote` caps the quoted input at the pot's affordability and at the main balance the
PoolManager actually holds (settling the fill takes that main out of it), and both the exact-input
and exact-output branches re-check the result against the swapper's offer. The zero-rounding guard
in `beforeSwap` returns a zero delta (leaving the swap to the pool) whenever either leg rounds to
zero, because a hook cannot balance a one-sided settlement.

**Discharge.** `testFuzz_FM4_shieldQuoteSane` (512 runs, arbitrary pot vs sell), `test_U11`,
`test_U14`, and invariant **PP3** (a fully-absorbed sell leaves the price bit-identical).

### 4.3 The pump cannot be sandwiched on its own — `V ≤ f·R`

**Claim.** An attacker whose own buy triggers a pump and who then dumps the acquired bag cannot
profit, for any attacker size, pot depth or price.

**Derivation.** Model a constant-product pool of depth `R` (the tangent reserve at the live price on
the side the pot spends) with fee `f`. An attacker opens with a buy of size `X` and closes by selling
the same bag, and a pump of size `V` lands between the two legs (this is the sandwich shape — the
pump is the "victim" the attacker brackets). To leading order the gross price-impact profit of the
bracket is

```
    profit ≈ 2·X·V / R
```

and the attacker pays fees `f·X` on the way in and `f·X`-worth on the way out, so `fees ≈ 2·f·X`.
The bracket is profitable iff `profit > fees`, i.e.

```
    2·X·V / R  >  2·f·X    ⟺    V > f·R
```

The attacker's own size `X` cancels: a single bound on the pump's spend closes the attack at every
attacker size simultaneously. The hook therefore caps the pump at `f·R` — computed live as
`swapFee(protocolFee, lpFee, direction)` times `tangentReserve(sqrtPrice, liquidity, side)`, so a
deeper pool or a fatter fee tier earns a proportionally larger pump and nothing is hardcoded — and
then applies a further `PUMP_HAIRCUT_BPS = 80%` factor, putting the realised spend at `0.8·f·R`,
strictly *inside* the break-even.

**Discharge.** `test_A2_pumpNotSelfSandwichable` — the attacker's own buy carries the pump and the
attacker immediately dumps; the round trip loses to fees at every size from 0.05 to 40 ETH.
`test_A6_zeroFeePoolNeverPumps` — with `f = 0` the ceiling `f·R` is zero, so the pump never fires:
a zero-fee pool cannot host an unsandwichable buyback and the design refuses to try.

> **Scope note.** This bound governs sandwiching the *pump itself*. Two adjacent surfaces — a third
> party sandwiching an *unrelated large buy*, and a self-sandwicher dumping through a
> *partially-absorbing shield* — are a different matter and are written up honestly, with their full
> two-sided accounting (the pot buys and burns main at pool-equivalent price in every posture, fuzzed
> as `FM10`), as finding **GH-1** below.

### 4.4 The pump is demand-following and pot-bounded

**Claim.** `spend ≤ 0.8·min(pot, f·R, userIn)`, where `userIn` is the secondary the carrying buy
actually paid (read from the swap delta, not quoted).

**Why.** `_pumpSize` takes `min(pot, feeCap)`, then `min(…, userIn)`, then applies the haircut. So
the pump never exceeds the pot, never exceeds the fee ceiling, and never spends more than the buy in
front of it — a dust buy unlocks only a dust pump, and the pot tracks real demand instead of
emptying all at once. `userIn` is the *measured* secondary leg of the delta rather than a re-quote
of the buyer's main output, because re-quoting a pot-sized swap divides by an average (not marginal)
execution price and would read a fat pot's own impact as extra demand.

**Discharge.** `testFuzz_FM1_pumpSpendBounds` and `testFuzz_FM2_pumpMonotoneInBuy` (512 runs each),
and invariant **PP4** (no pump ever spent more than the buy that carried it).

### 4.5 Conservation and delivery identity

**Claim (secondary conservation).** `pot + Σ shield payouts + Σ pump spends == Σ donations`, exactly.
Every wei that ever entered a pot is either still there or was spent by a mechanic that logged it.

**Claim (delivery identity).** `Σ main acquired == Σ main delivered` — burned, sent to the dead
address, held forever, or parked. Nothing the two mechanics acquire evaporates or sits unowned.

**Claim (solvency).** The hook's balance of any asset is always `≥ obligationOf(asset)` = every pot
denominated in it, plus everything parked in it, plus everything held forever in it, plus the owed
backlog booked in it, plus every program's compound carry in it. There is no withdrawal path for
any of them beyond the named creditor's own.

**Discharge.** Invariants **PP1** (solvency), **PP2** (conservation), **PP5** (main attributed),
**PP6** (delivery identity), each over 384 runs × 64 calls with zero reverts, ghost-ledgered from the
hook's own events (not inferred from balances). `testFuzz_FM6_quotesArePure` confirms the view
functions never mutate a pot. `test_L12_solvencyAcrossTheDance` closes the same solvency claim over
a full LP-program lifecycle (entries, trades, harvests, refusals, a removal).

### 4.6 The harvest split is exactly conservative

**Claim.** For a harvest of `fMain` main-side and `fSec` secondary-side fees under a config
`(compoundShareWad, buybackShareWad, burnShareWad)` — where `compound + buyback ≤ 1e18` and
`compound + burn ≤ 1e18`, enforced at set-time — every leg is the floor of its WAD product against
the GROSS of its side:

```
    cMain  = ⌊fMain · compoundShareWad / 1e18⌋,  cSec = ⌊fSec · compoundShareWad / 1e18⌋
    fueled = ⌊fSec · buybackShareWad / 1e18⌋     → credited to the pool's own pot
    burned = ⌊fMain · burnShareWad / 1e18⌋       → the burn cascade
    secondaryRecipient receives fSec − cSec − fueled   (exactly — division dust lands here)
    mainRecipient      receives fMain − cMain − burned (exactly)
```

and the compound mints against its budget PLUS the standing carry, returning the unplaced rest to
the carry:

```
    budgetMain = cMain + carryMain,  budgetSec = cSec + carrySecondary
    (uMain, uSec) = what the mint ACTUALLY consumed (0 on any mint failure)
    uMain ≤ budgetMain and uSec ≤ budgetSec       (hard budget check — QuoteMismatch otherwise)
    carryMain' = budgetMain − uMain,  carrySecondary' = budgetSec − uSec
```

The legs plus the mint's real consumption plus the carry delta sum to the harvest byte-for-byte on
both sides, so no wei is minted or lost by the split, the WAD floor's dust is absorbed by the
recipient leg, and the carry never leaks to the pot or a recipient — it only ever converts into
position liquidity. The carry is a per-asset term of `obligationOf`, so custody covers it at all
times, and a config edit only shapes future harvests (nothing already split or carried is
re-touched).

**Why.** The engine books each leg from a single subtraction against the collected total before any
external send (CEI); the carry is updated from the mint's REAL settlement deltas, not re-derived
from a second multiplication; the send phase pays from already-final books, and a bounced push
converts its leg into an owed booking of the identical amount instead of re-deriving anything. The
mint itself runs in an isolated external frame (`try/catch`): a revert consumes nothing, so the
whole budget stays in the carry and the harvest never blocks on the compound.

**Discharge.** `test_L5_manualHarvestExactSplit` (exact equalities per leg against the `Harvested`
event), `test_L13_compoundExactSplit` (the flat gross-referenced identity above, carry included),
`test_L14_compoundInSwap` (the in-swap mint), `test_L15_fullCompound` (the 100%-compound corner:
nobody else sees a wei; the unplaced budget waits whole in the carry),
`test_L16_compoundValidation` (the per-side sum bound and the exact-100% recipient-less corner),
`test_L17_compoundSolvencyDance` (solvency held across compounding interleaved with everything
else), `test_L23_compoundGrowsAcrossRounds` (five auto-harvest rounds: liquidity monotone,
compounds stack, solvency every round), `test_L24_carryAccumulatesAndRetries` (a skewed round's
unplaced budget joins the next harvest's mint and is drawn down by exactly its arithmetic),
`test_L25_oneSidedFeesCompound` (fees skewed entirely to one side never revert the harvest; the
anchored mint stays within both budgets or abandons cleanly), `test_L11_surrenderedAtBirth` (the
100%/100% corner with both roles zeroed), `test_L9_owedBacklogAndClaim` (a bounced
leg books at the identical amount, folds into the next push, and is claimable),
`test_A11_reentrantHarvestRecipientBooked` (a re-entering recipient cannot double-dip),
`test_L26_zeroFeeHarvestRetriesCarry` (a harvest with NO fresh fees still retries a standing carry
and touches no other ledger), `test_L27_carrySurvivesConfigEdit` (a share edit never releases or
re-routes what was already carried — the earmark keeps retrying under the new rules). Fuzzed:
`testFuzz_FM7` (split conservation over arbitrary share pairs), `testFuzz_FM8` (compound within
budget over every legal triple, conservation carry-inclusive), `testFuzz_FM11` (an armed program's
liquidity NEVER decreases through any trade — the auto-compound can only grow the position, with
custody solvent after every swap), `testFuzz_FM12` (global carry conservation: over a whole
sequence of harvests, Σ compound slices == Σ mint consumption + the final carry, per side to the
wei) — 512 runs each. Stateful: the program-armed campaign (§5, PI1–PI6) fuzzes the same ledgers
under random interleavings of harvests, compounds, pumps and shields.

---

## 5. Invariants (stateful campaigns)

Two campaigns drive the real hook against the real PoolManager on a real hooked pool, interleaving
donations, buys, and sells (exact-input and exact-output) from five actors in arbitrary order.
`foundry.toml` runs each at **384 runs × depth 64**.

**`test/GlueHookInvariant.t.sol`** — the bare pool (no LP program), isolating the pot's two
mechanics:

| ID | Property | Result |
|----|----------|--------|
| PP1 | Pot solvency: `held ≥ owed` in the secondary | ✅ 0 reverts |
| PP2 | Secondary conservation: `pot + payouts + spends == donations + fuel` | ✅ 0 reverts |
| PP3 | A fully-absorbed sell leaves the pool price bit-identical | ✅ 0 reverts |
| PP4 | No pump spends more than the buy that carried it | ✅ 0 reverts |
| PP5 | Every unit of main the hook holds is accounted (== parked + held) | ✅ 0 reverts |
| PP6 | Delivery identity: `main acquired == main delivered` | ✅ 0 reverts |

**`test/GlueHookProgramInvariant.t.sol`** — the SAME random walk with the LP program LIVE and armed
for in-swap auto-harvest with every split leg on at once (40% compound + carry, 30% buyback fuel,
30% burn, the buyback split at 25% compound + 25% burn, live recipients pushed real money inside
the swaps). Harvests, compounds, pumps and shields all settle in the same frames, which is exactly
where a bookkeeping slip between the four ledgers (pot, carry, owed, parked/held) would hide:

| ID | Property | Result |
|----|----------|--------|
| PI1 | ETH solvency: balance ≥ `obligationOf(ETH)` (pot + carry + owed) | ✅ 0 reverts |
| PI2 | Token solvency: balance ≥ `obligationOf(token)` | ✅ 0 reverts |
| PI3 | Main attributed exactly: balance == parked + held + carry + owed | ✅ 0 reverts |
| PI4 | Pot conservation with harvest fuel as a real inflow | ✅ 0 reverts |
| PI5 | Delivery identity incl. harvest burn legs and the buyback split's `COMPOUNDED` carry credits | ✅ 0 reverts |
| PI6 | Program liquidity NEVER decreases (nobody removes; compound only grows) | ✅ 0 reverts |

Four deterministic anti-vacuity walks prove the campaigns trade a non-empty world: actions land and
pump/shield fire (`test_coverage_handlerActionsLand`); a thin pot absorbs partially and empties to
the wei (`test_coverage_thinPotAbsorbsPartiallyAndEmpties`); an unfunded pot is completely invisible
(`test_coverage_emptyPotIsInvisible`); and under the armed program, harvests, compounds, fuel, burn
legs, recipient pushes and the buyback split's compound leg all actually fire inside the fuzzed
swaps (`test_coverage_programMechanismsLand`).

---

## 6. Test inventory

`forge clean && forge test` — **123 tests, 0 failures** (128 with `FORK_RPC_URL` set: the live-chain
fork suite self-skips offline).

| Suite | File | Count | What it proves |
|---|---|---:|---|
| Invariant | `GlueHookInvariant.t.sol` | 9 | PP1–PP6 + 3 anti-vacuity walks (bare pool) |
| Program invariant | `GlueHookProgramInvariant.t.sol` | 7 | PI1–PI6 + 1 anti-vacuity walk: the same random walk with the LP program live and every split leg armed — solvency, exact main attribution, pot conservation with harvest fuel, delivery identity, monotone liquidity |
| Unit | `GlueHookUnit.t.sol` | 14 | U1–U14: deploy gate, callback auth, admin capture, initPot/setRecipient validation, native + ERC20 + FoT donations, pump/shield happy paths, recipient delivery, views/quotes, dust skip |
| Adversarial | `GlueHookAdversarial.t.sol` | 11 | A1–A11: twin-pool parity, self-sandwich unprofitability, spot manipulation, hostile recipient park, reentrant donate, zero-fee refusal, 100% FoT refusal, direction discipline, pot isolation, pump-failure isolation, reentrant harvest recipient |
| Burn cascade | `GlueHookBurn.t.sol` | 9 | B1–B9: held-forever terminal hold, native burn, fake-burn fallthrough, the unburnable flag's permanent short-circuit, per-asset flag isolation, flushDirect guard, native-main burn rejection, refused-delivery park + retry (ERC20 and native) |
| LP program | `GlueHookLiquidity.t.sol` | 17 | L1–L12 + L18–L22: normal/advanced entries, full-range sentinel, creation gates, config validation (incl. the native-main burn mirror and the per-side share-sum bound), exact gross-referenced harvest split, auto-harvest mins, harvest-first adds, removes, owed backlog + claim, the operator-zero config freeze, surrendered-at-birth, lifecycle solvency, the owner-only harvest gate + `publicHarvest`, owner/operator separation, ownership transfer + surrender, a timelock locker owning a program, frozen rules travelling across a transfer |
| Compound + carry | `GlueHookCompound.t.sol` | 10 | L13–L17 + L23–L27: compound exact split + conservation, in-swap compound, 100% compound (the carry holds everything), share-sum validation + the exact-100% recipient-less corner, compound solvency dance, multi-round compound growth, carry accumulation + retry drawn down wei-for-wei, one-sided-fee compound skew, zero-fee harvest retrying a standing carry, the carry surviving a config edit |
| One-tx launch | `GlueHookLaunch.t.sol` | 10 | LA1–LA10: the single-transaction `launchPool` — happy path (launcher becomes admin, pool at the requested price, program owned/configured/seeded, native excess refunded to the wei, `PotOpened` carries the LAUNCHER not the hook), ERC20/ERC20 launch from allowances (+ value-on-tokenless-pool rejection), foreign-hook key rejection, existing-pool rejection, bad-main atomic rollback (no pool, no pot left behind), native-main-burn rejection, config legality + zero-seed rejection, the hook-initialised-outside-launch pool staying inert (no admin spoof), a launched pool fully operational (donate → shield → manual harvest), and surrendered-at-birth through the launch path |
| Gas | `GlueHookGas.t.sol` | 4 | G1–G4: deterministic `gasleft()` measurements behind generous regression ceilings — the one-tx launch vs the three-step path, swap overhead per circumstance (hookless baseline, hooked idle, pump firing, shield firing), the in-swap auto-harvest + compound, and the steady-state entries (donate, manual harvest, add, remove). Source of the numbers in §11 |
| Mixed decimals | `GlueHookDecimals.t.sol` | 6 | D1–D6: ERC20/ERC20 pools launched at a HUMAN 1:1 price so the raw sqrtPrice carries the whole decimals gap (6/18 and 8/18 pairs, roles both ways) — a 100-unit buy delivers ~100 units in the OTHER side's own raw scale, the pump and shield fire and deliver in correct raw units, the WAD harvest split is exactly conservative over 6-dec raw fee amounts, the compound mints real liquidity from mixed-scale fees, and the pot ledger stays fully backed after a trading burst. V4 and the hook never read `decimals()`; this suite proves the raw-units model end to end |
| Formal (fuzz) | `GlueHookFormal.t.sol` | 12 | FM1–FM12: pump spend bounds, pump monotonicity, full-absorb parity, shield sanity, live-pump within quote, quote purity, exact split conservation over arbitrary share pairs, compound-within-budget + carry-inclusive conservation over every legal (compound, buyback, burn) triple, owed-ledger exactness through refusal and claim, self-sandwich accounting (extraction ≤ pot spend, every spend converts into bought main, the pump capped by the attacker's own buy), auto-compound monotone growth, global carry conservation across whole harvest sequences — 512 runs each |
| Buyback split | `GlueHookPotSplit.t.sol` | 14 | SP1–SP10 + NS1–NS4: zero-default parity with the unsplit delivery, the wei-exact three-way carve on the pump's AND the shield's output, the burn-intent single-cascade merge, no-program neutrality, set-time validation (sum bound, native-main burn mirror, exact-100% legality), operator gating + the operator-zero freeze, plain-`addLiquidity` defaults (owner == operator, split off, burns whole on a burn-intent pot), the remove-all-liquidity carry cycle closed with the exact identity `carry' = carry + slice − minted`, the 100%-compound corner — and the never-stop matrix: a refusing recipient parks the rest while the other legs settle, an unburnable main under a burn share holds forever, a hostile native recipient parks while the ETH carry credits and native custody covers `obligationOf(ETH)`, and a re-entering recipient bounces off the transient guard with the carrying swap landing |
| Live-chain fork | `GlueHookFork.t.sol` | 5 | FK1–FK5: pump, shield, manual harvest + compound, in-swap auto-harvest, and the buyback split settling a live pump (compound carry + dead burn + remainder to a live recipient, wei-exact) against the LIVE deployed PoolManager on a forked real chain — real code, real storage, real gas accounting (verified on Ethereum mainnet `0x0000…8A90` and Tempo `0x3362…7029`); gated on `FORK_RPC_URL` |

Test infrastructure (`test/helpers`, `test/mocks`, `test/fixtures`) is fixture-only: the PoolManager
is etched from its real runtime bytecode, the hook is deployed to an address carrying its real
permission bits, and the `GlueLiquidity` runtime is etched at the `foundry.toml` link sentinel —
the same delegatecall topology as production. The fork suite goes one step further and runs the
same topology against the LIVE PoolManager singleton on a forked real chain, with its real deployed
code and storage.

---

## 7. Findings

### GH-1 — Informational: sandwich surfaces around an on-buy buyback — and why every one of them fills the pot's order

**Severity:** Informational (economically bounded, inherent to on-buy buybacks, not a pot drain).

**The frame that makes this finding legible.** The pot is not a treasury the hook defends — it is a
**standing buy order**. Its mandate is to convert its entire inventory into bought-and-burned main
at the pool's own execution price, as demand arrives. Every "attack" below is an attempt to get the
pot to trade; the question in each case is not *"did the attacker gain?"* but *"did the pot pay a
fair price for real main, capped by real demand?"* — and in every posture the answer is yes.

**Posture 1 — farming the pump itself: CLOSED.** The attacker buys to summon the pump, then dumps
the bag to sell into the bump they financed. The fee ceiling `V ≤ f·R` makes this strictly
unprofitable: the recapturable price impact is haircut (`0.8·f·R`) below the double fee bill the
round trip pays. Proven at fixed sizes from dust to pool-scale
(`test_A2_pumpNotSelfSandwichable`) and refused structurally on zero-fee pools (`test_A6`).

**Posture 2 — sandwiching an unrelated victim's buy: bounded uplift on a pre-existing attack.** Any
buy that lands behind a *separate* large buy makes that buy marginally more profitable to sandwich,
because the back-runner sells into a price lifted by both. Measured against the fee-ceiling tuning,
a third party sandwiching an unrelated 2 ETH victim buy earns roughly **15–27% more** than with the
pump absent (e.g. +0.00066 ETH on a 0.1 ETH front leg; +0.22 ETH on a 25 ETH front leg). The victim
was sandwichable with or without the hook — the pump does not create the opportunity, it adds a
bounded fraction to one that already existed. And the attacker cannot *summon* the pump for this:
it only rides behind the victim's genuine buy, capped by the victim's own input (§4.4, PP4).

**Posture 3 — self-sandwiching through a partially-absorbing shield: the attacker pays for the
pot's tokens.** This is the subtlest surface and it deserves the full mechanism. The shield quotes
one pool-exact step; when that step is tick-bounded, the pot absorbs a slice of the dump at the
current (attacker-elevated) price *without moving the pool*, and the remainder executes through the
pool from the un-moved price. A large buy followed by a full dump can therefore exit at a better
blended price than a hookless pool would give, and the attacker can walk away ETH-positive — in the
fuzz campaign's worst case, a 60 ETH buy against a ~480 ETH pot netted ~7 ETH while the pot spent
~13 ETH. Now read the same episode from the hook's side of the ledger:

- the pot paid **pool-equivalent price** for every token it absorbed — the exact terms the pool
  itself would have demanded at that moment (§4.1, `test_A3`), and ~5,580 tokens were bought and
  burned. The mandate — *buy back as much main as possible with the inventory donors provided* —
  was executed, not subverted;
- the extraction is **never leveraged**: the ETH the attacker takes out is strictly less than what
  the pot deliberately spent buying main, with the difference captured by the pool's LPs as fees
  (`testFuzz_FM10_selfSandwichAccounting`, 512 runs — profit ≤ pot spend, every pot spend
  converts into bought main, and the pump leg stays capped by the attacker's own money);
- the attacker's cost of doing this is **real and at-risk**: a pool-scale open position held across
  two legs, double fees paid to LPs, and the entire time that inventory is exposed, *anyone else*
  can sandwich them — the attacker takes on exactly the MEV risk they hoped to impose;
- the pot cannot be milked idle: with no pot inventory nothing fires, and the pump leg spends only
  behind real, fee-paying buys.

**Resolution.** Accepted and documented. The residuals are inherent to *every* buyback that trades
behind user flow (they are not specific to this hook), they are bounded by the fee ceiling and the
pot's own spend, and every path that "extracts" ETH from the pot hands the pot the burned main it
exists to acquire. Operators who want a smaller residual can lower `PUMP_HAIRCUT_BPS` (a smaller
pump adds proportionally less), trading buyback aggressiveness for it; the fee ceiling
(`V ≤ f·R`) is the load-bearing bound on posture 1 and is unchanged.

### No other findings

The review found no path to: drain a pot at an artificial price (§4.1), double-credit a donation
(reentrancy guard + measured pull; `test_A5`), settle a one-sided fill (§4.2), brick a pool with an
oversized pot (reserve bound; §4.1 guard 3), hijack a pot's roles (`test_U4`), re-declare roles
(`PotAlreadyReady`), steal main through a hostile token or recipient (the cascade holds or parks,
accounted, and never reverts a swap; `test_A4`, `test_B1`, `test_B3`), drift the harvest split by a
wei (§4.6), double-dip a bounced push (`test_A11`), edit rules after the operator role was zeroed
(`test_L10`, `test_L11`, `test_L22`), move a surrendered program's liquidity (`test_L11`,
`test_L20`), or exercise another owner's property rights (`test_L19`, `test_L20`, `test_L21`).

---

## 8. Trust assumptions & operational notes

- **Admin trust is scoped to configuration, not funds.** A pot admin sets the roles once and can
  re-point the recipient, but has **no** withdrawal path and cannot touch donated secondary or parked
  main. A malicious admin can at worst route a *future* buyback's main to an address of their choice
  (including themselves) — donors should verify a pool's recipient before donating, exactly as they
  would verify any on-chain destination.
- **The program's two roles split settings from property, and neither reaches funds.** The OPERATOR
  edits shares, recipients, mins and the `publicHarvest` gate — nothing else; the OWNER adds/removes
  the program's own liquidity and harvests — but neither can reach donated secondary, another pool's
  anything, or funds already booked to a recipient. The manual harvest is owner-only unless the
  config opens it; opening it is safe by construction (a public harvester can only trigger the
  frozen-at-call-time split, never redirect a wei). The two surrenders are independent:
  `setProgramOperator(poolId, address(0))` freezes the rules while the owner keeps the pool, and a
  zeroed owner locks the liquidity forever (with the harvest gate forced open) while a live operator
  may still edit rules. Nobody is ever forced to trade one for the other, and richer custody —
  timelocks, vesting, DAO control — is built by transferring ownership to a contract on top
  (proven by `test_L21_lockerOnTop`).
- **The terminal hold is deliberate.** A burn-intent token that refuses both its own `burn` and the
  dead address is held on the hook with no withdrawal path — out of circulation by custody. This is
  a feature, not stranding: the alternative (any retrieval path) would be a burn that someone can
  reverse.
- **Refused deliveries are never lost.** A live recipient that bounces a transfer (blocklist,
  reverting `receive()`) parks the main per-pool; anyone may retry through `flushDirect(poolId)`,
  which always pays the pot's *current* recipient. Harvest-split recipients book into the owed
  ledger instead (folded into the next push, claimable with full gas). A native-main pot can never
  be set to burn.
- **Fee-on-transfer secondary** is credited at the measured amount that arrived; a 100%-fee donation
  is refused. **Fee-on-transfer / rebasing MAIN** should be wrapped before use — the shield's
  pool-exact settlement assumes the main that leaves the PoolManager is the main the hook receives.
- **Zero-fee pools never pump** (§4.3) — this is by design, not a bug.

---

## 9. Deployment checklist

1. **Mine the deployer.** Run `scripts/mine-deployer.mjs` to mine a fresh key whose **nonce-1**
   CREATE address has low 14 bits equal to `REQUIRED_HOOK_FLAGS` (`beforeInitialize | beforeSwap |
   afterSwap | beforeSwapReturnsDelta`). The constructor asserts this, so a wrong address fails at
   deploy time. (Single-chain alternative: `scripts/mine-salt.mjs` for a CREATE2 salt.)
2. **Deploy per chain** with `scripts/deploy-nonce0.mjs <rpcUrl> <poolManager>`: the `GlueLiquidity`
   library lands at nonce 0, the hook — its init code linked against that real library address in
   place of the `foundry.toml` sentinel — at nonce 1, with the single constructor argument
   `(poolManager)`. Any chain with a V4 PoolManager; both addresses identical everywhere.
3. **Launch a pool in ONE transaction** with `launchPool(key, sqrtPriceX96, main, recipient,
   tickLower, tickUpper, liquidity, owner, config)` — initialise + roles + program + seed in a
   single call, the caller becoming the pot admin. (Or run the steps separately: **initialise** a
   pool naming the hook — the initialiser becomes the pot admin — then **`initPot(key, main,
   recipient)`** to declare which currency is defended and where its buybacks go, `address(0)` for
   buy-and-burn. The roles are irreversible except for the recipient.)
4. **Donate** the secondary to fund the pot. The pump and shield activate the moment the pot is
   non-empty and stand aside whenever it is empty.
5. **(Optional) verify the venue live** by running the fork suite against the target chain:
   `FORK_RPC_URL=<rpc> FORK_POOL_MANAGER=<manager> forge test --match-contract GlueHookFork` — the
   whole machine (pump, shield, harvest, compound, buyback split) against that chain's real deployed
   PoolManager before a single wei is committed.

---

## 10. Reproducing this audit

```bash
forge clean && forge test            # 123 tests (128 with FORK_RPC_URL set)
forge test --match-contract GlueHookInvariant          # PP1–PP6 + walks (bare pool)
forge test --match-contract GlueHookProgramInvariant   # PI1–PI6 + walk (program armed)
forge test --match-contract GlueHookFormal             # FM1–FM12, 512 runs each
forge test --match-contract GlueHookPotSplit           # SP1–SP10 + NS1–NS4, the buyback split
forge test --match-contract GlueHookLaunch             # LA1–LA10, the one-tx launch
forge test --match-contract GlueHookGas -vv            # G1–G4, the §11 gas numbers
FORK_RPC_URL=<rpc> forge test --match-contract GlueHookFork   # FK1–FK5 on a live chain
forge build --sizes                  # GlueHook 23,465 bytes (under EIP-170) + GlueLiquidity 11,843
```

The invariant depth/runs live in `foundry.toml` (`[profile.default.invariant]`); raise them for a
longer soak.

---

## 11. Gas costs

Deterministic `gasleft()` measurements from `test/GlueHookGas.t.sol` (G1–G4), run with the audited
compiler profile against the real etched PoolManager. Each number is the delta around the external
call, so it includes calldata and call overhead — what a caller actually pays on top of the venue —
but NOT the 21,000-gas transaction base cost, which is added explicitly where transactions are
compared. Reproduce with `forge test --match-contract GlueHookGas -vv`.

### 11.1 Launching a pool

| Path | Execution gas | All-in (incl. 21k base per tx) |
|---|---:|---:|
| **`launchPool` — ONE transaction** (initialise + roles + program + seed) | 530,298 | **551,298** |
| `initialize` | 56,440 | |
| `initPot` | 53,878 | |
| `addLiquidityAdvanced` | 404,591 | |
| Three-step total (3 transactions) | 514,909 | 577,909 |

The one-transaction launch pays ~15k extra execution gas (the launch orchestration) but saves two
transaction base costs, landing **~27k cheaper all-in** — and it is atomic: a failed step rolls the
whole launch back (LA5), where the three-step path can strand a half-configured pool between
transactions.

### 11.2 Swap overhead per circumstance

Measured through the same swap-router shape in every row, so the deltas isolate the hook's own work.

| Circumstance | Buy | Sell | Hook overhead vs bare V4 |
|---|---:|---:|---|
| Bare V4 pool (no hook) | 58,749 | 60,605 | — |
| Hooked pool, pot EMPTY, no program (idle) | 70,896 | 68,741 | +12,147 buy / +8,136 sell |
| Pot funded: **pump fires** on the buy | 146,615 | | +87,866 (the pot's own swap + delivery) |
| Pot funded: **shield fires** on the sell | | 98,922 | +38,317 (pool-exact quote + fill + delivery) |
| Armed program: **auto-harvest + compound** inside the swap | 169,983 | | +111,234 (collect + split + compound mint) |

The idle overhead — the only cost every swap on a hooked pool pays unconditionally — is one storage
read of the pot record plus the callback plumbing: ~8–12k. The heavy circumstances only ever run on
the swaps that trigger them, the trigger's own try/catch guaranteeing a failure skips the work
instead of reverting the carrying swap.

### 11.3 Steady-state entries

| Entry | Gas |
|---|---:|
| `donate` (native) | 55,888 |
| Manual `harvest` (collect + split + compound + payouts) | 129,568 |
| `addProgramLiquidity` (harvest-first add) | 103,142 |
| `removeProgramLiquidity` (harvest-first remove) | 82,281 |

Numbers move with pool state (tick crossings, cold vs warm slots, whether a compound places both
legs), so treat them as representative magnitudes, not constants; the suite's assertions are
regression ceilings at roughly 2× these values.
