import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/fiscal-years",
        destination: `${BACKEND_URL}/api/fiscal-years`,
      },
      {
        source: "/api/fiscal-years/:path*",
        destination: `${BACKEND_URL}/api/fiscal-years/:path*`,
      },
      {
        source: "/api/rate-groups/:path*",
        destination: `${BACKEND_URL}/api/rate-groups/:path*`,
      },
      {
        source: "/api/pool-groups/:path*",
        destination: `${BACKEND_URL}/api/pool-groups/:path*`,
      },
      {
        source: "/api/pools/:path*",
        destination: `${BACKEND_URL}/api/pools/:path*`,
      },
      {
        source: "/api/gl-mappings/:path*",
        destination: `${BACKEND_URL}/api/gl-mappings/:path*`,
      },
      {
        source: "/api/cost-categories/:path*",
        destination: `${BACKEND_URL}/api/cost-categories/:path*`,
      },
      {
        source: "/api/reference-rates/:path*",
        destination: `${BACKEND_URL}/api/reference-rates/:path*`,
      },
      {
        source: "/api/seed-test-data",
        destination: `${BACKEND_URL}/api/seed-test-data`,
      },
      {
        source: "/api/chart-of-accounts/:path*",
        destination: `${BACKEND_URL}/api/chart-of-accounts/:path*`,
      },
      {
        source: "/api/base-accounts/:path*",
        destination: `${BACKEND_URL}/api/base-accounts/:path*`,
      },
    ];
  },
};

export default nextConfig;
