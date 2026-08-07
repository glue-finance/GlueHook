// SPDX-License-Identifier: BUSL-1.1
// https://github.com/glue-finance/GlueHook/blob/main/LICENCE.txt
//
// SAME-ADDRESS-EVERYWHERE deployer miner for GlueHook.
//
// Uniswap V4 reads a hook's permissions from the LOW 14 BITS of its address (GlueHook needs
// exactly 0x20C8), and the PoolManager address DIFFERS on every chain — so CREATE2 (whose address
// commits to the init code, constructor args included) cannot give one address on all chains.
//
// A plain CREATE deploy can: `address = keccak256(rlp(deployer, nonce))` ignores the init code
// entirely. The deploy is TWO transactions from a fresh key — the GlueLiquidity library at
// NONCE 0, then the hook (delegatecall-linked against that library) at NONCE 1 — so this script
// mines a key whose NONCE-1 contract address carries the hook bits. Run both transactions, in
// order, as the key's first activity on every chain (any PoolManager arg, even chains where V4
// ships later) and BOTH contracts land at the same addresses everywhere.
//
// Expected work: 2^14 = ~16k candidate keys — a few seconds (plain random keys, not HD wallets:
// mnemonic derivation is ~50x slower per try and buys nothing for a throwaway deployer).
//
// SECURITY: the mined key is written to `.deployer.key` (git-ignored, chmod 600) and NEVER printed.
// Treat that file like a hardware wallet seed until every chain is deployed, then discard it —
// the key has no purpose after deployment.
//
// Usage:
//   node scripts/mine-deployer.mjs
//
// Then, per chain (the key's first TWO and only transactions there):
//   node scripts/deploy-nonce0.mjs <rpcUrl> <poolManager>

import { writeFileSync, existsSync } from "node:fs";
import { ethers } from "ethers";

const HOOK_FLAGS = 0x20c8n;
const HOOK_MASK = (1n << 14n) - 1n;
const KEY_FILE = ".deployer.key";

if (existsSync(KEY_FILE)) {
    console.error(`${KEY_FILE} already exists — refusing to overwrite a live deployer key.`);
    console.error("If you really want a new one, move or delete the old file first.");
    process.exit(1);
}

for (let i = 1; ; i++) {
    const wallet = new ethers.Wallet(ethers.hexlify(ethers.randomBytes(32)));
    const hook = ethers.getCreateAddress({ from: wallet.address, nonce: 1 });
    if ((BigInt(hook) & HOOK_MASK) !== HOOK_FLAGS) continue;

    const lib = ethers.getCreateAddress({ from: wallet.address, nonce: 0 });
    writeFileSync(KEY_FILE, wallet.privateKey + "\n", { mode: 0o600 });
    console.log(`deployer (fund this with gas on every target chain):  ${wallet.address}`);
    console.log(`GlueLiquidity (nonce-0 deploy, SAME on every chain): ${lib}`);
    console.log(`hook address (nonce-1 deploy, SAME on every chain):   ${hook}`);
    console.log(`low 14 bits: 0x${(BigInt(hook) & HOOK_MASK).toString(16)} (required 0x20c8) ✓`);
    console.log(`tries: ${i}`);
    console.log(`key written to ${KEY_FILE} (git-ignored, mode 600) — never share or commit it.`);
    process.exit(0);
}
