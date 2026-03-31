import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
