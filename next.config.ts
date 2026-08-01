import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fail the production build on type or lint errors rather than shipping them.
  // Vercel builds run `next build`, so this is the last gate before deploy.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  // Playwright drives the dev server via 127.0.0.1 while `next dev` announces
  // itself as localhost. Without this, Next logs a cross-origin warning for
  // every /_next/* request during e2e runs and will reject them in a future
  // major version.
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  images: {
    remotePatterns: [
      // YouTube thumbnails for lecture video cards.
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
    ],
  },
};

export default nextConfig;
