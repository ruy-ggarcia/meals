// Startup: reads DATA_DIR, PORT, and the assistant's variables, listens on
// 0.0.0.0, and stops cleanly on SIGINT and SIGTERM.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { readAssistantConfig } from "./assistant/config.js";
import { createAnthropicProvider } from "./assistant/providers/anthropic.js";
import { createOpenAIProvider } from "./assistant/providers/openai.js";
import { createLogger } from "./logger.js";
import { createShutdown } from "./shutdown.js";
import { start } from "./start.js";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(process.env.DATA_DIR || "data");
const logger = createLogger();

const PROVIDERS = { anthropic: createAnthropicProvider, openai: createOpenAIProvider };
const config = readAssistantConfig(process.env);
let provider;
if (config && "problem" in config) {
  // The problem names variables, never their values, so the key stays out
  // of the log.
  logger.error("assistant not configured", { problem: config.problem });
} else if (config && "provider" in config) {
  provider = PROVIDERS[config.provider]({ apiKey: config.apiKey, model: config.model });
}

let server;
try {
  server = await start({ dataDir, logger, port, provider, version });
} catch (error) {
  // An Error serializes to {} in JSON, so log its stack.
  logger.error("server failed to start", { error: error?.stack ?? String(error) });
  process.exit(1);
}

// Register the handlers before the log: whoever reads "server started" can
// send a signal at once, and a signal without a handler kills the process.
const shutdown = createShutdown({ exit: process.exit, logger, stop: server.stop });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
logger.info("server started", {
  version,
  port: server.port,
  dataDir,
  assistant: provider?.name ?? "off",
});
