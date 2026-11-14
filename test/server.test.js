import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { silentLogger } from "../server/logger.js";
import { start } from "../server/start.js";
import { createStores } from "../server/stores.js";
import { heldStep, scriptedProvider } from "./assistant-helpers.js";
import { startTestServer, useDataDir, within } from "./backend-helpers.js";

const INDEX = fileURLToPath(new URL("../server/index.js", import.meta.url));
const SIGNAL_LISTENERS_HOOK = fileURLToPath(
  new URL("./hooks/signal-listeners.js", import.meta.url),
);
const { version: PACKAGE_VERSION } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

const dataDir = useDataDir("meals-server-");

/** The names in the saved ingredient catalog. */
async function savedIngredients() {
  const text = await readFile(path.join(dataDir(), "v2", "ingredients.json"), "utf8");
  return JSON.parse(text).ingredients.map((ingredient) => ingredient.name);
}

describe("idle", () => {
  test("resolves after every write queued before it", async () => {
    const stores = createStores({ dataDir: dataDir() });
    const adding = stores.ingredients.create({ name: "Onion", unit: "g" });

    await stores.idle();

    assert.deepEqual(await savedIngredients(), ["Onion"]);
    await adding;
  });
});

describe("start", () => {
  test("creates a missing data directory, so the health check passes", async (t) => {
    const newDir = path.join(dataDir(), "not", "yet", "created");
    const server = await startTestServer(t, newDir);

    const health = await fetch(`http://127.0.0.1:${server.port}/api/health`);

    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", version: "1.2.3" });
  });

  test("listens on every interface unless it gets a host", async (t) => {
    const server = await start({
      dataDir: dataDir(),
      logger: silentLogger,
      port: 0,
      version: "1.2.3",
    });
    t.after(() => server.stop());

    assert.equal(server.address, "0.0.0.0");
  });

  test("listens only on the host that it gets", async (t) => {
    const server = await start({
      dataDir: dataDir(),
      host: "127.0.0.1",
      logger: silentLogger,
      port: 0,
      version: "1.2.3",
    });
    t.after(() => server.stop());

    assert.equal(server.address, "127.0.0.1");
  });

  test("turns the assistant on when it gets a provider", async (t) => {
    const server = await startTestServer(t, dataDir(), { provider: scriptedProvider([]) });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/assistant`);

    assert.deepEqual(await res.json(), { enabled: true });
  });

  test("rejects when it can't create the data directory", async (t) => {
    // A directory can't live under a regular file, whoever runs the test.
    const file = path.join(dataDir(), "file");
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
  const server = await start({
    dataDir: dataDir(),
    host: "127.0.0.1",
    logger: silentLogger,
    port: 0,
    version: "1.2.3",
  });
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

  test("cancels a turn that waits for the provider", async () => {
    const held = heldStep();
    const server = await start({
      dataDir: dataDir(),
      host: "127.0.0.1",
      logger: silentLogger,
      port: 0,
      provider: scriptedProvider([held.step]),
      version: "1.2.3",
    });
    const base = `http://127.0.0.1:${server.port}/api/assistant/conversations`;
    const { id } = await (await fetch(base, { method: "POST" })).json();
    const sent = await fetch(`${base}/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hi." }),
    });
    assert.equal(sent.status, 202);
    await within(held.called, "The turn never called the provider");

    await within(server.stop(), "stop() waited for the provider");

    assert.equal(held.aborted, true, "the provider call is still running");
  });

  test("rejects with the error of the server when it can't close", async () => {
    const server = await start({
      dataDir: dataDir(),
      host: "127.0.0.1",
      logger: silentLogger,
      port: 0,
      version: "1.2.3",
    });
    await server.stop();

    // The server is already closed, so closing it again fails.
    await assert.rejects(server.stop(), { code: "ERR_SERVER_NOT_RUNNING" });
  });
});

/**
 * Runs `node server/index.js` in the data directory of the test, with the
 * environment variables ENV, and kills it when the test ends. `entries` holds
 * the lines of its standard output parsed as JSON, and a line that isn't JSON
 * as `{ notJson: line }`. `logged(msg)` resolves to the first entry whose
 * message is `msg`, once the process writes it.
 * @param {import("node:test").TestContext} t
 * @param {Record<string, string>} env
 * @param {string[]} [nodeArgs] The options of `node`, before the script.
 */
function runIndex(t, env, nodeArgs = []) {
  const child = spawn(process.execPath, [...nodeArgs, INDEX], {
    // An empty variable is an unset one, so the assistant of the machine
    // that runs the tests stays off unless a test turns it on.
    env: {
      ...process.env,
      ASSISTANT_API_KEY: "",
      ASSISTANT_MODEL: "",
      ASSISTANT_PROVIDER: "",
      DATA_DIR: dataDir(),
      ...env,
    },
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
  /** @param {string} msg */
  function logged(msg) {
    return new Promise((resolve) => {
      // Registered after the parser above, so each line is in `entries` by now.
      const check = () => {
        const entry = entries.find((candidate) => candidate.msg === msg);
        if (entry === undefined) return;
        lines.off("line", check);
        resolve(entry);
      };
      lines.on("line", check);
      check();
    });
  }
  return {
    child,
    entries,
    exited,
    first,
    logged,
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

  test("logs only one error line when the port is in use", async (t) => {
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
        dataDir: dataDir(),
        assistant: "off",
      },
    );
    // The logged port is the one that answers.
    const health = await fetch(`http://127.0.0.1:${entry.port}/api/health`);
    assert.equal(health.status, 200);
  });

  for (const provider of ["anthropic", "openai"]) {
    test(`turns the assistant on and logs ${provider} when it's configured`, async (t) => {
      const server = runIndex(t, {
        ASSISTANT_API_KEY: "sk-test-key",
        ASSISTANT_MODEL: "model-1",
        ASSISTANT_PROVIDER: provider,
        PORT: "0",
      });

      const entry = await server.first;

      assert.equal(entry.msg, "server started");
      assert.equal(entry.assistant, provider);
      const res = await fetch(`http://127.0.0.1:${entry.port}/api/assistant`);
      assert.deepEqual(await res.json(), { enabled: true });
    });
  }

  test("logs the problem and starts with the assistant off when it's incomplete", async (t) => {
    const server = runIndex(t, {
      ASSISTANT_API_KEY: "sk-test-key",
      ASSISTANT_PROVIDER: "anthropic",
      PORT: "0",
    });
    const started = await within(server.logged("server started"), "The server never started");

    assert.deepEqual(
      server.entries.map(({ level, msg, problem, assistant }) => ({
        level,
        msg,
        problem,
        assistant,
      })),
      [
        {
          level: "error",
          msg: "assistant not configured",
          problem: server.entries[0].problem,
          assistant: undefined,
        },
        { level: "info", msg: "server started", problem: undefined, assistant: "off" },
      ],
    );
    assert.match(server.entries[0].problem, /ASSISTANT_MODEL/);
    assert.equal(server.stdout.includes("sk-test-key"), false, "the key is in the log");
    const res = await fetch(`http://127.0.0.1:${started.port}/api/assistant`);
    assert.deepEqual(await res.json(), { enabled: false });
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
