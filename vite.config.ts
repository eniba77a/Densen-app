import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Freebuff requires HMR to remain disabled in this environment.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    hmr: false,
  },
  // Day 20: `day20-changes/` and `densen-work/` are static download/snapshot
  // folders (copies of merged files), not source. Keep the dev server AND
  // vitest from walking them — vitest otherwise discovers the copied test
  // files there and fails on their repo-relative imports.
  test: {
    exclude: ["**/node_modules/**", "day20-changes/**", "densen-work/**"],
  },
});
