// SPDX-License-Identifier: BUSL-1.1
// https://github.com/glue-finance/GlueHook/blob/main/LICENCE.txt
//
// Two-transaction CREATE deploy of GlueHook on one chain, from the deployer mined by
// mine-deployer.mjs: the GlueLiquidity library at NONCE 0, then the hook — delegatecall-linked
// against that library — at NONCE 1.
//
// Both addresses are `keccak256(rlp(deployer, nonce))` — independent of the init code, so the
// PoolManager constructor arg may differ per chain while the addresses stay identical everywhere.
// This makes nonce discipline the ONLY invariant that matters: the two deploys MUST be the key's
// first two transactions on the chain, in order. This script refuses to run otherwise, and refuses
// everything else that would burn the one shot:
//
//   1. the deployer's nonce on this chain must be 0 (fresh) or 1 (library landed, hook pending —
//      the script resumes at the hook)
//   2. the hook address must be empty (no code) on this chain
//   3. the PoolManager must be a live contract on this chain (it is an immutable arg — a typo here
//      would burn the address on this chain forever)
//   4. the predicted NONCE-1 address must carry the 0x20C8 hook bits (sanity: right key file)
//   5. the hook artifact must actually contain the link SENTINEL to replace (sanity: right build)
//   6. after inclusion, the deployed code must actually sit at each predicted address
//
// LINKING: the artifact is statically linked against the sentinel address in foundry.toml
// (0xb0b0…0b0b, which the test fixture etches over); this script substitutes the REAL nonce-0
// library address into the hook's init code before deploying it.
//
// Usage:
//   node scripts/deploy-nonce0.mjs <rpcUrl> <poolManager>
//
//   <rpcUrl>       the chain's RPC endpoint
//   <poolManager>  the chain's Uniswap V4 PoolManager (verify it on Uniswap's official deployments list)
//
// Requires `forge build` first (reads out/GlueHook.sol/ and out/GlueLiquidity.sol/).

import { readFileSync } from "node:fs";
import { ethers } from "ethers";

const HOOK_FLAGS = 0x20c8n;
const HOOK_MASK = (1n << 14n) - 1n;
const KEY_FILE = ".deployer.key";
// The static-link sentinel from foundry.toml, replaced with the real library address below.
const SENTINEL = "b0b0000000000000000000000000000000000b0b";

const [rpcUrl, poolManager] = process.argv.slice(2);
if (!rpcUrl || !poolManager) {
    console.error("usage: node scripts/deploy-nonce0.mjs <rpcUrl> <poolManager>");
    process.exit(1);
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(readFileSync(KEY_FILE, "utf8").trim(), provider);
const libAddr = ethers.getCreateAddress({ from: wallet.address, nonce: 0 });
const hookAddr = ethers.getCreateAddress({ from: wallet.address, nonce: 1 });

const { chainId, name } = await provider.getNetwork();
console.log(`chain:            ${name} (${chainId})`);
console.log(`deployer:         ${wallet.address}`);
console.log(`library (n=0):    ${libAddr}`);
console.log(`hook    (n=1):    ${hookAddr}`);

// 4. right key file
if ((BigInt(hookAddr) & HOOK_MASK) !== HOOK_FLAGS) {
    console.error("ABORT: the nonce-1 address does not carry the 0x20C8 hook bits — wrong .deployer.key?");
    process.exit(1);
}
// 1. the key's first activity on this chain (or a resume after the library landed)
const nonce = await provider.getTransactionCount(wallet.address);
if (nonce !== 0 && nonce !== 1) {
    console.error(`ABORT: deployer nonce on this chain is ${nonce} — the one shot is spent here.`);
    process.exit(1);
}
if (nonce === 1 && (await provider.getCode(libAddr)) === "0x") {
    console.error("ABORT: nonce is 1 but no code at the library address — the nonce-0 slot was wasted here.");
    process.exit(1);
}
// 2. hook target empty
if ((await provider.getCode(hookAddr)) !== "0x") {
    console.error("ABORT: the hook address already has code on this chain.");
    process.exit(1);
}
// 3. PoolManager is real — an immutable arg, so a typo burns this chain's shot forever
if ((await provider.getCode(poolManager)) === "0x") {
    console.error(`ABORT: no code at PoolManager ${poolManager} on this chain.`);
    process.exit(1);
}

// 5. link the hook's init code: sentinel → the real nonce-0 library address
const hookArtifact = JSON.parse(readFileSync("out/GlueHook.sol/GlueHook.json", "utf8"));
const libArtifact = JSON.parse(readFileSync("out/GlueLiquidity.sol/GlueLiquidity.json", "utf8"));
const unlinked = hookArtifact.bytecode.object.toLowerCase();
if (!unlinked.includes(SENTINEL)) {
    console.error("ABORT: the hook artifact carries no link sentinel — stale build? Run `forge build` first.");
    process.exit(1);
}
const linked = unlinked.split(SENTINEL).join(libAddr.toLowerCase().slice(2));
const hookInitCode = ethers.concat([
    linked,
    ethers.AbiCoder.defaultAbiCoder().encode(["address"], [poolManager]),
]);

console.log(`poolManager:      ${poolManager}`);

// Wait for a receipt, then insist the code actually sits at the predicted address. Some nodes
// serve the receipt a beat before the state is queryable — retry the code read briefly rather
// than mislabel a landed deploy as failed.
async function deployAndVerify(label, data, predicted) {
    console.log(`deploying ${label}…`);
    const tx = await wallet.sendTransaction({ data });
    console.log(`tx: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt.status !== 1 || receipt.contractAddress.toLowerCase() !== predicted.toLowerCase()) {
        console.error(`${label} DEPLOY FAILED or landed at an unexpected address — investigate before touching the key again.`);
        process.exit(1);
    }
    let code = "0x";
    for (let i = 0; i < 10 && code === "0x"; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 1_000));
        // "latest", not the receipt's block: load-balanced RPCs may route the read to a lagging
        // replica that has not seen that block yet and error with "block not found".
        try { code = await provider.getCode(predicted); } catch {}
    }
    if (code === "0x") {
        console.error(`${label} DEPLOY FAILED: no code at the predicted address after inclusion.`);
        process.exit(1);
    }
    console.log(`✓ ${label} live at ${predicted} (gas used: ${receipt.gasUsed})`);
}

if (nonce === 0) {
    await deployAndVerify("GlueLiquidity (nonce 0)", libArtifact.bytecode.object, libAddr);
} else {
    console.log("library already live on this chain — resuming at the hook.");
}
await deployAndVerify("GlueHook (nonce 1)", hookInitCode, hookAddr);
console.log(`✓ done on chain ${chainId}: library ${libAddr}, hook ${hookAddr}`);
