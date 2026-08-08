import type { ReactNode } from "react";

/**
 * Per-chapter FAQ — five questions under every article, rendered
 * automatically by DocArticle. Keyed by the docs slug ("" = the index).
 */
export type DocFaq = { q: string; a: ReactNode };

export const DOC_FAQS: Record<string, DocFaq[]> = {
  "": [
    {
      q: "Do I need to change my token to use GlueHook?",
      a: "No. Any standard ERC20 (or the chain's native coin) works as-is — the machine lives in the pool, not in your token. You launch a Uniswap V4 pool with the hook attached and everything else stays untouched.",
    },
    {
      q: "Does GlueHook take a fee?",
      a: "No. Zero protocol fee, on everything, forever — there isn't even a fee switch to flip. The only fee in the system is the pool's own Uniswap LP fee, which you chose at launch and which pays liquidity providers.",
    },
    {
      q: "Is this a token? Is there something to buy?",
      a: "No token, no points, nothing to buy. GlueHook is a free piece of infrastructure: one immutable contract at the same address on every supported network.",
    },
    {
      q: "Can a trader tell the difference on a hooked pool?",
      a: "Buys and sells route exactly like any V4 pool — same interfaces, same aggregators. The difference is what happens inside the swap: buys can trigger a buyback, sells can be absorbed by the pot, and neither adds a step for the trader.",
    },
    {
      q: "What do I actually have to trust?",
      a: "Only the immutable code. There is no admin key over funds, no oracle, no upgradeability, no pause switch. The pot can only be spent buying or defending its own pool, and every rule you set is enforced on-chain.",
    },
  ],
  why: [
    {
      q: "Why not just run a buyback bot?",
      a: "A bot needs a funded EOA, a price feed, gas management and someone you trust to keep running it — and everyone can see its transactions coming. The hook's buyback executes inside the buy that funds it, at the pool's own price, with nothing to operate.",
    },
    {
      q: "Why is an oracle a problem for buybacks?",
      a: "An oracle is an extra trust assumption and an extra attack surface: manipulate the feed, and the buyback buys at the wrong moment. The hook never asks what the price is — it trades against the pool's own curve, which IS the price.",
    },
    {
      q: "Couldn't the team just market-buy manually?",
      a: "They can — that's exactly the opaque, trust-me pattern this replaces. Manual buybacks are unverifiable promises; the hook turns them into code anyone can read and quotes anyone can call.",
    },
    {
      q: "What are the two gaps the intro talks about?",
      a: "First: no credible, automatic way to spend treasury on defending a price without trusting someone. Second: V3/V4 concentrated positions never auto-compounded their own fees. The pot closes the first, the LP program closes the second.",
    },
    {
      q: "Does this replace a token locker or vesting product?",
      a: "No — the hook is deliberately not a locker. Surrendering the owner role locks liquidity forever, but time-locks, vesting and escrow are meant to be built ON TOP by composing with the roles.",
    },
  ],
  "quick-start": [
    {
      q: "What is the fastest way to get a hooked pool live?",
      a: "The app's create-pool wizard: pick the two tokens, the fee tier, your split preset, and press launch. One transaction creates the pool, initializes the pot, writes your config and seeds the liquidity.",
    },
    {
      q: "Can I attach the hook to an existing Uniswap pool?",
      a: "No — a V4 pool's hook is part of its identity and is fixed at creation. You launch a new pool with the hook attached and migrate liquidity to it.",
    },
    {
      q: "Which wallet/network do I need?",
      a: "Any EVM wallet on any of the 23 supported networks. The hook sits at the same address everywhere, so the flow is identical on Ethereum, Base, Robinhood Chain or any of the others.",
    },
    {
      q: "Do I have to configure everything at launch?",
      a: "No, but you should: launching with a full ProgramConfig means your split rules are live from the first trade. Everything except the pool itself stays editable later by the operator.",
    },
    {
      q: "How do I fuel the pot after launch?",
      a: "Donate the SECONDARY currency with donate(key, amount) — from the app's donate tab or from any contract. Harvests with a buyback share refuel the pot automatically as trading fees accrue.",
    },
  ],
  networks: [
    {
      q: "Why is the address the same on every chain?",
      a: "The contracts are deployed from a dedicated deployer key's first-ever transactions (nonce 0 and 1), so the CREATE addresses are identical by construction. Same bytecode, same address, every network.",
    },
    {
      q: "Why does the address itself matter for V4?",
      a: "Uniswap V4 reads a hook's permissions from the low bits of its address. The canonical address carries exactly the flag bits the machine needs — an address mismatch simply couldn't run these callbacks.",
    },
    {
      q: "Can you deploy to a chain that isn't listed?",
      a: "When a chain ships a canonical V4 PoolManager, the same deployer can repeat the deployment there with the same resulting address. Watch the repository or ask — the process is repeatable by design.",
    },
    {
      q: "Are testnets supported?",
      a: "Yes — Sepolia, Base Sepolia, Unichain Sepolia, Arbitrum Sepolia and Robinhood Testnet run the same contracts at the same address, so a testnet integration ports to mainnet unchanged.",
    },
    {
      q: "Is the source verified?",
      a: "On every network: Etherscan-family explorers, Blockscout instances, and Sourcify (full creation + runtime match). The docs' networks table links each explorer page directly.",
    },
  ],
  "the-pot": [
    {
      q: "Who controls the pot's balance?",
      a: "Nobody, including the pot admin — there is no withdrawal function. The pot's only two exits are pumping buys and shielding sells on its own pool, both at the pool's live price.",
    },
    {
      q: "What are MAIN and SECONDARY exactly?",
      a: "MAIN is the defended asset: it gets bought on pumps and absorbed from sells. SECONDARY is the war-chest currency: the only thing the pot holds and the only thing donate accepts.",
    },
    {
      q: "Can one token have several pots?",
      a: "Yes — a pot belongs to a POOL, not a token. Each hooked pool of the same token has its own independent pot, config and LP program.",
    },
    {
      q: "What does the recipient receive?",
      a: "The recipient receives the pot's output after the buyback split: whatever share isn't compounded into liquidity or burned. Setting the recipient to 0x0 routes that rest into the burn cascade instead.",
    },
    {
      q: "What happens when the pot is empty?",
      a: "Nothing breaks — the pool trades like a plain V4 pool and the machine idles. The next donation or the next harvest's buyback share wakes it up again.",
    },
  ],
  donations: [
    {
      q: "Who can donate, and to which pools?",
      a: "Anyone can donate to any hooked pool — a community member, a partner protocol, another contract. It's a permissionless public-goods action; no role or allowlist is involved.",
    },
    {
      q: "Can I get a donation back?",
      a: "No. Donations are irreversible by design — the pot has no withdrawal path for anyone. Treat a donation like burning value into the pool's defense budget.",
    },
    {
      q: "What exactly do I donate — MAIN or SECONDARY?",
      a: "Always the SECONDARY currency (native ETH via msg.value when secondary is native, an ERC20 pull otherwise). The pot spends secondary to buy or defend MAIN.",
    },
    {
      q: "How are fee-on-transfer tokens handled?",
      a: "The pot credits what actually arrived, not what you asked to send — the balance is measured on arrival. A tax token simply donates its post-tax amount.",
    },
    {
      q: "Can a smart contract donate programmatically?",
      a: "Yes — one call: hook.donate{value: amt}(key, amt). That's the whole integration; pair it with quotePump/quoteShield to size donations against the defense you want.",
    },
  ],
  pump: [
    {
      q: "When does a pump fire?",
      a: "In afterSwap, inside a buy of MAIN, in the same transaction. No schedule, no keeper, no button — the buy itself is the trigger.",
    },
    {
      q: "Why can't the pump be sandwiched?",
      a: "The spend is proportional to the carrying buy and capped, so a dust buy only unlocks a dust pump. Front-running it means pushing the price up before your own tiny unlock — the attacker pays more than they can extract.",
    },
    {
      q: "What price does the pump pay?",
      a: "The pool's own execution price at that moment, fees and tick impact included. There is no oracle to manipulate — the pot trades against the same curve as everyone else.",
    },
    {
      q: "Where does the bought MAIN go?",
      a: "Through the buyback split: a configurable share is compounded into the LP program's liquidity, a share is burned through the cascade, and the exact rest is delivered to the pot's recipient (0x0 = burn it all).",
    },
    {
      q: "Can a pump ever make my swap fail?",
      a: "No. The pump body is wrapped so any internal failure is swallowed and the carrying swap lands normally — the machine can only ever add to a trade, never block one.",
    },
  ],
  shield: [
    {
      q: "What does the seller actually get?",
      a: "Exactly what the pool would have paid — the pool's execution price with fee and tick impact included. The seller can't tell the shield exists; only the pool's reserves notice.",
    },
    {
      q: "Why doesn't the price move on a shielded sell?",
      a: "The pot absorbs the sell in beforeSwap: it takes the MAIN being sold and pays the secondary the pool would have paid, so the curve itself never processes the sell.",
    },
    {
      q: "What if the sell is bigger than the pot can absorb?",
      a: "The shield absorbs what it can afford and the remainder executes against the pool normally. Defense degrades gracefully — it never blocks or reverts the trade.",
    },
    {
      q: "Where does the absorbed MAIN go?",
      a: "Same as a pump's output: through the buyback split — compound share into liquidity, burn share through the cascade, the rest to the recipient.",
    },
    {
      q: "Can I preview the shield before selling?",
      a: "Yes: quoteShield(key, sellSize) returns what would be absorbed and what the pot would pay, as a view — UIs and contracts can read the defense before acting.",
    },
  ],
  delivery: [
    {
      q: "What is the burn cascade, in one line?",
      a: "Try the token's own burn(), else send to 0xdEaD, else hold the tokens on the hook forever — whichever step succeeds first, the supply is out of circulation.",
    },
    {
      q: "What does \"parked\" mean?",
      a: "A delivery the recipient refused (reverting receiver, blocklist, gas-hungry fallback). The value is booked instead of lost, and anyone can retry it later with flushDirect — the swap that carried it already landed.",
    },
    {
      q: "What is the held-forever ledger?",
      a: "heldOf(asset) counts tokens that could be neither burned nor sent to 0xdEaD, held on the hook with no withdrawal path, across all pools. Custody with no exit IS the burn — the view makes it auditable.",
    },
    {
      q: "Why bounded-gas pushes?",
      a: "A hostile recipient could otherwise burn the whole swap's gas. Deliveries get a fixed gas stipend; if that's not enough, the value books to the ledger and the trade completes.",
    },
    {
      q: "Can a weird token brick the machine?",
      a: "No — every external token interaction is wrapped in try/catch with a fallback, and the never-stop test matrix (hostile receivers, unburnable tokens, re-entrant recipients) proves a swap always lands.",
    },
  ],
  "buyback-management": [
    {
      q: "What are the two split knobs?",
      a: "potCompoundShareWad and potBurnShareWad — WAD fractions (1e18 = 100%) of every pump/shield output. Compound share becomes LP budget, burn share goes through the cascade, the exact remainder goes to the recipient.",
    },
    {
      q: "What happens with no LP program or a zeroed split?",
      a: "Compounding is effectively 0, and the output flows like before the split existed: everything to the recipient, or the whole amount through the burn cascade when the recipient is 0x0.",
    },
    {
      q: "Who edits the split?",
      a: "The program operator, via setProgramConfig — the same role and call that edits the LP fee shares. Surrendering the operator (0x0) freezes the split forever.",
    },
    {
      q: "Why can't a native MAIN take a burn share?",
      a: "Native coins have no burn() and no 0xdEaD transfer that removes supply — a \"burn\" would be a pretend. The config validation rejects it at write-time instead of lying at runtime.",
    },
    {
      q: "Does the compound leg mint immediately?",
      a: "It credits the program's carry — waiting LP budget covered by the hook's custody — and the next harvest mints it into the position together with the harvested fees. Nothing leaks in between.",
    },
  ],
  "lp-fees": [
    {
      q: "What are the seven numbers in one config?",
      a: "Per side: secondary → compound share + buyback share; main → compound share + burn share (the remainder of each side goes to its recipient), plus the two recipients and the harvest minimums packed in the same struct.",
    },
    {
      q: "Which side funds the pot?",
      a: "The secondary side's buyback share: that slice of every harvest is credited straight to the pot, making the machine self-funding from the pool's own traffic.",
    },
    {
      q: "Do LP fees and the buyback split interact?",
      a: "They're two independent stages: LP fees split at harvest time; pump/shield output splits at buyback time. Both can compound into the same position and both are edited by the same operator.",
    },
    {
      q: "Can the shares sum to less than 100%?",
      a: "Yes — the remainder of each side is exactly what the recipient receives. Shares above 100% per side are rejected at write-time with BadConfig.",
    },
    {
      q: "When do the fees actually move?",
      a: "At harvest: automatically inside a swap once the configured minimums are reached (within a gas budget), or manually via harvest(key) with full gas, callable by the owner — or by anyone once the owner surrendered.",
    },
  ],
  "lp-recipients": [
    {
      q: "How many recipients does a program have?",
      a: "One per side: a main-side recipient and a secondary-side recipient. Each receives the exact remainder of its side after the configured shares.",
    },
    {
      q: "Can a recipient be a contract?",
      a: "Yes — staking pools, splitters, vesting vaults, treasuries. Pushes carry a bounded gas stipend; a contract that needs more gas can always claim() its owed balance itself.",
    },
    {
      q: "What if the recipient refuses the transfer?",
      a: "The amount books to the owed ledger under (recipient, asset) and the harvest completes. The recipient — and only the recipient — can pull it any time with claim().",
    },
    {
      q: "Can the recipients be changed later?",
      a: "The operator edits them with setProgramConfig at any time — unless the operator was surrendered, which freezes recipients along with the rest of the config.",
    },
    {
      q: "What does recipient = 0x0 mean on a fee side?",
      a: "A side that can carry value (shares below 100%) must have a live recipient — that's validated at write-time. You zero a recipient only by making the shares consume the whole side.",
    },
  ],
  "lp-burn": [
    {
      q: "Why burn at the source instead of buy-and-burn?",
      a: "Main-side fees are already the defended asset — burning them directly removes supply with zero price impact and zero MEV surface. Buy-and-burn is what the pot's buyback share is for, on the other side.",
    },
    {
      q: "What exactly happens when the burn share fires?",
      a: "The slice goes through the cascade: token burn() first, 0xdEaD second, held-forever custody last. Whichever step lands, the tokens are out of circulation.",
    },
    {
      q: "Why is a burn share illegal on a native main?",
      a: "There's no honest way to destroy native coin from a contract — no burn(), and 0xdEaD custody of ETH is just parking. The config rejects it instead of faking it.",
    },
    {
      q: "Is the burn visible on-chain?",
      a: "Every burn emits the delivery event with its mode, and unburnable amounts appear in heldOf(asset). Supply trackers can reconstruct the full burn history from logs alone.",
    },
    {
      q: "Burn share vs buyback share — which defends the price more?",
      a: "The burn share shrinks supply silently; the buyback share adds buy pressure and refuels the defense. Most programs run both: burn on the main side, buyback on the secondary side.",
    },
  ],
  "lp-never-stops": [
    {
      q: "What is the worst a broken config can do?",
      a: "Nothing to traders. Every fee-machine failure is contained: the harvest reverts atomically (fees stay pending) or a delivery books to a ledger — the carrying swap lands either way.",
    },
    {
      q: "What if the auto-harvest runs out of gas?",
      a: "The in-swap harvest runs under a budget; blowing it reverts the harvest alone, atomically. Pending fees stay safe and anyone entitled can run harvest(key) manually with full gas.",
    },
    {
      q: "Can a hostile recipient block harvesting?",
      a: "No — a refusing recipient's amount books to the owed ledger and everything else settles normally. The hostility only hurts the hostile party's own payout timing.",
    },
    {
      q: "Can a re-entrant token attack the machine mid-swap?",
      a: "State-bearing entries sit behind a transient-storage guard: a re-entering call bounces while the frame is live. The adversarial suite proves the swap still completes.",
    },
    {
      q: "Why try/catch instead of letting errors bubble?",
      a: "Because the hook runs inside OTHER people's swaps. An error that bubbled would let any weird token or recipient grief every trader in the pool — so failures are absorbed, booked, and retried instead.",
    },
  ],
  compound: [
    {
      q: "What does the compound engine actually do?",
      a: "At every harvest it takes the configured share of collected fees (plus any carry) and mints it back into the program's own position — the auto-compounding that V3/V4 positions never had natively.",
    },
    {
      q: "Why does the carry exist?",
      a: "A two-sided mint can rarely place BOTH assets exactly — the pool's price fixes their ratio. Whatever can't be placed this round is carried, custody-backed, and retried next harvest. Nothing leaks.",
    },
    {
      q: "Does compounding cost me anything?",
      a: "No extra fee — the engine re-mints your own fees. The only cost is the gas of the harvest that carries it, which the in-swap path amortizes into normal trading.",
    },
    {
      q: "Can I compound 100% of fees?",
      a: "Yes — the 100% corner sends both sides' whole fee stream back into liquidity (recipients get nothing). It's the pure flywheel preset, and the validation accepts it.",
    },
    {
      q: "Does removing liquidity lose my carry?",
      a: "No — the carry survives a full exit, keeps growing from pumps if a compound share is set, and re-mints when liquidity exists again. It's proven by the remove-all-then-remint test.",
    },
  ],
  "compound-math": [
    {
      q: "What constraint does every mint satisfy?",
      a: "Uniswap's own liquidity formulas: for the position's range, L = min over both assets of the amount that fits at the current √price. The engine mints the min and carries the excess.",
    },
    {
      q: "Which side anchors the mint?",
      a: "The scarcer side at the current price — the engine computes both candidate Ls and the smaller one wins. The other side's surplus becomes carry, not waste.",
    },
    {
      q: "How does compound growth behave over time?",
      a: "Geometrically: each harvest re-mints a share of fees that are themselves proportional to liquidity, so position size follows roughly (1 + share·feeRate)ⁿ across n harvests.",
    },
    {
      q: "Is rounding a risk?",
      a: "All splits floor toward the protocol's ledgers and the dust lands in the carry — conservation is exact by construction and asserted wei-for-wei in the tests.",
    },
    {
      q: "Does the range width change the math?",
      a: "Only through the L formulas — a wider range needs more of both assets per unit of L. Full-range programs are the least ratio-sensitive; narrow ranges carry more between harvests.",
    },
  ],
  "compound-strategies": [
    {
      q: "What's a sensible default compound share?",
      a: "Most programs run 30–70% on the secondary side. Below that the position barely grows; above it the recipients see little — pick by how much you value depth versus income.",
    },
    {
      q: "When is 100% compound the right call?",
      a: "Bootstrap phases and community pools: everything the pool earns makes the pool deeper. Pair it with a locked owner and you get an ownerless, self-deepening pool.",
    },
    {
      q: "How do I read the carry as a signal?",
      a: "A persistently growing carry means the pool's price drifted from your position's balance point — the mint keeps hitting the same-side limit. It resolves itself when the price returns or the range is right.",
    },
    {
      q: "Should the two sides use the same share?",
      a: "Not necessarily: the secondary side competes with the buyback share (pot funding), the main side with the burn share. Balance each side's trio for your goal — depth, defense, or supply reduction.",
    },
    {
      q: "Can I change the shares as the pool matures?",
      a: "Any time, via the operator's setProgramConfig — heavy compounding early, then dialing toward recipients or burn later is a common lifecycle.",
    },
  ],
  harvest: [
    {
      q: "What triggers an automatic harvest?",
      a: "A swap, once the position's pending fees reach your configured minMain/minSecondary. The harvest runs inside that swap under a strict gas budget.",
    },
    {
      q: "Why did my swap not harvest?",
      a: "Either the minimums aren't reached, the minimums are disarmed (set to max), or the gas budget was exceeded and the harvest reverted atomically. Fees stay pending — nothing is lost.",
    },
    {
      q: "Who can harvest manually?",
      a: "The program owner via harvest(key) with full gas — and once the owner is surrendered (0x0), the harvest becomes public and anyone can run it.",
    },
    {
      q: "What are good minimums?",
      a: "High enough that the split beats the gas of running it, low enough to keep the pot fed. Testnets and high-traffic pools can go low; mainnet long-tail pools should set meaningful floors.",
    },
    {
      q: "Does harvesting touch the pool price?",
      a: "No — a harvest collects the position's fees and routes them. It never swaps through the curve, so it cannot move the price or be sandwiched.",
    },
  ],
  "harvest-math": [
    {
      q: "What does \"gross-referenced\" mean for the shares?",
      a: "All WAD shares of a side apply to that side's GROSS harvested amount, not to a running remainder — so 30% + 30% means exactly 30% and 30%, and the recipient gets exactly 40%.",
    },
    {
      q: "Where does rounding dust go?",
      a: "Shares floor; the recipient's remainder is computed by subtraction, so the legs sum to the gross byte-for-byte. Dust systematically favors the remainder leg.",
    },
    {
      q: "Is conservation actually proven?",
      a: "Yes — invariant PI5 asserts the delivery identity across randomized campaigns: everything acquired equals everything compounded + burned + delivered + booked, wei-exact.",
    },
    {
      q: "How is 100% per side validated?",
      a: "Each side's two shares may sum to at most 1e18 (100%). Above that, setProgramConfig and launch revert with BadConfig at write-time — never at trade-time.",
    },
    {
      q: "Do both sides settle in the same harvest?",
      a: "Yes — one harvest collects both fee assets and runs both sides' splits in the same transaction, so the two ledgers never drift apart.",
    },
  ],
  "harvest-payouts": [
    {
      q: "Why did my payout not arrive as a transfer?",
      a: "Pushes carry a bounded gas stipend. If your receiver needs more (or reverted), the amount was booked to the owed ledger — call claim() to pull it with your own gas.",
    },
    {
      q: "Who can call claim()?",
      a: "Only the booked recipient, for their own (recipient, asset) balance. There's no admin sweep and no expiry — owed balances wait forever.",
    },
    {
      q: "What's the difference between owed and parked?",
      a: "Owed = harvest payouts refused by a recipient, pulled via claim(). Parked = pot deliveries refused by the pot recipient, retryable BY ANYONE via flushDirect.",
    },
    {
      q: "Can a booked balance be redirected?",
      a: "No — bookings are keyed to the recipient at the moment of the harvest. Changing the config redirects FUTURE harvests only; history is immutable.",
    },
    {
      q: "Is the venue solvent for these ledgers?",
      a: "Yes — the obligation invariant checks that the hook's custody always covers pot balances + carry + owed + parked, across every randomized campaign.",
    },
  ],
  autonomy: [
    {
      q: "Does the pool literally run with zero human involvement?",
      a: "Once launched, yes — every engine (harvest, compound, buyback, burn, payouts) is triggered by swaps themselves. Humans only exist at the policy layer: setting the split, fueling the pot, optionally running a manual harvest. All of those are inputs, not dependencies.",
    },
    {
      q: "What happens to the machine if the team abandons the project?",
      a: "Nothing. The trigger is trading, not the team: as long as anyone swaps, fees harvest, the position compounds, the pot pumps and shields, and supply burns. If the roles were surrendered, even the policy is frozen and runs unchanged forever.",
    },
    {
      q: "Is this the same as renouncing a token contract?",
      a: "Stronger. Renouncing usually just removes a mint key. Surrendering the hook's roles freezes an active machine — a buyback, burn and compounding program that keeps executing on immutable terms, not just a promise to do nothing bad.",
    },
    {
      q: "If no keeper is paid, who pays the gas for all this?",
      a: "The triggering swap carries a bounded slice of gas for the auto-harvest, controlled by the minimums the operator sets — so it only fires when the harvest is worth far more than the overhead. Pumps and shields ride the swaps that trigger them. Heavy work can always go through the optional manual path with the caller's own gas.",
    },
    {
      q: "Can autonomy ever hurt a trader?",
      a: "No — that's the design's hard line. Every autonomous action is wrapped in fault tolerance: if anything about the hook's state or settings would fail, the action is skipped and the swap completes exactly as a vanilla pool. Sellers always receive the pool's exact output.",
    },
  ],
  "autonomous-buyback": [
    {
      q: "Why is having no oracle an advantage rather than a limitation?",
      a: "An oracle is a dependency you must trust and an attacker can bend. The pot trades against the pool's own curve, which IS the price by definition — there is nothing to manipulate upstream of the buyback and no feed that can go stale.",
    },
    {
      q: "What role do arbitrageurs play in the buyback?",
      a: "None — and that's the point. Designs that move a reference price rely on arbitrageurs to realign the market, paying them a spread on every cycle. Pump and shield execute at the pool's exact tick math inside the trade itself, so no gap opens and no value leaks to third parties.",
    },
    {
      q: "Can the pot be drained by whoever controls it?",
      a: "Nobody controls it in the withdrawal sense. There is no function that pays the pot out to an address at will — it can only spend on buying or defending its own pool, and its purchases follow the configured split (compound, burn, recipient). The worst a hostile admin can do is point deliveries somewhere else; they can never extract the pot's balance directly.",
    },
    {
      q: "What keeps the pot funded long-term without a treasury?",
      a: "Two permissionless flows: anyone can donate at any time (the community, the protocol's own contracts, a partner), and a buybackShare on the fee split refuels the pot from the pool's own trading, forever. A pool with volume is structurally self-funding.",
    },
    {
      q: "Does the autonomous buyback ever front-run or sandwich its own traders?",
      a: "It can't — it has no separate transaction to place. Pump executes inside the buy, shield inside the sell, atomically. There's no pending buyback order in the mempool to trade around, and the trader's own amounts are never touched.",
    },
  ],
  "autonomous-compounding": [
    {
      q: "How is this different from an auto-compounding vault?",
      a: "A vault is a wrapper: a new contract you deposit into, usually charging a performance fee, run by a protocol that must keep operating. Here compounding is native to the pool's own program — no wrapper, no deposit, no fee on your growth, and no protocol whose shutdown ends the service.",
    },
    {
      q: "Why doesn't the engine swap fees to rebalance them before minting?",
      a: "Rebalancing swaps pay the fee tier and cross the spread — a permanent leak from your yield, and a predictable flow for others to trade against. The engine instead mints the maximum the two-sided constraint allows at the live price and carries the remainder, so growth costs zero spread.",
    },
    {
      q: "What exactly is the carry and is it ever lost?",
      a: "Minting needs both tokens in the ratio the current tick dictates; whatever doesn't fit that ratio is the carry. It stays credited to the program, is first in line at the next compound, and appears in the views — nothing is ever sold off, donated to the market, or orphaned.",
    },
    {
      q: "What if a compound would be too gas-heavy inside a swap?",
      a: "The auto-run operates under a hard gas budget in its own frame: if it would exceed it, it reverts atomically — fees stay pending, nothing half-executes, and the carrying swap completes untouched. The manual harvest(key) path with full caller gas picks it up.",
    },
    {
      q: "Does compounding stop if the operator surrenders?",
      a: "No — surrender freezes the compoundShare at its current value and the loop keeps running on those terms forever. Volume remains the only input; the org chart was never part of the equation.",
    },
  ],
  roles: [
    {
      q: "What are the three roles again?",
      a: "Pot admin (the pool's initializer: sets the pot recipient, creates the one LP program), program owner (holds the liquidity, harvests, transfers), program operator (edits config).",
    },
    {
      q: "What does surrendering the owner do?",
      a: "owner = 0x0 locks the liquidity forever — nobody can ever remove it — and the harvest becomes public. It's the strongest \"liquidity locked\" statement possible.",
    },
    {
      q: "What does surrendering the operator do?",
      a: "operator = 0x0 freezes the config forever: fee splits, buyback split, recipients and minimums become immutable. The owner keeps its property rights.",
    },
    {
      q: "Can the roles be held by contracts?",
      a: "Yes — that's the composition surface: DAOs, lockers, vesting contracts and launchpads hold roles and expose their own policies on top of the hook's primitives.",
    },
    {
      q: "Can a surrendered role be recovered?",
      a: "Never — surrender writes 0x0 and there is no path back. It's a feature: the irreversibility is what makes the promise credible.",
    },
  ],
  launch: [
    {
      q: "What does launchPool do in one transaction?",
      a: "Creates the V4 pool with the hook attached, initializes the pot, creates the LP program with YOUR ProgramConfig, and seeds the first liquidity — configured from block one.",
    },
    {
      q: "Should I use plain addLiquidity or the advanced path?",
      a: "Prefer addLiquidityAdvanced (or launchPool with a config): it writes your split rules atomically with the program. Plain addLiquidity is the bare shortcut — zeroed shares, you as owner/operator.",
    },
    {
      q: "What are the plain addLiquidity defaults?",
      a: "The caller becomes owner AND operator (so everything stays editable later), all shares start at zero, and the pot recipient defaults toward burn. Nothing is locked by accident.",
    },
    {
      q: "Why did the launch revert with BadConfig?",
      a: "A side's shares sum above 100%, a burn share on a native main, a value-carrying side without a live recipient, or a malformed liquidity request. All validation is at write-time by design.",
    },
    {
      q: "Can a pool have more than one LP program?",
      a: "No — one program per pool, created once (PotAlreadyReady on a second attempt). Later deposits go through addProgramLiquidity, which tops up the existing position.",
    },
  ],
  manage: [
    {
      q: "Which settings can I edit after launch?",
      a: "Everything in ProgramConfig: both sides' fee shares, the buyback split, both recipients and the harvest minimums — via the operator's setProgramConfig. The pool itself (tokens, fee tier, hook) is fixed.",
    },
    {
      q: "How do I arm or disarm the auto-harvest?",
      a: "Set minMain/minSecondary: real values arm the in-swap harvest at those floors; type(uint256).max disarms it, leaving only the manual harvest(key) path.",
    },
    {
      q: "How do I hand the program to a multisig or DAO?",
      a: "Transfer the owner and/or operator to the contract's address — each role moves independently, so you can give a DAO the settings while a locker holds the property.",
    },
    {
      q: "What can the pot admin change?",
      a: "Only the pot recipient (where the buyback split's remainder goes, 0x0 = burn) — and only while the main isn't native for a burn target. The admin has no power over anyone's funds.",
    },
    {
      q: "How do I read my program's health?",
      a: "programOf(id) shows the position, shares and carry; potOf(id) the war chest; owedOf/parkedOf/heldOf the ledgers; quotePump/quoteShield the live defense. All views, all free.",
    },
  ],
  liquidity: [
    {
      q: "How do amounts turn into a liquidity value?",
      a: "The app computes L from your typed amounts at the pool's live price over the position's range (Uniswap's own formulas), then shaves a hair so on-chain round-up never exceeds what you typed.",
    },
    {
      q: "Why did adding liquidity trigger a buyback?",
      a: "Your deposit's swap-less price touch still runs the hook's callbacks — a pending harvest or a compound-carry mint can settle inside your transaction. It's your own machine doing scheduled work, not a fee.",
    },
    {
      q: "What happens to the extra native I send?",
      a: "The native side is a hard cap: whatever the mint doesn't consume is refunded in the same transaction. You never overpay for a two-sided mint.",
    },
    {
      q: "Who can add or remove liquidity?",
      a: "Only the program owner — adds top up the one hook-held position, removals settle harvest-first so pending fees are never orphaned. A surrendered owner means removals are impossible forever.",
    },
    {
      q: "What does removing ALL liquidity leave behind?",
      a: "The program, its config, its carry and the pot all survive. Pumps keep splitting into the carry, and the next add re-arms the full machine with the carry re-minted at the next harvest.",
    },
  ],
  integrate: [
    {
      q: "What's the minimum integration?",
      a: "One line: hook.donate{value: amt}(key, amt) fuels a pool's defense from any contract. No token approvals needed for a native secondary, one approve otherwise.",
    },
    {
      q: "How do I read the machine before acting?",
      a: "quotePump(key, buySize) and quoteShield(key, sellSize) are free views returning the spend/output the machine WOULD do — size your logic against them, no oracle involved.",
    },
    {
      q: "Can I build buy-pressure logic without holding a role?",
      a: "Yes — donations and quotes are permissionless. A router, a game, a rewards contract can fuel and read any hooked pool without asking anyone.",
    },
    {
      q: "How do I find the hook on a new chain?",
      a: "Same address everywhere: 0xb216070c3509047ea597E2E626A29cea427a60C8. Hardcode it once, gate by chainId if you must, and the integration ports across all 23 networks.",
    },
    {
      q: "What events should my indexer watch?",
      a: "The harvest event for fee flows, the delivery events for pump/shield/burn output (each carries its mode), and the pot events for donations. Everything the machine does is reconstructible from logs.",
    },
  ],
  "build-apps": [
    {
      q: "Can I build a launchpad on GlueHook?",
      a: "Yes, explicitly — launchPool was designed for it: your launcher composes token creation with a one-transaction hooked-pool launch, and your product holds whatever roles your policy needs.",
    },
    {
      q: "How does a locker compose with the roles?",
      a: "The locker contract holds the owner role and enforces its own timelock before ever calling removeLiquidity — the hook stays a neutral primitive; the locker is the policy.",
    },
    {
      q: "Can a vault automate harvest and claims?",
      a: "Yes — a keeper-style vault can hold the owner role (or act after a surrender made harvest public), call harvest(key) on its schedule, and claim() its owed balances.",
    },
    {
      q: "Do I need permission or an API key?",
      a: "No — everything is on-chain and permissionless: public functions, free views, deterministic addresses. The docs and the verified source are the whole integration surface.",
    },
    {
      q: "Is there a reference UI I can fork?",
      a: "This site itself — the app is a DB-less, indexer-less interface that any team can fork and re-skin; pools are discovered from public logs and token lists.",
    },
  ],
  api: [
    {
      q: "Which functions mutate and which are free views?",
      a: "Mutating: launchPool, initPot, addLiquidity(+Advanced), addProgramLiquidity, removeLiquidity, harvest, donate, claim, flushDirect and the setters. Views: potOf, programOf, quotePump, quoteShield, owedOf, parkedOf, heldOf, obligationOf and friends.",
    },
    {
      q: "Who may call what?",
      a: "Trading paths and donations: anyone. harvest: owner (public after surrender). Liquidity: owner. setProgramConfig: operator. setRecipient: pot admin. claim: the booked recipient. flushDirect: anyone.",
    },
    {
      q: "What units do the shares use?",
      a: "WAD — 1e18 = 100%. All amounts elsewhere are raw token units in each token's own decimals; nothing is normalized behind your back.",
    },
    {
      q: "What are the main custom errors?",
      a: "BadConfig for write-time validation, PotAlreadyReady for a second program attempt, plus auth errors on the role-gated calls. Trade-path failures never surface as reverts to the swapper.",
    },
    {
      q: "Where is the exact struct layout?",
      a: "This page lists ProgramConfig and Program field by field; the verified source on any explorer and the repository's interface file are the canonical machine-readable versions.",
    },
  ],
  security: [
    {
      q: "What's the headline trust model?",
      a: "Immutable code, no admin over funds, no oracle, no upgradeability. The pot spends only on its own pool at the pool's price; roles control policy, never other people's money.",
    },
    {
      q: "How is it tested?",
      a: "123 local Foundry tests (128 with live-fork proofs on Ethereum and Tempo): unit, adversarial never-stop matrices, stateful invariants with randomized campaigns, and deterministic scenario walks.",
    },
    {
      q: "What do the invariants actually check?",
      a: "Delivery conservation (everything acquired = compounded + burned + delivered + booked), custody solvency over all ledgers, config validity, and that hostile actors can't stop swaps.",
    },
    {
      q: "Why can't the pot be used to manipulate the market?",
      a: "It only ever trades its own pool at the pool's own price, sized by the carrying trade. Pushing the price first worsens the pusher's own fill — the mechanism taxes its own manipulation.",
    },
    {
      q: "Has the bytecode been size- and gas-audited?",
      a: "Yes — the audit doc tracks runtime sizes (hook + delegatecall library under EIP-170), per-path gas, and the in-swap budget that keeps harvests from griefing trades.",
    },
  ],
  glossary: [
    {
      q: "Why does the doc insist on MAIN vs SECONDARY?",
      a: "Because every rule is asymmetric: pumps buy MAIN with SECONDARY, the pot holds only SECONDARY, burn shares exist only on MAIN. Mixing the two words up makes every sentence wrong.",
    },
    {
      q: "Is \"pot\" the same as the LP program?",
      a: "No — the pot is the buyback war chest (secondary only); the program is the hook-held liquidity position with its split rules. They cooperate but have separate balances and roles.",
    },
    {
      q: "What's the difference between carry and owed?",
      a: "Carry is compound budget waiting to be minted into liquidity. Owed is a payout a recipient refused, waiting to be claimed. Both are custody-backed, neither expires.",
    },
    {
      q: "What does WAD mean in configs?",
      a: "The 1e18 fixed-point scale: 5e17 = 50%, 1e18 = 100%. All shares in ProgramConfig are WADs; amounts everywhere else are raw token units.",
    },
    {
      q: "What is \"held forever\" exactly?",
      a: "Burn-intent tokens that refused both burn() and 0xdEaD, kept on the hook with no withdrawal path, counted per asset by heldOf. Custody with no exit is the burn of last resort.",
    },
  ],
  license: [
    {
      q: "Can I build a product on the deployed hook?",
      a: "Yes — launchpads, lockers, vaults, UIs and integrations that CALL the canonical deployments are the intended use and don't touch the source licence at all.",
    },
    {
      q: "Can I fork the code into my own hook?",
      a: "Not for production: BUSL-1.1 grants copy/modify/derivative rights for NON-production use only. Shipping a competing deployment needs a grant from the licensor until the Change Date.",
    },
    {
      q: "When does the code become fully open?",
      a: "On the Change Date — the earlier of 2030-08-05 or a date published on-chain at the licence ENS records — the licence converts to GPL v2.0 or later, automatically.",
    },
    {
      q: "Can I read, audit and test the source?",
      a: "Freely — reading, auditing, running the test-suite and any other non-production use is explicitly granted to everyone, today.",
    },
    {
      q: "Who do I ask for a production grant?",
      a: "Glue Labs Inc. — additional use grants are published at the ENS record listed in LICENCE.txt, and the team is reachable through the repository or @glue_fi.",
    },
  ],
};
