import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  serverExternalPackages: ["pdf-parse"],
  // This is a desktop research workstation with six substantial workspaces.
  // Keep their development bundles warm instead of dropping one after a minute
  // (or after the default five-route buffer) and compiling it again on the
  // next navigation. It has no effect on the production build or deployment.
  onDemandEntries: {
    maxInactiveAge: 30 * 60 * 1000,
    pagesBufferLength: 12,
  },
};

export default nextConfig;
