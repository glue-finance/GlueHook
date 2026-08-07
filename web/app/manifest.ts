import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GlueHook — buy back & autocompound your V4 LP",
    short_name: "GlueHook",
    description:
      "A free, open-source Uniswap V4 hook that automates buybacks, burns, sell defense and self-compounding liquidity — on-chain, contract-to-contract, no oracles, no keepers. Same address on 23 networks.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf6ec",
    theme_color: "#faf6ec",
    categories: ["finance", "defi", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: [
      {
        src: "/og.png",
        sizes: "1200x630",
        type: "image/png",
        form_factor: "wide",
        label: "GlueHook — automated buybacks and autocompounding for Uniswap V4 pools",
      },
    ],
  };
}
