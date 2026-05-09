import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    // Mirror tsconfig.json's "@/*" → "./src/*" path alias so test files
    // and the modules they import resolve consistently with the
    // production bundler.
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
