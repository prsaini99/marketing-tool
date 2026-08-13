/**
 * Vitest config.
 *
 * Scope is deliberately narrow: this suite covers PURE logic — the modules
 * that decide things (rule matching, opt-out, windows, safety filters,
 * budget-rule thresholds) plus small pure helpers (password hashing,
 * webhook signature verification, Meta error parsing, schedule maths).
 *
 * It does NOT cover anything that touches Prisma, Meta, or OpenAI. Those
 * paths are exercised by hand against a real account; mocking them here
 * would test the mocks, not the system. The value of this suite is that
 * `decide.ts` and friends are already written as pure functions over
 * injected context, so they can be tested with zero setup — which is
 * exactly why they were written that way.
 *
 * `@/` resolves the same as in tsconfig.json so tests import modules by the
 * same specifier the app uses.
 */

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
