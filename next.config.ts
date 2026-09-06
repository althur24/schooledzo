import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // bcrypt = native addon (C++) — jangan dibundler; pakai require runtime
  serverExternalPackages: ["bcrypt"],
  turbopack: {},
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
