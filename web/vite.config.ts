import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Dev only: forward API calls to Kevin's API. Basic-auth 401s pass through,
// so the browser shows its native login prompt. No credentials live here.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_TARGET || "http://127.0.0.1:8080";
  const apiBase = env.VITE_API_BASE || "/api";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        [apiBase]: { target, changeOrigin: true },
      },
    },
    build: { outDir: "dist", sourcemap: false },
  };
});
