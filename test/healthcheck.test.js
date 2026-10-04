import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { silentLogger } from "../server/logger.js";
import { start } from "../server/start.js";

const HEALTHCHECK = fileURLToPath(new URL("../server/healthcheck.js", import.meta.url));

let dataDir;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-healthcheck-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

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
  const server = await start({ dataDir, logger: silentLogger, port: 0, version: "1.2.3" });
  t.after(() => server.stop());

  assert.deepEqual(await healthcheck(server.port), { code: 0, stderr: "" });
});

test("healthcheck.js exits with 1 when the health check returns 503", async (t) => {
  const missing = path.join(dataDir, "missing");
  const server = await start({ dataDir: missing, logger: silentLogger, port: 0, version: "1.2.3" });
  t.after(() => server.stop());

  // An empty stderr shows a failed check, and not a crash that also exits with 1.
  assert.deepEqual(await healthcheck(server.port), { code: 1, stderr: "" });
});

test("healthcheck.js exits with 1 when nothing listens on the port", async () => {
  const server = await start({ dataDir, logger: silentLogger, port: 0, version: "1.2.3" });
  await server.stop();

  // An empty stderr shows a failed check, and not a crash that also exits with 1.
  assert.deepEqual(await healthcheck(server.port), { code: 1, stderr: "" });
});
