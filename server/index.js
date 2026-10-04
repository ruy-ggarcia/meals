// Startup: reads DATA_DIR and PORT, listens on 0.0.0.0, and stops cleanly on
// SIGINT and SIGTERM.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createLogger } from "./logger.js";
import { createShutdown } from "./shutdown.js";
import { start } from "./start.js";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(process.env.DATA_DIR || "data");
const logger = createLogger();

let server;
try {
  server = await start({ dataDir, logger, port, version });
} catch (error) {
  // An Error serializes to {} in JSON, so log its stack.
  logger.error("server failed to start", { error: error?.stack ?? String(error) });
  process.exit(1);
}
logger.info("server started", { version, port: server.port, dataDir });

const shutdown = createShutdown({ exit: process.exit, logger, stop: server.stop });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
