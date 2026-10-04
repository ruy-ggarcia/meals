import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, beforeEach, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { silentLogger } from "../server/logger.js";
import { start } from "../server/start.js";
import { createStores } from "../server/stores.js";
import { within } from "./helpers.js";

const INDEX = fileURLToPath(new URL("../server/index.js", import.meta.url));
const { version: PACKAGE_VERSION } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

let dataDir;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meals-server-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** The names in the saved ingredient catalog. */
async function savedIngredients() {
  const text = await readFile(path.join(dataDir, "v2", "ingredients.json"), "utf8");
  return JSON.parse(text).ingredients.map((ingredient) => ingredient.name);
}

test("idle() resolves after every write queued before it", async () => {
  const stores = createStores({ dataDir });
  const adding = stores.ingredients.create({ name: "Onion", unit: "g" });

  await stores.idle();

  assert.deepEqual(await savedIngredients(), ["Onion"]);
  await adding;
});

test("stop() waits for a request in progress, and then closes its keep-alive connection", async (t) => {
  // The server emits "request" once it has parsed the headers.
  const requestReceived = Promise.withResolvers();
  const emit = http.Server.prototype.emit;
  t.mock.method(http.Server.prototype, "emit", function (event, ...args) {
    if (event === "request") requestReceived.resolve();
    return emit.call(this, event, ...args);
  });
  const server = await start({ dataDir, logger: silentLogger, port: 0, version: "1.2.3" });
  const socket = net.connect(server.port, "127.0.0.1");
  let stopping;
  t.after(async () => {
    socket.destroy();
    await (stopping ?? server.stop()).catch(() => {});
  });
  await once(socket, "connect");
  const socketClosed = once(socket, "close");
  let response = "";
  socket.on("data", (chunk) => {
    response += chunk;
  });
  const body = JSON.stringify({ name: "Onion", unit: "g" });
  socket.write(
    "POST /api/ingredients HTTP/1.1\r\nHost: localhost\r\n" +
      `Content-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n`,
  );
  await within(requestReceived.promise, "The server never received the request");

  let stopped = false;
  stopping = server.stop().then(() => {
    stopped = true;
  });
  // The request is still waiting for its body, so stop() must stay pending. A
  // wait can only miss a bug here, never fail a correct server.
  await delay(100);
  assert.equal(stopped, false, "stop() resolved before the request finished");

  const sentAt = Date.now();
  socket.write(body);
  await stopping;
  // stop() can resolve before the client reads the response, so wait for the
  // server to close the connection.
  await socketClosed;

  // Without closing the connection, stop() waits for the 5-second keep-alive timeout.
  assert.ok(Date.now() - sentAt < 4000, "stop() waited for the keep-alive timeout");
  assert.match(response, /^HTTP\/1\.1 201 /);
  assert.deepEqual(await savedIngredients(), ["Onion"]);
});

test("stop() rejects with the error of the server when it can't close", async () => {
  const server = await start({ dataDir, logger: silentLogger, port: 0, version: "1.2.3" });
  await server.stop();

  // The server is already closed, so closing it again fails.
  await assert.rejects(server.stop(), { code: "ERR_SERVER_NOT_RUNNING" });
});

test("node server/index.js logs one error line and exits with 1 when the port is in use", async () => {
  const taken = net.createServer().listen(0, "0.0.0.0");
  await once(taken, "listening");
  try {
    const child = spawn(process.execPath, [INDEX], {
      env: { ...process.env, DATA_DIR: dataDir, PORT: String(taken.address().port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const [code] = await once(child, "close");

    assert.equal(code, 1);
    assert.equal(stderr, "");
    const lines = stdout.trim().split("\n");
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.level, "error");
    assert.equal(entry.msg, "server failed to start");
    assert.match(entry.error, /EADDRINUSE/);
  } finally {
    taken.close();
  }
});

test("node server/index.js logs its start, and on SIGTERM stops and exits with 0", async (t) => {
  const child = spawn(process.execPath, [INDEX], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const entries = [];
  const lines = createInterface({ input: child.stdout });
  const started = new Promise((resolve, reject) => {
    lines.on("line", (line) => {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        // Keep the line, so the final comparison shows it.
        entry = { notJson: line };
        if (entries.length === 0) reject(new Error(`The first line isn't JSON: ${line}`));
      }
      entries.push(entry);
      if (entries.length === 1) resolve(entry);
    });
  });
  const { port } = await started;

  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.status, 200);
  // Listen first: readline can close before the exit event's handlers run.
  const closed = once(lines, "close");
  child.kill("SIGTERM");
  const [code] = await once(child, "exit");
  await closed;

  assert.equal(code, 0, stderr);
  assert.deepEqual(
    entries.map((entry) => ({ ...entry, time: typeof entry.time })),
    [
      {
        time: "string",
        level: "info",
        msg: "server started",
        version: PACKAGE_VERSION,
        port,
        dataDir,
      },
      { time: "string", level: "info", msg: "server stopping", signal: "SIGTERM" },
      { time: "string", level: "info", msg: "server stopped" },
    ],
  );
});
