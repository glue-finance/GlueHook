import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: path.join(__dirname),
  },
  async redirects() {
    return [
      // the FAQ chapter became the Glossary — keep old links alive
      { source: "/docs/faq", destination: "/docs/glossary", permanent: true },
    ];
  },
};

export default nextConfig;
