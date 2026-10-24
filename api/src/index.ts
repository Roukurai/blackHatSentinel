import { createServer } from "./server.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { createApiInvestigator, enqueueInvestigations } from "./investigate.ts";
import { flushNotifications } from "./notify.ts";

const config = loadConfig();
const db = openDatabase(config.dbPath);
const investigator = createApiInvestigator(db);
const stopProbe = investigator.startHealthProbe();
const server = createServer({ config, db, investigator });
const timer = setInterval(() => {
  void flushNotifications(db, config)
    .then((notified) => {
      enqueueInvestigations(investigator, db, notified);
    })
    .catch((err: unknown) => {
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
  stopProbe();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
