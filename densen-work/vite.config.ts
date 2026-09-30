import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Freebuff requires HMR to remain disabled in this environment.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    hmr: false,
  },
  // Day 20: `day20-changes/` is a static download package (copies of merged
  // files), not source. Keep the dev server AND vitest from walking it —
  // vitest otherwise discovers the copied test file there and fails on its
  // repo-relative imports.
  test: {
    exclude: ["**/node_modules/**", "day20-changes/**"],
  },
});
