#!/usr/bin/env bash
# SPDX-License-Identifier: BUSL-1.1
# https://github.com/glue-finance/GlueHook/blob/main/LICENCE.txt
#
# Verify GlueLiquidity + GlueHook on every deployed network.
#
#   ETHERSCAN_API_KEY=… bash scripts/verify-all.sh            # all chains
#   ETHERSCAN_API_KEY=… bash scripts/verify-all.sh unichain   # only chains whose name matches
#
# Three verifier families:
#   - Etherscan v2 multichain API (one key, all Etherscan-family explorers)
#   - Blockscout instances (no key)
#   - Sourcify (Tempo's own instance at contracts.tempo.xyz)
#
# The hook is linked against the nonce-0 library, so --libraries carries the REAL deployed
# address (the foundry.toml sentinel is only for the test fixture's etch).

set -u
LIB=0x26CD66aDec6176c11f894A9DE5bC504235c90241
HOOK=0xb216070c3509047ea597E2E626A29cea427a60C8
LINK="contracts/libs/GlueLiquidity.sol:GlueLiquidity:$LIB"
KEY="${ETHERSCAN_API_KEY:?set ETHERSCAN_API_KEY}"
FILTER="${1:-}"

pass=0; fail=0; failed=""

verify_pair() { # name chainid poolManager verifier...
    local name="$1" chainid="$2" pm="$3"; shift 3
    if [[ -n "$FILTER" && "${name,,}" != *"${FILTER,,}"* ]]; then return; fi
    echo "=== $name ($chainid) ==="
    local args=$(cast abi-encode 'constructor(address)' "$pm")
    if forge verify-contract "$@" --chain-id "$chainid" "$LIB" contracts/libs/GlueLiquidity.sol:GlueLiquidity --watch 2>&1 | tail -2 \
       && forge verify-contract "$@" --chain-id "$chainid" "$HOOK" contracts/GlueHook.sol:GlueHook \
              --constructor-args "$args" --libraries "$LINK" --watch 2>&1 | tail -2; then
        pass=$((pass+1))
    else
        fail=$((fail+1)); failed="$failed $name"
    fi
}

ES=(--verifier etherscan --etherscan-api-key "$KEY")

# ------------------------------- Etherscan-family (v2 multichain key) -------------------------------
verify_pair "Ethereum"          1         0x000000000004444c5dc75cB358380D2e3dE08A90 "${ES[@]}"
verify_pair "Base"              8453      0x498581fF718922c3f8e6A244956aF099B2652b2b "${ES[@]}"
verify_pair "Unichain"          130       0x1F98400000000000000000000000000000000004 "${ES[@]}"
verify_pair "Arbitrum"          42161     0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32 "${ES[@]}"
verify_pair "Optimism"          10        0x9a13F98Cb987694C9F086b1F5eB990EeA8264Ec3 "${ES[@]}"
verify_pair "BNB Chain"         56        0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF "${ES[@]}"
verify_pair "Polygon"           137       0x67366782805870060151383F4BbFF9daB53e5cD6 "${ES[@]}"
verify_pair "World Chain"       480       0xb1860D529182ac3BC1F51Fa2ABd56662b7D13f33 "${ES[@]}"
verify_pair "Avalanche"         43114     0x06380C0e0912312B5150364B9DC4542BA0DbBc85 "${ES[@]}"
verify_pair "Blast"             81457     0x1631559198A9e474033433b2958daBC135ab6446 "${ES[@]}"
verify_pair "Celo"              42220     0x288dc841A52FCA2707c6947B3A777c5E56cd87BC "${ES[@]}"
verify_pair "Monad"             143       0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e "${ES[@]}"
verify_pair "Sepolia"           11155111  0xE03A1074c86CFeDd5C142C4F04F1a1536e203543 "${ES[@]}"
verify_pair "Base Sepolia"      84532     0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408 "${ES[@]}"
verify_pair "Unichain Sepolia"  1301      0x00B036B58a818B1BC34d502D3fE730Db729e62AC "${ES[@]}"
verify_pair "Arbitrum Sepolia"  421614    0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317 "${ES[@]}"

# ------------------------------------- Blockscout (keyless) -------------------------------------
verify_pair "Zora"              7777777   0x0575338e4C17006aE181B47900A84404247CA30f --verifier blockscout --verifier-url 'https://explorer.zora.energy/api?'
verify_pair "Soneium"           1868      0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32 --verifier blockscout --verifier-url https://soneium.blockscout.com/api
verify_pair "MegaETH"           4326      0xaCB7e78fa05D562e0A5D3089ec896D57D057d38E --verifier blockscout --verifier-url https://megaeth.blockscout.com/api
verify_pair "Robinhood"         4663      0x8366a39CC670B4001A1121B8F6A443A643e40951 --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api
verify_pair "Robinhood Testnet" 46630     0x8366a39CC670B4001A1121B8F6A443A643e40951 --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/

# ---------------------------------------- Sourcify ----------------------------------------
verify_pair "Tempo"             4217      0x33620f62C5b9B2086dD6b62F4A297A9f30347029 --verifier sourcify --verifier-url https://contracts.tempo.xyz
# X Layer's explorer is OKLink (not Etherscan-family) — public Sourcify covers chain 196
verify_pair "X Layer"           196       0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32 --verifier sourcify --verifier-url https://sourcify.dev/server

echo
echo "verified: $pass | failed: $fail${failed:+ —$failed}"
