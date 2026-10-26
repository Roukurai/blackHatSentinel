import { createServer } from "./server.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { createApiInvestigator } from "./investigate.ts";
import { flushAndFollowUp } from "./pipeline.ts";

process.umask(0o027);

const config = loadConfig();
const db = openDatabase(config.dbPath);
const investigator = createApiInvestigator(db, config.llmSettingsPath);
const stopProbe = investigator.startHealthProbe();
const server = createServer({ config, db, investigator });
const timer = setInterval(() => {
  void flushAndFollowUp(db, config, investigator)
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
