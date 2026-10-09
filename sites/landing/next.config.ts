import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  // Served as static files next to the web app (scripts/build-site.mjs), not by a Next server.
  output: 'export',
  images: { unoptimized: true },
};

export default nextConfig;
