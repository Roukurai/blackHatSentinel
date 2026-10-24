import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

// Dev only: forward API calls to the API. A 401 means "show the sign-in screen";
// credentials stay in the session cookie, never in this file.
//
// The API serves JSON at the root (/health, /incidents, /incidents/:id), which
// collides with the SPA deep link /incidents/:id. Browser navigations ask for
// text/html and get the SPA; fetches ask for application/json and reach the API.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_TARGET || "http://127.0.0.1:8080";
  const apiBase = env.VITE_API_BASE ?? "";

  const toApi: ProxyOptions = {
    target,
    changeOrigin: true,
    bypass: (req) => (req.headers.accept?.includes("text/html") ? "/index.html" : undefined),
  };

  const proxy: Record<string, ProxyOptions> = apiBase
    ? { [apiBase]: toApi }
    : {
        "/health": toApi,
        "/incidents": toApi,
        "/actions": toApi,
        "/settings": toApi,
        "/login": toApi,
        "/logout": toApi,
        "/setup": toApi,
        "/auth": toApi,
      };

  return {
    plugins: [react()],
    server: { port: 5173, proxy },
    build: { outDir: "dist", sourcemap: false },
  };
});
