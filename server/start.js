// Starts the HTTP server, and stops it without cutting a request or a write.

import { createApp } from "./app.js";
import { createStores } from "./stores.js";

/**
 * Listens on `port` on every interface, where 0 picks a free port, and
 * resolves to `{ port, stop }`. `stop()` stops accepting connections, waits
 * for the requests in progress and the queued writes, and then resolves.
 */
export async function start({ dataDir, logger, port, version }) {
  const stores = createStores({ dataDir });
  const app = createApp(stores, { dataDir, logger, version });
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(port, "0.0.0.0", (error) =>
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
    port: server.address().port,
    async stop() {
      stopping = true;
      const closed = new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeIdleConnections();
      await closed;
      await stores.idle();
    },
  };
}
