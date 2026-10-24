import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Load KEY=VALUE lines into process.env without overriding existing values. */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(resolve(import.meta.dirname, "../../../../.env"));
loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
