<p align="center">
  <a href="https://gluehook.trade">
    <img src="web/public/gluehook-logo.png" alt="GlueHook" width="320" />
  </a>
</p>

**A Uniswap V4 buyback-and-burn hook.** One hook singleton hosts a permissionless donation **pot** for
every pool that adopts it: the pot **pumps** on buys and **shields** on sells, and everything it buys is
delivered to the pot's recipient — `address(0)` means **burn**, so the default configuration is
buy-and-burn. Each pool may additionally run an **LP program**: one hook-held liquidity position whose
trading fees are auto-harvested and split — a share fuels the pot, a share burns, the rest pays a
recipient per side.

Built by [Glue](https://github.com/glue-finance) and released as an open preview of the Glue stack.
The hook is fully standalone: it runs on any chain with a V4 `PoolManager`, over any pair, with no
external protocol wiring at all.

## Deployed everywhere — one address, 23 networks

The hook lives at the **same canonical address on every network**, source-verified
on each chain's explorer. Launch pools, add liquidity and manage programs from
[**gluehook.trade**](https://gluehook.trade) ([app](https://gluehook.trade/app) ·
[simulator](https://gluehook.trade/app?tab=simulate) · [docs](https://gluehook.trade/docs)).

```
GlueHook  0xb216070c3509047ea597E2E626A29cea427a60C8
```

| Mainnets | Testnets |
|---|---|
| [Ethereum](https://etherscan.io/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Base](https://basescan.org/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Unichain](https://uniscan.xyz/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Arbitrum](https://arbiscan.io/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Optimism](https://optimistic.etherscan.io/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [BNB Chain](https://bscscan.com/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Polygon](https://polygonscan.com/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Avalanche](https://snowscan.xyz/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Blast](https://blastscan.io/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Celo](https://celoscan.io/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Monad](https://monadvision.com/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [X Layer](https://www.oklink.com/x-layer/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [World Chain](https://worldscan.org/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Zora](https://explorer.zora.energy/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Soneium](https://soneium.blockscout.com/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [MegaETH](https://megaeth.blockscout.com/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Robinhood](https://robinscan.io/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Tempo](https://explore.tempo.xyz/address/0xb216070c3509047ea597E2E626A29cea427a60C8) | [Sepolia](https://sepolia.etherscan.io/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Base Sepolia](https://sepolia.basescan.org/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Unichain Sepolia](https://sepolia.uniscan.xyz/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Arbitrum Sepolia](https://sepolia.arbiscan.io/address/0xb216070c3509047ea597E2E626A29cea427a60C8) · [Robinhood Testnet](https://explorer.testnet.chain.robinhood.com/address/0xb216070c3509047ea597E2E626A29cea427a60C8) |

## Why this hook exists

Buyback programs today are either **manual** (a multisig watches the price and clicks) or **oracle-fed**
(a keeper bot reads a price feed and fires a transaction — trusting the oracle, the keeper, and the gap
between them). GlueHook removes both dependencies: it is an **automatic, contract-to-contract
buyback** that executes inside other people's swaps, priced by the pool's own arithmetic at the moment
of execution. No price oracle, no TWAP, no keeper, no off-chain trigger.

The trade-off is stated plainly: the mechanism narrows *who decides when* (nobody decides — the market
does), which limits discretionary control, and in exchange it **automates the buyback on the users' own
financial incentives**. Buyers trigger pumps because buying is what they came to do; sellers trigger the
shield because selling is what they came to do. Every activation is a real market participant paying
their own gas to move in the direction the pot amplifies — the system needs no privileged actor, only
traffic.

The hook closes a second gap the venue leaves open: **concentrated-liquidity pools do not compound**.
In V2, fees accrued inside the reserves and every LP's position grew automatically; V3 and V4 park fees
*outside* the position, so they sit idle until someone pays gas to collect and re-mint them — which in
practice means keeper services, position managers, or fees that never compound at all. GlueHook's LP
program gives a pool **native auto-compounding**: a configurable share of every harvest is re-minted
into the position *inside the swaps that generated the fees*, with the same no-keeper, no-oracle,
traffic-powered trigger as the buyback itself.

---

## How it works

A hooked pool declares two roles for its two currencies at `initPot`:

| Role | Meaning |
|---|---|
| **MAIN** | The asset being defended. It is what the pot buys and what the recipient receives. |
| **SECONDARY** | The buyback currency. The ONLY asset the pot holds and the ONLY asset `donate` accepts. |

Either side may be native ETH and either may be `currency0`, so the hook is pair-agnostic — a token
quoted in ETH is one configuration, not a rule.

### PUMP — `afterSwap`, on a secondary → main buy

The pot spends secondary on more main **inside the buyer's own transaction** and delivers it. The spend
is capped at `min(pot, fee·depth, the secondary this buy actually paid) · 80%`, and the buyback runs
through a `try/catch` self-call, so a pool state that would revert the buyback skips the pump instead of
reverting the buyer.

### SHIELD — `beforeSwap`, on a main → secondary sell

The pot buys the seller's main at the pool's **own execution price** — LP fee and tick impact included,
computed with the pool's own arithmetic against live `slot0`/`liquidity` — and returns a
`BeforeSwapDelta` that shrinks the pool leg. The seller is exactly indifferent, spot does not move, and
the absorbed supply never reaches the curve. A thin pot absorbs its affordable prefix; the remainder
swaps through the pool in the same call.

### Why it cannot be played

- **The shield has no reference price to lag.** Its fill price IS the pool's execution price, read
  live. Moving spot inside your own transaction moves your own fill with it — no oracle, no TWAP, no
  gap to arbitrage.
- **The pump refuses the sandwich break-even.** For a sandwich the attacker's own legs cancel out of
  the algebra and the profit condition reduces to *pump spend > fee·depth*. The pump never spends more
  than `fee·depth` (then takes 80% of it), which closes the attack for every attacker size, pot depth
  and price at once — no cooldown, no per-swap state.
- **The buyer pays the pump's gas.** Executing inline in `afterSwap` means there is no separate
  transaction to front-run.

### Delivery — can never revert a swap

A pot's `recipient` is stored verbatim; `address(0)` means **BURN**. Two rules frame everything below:

- **A native-main pot can never burn.** The network token has no supply to destroy, so `initPot` and
  `setRecipient` reject `address(0)` when main is the network token — a native-main pot always names a
  live recipient.
- **A refused delivery is never lost.** A live recipient that bounces the transfer (a blocklist, a
  reverting `receive()`) parks the main on the hook, booked **per pool** in `parkedDirectOf`, and anyone
  may retry it any time through `flushDirect(poolId)` — it pays the pot's *current* recipient. Native
  main is pushed with a 30,000-gas stipend so a hostile treasury can never brick the carrying swap.

A burn runs a cascade, cheapest and most final first:

1. **Native burn** — the token's own `burn(amount)`, accepted only on a verified balance drop.
2. **Dead route** — a transfer to `0xdead`.
3. **Held forever** — for a token that is **neither burnable nor dead-sendable** (by design "weird":
   blocklisted dead address, no burn function): the amount is held on the hook itself, booked in
   `heldOf`, with **no withdrawal path of any kind** — custody IS the burn. The asset is flagged
   unburnable on the first fall-through, so every later burn of it settles straight to the held ledger
   without re-running the probes.

Donations are irreversible and there is no withdrawal path for a pot, for parked main, or for held
main. `obligationOf(asset)` sums every pot, everything parked, everything held, the owed backlog,
and every program's compound carry in that asset — and the hook's balance always covers it.

**The buyback split.** When the pool carries an LP program, its operator can carve the pot's output —
pump and shield alike — *before* the recipient logic above runs: `potCompoundShareWad` of every
purchase is credited to the program's compound **carry** (it becomes pool liquidity on the next
harvest, delivery mode `COMPOUNDED`), `potBurnShareWad` walks the burn cascade, and the exact
remainder follows the pot's recipient as always. Shares are floored individually and the rest is
computed by subtraction, so the three legs sum to the output to the wei. Both shares at zero (the
default, including everything created by plain `addLiquidity`) is the classic behaviour bit-for-bit.
The same laws apply as everywhere else: `potCompound + potBurn ≤ 100%`, `potBurn == 0` on a native
main, and when the pot's recipient is itself `address(0)` the burn share and the rest merge into ONE
cascade walk. The carry credit is pure accounting and cannot fail; the split adds zero new
swap-revert paths.

### LP PROGRAM — one position per pool, fees that feed the machine

The pot admin may create the pool's single hook-held liquidity position:

- **`addLiquidity`** — a normal position: zero shares, both fee recipients default to the owner,
  auto-harvest disarmed. Everything can be turned on later.
- **`addLiquidityAdvanced`** — full rules at creation: the compound share, the buyback share, the
  burn share, the buyback split (`potCompoundShareWad` / `potBurnShareWad`), one recipient per side,
  and the auto-harvest minimums.

Each program carries **two independent roles**, both explicit parameters rather than `msg.sender`,
and each surrenders on its own terms — nobody is ever forced to give up the pool just to lock the
rules, or vice versa:

- The **OWNER** holds the property — add/remove liquidity and harvest. Transferable through
  `transferProgramOwnership`; `address(0)` (at creation or by transfer) is the explicit full
  surrender: the liquidity locks forever and the manual harvest is forced public. Richer custody
  policy (timelocks, vesting, DAO control) is built ON TOP by making such a contract the owner —
  a locker simply becomes the owner.
- The **OPERATOR** edits the split rules (`setProgramConfig`). The role starts on the owner and
  moves through `setProgramOperator`; setting it to `address(0)` **freezes the rules forever**
  without the owner losing the position — the immutable-fees promise with no LP lock attached.

Fees are harvested automatically inside `afterSwap` once the accrued fees reach the configured
minimums (a `try/catch` self-call, so a heavy harvest can never revert the carrying swap), or
manually through `harvest(key)` — **owner-only by default**, opened to anyone by the config's
`publicHarvest` flag (the auto-harvest is inherently public: any swap triggers it). Every share is
a fraction of the **GROSS fees of its side**, so the numbers mean exactly what they say:

| Side | Shares (must sum to ≤ 100%) | Remainder |
|---|---|---|
| **SECONDARY** fees | `compoundShareWad` → the LP budget · `buybackShareWad` → credited to the pool's own pot (buyback fuel) | → `secondaryRecipient` |
| **MAIN** fees | `compoundShareWad` → the LP budget · `burnShareWad` → the burn cascade above | → `mainRecipient` |
| **POT OUTPUT** (the buyback split) | `potCompoundShareWad` → the compound carry · `potBurnShareWad` → the burn cascade | → the pot's recipient |

The **compound** is the auto-compounding the venue never gave concentrated-liquidity LPs,
selectable as a simple percentage: the budget of both sides is re-minted into the program's own
position at the live price, across any tick range — whichever side binds caps the mint. Whatever
the mint cannot place this time is saved in the program's **CARRY** and added to the NEXT harvest's
compound budget: it retries LP-ing forever and never leaks to the pot or a recipient. A failed
mint abandons the compound alone (the budget stays in the carry) and the harvest never blocks. A
config edit only changes how future harvests split — nothing already harvested or carried is
re-touched.

A native-main program mirrors the pot's rule (`burnShareWad` must be 0), and a side whose shares
sum below 100% must name a live recipient. Recipient pushes are bounded-gas: a refusal books the
exact amount in a per-`(recipient, asset)` **owed ledger** that folds into the next successful push
automatically and is always claimable with full gas via `claim(asset)`. Adds and removes harvest
first, so principal and fees never mix.

---

## API

| Entry | Who | What |
|---|---|---|
| `beforeInitialize` | the PoolManager | records whoever called `initialize` as the pot's admin |
| `initPot(key, main, recipient)` | that admin, once | declares the roles; the other currency becomes secondary |
| `setRecipient(poolId, recipient)` | that admin | moves the delivery target (`address(0)` = burn) |
| `donate(key, amount)` | anyone | credits the pot by measured delta (fee-on-transfer safe); native pots take `msg.value`, ERC20 pots take an allowance |
| `flushDirect(poolId)` | anyone | retries a delivery the pot's live recipient refused, paying the pot's current recipient |
| `launchPool(key, sqrtP, main, recipient, tl, tu, liquidity, owner, config)` | anyone, on a pool that does not exist yet | the whole launch in ONE transaction: initializes the pool (the caller becomes the pot admin), declares the roles and creates the seeded program — same validation, events and funding rules as the standalone entries |
| `addLiquidity(key, tl, tu, liquidity, owner)` | the pot admin, once | creates the pool's program with everything off; `(0,0)` ticks = full range; the owner is also the first operator |
| `addLiquidityAdvanced(key, tl, tu, liquidity, owner, config)` | the pot admin, once | creates the program with full rules; `owner == 0` = surrendered at birth |
| `setProgramConfig(poolId, config)` | the program operator | edits shares (fee split AND buyback split), recipients, `publicHarvest`, and auto-harvest minimums |
| `setProgramOperator(poolId, newOperator)` | the program operator | moves the settings role; `address(0)` = rules frozen forever, owner untouched |
| `transferProgramOwnership(poolId, newOwner)` | the program owner | moves the property; `address(0)` = liquidity locked forever, harvest forced public |
| `addProgramLiquidity` / `removeProgramLiquidity` | the program owner | grows / shrinks the position (harvests first) |
| `harvest(key)` | the program owner, or anyone when `publicHarvest` | collects the program's fees and runs the split with full caller gas |
| `claim(asset)` | any owed recipient | pulls its refused-push backlog with full gas |
| `quoteShield` / `quotePump` | anyone | preview either mechanic against live pool state |
| `potOf` / `programOf` / `parkedOf` / `heldOf` / `parkedDirectOf` / `owedOf` / `obligationOf` | anyone | pot/program state and full asset attribution |

---

## Deployment

Uniswap V4 encodes a hook's permissions in the **low 14 bits of its address**. GlueHook must live
at a mined address carrying exactly

```
beforeInitialize | beforeSwap | afterSwap | beforeSwapReturnsDelta  =  0x20C8
```

The constructor asserts its own address, so a mis-mined deployment fails at deploy time.

### Same address on every chain (recommended)

CREATE2 cannot do this: its address commits to the init code, and the PoolManager constructor arg
differs on every chain. Plain **CREATE** can — `keccak256(rlp(deployer, nonce))` ignores the init
code entirely — so the tooling mines a **fresh throwaway deployer key** and deploys TWO contracts
from it, in order: the `GlueLiquidity` library at **nonce 0**, then the hook (delegatecall-linked
against that library) at **nonce 1**, whose address is mined to carry the hook bits. Both land at
the same addresses on every EVM chain, including chains where V4 ships later (deploy there whenever
their PoolManager exists; the addresses still match).

```bash
npm install && forge build

# 1. mine a fresh deployer (~16k keccaks, <1s). Writes the key to .deployer.key
#    (git-ignored, chmod 600, never printed). Prints the deployer + the library + hook addresses.
node scripts/mine-deployer.mjs

# 2. fund the printed deployer with a little gas on each target chain

# 3. deploy per chain — MUST be the key's first two transactions there (library, then hook; the
#    script links the hook's init code against the real nonce-0 library address). It refuses to
#    run unless: nonce == 0 (or 1 with the library already landed), the hook target is empty, the
#    PoolManager is a live contract (it is an immutable arg — a typo burns that chain's shot), and
#    the nonce-1 address carries 0x20C8.
node scripts/deploy-nonce0.mjs <rpcUrl> <poolManager>
```

Nonce discipline is the whole game: the deployer key must never send anything before the deploy on
any chain, and has no purpose after — discard it once every chain is live.

### Single chain via CREATE2 (alternative)

```bash
# deploy the GlueLiquidity library first (any address), then mine a salt for your CREATE2
# deployer + the LINKED init code, then deploy through it
node scripts/mine-salt.mjs <create2Deployer> <poolManager> <glueLiquidityAddress>
# verify: address & 0x3FFF == 0x20C8
```

## Build

Solidity `^0.8.35`, EVM target `prague`, viaIR. The only external dependency is
OpenZeppelin Contracts (interfaces + SafeERC20):

```bash
forge install OpenZeppelin/openzeppelin-contracts
forge build
```

Repository layout:

```
contracts/
  GlueHook.sol            the hook (pot factory + pump + shield + burn cascade + LP program)
  interfaces/
    IGlueHook.sol         the hook's public API
  libs/
    GlueLiquidity.sol        DELEGATECALL-linked harvest engine (collect / split / compound / config)
    GluedV4Core.sol           V4 math + callback base + hook flag constants (MIT)
    GluedMath.sol             512-bit mul-div (MIT)
scripts/
  mine-deployer.mjs           vanity deployer key miner (library at nonce 0, hook at nonce 1 — same addresses on every chain)
  deploy-nonce0.mjs           per-chain two-transaction deployment (link + deploy) with strict pre-flight checks
  mine-salt.mjs               CREATE2 hook-address salt miner (single-chain alternative)
```

The hook stays under EIP-170 by delegating the LP program's heavy bodies — fee collects, the
flat harvest split, the compound mint, config validation — to `GlueLiquidity`, a linked library
running in the hook's own storage and address. The artifact is statically linked against a sentinel
address (`foundry.toml`); the deploy script substitutes the real library address at deploy time, and
the test fixture etches the library runtime at the sentinel.

## Security

A full self-audit — scope, threat model, the pump/shield math with proofs, the invariant catalogue,
findings, trust assumptions, and a deployment checklist — lives in [`audit/AUDIT.md`](audit/AUDIT.md).

The whole campaign is in `test/` and reproducible with `forge clean && forge test` (**123 tests, 0
failures**; **128** with `FORK_RPC_URL` set), all against a real Uniswap V4 `PoolManager` — etched
from its runtime bytecode for the deterministic suites, and the LIVE deployed singleton for the
fork suite:

| Suite | Count | What it proves |
|---|---:|---|
| `GlueHookInvariant` | 9 | PP1–PP6 stateful invariants (384 runs × 64 depth) + 3 anti-vacuity walks: pot solvency, donation conservation, price immobility on a full absorb, pump boundedness, main attribution, delivery identity |
| `GlueHookProgramInvariant` | 7 | PI1–PI6 + 1 anti-vacuity walk: the SAME random walk with the LP program live and every split leg armed — harvests, compounds, pumps and shields interleaved in the same frames — proving solvency, exact main attribution (parked + held + carry + owed), pot conservation with harvest fuel as a real inflow, delivery identity, and monotone program liquidity |
| `GlueHookUnit` | 14 | deploy gate, callback auth, admin capture, role validation, native/ERC20/fee-on-transfer donations, both mechanics' happy paths, recipient delivery, views |
| `GlueHookAdversarial` | 11 | differential twin-pool parity (wei-exact, incl. spot-manipulated), self-sandwich unprofitability, hostile recipients/tokens, reentrant donate + reentrant harvest recipient, zero-fee refusal, direction discipline, pot isolation |
| `GlueHookBurn` | 9 | the full delivery cascade (native burn → dead → held forever), the unburnable flag's permanent short-circuit, per-asset flag isolation, `flushDirect` retries, native-main burn rejection, hostile-treasury ETH parking |
| `GlueHookLiquidity` | 17 | both LP entries, creation gates, config validation (per-side share sums, recipient rules), the exact gross-referenced harvest split, auto-harvest minimums, harvest-first adds/removes, the owed backlog + `claim`, the operator-zero config freeze, surrendered-at-birth, lifecycle solvency, the harvest gate, owner/operator separation, ownership transfer + surrender, a timelock locker owning a program, frozen rules travelling across a transfer |
| `GlueHookCompound` | 10 | the compound leg end to end: exact split + conservation, in-swap mints, the 100% budget corner, share-sum validation, the solvency dance, multi-round growth, carry accumulation + retry drawn down wei-for-wei, one-sided-fee skew, a zero-fee harvest retrying a standing carry, and the carry surviving a config edit |
| `GlueHookDecimals` | 6 | mixed-decimals ERC20/ERC20 pools (6/18 and 8/18, roles both ways) launched at a human 1:1 price — magnitude proofs that a 100-unit buy delivers ~100 units in the other side's own raw scale, pump/shield deliveries in correct raw units, the exact WAD harvest split over 6-dec raw fees, real compound mints from mixed-scale fees, pot solvency after a trading burst |
| `GlueHookFormal` | 12 | fuzzed theorems (512 runs each): pump spend bounds, monotonicity, full-absorb parity, shield sanity, live-pump-within-quote, quote purity, exact split conservation over arbitrary share pairs, compound-within-budget over every legal triple with carry-inclusive conservation, owed-ledger exactness, self-sandwich accounting (extraction ≤ pot spend, every spend burns), auto-compound monotone growth, global carry conservation across whole harvest sequences |
| `GlueHookPotSplit` | 14 | the buyback split end to end: zero-default parity with the unsplit delivery, the wei-exact three-way carve on both the pump's and the shield's output, the burn-intent single-cascade merge, no-program neutrality, set-time validation + operator gating, plain-`addLiquidity` defaults (owner == operator, split off), the remove-all-liquidity carry cycle with the exact carry identity, the 100%-compound corner — plus the NS never-stop matrix: a refusing recipient parks, an unburnable main holds, a hostile native recipient parks while the ETH carry credits, and a re-entering recipient bounces off the guard |
| `GlueHookLaunch` | 10 | LA1–LA10: the one-transaction `launchPool` — admin capture, funding + refunds, rejections (existing pool, foreign hook, bad main, native-main burn), atomic rollback, and a launched pool fully operational |
| `GlueHookGas` | 4 | G1–G4: deterministic `gasleft()` measurements behind regression ceilings — launch vs three-step, per-circumstance swap overhead, in-swap harvest + compound, steady-state entries |
| `GlueHookFork` | 5 | the pump, the shield, the manual harvest + compound, the in-swap auto-harvest, and the buyback split (compound + burn + rest on a live pump) against the LIVE deployed PoolManager on a forked real chain (verified on Ethereum mainnet and Tempo); gated on `FORK_RPC_URL`, PoolManager address overridable with `FORK_POOL_MANAGER` |

One informational finding (GH-1) walks every sandwich posture around an on-buy buyback with its full
two-sided accounting: the pump itself cannot be farmed (proven), a third-party sandwich of an
unrelated trade captures only a bounded uplift on an attack that already existed, and a
self-sandwicher who extracts ETH through a partially-absorbing shield always pays for it by
delivering the pot the burned main it exists to buy — at pool-equivalent price, capped by the pot's
own spend, while holding open inventory anyone else can sandwich (`FM10`, 512 fuzz runs).

## Licence

Business Source License 1.1 — see [`LICENCE.txt`](LICENCE.txt). Licensed Work: **GlueHook**,
(c) 2026 gluefinance.eth, owned by Glue Labs Inc. (Delaware). Change Date: the earlier of **2030-08-05**
or a date specified at `gluehook-license-date.gluefinance.eth`; Change License: **GPL-2.0-or-later**.
The `GluedMath` and `GluedV4Core` libraries are MIT.

Building on the officially deployed hook — pools, donations, integrations, interfaces, tokens adopting
it — is authorized and encouraged (see the Authorized Uses in the licence). Deploying your own copy is
not.
