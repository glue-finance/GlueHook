// SPDX-License-Identifier: BUSL-1.1
// https://github.com/glue-finance/GlueHook/blob/main/LICENCE.txt
//
// Sweep the OLD deployer's leftover gas into the NEW deployer on every target chain, leaving
// EXACTLY the sweep transaction's own max cost behind (21000 * maxFeePerGas) so the send can never
// fail on insufficient funds for gas — the mistake to avoid is subtracting the ESTIMATED cost
// (gasPrice) instead of the MAX cost (maxFeePerGas), which strands the transaction.
//
// Usage:
//   node scripts/sweep-to-new.mjs check                 # read-only: balances + sufficiency report
//   node scripts/sweep-to-new.mjs sweep                 # actually send, chain by chain
//   node scripts/sweep-to-new.mjs sweep "Unichain"      # only chains whose name contains the filter
//
// Sweeps are sent with a 2x fee bump over the current maxFeePerGas so a re-run REPLACES a stuck
// same-nonce transaction instead of tripping "already known"; waits are capped at 90s per chain.
//
// Reads .deployer.v1.key (the spent v1 deployer) and .deployer.key (the new one, for the target
// address). Tempo's own v1 key (.deployer.tempo.key) is swept too when present.

import { readFileSync, existsSync } from "node:fs";
import { ethers } from "ethers";

const MODE = process.argv[2] ?? "check";
const FILTER = process.argv[3]?.toLowerCase() ?? null;

const NETS = [
    ["Ethereum",          "https://ethereum-rpc.publicnode.com"],
    ["Base",              "https://mainnet.base.org"],
    // publicnode, NOT mainnet.unichain.org — the official endpoint accepts eth_sendRawTransaction
    // but silently drops the transaction (returns a hash, never propagates).
    ["Unichain",          "https://unichain-rpc.publicnode.com"],
    ["Arbitrum",          "https://arb1.arbitrum.io/rpc"],
    ["Optimism",          "https://mainnet.optimism.io"],
    ["BNB Chain",         "https://bsc-dataseed.bnbchain.org"],
    ["Polygon",           "https://polygon-bor-rpc.publicnode.com"],
    ["World Chain",       "https://worldchain-mainnet.g.alchemy.com/public"],
    ["Zora",              "https://rpc.zora.energy"],
    ["Soneium",           "https://rpc.soneium.org"],
    ["MegaETH",           "https://mainnet.megaeth.com/rpc"],
    ["Robinhood",         "https://rpc.mainnet.chain.robinhood.com"],
    // Tempo is EXCLUDED: its native balance is a sentinel (4242… for every account, fees ride a
    // different mechanism), so there is nothing real to sweep and a "max cost" subtraction is
    // meaningless there — the new deployer already carries the same sentinel balance.
    ["Sepolia",           "https://ethereum-sepolia-rpc.publicnode.com"],
    ["Base Sepolia",      "https://sepolia.base.org"],
    ["Unichain Sepolia",  "https://unichain-sepolia-rpc.publicnode.com"],
    ["Arbitrum Sepolia",  "https://sepolia-rollup.arbitrum.io/rpc"],
    ["Robinhood Testnet", "https://rpc.testnet.chain.robinhood.com"],
];

// Both deploys together (lib ~2.3M + hook ~6.2M incl. calldata) with headroom.
const DEPLOY_GAS = 9_500_000n;

const oldW = new ethers.Wallet(readFileSync(".deployer.v1.key", "utf8").trim());
const newW = new ethers.Wallet(readFileSync(".deployer.key", "utf8").trim());
const tempoW = existsSync(".deployer.tempo.key")
    ? new ethers.Wallet(readFileSync(".deployer.tempo.key", "utf8").trim())
    : null;

console.log(`old deployer:   ${oldW.address}`);
if (tempoW) console.log(`tempo deployer: ${tempoW.address}`);
console.log(`new deployer:   ${newW.address}\n`);

function fmt(wei) {
    return ethers.formatEther(wei);
}

for (const [name, rpc] of NETS) {
    if (FILTER && !name.toLowerCase().includes(FILTER)) continue;
    let line = `${name.padEnd(18)}`;
    try {
        const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
        const sources = [oldW];

        const fee = await provider.getFeeData();
        // MAX cost per gas: prefer EIP-1559 maxFeePerGas, else legacy gasPrice — never undercount
        const maxFee = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
        const needed = DEPLOY_GAS * maxFee;
        const newBal = await provider.getBalance(newW.address);

        let sweptTotal = 0n;
        for (const src of sources) {
            const bal = await provider.getBalance(src.address);
            if (bal === 0n) continue;

            // The chain's OWN intrinsic gas for a plain transfer (Arbitrum-style chains charge more
            // than 21000), padded 25%; plus a flat buffer for the OP-stack L1 data fee, which is
            // charged ON TOP of gasLimit*maxFee and would otherwise strand the sweep.
            let gasLimit = 21_000n;
            try {
                gasLimit = await provider.estimateGas({ from: src.address, to: newW.address, value: 1n });
            } catch {}
            gasLimit = (gasLimit * 125n) / 100n;
            const L1_BUFFER = ethers.parseEther("0.00003");

            // 2x bump so a re-run replaces a stuck same-nonce tx instead of "already known".
            const bumpedMax = maxFee * 2n;
            const bumpedPriority = (fee.maxPriorityFeePerGas ?? 0n) * 2n + (bumpedMax / 4n);

            const sweepCost = gasLimit * bumpedMax + L1_BUFFER;
            if (bal <= sweepCost) {
                line += ` | old bal ${fmt(bal)} <= sweep cost, skipped`;
                continue;
            }
            const value = bal - sweepCost;
            sweptTotal += value;

            if (MODE === "sweep") {
                const signer = src.connect(provider);
                const nonce = await provider.getTransactionCount(src.address, "latest");
                const tx = await signer.sendTransaction({
                    to: newW.address,
                    value,
                    gasLimit,
                    nonce,
                    maxFeePerGas: fee.maxFeePerGas ? bumpedMax : undefined,
                    maxPriorityFeePerGas: fee.maxFeePerGas ? (bumpedPriority > bumpedMax ? bumpedMax : bumpedPriority) : undefined,
                    gasPrice: fee.maxFeePerGas ? undefined : bumpedMax,
                });
                await tx.wait(1, 90_000);
                line += ` | swept ${fmt(value)} (${tx.hash.slice(0, 10)}…)`;
            } else {
                line += ` | sweepable ${fmt(value)}`;
            }
        }

        const projected = newBal + (MODE === "sweep" ? 0n : sweptTotal);
        const finalBal = MODE === "sweep" ? await provider.getBalance(newW.address) : projected;
        const ok = finalBal >= needed;
        line += ` | new bal ${fmt(finalBal)} | need ~${fmt(needed)} @${ethers.formatUnits(maxFee, "gwei")}gwei | ${ok ? "ENOUGH ✓" : "TOP-UP NEEDED ✗"}`;
    } catch (e) {
        line += ` | ERROR: ${String(e.message ?? e).slice(0, 90)}`;
    }
    console.log(line);
}
