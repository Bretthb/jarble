import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [],

  // Suppress optional peer dep warnings from @tambo-ai/react → @standard-community/standard-json
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      effect: false,
      sury: false,
      "@valibot/to-json-schema": false,
    };
    return config;
  },
  // Disable strict mode double-render in dev if desired
  reactStrictMode: true,

  // Image optimization
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "logos-api.apistemic.com",
      },
    ],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },

  // Enable gzip compression
  compress: true,

  // Powered-by header is a minor info leak
  poweredByHeader: false,

  // Experimental performance optimizations
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "recharts",
      "date-fns",
    ],
  },
};

export default nextConfig;
