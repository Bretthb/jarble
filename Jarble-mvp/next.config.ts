import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [],
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
