import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "node_modules/",
        "dist/**",
        "vitest.config.ts",
        "vite.config.ts",
        "eslint.config.mjs",
      ],
    },
  },
});
