import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
  experimental: {
    proxyTimeout: 10000000000,
  },
};

export default nextConfig;
