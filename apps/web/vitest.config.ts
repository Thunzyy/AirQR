import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../..");
const webSrc = resolve(__dirname, "src").replaceAll("\\", "/");
const eagerLazyTabs = resolve(__dirname, "src/lazyTabs.eager.ts").replaceAll("\\", "/");

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_LOG_LEVEL": JSON.stringify("error"),
  },
  resolve: {
    alias: [
      { find: "@web", replacement: webSrc },
      { find: "./lazyTabs", replacement: eagerLazyTabs },
      { find: "./lazyTabs.ts", replacement: eagerLazyTabs },
      {
        find: "@testing-library/react",
        replacement: resolve(__dirname, "node_modules/@testing-library/react"),
      },
      {
        find: "@testing-library/user-event",
        replacement: resolve(__dirname, "node_modules/@testing-library/user-event"),
      },
      { find: "omggif", replacement: resolve(__dirname, "node_modules/omggif") },
      { find: "fflate", replacement: resolve(__dirname, "node_modules/fflate") },
      { find: "jsqr", replacement: resolve(__dirname, "node_modules/jsqr") },
      { find: "canvas", replacement: resolve(__dirname, "node_modules/canvas") },
    ],
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    minWorkers: 1,
    maxWorkers: 1,
    setupFiles: ["./vitest.setup.storage.ts", "./vitest.setup.ts"],
    include: ["test-runners/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
});
