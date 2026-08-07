#!/usr/bin/env bash
# GlueHook whitelisting watcher — status of every open PR/issue across the ecosystem.
# Run anytime: bash scripts/check-prs.sh
# Shows state, mergeability, and the latest comment (so a maintainer reply is never missed).

set -uo pipefail

check_pr() { # repo number label
  local repo=$1 n=$2 label=$3
  local json
  json=$(gh pr view "$n" --repo "$repo" --json state,mergeable,updatedAt,comments,reviews 2>/dev/null) || {
    echo "── $label — FAILED TO FETCH"; return; }
  local state updated last
  state=$(jq -r .state <<<"$json")
  updated=$(jq -r '.updatedAt[:10]' <<<"$json")
  last=$(jq -r '[.comments[], .reviews[]] | sort_by(.createdAt // .submittedAt) | last |
    if . == null then "no comments yet"
    else "\(.author.login) (\((.createdAt // .submittedAt)[:10])): \(.body // "" | gsub("\n"; " ") | .[:120])" end' <<<"$json")
  echo "── $label — $state (updated $updated)"
  echo "   last activity: $last"
}

check_issue() { # repo number label
  local repo=$1 n=$2 label=$3
  local json
  json=$(gh issue view "$n" --repo "$repo" --json state,updatedAt,comments 2>/dev/null) || {
    echo "── $label — FAILED TO FETCH"; return; }
  local state updated last
  state=$(jq -r .state <<<"$json")
  updated=$(jq -r '.updatedAt[:10]' <<<"$json")
  last=$(jq -r '.comments | last |
    if . == null then "no comments yet"
    else "\(.author.login) (\(.createdAt[:10])): \(.body | gsub("\n"; " ") | .[:120])" end' <<<"$json")
  echo "── $label — $state (updated $updated)"
  echo "   last activity: $last"
}

echo "GlueHook whitelisting status — $(date '+%Y-%m-%d %H:%M')"
echo
check_pr    Uniswap/routing-api             1408  "Uniswap routing-api (hooks allowlist, 16 chains)"
check_pr    KyberNetwork/kyberswap-dex-lib  1599  "KyberSwap aggregator integration"
check_issue KyberNetwork/kyberswap-dex-lib  1598  "KyberSwap proposal issue"
check_pr    VeloraDEX/paraswap-dex-lib      1221  "ParaSwap / Velora integration"
check_pr    DefiLlama/DefiLlama-Adapters    20419 "DefiLlama TVL adapter"
check_pr    fewwwww/awesome-uniswap-hooks   86    "awesome-uniswap-hooks listing"
echo
echo "hooklist registry issues (18, bot-processed):"
gh issue list --repo Uniswap/hooklist --author lalilulel0x --state all --limit 20 \
  --json number,state --jq 'group_by(.state) | map("   \(.[0].state): \(length)") | .[]' 2>/dev/null \
  || echo "   fetch failed"
echo
echo "still manual (no GitHub channel): Uniswap Labs form · 1inch · 0x/Matcha · OKX · OpenOcean · Odos · CoW forum post"
