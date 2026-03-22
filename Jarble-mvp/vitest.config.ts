import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "@jarble/component-manifest": path.resolve(
        __dirname,
        "../shared/component-manifest/index.ts"
      ),
      zod: path.resolve(__dirname, "node_modules/zod"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./__tests__/setup.ts"],
    include: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
    exclude: ["node_modules", ".next", "e2e", "tests"],
    coverage: {
      provider: "v8",
      include: [
        "lib/**/*.ts",
        "components/**/*.ts",
        "components/**/*.tsx",
        "hooks/**/*.ts",
      ],
      exclude: ["**/*.test.*", "**/*.spec.*"],
      reporter: ["text", "html", "lcov"],
    },
  },
});
