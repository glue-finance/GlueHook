// SPDX-License-Identifier: BUSL-1.1
// https://github.com/glue-finance/GlueHook/blob/main/LICENCE.txt
//
// CREATE2 salt miner for GlueHook.
//
// Uniswap V4 reads a hook's permissions from the LOW 14 BITS of its address, so GlueHook must be
// deployed at an address whose low bits equal EXACTLY its permission set:
//
//   beforeInitialize | beforeSwap | afterSwap | beforeSwapReturnsDelta  =  0x20C8
//
// This script searches a salt for a given CREATE2 deployer + constructor args. ~2^14 expected keccaks,
// so it finishes in well under a second.
//
// The hook is DELEGATECALL-linked against the GlueLiquidity library: deploy the library first (any
// address, out/GlueLiquidity.sol/GlueLiquidity.json is self-contained), then pass its address here —
// the script substitutes it for the foundry.toml link sentinel before hashing the init code. The
// SAME linked init code must then be what the CREATE2 deployer runs, byte for byte.
//
// Usage:
//   node scripts/mine-salt.mjs <deployer> <poolManager> <glueLiquidity>
//
//   <deployer>        the CREATE2 deployer address that will run `create2(salt, initCode)`
//   <poolManager>     the chain's Uniswap V4 PoolManager
//   <glueLiquidity>  the deployed GlueLiquidity library on this chain
//
// Requires the contract to be built first (out/GlueHook.sol/GlueHook.json via `forge build`).

import { readFileSync } from "node:fs";
import { ethers } from "ethers";

const HOOK_FLAGS = 0x20c8n;
const HOOK_MASK = (1n << 14n) - 1n;
// The static-link sentinel from foundry.toml, replaced with the real library address below.
const SENTINEL = "b0b0000000000000000000000000000000000b0b";

const [deployer, poolManager, glueLiquidity] = process.argv.slice(2);
if (!deployer || !poolManager || !glueLiquidity) {
    console.error("usage: node scripts/mine-salt.mjs <deployer> <poolManager> <glueLiquidity>");
    process.exit(1);
}

const artifact = JSON.parse(readFileSync("out/GlueHook.sol/GlueHook.json", "utf8"));
const unlinked = artifact.bytecode.object.toLowerCase();
if (!unlinked.includes(SENTINEL)) {
    console.error("no link sentinel in the hook artifact — stale build? Run `forge build` first.");
    process.exit(1);
}
const linked = unlinked.split(SENTINEL).join(ethers.getAddress(glueLiquidity).toLowerCase().slice(2));
const initCode = ethers.concat([
    linked,
    ethers.AbiCoder.defaultAbiCoder().encode(["address"], [poolManager]),
]);
const initCodeHash = ethers.keccak256(initCode);

for (let i = 0; i < 10_000_000; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const addr = ethers.getCreate2Address(deployer, salt, initCodeHash);
    if ((BigInt(addr) & HOOK_MASK) === HOOK_FLAGS) {
        console.log(`salt:         ${salt}`);
        console.log(`address:      ${addr}`);
        console.log(`initCodeHash: ${initCodeHash}`);
        console.log(`tries:        ${i}`);
        process.exit(0);
    }
}
console.error("no salt found in 10M tries (check the inputs)");
process.exit(1);
