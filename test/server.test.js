import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { silentLogger } from "../server/logger.js";
import { start } from "../server/start.js";
import { createStores } from "../server/stores.js";
import { within } from "./helpers.js";

const INDEX = fileURLToPath(new URL("../server/index.js", import.meta.url));
const SIGNAL_LISTENERS_HOOK = fileURLToPath(
  new URL("./hooks/signal-listeners.js", import.meta.url),
);
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

test("start() creates a data directory that doesn't exist yet, so the health check passes", async (t) => {
  const newDir = path.join(dataDir, "not", "yet", "created");
  const server = await start({
    dataDir: newDir,
    logger: silentLogger,
    port: 0,
    version: "1.2.3",
  });
  t.after(() => server.stop());

  const health = await fetch(`http://127.0.0.1:${server.port}/api/health`);

  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", version: "1.2.3" });
});

test("start() listens on every interface unless it gets a host", async (t) => {
  const server = await start({ dataDir, logger: silentLogger, port: 0, version: "1.2.3" });
  t.after(() => server.stop());

  assert.equal(server.address, "0.0.0.0");
});

test("start() listens only on the host that it gets", async (t) => {
  const server = await start({
    dataDir,
    host: "127.0.0.1",
    logger: silentLogger,
    port: 0,
    version: "1.2.3",
  });
  t.after(() => server.stop());

  assert.equal(server.address, "127.0.0.1");
});

test("start() rejects when it can't create the data directory", async (t) => {
  // A directory can't live under a regular file, whoever runs the test.
  const file = path.join(dataDir, "file");
  await writeFile(file, "");

  const started = start({
    dataDir: path.join(file, "data"),
    logger: silentLogger,
    port: 0,
    version: "1.2.3",
  });
  // A server that starts anyway must not keep the test process alive.
  started.then((server) => t.after(() => server.stop())).catch(() => {});

  await assert.rejects(started, { code: "ENOTDIR" });
});

/**
 * Starts a server and sends the headers of a POST that adds the ingredient
 * "Onion", without its body. Resolves once the server has parsed the headers.
 * The keep-alive timeout of a minute outlasts the time limit of a test, so a
 * stop() that waits for the timeout instead of closing the connection fails
 * the test.
 * @param {import("node:test").TestContext} t
 * @param {"close" | "keep-alive"} connection The Connection header of the request.
 */
async function startPostInProgress(t, connection) {
  /** @type {PromiseWithResolvers<void>} */
  const requestReceived = Promise.withResolvers();
  const emit = http.Server.prototype.emit;
  // The server emits "request" once it has parsed the headers.
  t.mock.method(http.Server.prototype, "emit", function (event, ...args) {
    if (event === "request") {
      this.keepAliveTimeout = 60_000;
      requestReceived.resolve();
    }
    return emit.call(this, event, ...args);
  });
  const server = await start({ dataDir, logger: silentLogger, port: 0, version: "1.2.3" });
  const socket = net.connect(server.port, "127.0.0.1");
  const post = {
    body: JSON.stringify({ name: "Onion", unit: "g" }),
    port: server.port,
    response: "",
    socketClosed: once(socket, "close"),
    /** @type {Promise<void> | undefined} */
    stopping: undefined,
    sendBody() {
      socket.write(post.body);
    },
    stop() {
      post.stopping = server.stop();
      return post.stopping;
    },
  };
  t.after(async () => {
    socket.destroy();
    await (post.stopping ?? server.stop()).catch(() => {});
  });
  await once(socket, "connect");
  socket.on("data", (chunk) => {
    post.response += chunk;
  });
  socket.write(
    "POST /api/ingredients HTTP/1.1\r\nHost: localhost\r\n" +
      `Connection: ${connection}\r\n` +
      `Content-Type: application/json\r\nContent-Length: ${post.body.length}\r\n\r\n`,
  );
  await within(requestReceived.promise, "The server never received the request");
  return post;
}

describe("stop", () => {
  test("waits for a request in progress", async (t) => {
    const post = await startPostInProgress(t, "close");
    let stopped = false;
    const stopping = post.stop().then(() => {
      stopped = true;
    });
    // stop() closes the listening socket as soon as it starts, so a refused
    // connection means that stop() ran. A stop() that doesn't wait for the
    // request has resolved by the time the event loop reports the refusal, with
    // no timer: it needs only promise ticks. The request still waits for its
    // body, so a correct stop() is still pending.
    await assert.rejects(once(net.connect(post.port, "127.0.0.1"), "connect"), {
      code: "ECONNREFUSED",
    });
    assert.equal(stopped, false, "stop() resolved before the request finished");

    post.sendBody();
    await stopping;
    // stop() can resolve before the client reads the response, so wait for the
    // server to close the connection.
    await post.socketClosed;

    assert.match(post.response, /^HTTP\/1\.1 201 /);
    assert.deepEqual(await savedIngredients(), ["Onion"]);
  });

  test("closes the keep-alive connection of a request in progress", async (t) => {
    const post = await startPostInProgress(t, "keep-alive");
    const stopping = post.stop();

    post.sendBody();

    await within(stopping, "stop() didn't resolve after the request finished");
    await within(post.socketClosed, "The server didn't close the keep-alive connection");
  });
});

test("stop() rejects with the error of the server when it can't close", async () => {
  const server = await start({ dataDir, logger: silentLogger, port: 0, version: "1.2.3" });
  await server.stop();

  // The server is already closed, so closing it again fails.
  await assert.rejects(server.stop(), { code: "ERR_SERVER_NOT_RUNNING" });
});

/**
 * Runs `node server/index.js` in the data directory of the test, with the
 * environment variables ENV, and kills it when the test ends. `entries` holds
 * the lines of its standard output parsed as JSON, and a line that isn't JSON
 * as `{ notJson: line }`.
 * @param {import("node:test").TestContext} t
 * @param {Record<string, string>} env
 * @param {string[]} [nodeArgs] The options of `node`, before the script.
 */
function runIndex(t, env, nodeArgs = []) {
  const child = spawn(process.execPath, [...nodeArgs, INDEX], {
    env: { ...process.env, DATA_DIR: dataDir, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  /** @type {any[]} */
  const entries = [];
  const lines = createInterface({ input: child.stdout });
  /** The first entry that the process writes. */
  const first = new Promise((resolve, reject) => {
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
  // Listen from the start: readline can close before the exit event's handlers run.
  /** The exit code, once the process has exited and its output has ended. */
  const exited = Promise.all([
    once(child, "exit"),
    once(lines, "close"),
    once(child.stderr, "close"),
  ]).then(([[code]]) => code);
  // A test that never reads `exited` must not report its rejection as unhandled.
  exited.catch(() => {});
  // The same for `first`, which rejects when the first line isn't JSON.
  first.catch(() => {});
  return {
    child,
    entries,
    exited,
    first,
    get stderr() {
      return stderr;
    },
    get stdout() {
      return stdout;
    },
  };
}

/** A port that another server listens on until the test ends. */
async function takenPort(t) {
  const taken = net.createServer().listen(0, "0.0.0.0");
  t.after(() => taken.close());
  await once(taken, "listening");
  return /** @type {net.AddressInfo} */ (taken.address()).port;
}

describe("server/index.js", () => {
  test("exits with 1 when the port is in use", async (t) => {
    const { exited } = runIndex(t, { PORT: String(await takenPort(t)) });

    assert.equal(await exited, 1);
  });

  test("logs one error line, and nothing else, when the port is in use", async (t) => {
    const server = runIndex(t, { PORT: String(await takenPort(t)) });

    await server.exited;

    assert.equal(server.stderr, "");
    const lines = server.stdout.trim().split("\n");
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.level, "error");
    assert.equal(entry.msg, "server failed to start");
    assert.match(entry.error, /EADDRINUSE/);
  });

  test("logs the version, the data directory, and the port that it listens on", async (t) => {
    const server = runIndex(t, { PORT: "0" });

    const entry = await server.first;

    assert.deepEqual(
      { ...entry, time: typeof entry.time },
      {
        time: "string",
        level: "info",
        msg: "server started",
        version: PACKAGE_VERSION,
        port: entry.port,
        dataDir,
      },
    );
    // The logged port is the one that answers.
    const health = await fetch(`http://127.0.0.1:${entry.port}/api/health`);
    assert.equal(health.status, 200);
  });

  test("registers the SIGINT and SIGTERM handlers before it logs its start", async (t) => {
    const server = runIndex(t, { PORT: "0" }, ["--import", SIGNAL_LISTENERS_HOOK]);
    await server.first;
    server.child.kill("SIGTERM");

    await server.exited;

    assert.deepEqual(JSON.parse(server.stderr), { listeners: { SIGINT: 1, SIGTERM: 1 } });
  });

  test("exits with 0 on SIGTERM", async (t) => {
    const server = runIndex(t, { PORT: "0" });
    await server.first;

    server.child.kill("SIGTERM");

    assert.equal(await server.exited, 0, server.stderr);
  });

  test("logs the signal and the stop on SIGTERM", async (t) => {
    const server = runIndex(t, { PORT: "0" });
    await server.first;

    server.child.kill("SIGTERM");
    await server.exited;

    assert.deepEqual(
      server.entries.slice(1).map((entry) => ({ ...entry, time: typeof entry.time })),
      [
        { time: "string", level: "info", msg: "server stopping", signal: "SIGTERM" },
        { time: "string", level: "info", msg: "server stopped" },
      ],
    );
  });
});
