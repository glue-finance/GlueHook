import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono" });

const TITLE = "GlueHook — buy back and autocompound your V4 LP";
const DESCRIPTION =
  "A free, open-source Uniswap V4 hook that automates buybacks, burns, sell defense and self-compounding liquidity — on-chain, contract-to-contract, no oracles, no keepers, no team actions. Same address on 23 networks.";

// maximumScale 1 stops iOS Safari's automatic zoom-on-input-focus; pinch
// zoom stays available (Safari ignores the cap for user gestures)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL("https://gluehook.trade"),
  title: { default: TITLE, template: "%s · GlueHook" },
  description: DESCRIPTION,
  applicationName: "GlueHook",
  keywords: [
    "Uniswap V4 hook", "buyback and burn", "autocompound LP", "auto-harvest fees",
    "buyback hook", "V4 liquidity", "DeFi buyback", "sell shield", "token burn",
    "GlueHook", "Glue",
  ],
  alternates: { canonical: "/" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    url: "https://gluehook.trade",
    siteName: "GlueHook",
    title: TITLE,
    description:
      "Automated buybacks, burns, sell defense and self-growing liquidity for any Uniswap V4 pool. No oracles, no keepers, no fee — same address on 23 networks.",
    locale: "en_US",
    images: [
      { url: "/og.png", width: 1200, height: 630, alt: "GlueHook — buy back & autocompound your Uniswap V4 LP" },
      { url: "/og-square.png", width: 1200, height: 1200, alt: "GlueHook" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@glue_fi",
    creator: "@glue_fi",
    title: TITLE,
    description:
      "Automated buybacks, burns, sell defense and self-growing liquidity for any Uniswap V4 pool — same address on 23 networks.",
    images: ["/og.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

/** Structured data for Google rich results and AI-search crawlers. */
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://gluehook.trade/#website",
      url: "https://gluehook.trade",
      name: "GlueHook",
      description: DESCRIPTION,
      publisher: { "@id": "https://gluehook.trade/#org" },
    },
    {
      "@type": "Organization",
      "@id": "https://gluehook.trade/#org",
      name: "Glue",
      url: "https://gluehook.trade",
      logo: "https://gluehook.trade/icon-512.png",
      sameAs: ["https://github.com/glue-finance/GlueHook", "https://x.com/glue_fi"],
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://gluehook.trade/#app",
      name: "GlueHook",
      applicationCategory: "FinanceApplication",
      operatingSystem: "EVM (23 networks)",
      description:
        "A Uniswap V4 hook that automates buybacks, burns, sell defense, auto-harvesting and self-compounding liquidity for any pool. Deployed at the same canonical address (0xb216070c3509047ea597E2E626A29cea427a60C8) on 23 networks, source-verified and open-source.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      url: "https://gluehook.trade/app",
      softwareHelp: "https://gluehook.trade/docs",
      license: "https://github.com/glue-finance/GlueHook/blob/main/LICENCE.txt",
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jbmono.variable}`}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        <div className="glow-layer" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
