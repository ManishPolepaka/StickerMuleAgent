import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  // Avoid loading Next/Tailwind PostCSS during unit tests
  css: { postcss: { plugins: [] } },
});
