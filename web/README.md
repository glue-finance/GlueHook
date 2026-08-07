# GlueHook — website

The GlueHook site: landing page, live app (on-chain charts + LP management), simulator, and docs.

- **Stack:** Next.js (App Router) + TypeScript + Tailwind v4 + wagmi/viem + RainbowKit.
- **No backend:** all live data comes from public RPCs (`eth_getLogs` + view calls); scanned logs are cached in `localStorage`.
- **Charts:** hand-rolled SVG (`components/app/LineChart.tsx`).
- **Chains:** the 18 deployed networks live in `lib/chains.ts` (per-chain RPC overridable with `NEXT_PUBLIC_RPC_<chainId>`).
- **ABI:** `lib/abi.ts` is generated from the Foundry artifact (`out/GlueHook.sol/GlueHook.json`).

## Develop

```bash
npm install
npm run dev
```

## Deploy

Vercel project with **Root Directory = `web`**, framework Next.js. Optional env:

- `NEXT_PUBLIC_WALLETCONNECT_ID` — WalletConnect Cloud project id (wallet modal).
- `NEXT_PUBLIC_RPC_<chainId>` — override the default public RPC for a chain.
