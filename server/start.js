// Starts the HTTP server, and stops it without cutting a request or a write.

import { mkdir } from "node:fs/promises";

import { createApp } from "./app.js";
import { createConversations } from "./assistant/conversations.js";
import { createAssistantSetup } from "./assistant/setup.js";
import { createStores } from "./stores.js";

/**
 * Listens on `port` of `host`, by default every interface, where port 0
 * picks a free port, and resolves to `{ address, port, assistant, stop }`,
 * with the address and the port that the server listens on, and the
 * assistant's provider and its source at the start, or undefined while it's
 * off. `stop()` stops accepting connections, cancels the assistant's turns,
 * waits for the requests in progress and the queued writes, and then
 * resolves.
 * Creates `dataDir` first if it doesn't exist, and rejects if it can't.
 * The assistant's provider comes from `environment` when it's set, or else
 * from the settings saved in `dataDir`, and `providerFactories` build it.
 * `modelLists` ask the providers for their models, which checks a key.
 * @param {{
 *   dataDir: string,
 *   environment?: import("./assistant/config.js").AssistantConfig,
 *   host?: string,
 *   logger?: import("./logger.js").Logger,
 *   modelLists?: import("./assistant/setup.js").ModelLists,
 *   port: number,
 *   providerFactories?: import("./assistant/setup.js").ProviderFactories,
 *   version?: string,
 * }} options
 */
export async function start({
  dataDir,
  environment,
  host = "0.0.0.0",
  logger,
  modelLists,
  port,
  providerFactories,
  version,
}) {
  await mkdir(dataDir, { recursive: true });
  const stores = createStores({ dataDir });
  const setup = createAssistantSetup({
    environment,
    settings: stores.assistantSettings,
    providerFactories,
    modelLists,
    logger,
  });
  await setup.load();
  const assistant = createConversations({ getProvider: setup.provider, stores, logger });
  const app = createApp(stores, { assistant, dataDir, logger, setup, version });
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(port, host, (error) =>
      error ? reject(error) : resolve(listening),
    );
  });

  let stopping = false;
  // A keep-alive connection becomes idle when its response finishes. Once
  // the server is stopping, close it then, instead of after its timeout.
  server.on("request", (_req, res) => {
    res.on("finish", () => {
      if (stopping) setImmediate(() => server.closeIdleConnections());
    });
  });

  return {
    address: server.address().address,
    port: server.address().port,
    assistant: setup.status(),
    async stop() {
      stopping = true;
      /** @type {Promise<void>} */
      const closed = new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeIdleConnections();
      // The server accepts no new connection now, and closes each one once
      // its request finishes, so no request can start a turn after the
      // conversations stop. Canceling the turns means that a stop never
      // waits for a provider, and leaves no call running.
      await Promise.all([closed, assistant.stop()]);
      await stores.idle();
    },
  };
}
