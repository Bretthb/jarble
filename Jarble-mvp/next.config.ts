import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  transpilePackages: ["@jarble/component-manifest"],

  // Suppress optional peer dep warnings from @tambo-ai/react → @standard-community/standard-json
  // Also resolve .js → .ts for shared/component-manifest ESM imports
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      effect: false,
      sury: false,
      "@valibot/to-json-schema": false,
    };
    // Ensure webpack resolves .ts before .js so ESM-style ".js" imports
    // in @jarble/component-manifest find the actual .ts source files
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
  // Skip tRPC AppRouter type errors during build (monorepo cross-package issue)
  typescript: {
    ignoreBuildErrors: true,
  },

  // Allow Turbopack builds alongside webpack config
  turbopack: {},

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

  // Security response headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },

  // Powered-by header is a minor info leak
  poweredByHeader: false,

  // Experimental performance optimizations
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "recharts",
      "date-fns",
      "@xyflow/react",
      "@monaco-editor/react",
    ],
  },
};

// Wrap with Sentry only when DSN is configured
export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      silent: true,
      sourcemaps: { disable: true },
    })
  : nextConfig;
