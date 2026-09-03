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
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
