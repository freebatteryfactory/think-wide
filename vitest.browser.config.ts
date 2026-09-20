// Browser acceptance is a separate, opt-in suite: `bun run test:browser`.
// The default config (vitest.config.ts) excludes tests/browser/**, so `bun run verify` never needs
// a browser. This suite skips itself, loudly, when Chromium is not installed.
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		environment: "node",
		include: ["tests/browser/**/*.test.ts"],
		pool: "forks",
		maxWorkers: 1,
		testTimeout: 30_000,
		hookTimeout: 60_000,
	},
});
