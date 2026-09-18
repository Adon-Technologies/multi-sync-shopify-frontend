import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { environment: "jsdom", include: ["tests/*.ui.test.tsx", "tests/*.vitest.ts"], setupFiles: ["tests/ui-setup.ts"] },
});
