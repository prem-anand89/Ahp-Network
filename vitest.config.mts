import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Per BUILD_SEQUENCE.md Phase 0's test-stack convention: everything
// touching the database runs against a real Postgres (local dev instance
// or a Supabase branch), never mocks — the concurrency invariants under
// test from Phase 6 onward are database behaviour, and a mock cannot fail
// the way the database can.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // CI runs every test file against one shared Postgres container
    // (DATABASE_URL is the same for the whole job — see ci.yml). Several
    // suites claim/mutate shared tables with intentionally global queries
    // (e.g. notification-outbox-worker's FOR UPDATE SKIP LOCKED claim is
    // any due row in the table, matching production behaviour). Running
    // test files in parallel lets one file's mock outcomes land on another
    // file's rows — the exact flaky failure this fixes, not a bug in the
    // claim query itself.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
