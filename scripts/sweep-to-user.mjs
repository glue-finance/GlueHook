// SPDX-License-Identifier: BUSL-1.1
// https://github.com/glue-finance/GlueHook/blob/main/LICENCE.txt
//
// Drain EVERY old deployer's full balance to a user-owned address on every target chain, leaving
// only the sweep transaction's own MAX cost behind (gasLimit * bumped maxFeePerGas + an OP-stack
// L1-data-fee buffer) so the send can never fail on insufficient funds for gas.
//
// This is the anonymity-preserving retirement of spent deployer keys: nothing flows old→new
// deployer on-chain — the old keys empty into the user's wallet, and the NEW deployer is funded
// out-of-band by the user.
//
// Usage:
//   node scripts/sweep-to-user.mjs check                 # read-only: balances + sweepable report
//   node scripts/sweep-to-user.mjs sweep                 # actually send, chain by chain
//   node scripts/sweep-to-user.mjs sweep "Base"          # only chains whose name contains the filter
//
// Sources: .deployer.v1.key, .deployer.tempo.key, .deployer.v2.key, .deployer.key (v3) —
// whichever exist. Tempo native is a sentinel, but pathUSD (the fee stablecoin) IS real value
// and is swept as an ERC20, keeping a small reserve for the transfer's own pathUSD-denominated fee.
// Destination: the SWEEP_DEST environment variable (never hard-coded, never committed).
//
//   SWEEP_DEST=0x… node scripts/sweep-to-user.mjs check

import { readFileSync, existsSync } from "node:fs";
import { ethers } from "ethers";

const DEST = ethers.getAddress(process.env.SWEEP_DEST ?? "");

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
    ["Avalanche",         "https://api.avax.network/ext/bc/C/rpc"],
    ["Blast",             "https://rpc.blast.io"],
    ["Celo",              "https://forno.celo.org"],
    ["Monad",             "https://rpc.monad.xyz"],
    ["X Layer",           "https://rpc.xlayer.tech"],
    // Tempo native is EXCLUDED from this loop: its native balance is a sentinel (4242… for every
    // account, fees ride stablecoins). pathUSD is swept separately below.
    ["Sepolia",           "https://ethereum-sepolia-rpc.publicnode.com"],
    ["Base Sepolia",      "https://sepolia.base.org"],
    ["Unichain Sepolia",  "https://unichain-sepolia-rpc.publicnode.com"],
    ["Arbitrum Sepolia",  "https://sepolia-rollup.arbitrum.io/rpc"],
    ["Robinhood Testnet", "https://rpc.testnet.chain.robinhood.com"],
];

const sources = [];
for (const [file, label] of [
    [".deployer.v1.key", "v1"],
    [".deployer.tempo.key", "tempo"],
    [".deployer.v2.key", "v2"],
    [".deployer.key", "v3"],
]) {
    if (existsSync(file)) {
        const w = new ethers.Wallet(readFileSync(file, "utf8").trim());
        sources.push([w, label]);
        console.log(`source ${label.padEnd(6)} ${w.address}`);
    }
}
console.log(`destination     ${DEST}\n`);

function fmt(wei) {
    return ethers.formatEther(wei);
}

for (const [name, rpc] of NETS) {
    if (FILTER && !name.toLowerCase().includes(FILTER)) continue;
    let line = `${name.padEnd(18)}`;
    try {
        const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
        const fee = await provider.getFeeData();
        const maxFee = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;

        for (const [src, label] of sources) {
            const bal = await provider.getBalance(src.address);
            if (bal === 0n) continue;

            // The chain's OWN intrinsic gas for a plain transfer (Arbitrum-style chains charge
            // more than 21000), padded 25%; plus a flat buffer for the OP-stack L1 data fee.
            let gasLimit = 21_000n;
            try {
                gasLimit = await provider.estimateGas({ from: src.address, to: DEST, value: 1n });
            } catch {}
            gasLimit = (gasLimit * 125n) / 100n;
            const L1_BUFFER = ethers.parseEther("0.00003");

            // 2x bump so a re-run replaces a stuck same-nonce tx instead of "already known".
            const bumpedMax = maxFee * 2n;
            const bumpedPriority = (fee.maxPriorityFeePerGas ?? 0n) * 2n + (bumpedMax / 4n);

            const sweepCost = gasLimit * bumpedMax + L1_BUFFER;
            if (bal <= sweepCost) {
                line += ` | ${label} bal ${fmt(bal)} <= cost, skip`;
                continue;
            }
            const value = bal - sweepCost;

            if (MODE === "sweep") {
                const signer = src.connect(provider);
                const nonce = await provider.getTransactionCount(src.address, "latest");
                const tx = await signer.sendTransaction({
                    to: DEST,
                    value,
                    gasLimit,
                    nonce,
                    maxFeePerGas: fee.maxFeePerGas ? bumpedMax : undefined,
                    maxPriorityFeePerGas: fee.maxFeePerGas ? (bumpedPriority > bumpedMax ? bumpedMax : bumpedPriority) : undefined,
                    gasPrice: fee.maxFeePerGas ? undefined : bumpedMax,
                });
                await tx.wait(1, 90_000);
                line += ` | ${label} swept ${fmt(value)} (${tx.hash.slice(0, 10)}…)`;
            } else {
                line += ` | ${label} sweepable ${fmt(value)}`;
            }
        }
    } catch (e) {
        line += ` | ERROR: ${String(e.message ?? e).slice(0, 90)}`;
    }
    console.log(line);
}

// ---------------------------------------------------------------------------
// Tempo pathUSD — the fee stablecoin IS the value on this chain
// ---------------------------------------------------------------------------

if (!FILTER || "tempo".includes(FILTER)) {
    const PATH_USD = "0x20c0000000000000000000000000000000000000";
    const ERC20 = [
        "function balanceOf(address) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function transfer(address,uint256) returns (bool)",
    ];
    let line = "Tempo (pathUSD)   ";
    try {
        const provider = new ethers.JsonRpcProvider("https://rpc.tempo.xyz", undefined, { staticNetwork: true });
        const token = new ethers.Contract(PATH_USD, ERC20, provider);
        const dec = await token.decimals();
        // the transfer's own fee is deducted from the SAME pathUSD balance — keep a generous
        // reserve behind (a plain TIP-20 transfer costs a small fraction of this)
        const FEE_RESERVE = 5n * 10n ** (BigInt(dec) - 1n); // 0.5 pathUSD

        for (const [src, label] of sources) {
            const bal = await token.balanceOf(src.address);
            if (bal === 0n) continue;
            if (bal <= FEE_RESERVE) {
                line += ` | ${label} bal ${ethers.formatUnits(bal, dec)} <= fee reserve, skip`;
                continue;
            }
            const value = bal - FEE_RESERVE;
            if (MODE === "sweep") {
                const tx = await token.connect(src.connect(provider)).transfer(DEST, value);
                await tx.wait(1, 90_000);
                line += ` | ${label} swept ${ethers.formatUnits(value, dec)} pathUSD (${tx.hash.slice(0, 10)}…)`;
            } else {
                line += ` | ${label} sweepable ${ethers.formatUnits(value, dec)} pathUSD`;
            }
        }
    } catch (e) {
        line += ` | ERROR: ${String(e.message ?? e).slice(0, 90)}`;
    }
    console.log(line);
}
