import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@jarble/component-manifest": path.resolve(
        __dirname,
        "../shared/component-manifest/index.ts"
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/db/migrations/**"],
      reporter: ["text", "html", "lcov"],
    },
  },
});
