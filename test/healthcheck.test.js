import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import net from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startTestServer, useDataDir } from "./backend-helpers.js";

const HEALTHCHECK = fileURLToPath(new URL("../server/healthcheck.js", import.meta.url));

const dataDir = useDataDir("meals-healthcheck-");

/** Runs healthcheck.js against PORT, and resolves to its exit code and its stderr. */
function healthcheck(port) {
  return new Promise((resolve) => {
    const env = { ...process.env, PORT: String(port) };
    execFile(process.execPath, [HEALTHCHECK], { env }, (error, _stdout, stderr) =>
      resolve({ code: error ? error.code : 0, stderr }),
    );
  });
}

test("healthcheck.js exits with 0 when the server is healthy", async (t) => {
  const server = await startTestServer(t, dataDir());

  assert.deepEqual(await healthcheck(server.port), { code: 0, stderr: "" });
});

test("healthcheck.js exits with 1 when the health check returns 503", async (t) => {
  const server = await startTestServer(t, dataDir());
  // The server is running, and its data directory is gone.
  await rm(dataDir(), { recursive: true });

  // An empty stderr shows a failed check, and not a crash that also exits with 1.
  assert.deepEqual(await healthcheck(server.port), { code: 1, stderr: "" });
});

test("healthcheck.js exits with 1 when the connection closes without an answer", async (t) => {
  const closer = net.createServer((socket) => socket.destroy());
  closer.listen(0, "127.0.0.1");
  await once(closer, "listening");
  t.after(() => closer.close());

  // An empty stderr shows a failed check, and not a crash that also exits with 1.
  assert.deepEqual(await healthcheck(/** @type {net.AddressInfo} */ (closer.address()).port), {
    code: 1,
    stderr: "",
  });
});
