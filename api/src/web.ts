import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

// Serves the built dashboard (web/dist). /incidents/:id is both a JSON route and the
// Telegram deep link, so browser navigations (Accept: text/html) get the SPA and
// API fetches (Accept: application/json) fall through to the JSON routes.

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

export function wantsHtml(req: IncomingMessage): boolean {
  return (req.headers.accept ?? "").includes("text/html");
}

async function sendFile(res: ServerResponse, file: string, immutable: boolean): Promise<void> {
  const body = await readFile(file);
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Returns true when the request was answered with a dashboard file. */
export async function serveWeb(req: IncomingMessage, res: ServerResponse, distDir: string, urlPath: string): Promise<boolean> {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const root = path.resolve(distDir);

  if (urlPath !== "/") {
    let decoded: string;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return false;
    }
    const file = path.resolve(root, `.${decoded}`);
    if (file.startsWith(root + path.sep) && (await isFile(file))) {
      await sendFile(res, file, decoded.startsWith("/assets/"));
      return true;
    }
  }

  if (!wantsHtml(req)) return false;
  const index = path.join(root, "index.html");
  if (!(await isFile(index))) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("Dashboard not built. Run: npm ci --prefix web && npm run build --prefix web\n");
    return true;
  }
  await sendFile(res, index, false);
  return true;
}
