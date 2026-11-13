import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    // The suites register many accounts from the same IP; tests that cover
    // rate limiting turn it back on explicitly.
    env: { RATE_LIMIT_ENABLED: "false" },
  },
});
