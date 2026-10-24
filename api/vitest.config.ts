import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/investigator/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./src/investigator/__tests__/load-env.ts"],
  },
});
