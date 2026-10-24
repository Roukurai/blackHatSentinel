import { createServer } from "./server.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { flushNotifications } from "./notify.ts";

const config = loadConfig();
const db = openDatabase(config.dbPath);
const server = createServer({ config, db });
const timer = setInterval(() => {
  void flushNotifications(db, config).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "error";
    console.error(`telegram retry failed: ${message}`);
  });
}, 15_000);
timer.unref();

server.listen(config.port, config.bind, () => {
  console.log(`sentinel api listening on ${config.bind}:${config.port}`);
});

function shutdown(): void {
  clearInterval(timer);
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
