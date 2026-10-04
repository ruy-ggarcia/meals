# Releases and deployment implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every change reaches the home host as a versioned release: an
immutable image that the host deploys on its own, with a backup first, a
health check, and a rollback, plus daily backups and a weekly restore check.

**Architecture:** The server gains JSON logs, a health endpoint, and a
graceful shutdown. A `Dockerfile` and `deploy/compose.yaml` define how it
runs. GitHub Actions tests the image on every pull request, and
release-please plus a publish job turn merged release pull requests into
tags, GitHub Releases, and images in GHCR referenced by digest. On the host,
bash scripts in `scripts/`, run by systemd timers as the user `deployer`,
deploy, back up, restore, and check backups under `/opt/server/meals`.

**Tech Stack:** Node.js 22, Express 5, `node:test`, supertest, Docker and
Docker Compose, bash, `curl`, `flock`, `jq`, `tar`, ShellCheck, GitHub
Actions, release-please, Dependabot, and systemd.

**Spec:** `docs/plans/2026-10-04-releases-and-deployment-design.md`

## Global Constraints

- Node.js 22, and no new runtime dependencies. The image starts from
  `node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402`.
- Every artifact is in US English and follows the Google developer
  documentation style: sentence-case headings, "you", present tense, active
  voice, the serial comma, and code font for code, commands, files, and
  values.
- When nothing else decides an order, sort from A to Z. In mixed lists, put
  patterns first, then directories, then files.
- Before every commit, `npm run format` applies Biome's format, and then
  `npm run lint` and `npm test` pass. A passing `npm test` prints nothing
  but the TAP summary.
- Commit messages follow Conventional Commits, and the type decides
  releases: `feat` and `fix` release, and `build`, `ci`, `docs`, `refactor`,
  and `test` don't. Commits have no attribution trailers and no planning
  labels.
- Shell scripts use bash with `set -euo pipefail` and pass ShellCheck.
- Host values: the root is `/opt/server/meals` (`MEALS_ROOT`), the port is
  `3000`, the image is `ghcr.io/ruy-ggarcia/meals`, and `image.txt` matches
  `^ghcr\.io/ruy-ggarcia/meals@sha256:[0-9a-f]{64}$`.
- Times: the shutdown deadline is 10 seconds, the container grace period is
  15 seconds, and the deployment verification waits up to 60 seconds.
- Retention: 14 `daily`, 10 `pre-deploy`, and 10 `pre-restore` backups.
- Actions are pinned by full SHA with a version comment:
  - `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`
  - `actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0`
  - `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0`
  - `googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0`
- `docs/glossary.md` holds application-domain terms only. Don't add the
  operations terms to it.

## Review Focus

- A browser keeps a keep-alive connection open when Docker stops the
  container: the server must stop right after the request in progress, not
  after the 5-second keep-alive timeout. Task 3 pins it.
- GitHub is unreachable or rate-limits the host: `meals-deploy` must fail
  without stopping the app or changing any file. Task 9 pins it.
- The deploy timer fires while the daily backup runs: the second script must
  wait for the lock, not interleave. Task 7 pins it.
- A backup was interrupted and left a `.partial` file: retention and the
  restore check must ignore it. Tasks 7 and 10 pin it.
- You type the version with its tag prefix, as in `meals-deploy v0.1.0`: it
  must work like `meals-deploy 0.1.0`. Task 9 pins it.

## Before you start

The implementer needs these tools on the computer that runs the plan:

- ShellCheck. From Task 4 on, `npm run lint` runs it. To install it on
  Ubuntu, the repository owner runs `sudo apt install shellcheck`.
- Docker with the Compose plugin, for `npm run test:image` in Task 4.
- `curl`, `flock`, `gzip`, `jq`, and `tar`, which the host script tests run
  for real.

Work in the worktree of the branch `feature/releases-and-deployment`. Run
`npm ci` once before the first task.

## File structure

```none
.github/
  workflows/
    ci.yml                  # Modify: SHAs, timeouts, ShellCheck, image job
    release.yml             # Create: release-please and publish
  dependabot.yml            # Create
deploy/
  systemd/                  # Create: the three services and three timers
  compose.yaml              # Create: the app service on the host
docs/
  deployment.md             # Create: operations guide
  manual-test-plan.md       # Modify: port 3001, host tests
scripts/
  lib/
    common.sh               # Create: functions shared by the meals-* scripts
  image-smoke.sh            # Create: the image smoke test
  install.sh                # Create: installs the host tools
  meals-backup              # Create
  meals-deploy              # Create
  meals-restore             # Create
  meals-restore-check       # Create
server/
  app.js                    # Modify: request logs, error logs, health endpoint
  healthcheck.js            # Create: the image's HEALTHCHECK
  index.js                  # Modify: start, logs, and signals
  logger.js                 # Create: JSON line logger
  shutdown.js               # Create: signal handling with a deadline
  start.js                  # Create: listen and stop
  stores.js                 # Modify: idle()
test/
  stubs/
    curl                    # Create: stub curl for the host script tests
    docker                  # Create: stub docker for the host script tests
  api.test.js               # Modify: logs and health
  backup.test.js            # Create
  deploy.test.js            # Create
  healthcheck.test.js       # Create
  helpers.js                # Modify: collectingLogger()
  host-helpers.js           # Create: temporary host and script runner
  logger.test.js            # Create
  restore-check.test.js     # Create
  restore.test.js           # Create
  server.test.js            # Create: idle(), start/stop, index.js
  shutdown.test.js          # Create
.dockerignore               # Create
.release-please-manifest.json # Create
.shellcheckrc               # Create
CHANGELOG.md                # Create
Dockerfile                  # Create
README.md                   # Modify
package.json                # Modify: lint, test:image
release-please-config.json  # Create
```

---

### Task 1: Request and error logs

**Files:**
- Create: `server/logger.js`
- Create: `test/logger.test.js`
- Modify: `server/app.js`
- Modify: `test/api.test.js`
- Modify: `test/helpers.js`

**Interfaces:**
- Produces: `createLogger(write?) → { error(msg, fields?), info(msg, fields?) }`
  and `silentLogger` from `server/logger.js`.
- Produces: `createApp(stores, { logger } = {})`. Later tasks add `dataDir`
  and `version` to the second parameter.
- Produces: `collectingLogger() → { entries, logger }` in `test/helpers.js`.
  Each entry is `{ level, msg, ...fields }`, without `time`.

- [ ] **Step 1: Write the failing logger test**

Create `test/logger.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { createLogger } from "../server/logger.js";

test("createLogger writes one JSON object per line with time, level, msg, and the fields", () => {
  const lines = [];
  const logger = createLogger((line) => lines.push(line));

  logger.info("server started", { port: 3000 });
  logger.error("shutdown timed out");

  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.ok(line.endsWith("\n"), "each entry ends its line");
    assert.ok(!line.slice(0, -1).includes("\n"), "each entry takes one line");
  }
  const [started, timedOut] = lines.map((line) => JSON.parse(line));
  assert.deepEqual(Object.keys(started), ["time", "level", "msg", "port"]);
  assert.equal(new Date(started.time).toISOString(), started.time);
  assert.deepEqual(
    { ...started, time: "TIME" },
    { time: "TIME", level: "info", msg: "server started", port: 3000 },
  );
  assert.deepEqual({ ...timedOut, time: "TIME" }, { time: "TIME", level: "error", msg: "shutdown timed out" });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/logger.test.js`
Expected: FAIL with `Cannot find module` for `server/logger.js`.

- [ ] **Step 3: Write the logger**

Create `server/logger.js`:

```js
// Logs one JSON object per line, for `docker logs` and the journal.

/**
 * Returns a logger whose `info` and `error` write `{ time, level, msg,
 * ...fields }` as one line through `write`, which defaults to standard
 * output.
 */
export function createLogger(write = (line) => process.stdout.write(line)) {
  const entry =
    (level) =>
    (msg, fields = {}) => {
      write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })}\n`);
    };
  return { error: entry("error"), info: entry("info") };
}

/** A logger that discards every entry, for code that doesn't need logs. */
export const silentLogger = { error() {}, info() {} };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/logger.test.js`
Expected: PASS.

- [ ] **Step 5: Add `collectingLogger` to the test helpers**

Append to `test/helpers.js`:

```js

/**
 * A logger that keeps each entry as `{ level, msg, ...fields }` in `entries`,
 * so tests can check logs without printing them.
 */
export function collectingLogger() {
  const entries = [];
  const entry =
    (level) =>
    (msg, fields = {}) => {
      entries.push({ level, msg, ...fields });
    };
  return { entries, logger: { error: entry("error"), info: entry("info") } };
}
```

- [ ] **Step 6: Write the failing request log tests**

In `test/api.test.js`, add `collectingLogger` to the import from
`./helpers.js`:

```js
import { blankWeek, collectingLogger } from "./helpers.js";
```

Insert this section before `// ---------- Recipes ----------`:

```js
// ---------- Logs ----------

test("each /api request is logged with its method, path, status, and duration", async () => {
  const { entries, logger } = collectingLogger();
  const loggedApp = createApp(createStores({ dataDir }), { logger });

  await request(loggedApp).get("/api/recipes?ignored=1");
  await request(loggedApp).put(`/api/weeks/${WEEK}/mon/lunch`).send({ items: [] });
  await request(loggedApp).get("/api/nope");

  assert.deepEqual(
    entries.map((entry) => ({ ...entry, ms: typeof entry.ms })),
    [
      { level: "info", msg: "request", method: "GET", path: "/api/recipes", status: 200, ms: "number" },
      {
        level: "info",
        msg: "request",
        method: "PUT",
        path: `/api/weeks/${WEEK}/mon/lunch`,
        status: 200,
        ms: "number",
      },
      { level: "info", msg: "request", method: "GET", path: "/api/nope", status: 404, ms: "number" },
    ],
  );
  assert.ok(entries.every(({ ms }) => Number.isInteger(ms) && ms >= 0));
});

test("static files aren't logged", async () => {
  const { entries, logger } = collectingLogger();
  const loggedApp = createApp(createStores({ dataDir }), { logger });

  assert.equal((await request(loggedApp).get("/")).status, 200);
  assert.equal((await request(loggedApp).get("/styles.css")).status, 200);

  assert.deepEqual(entries, []);
});
```

- [ ] **Step 7: Make the 500 tests check the log instead of `console.error`**

In `test/api.test.js`, replace the test
`GET /api/recipes returns 500 JSON when the recipes file is corrupt` with:

```js
test("GET /api/recipes returns 500 JSON when the recipes file is corrupt, and logs the error", async () => {
  const { entries, logger } = collectingLogger();
  const loggedApp = createApp(createStores({ dataDir }), { logger });
  await mkdir(path.join(dataDir, "v2"), { recursive: true });
  await writeFile(path.join(dataDir, "v2", "recipes.json"), "{ not json");

  const res = await request(loggedApp).get("/api/recipes");

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "Internal server error" });
  const failures = entries.filter((entry) => entry.msg === "request failed");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].level, "error");
  assert.equal(failures[0].method, "GET");
  assert.equal(failures[0].path, "/api/recipes");
  assert.match(failures[0].error, /^SyntaxError/);
});
```

Replace the test `GET returns 500 JSON when the week file is corrupt` with:

```js
test("GET returns 500 JSON when the week file is corrupt, and logs the error", async () => {
  const { entries, logger } = collectingLogger();
  const loggedApp = createApp(createStores({ dataDir }), { logger });
  await mkdir(path.join(dataDir, "v2", "weeks"), { recursive: true });
  await writeFile(path.join(dataDir, "v2", "weeks", `${WEEK}.json`), "{ not json");

  const res = await request(loggedApp).get(`/api/weeks/${WEEK}`);

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "Internal server error" });
  assert.equal(entries.filter((entry) => entry.msg === "request failed").length, 1);
});
```

In the tests `an error with a status outside 400-499 maps to 500` and
`a corrupt ingredients file makes GET /api/ingredients and GET /api/recipes return 500`,
delete the line `t.mock.method(console, "error", () => {});`, and change
`async (t) =>` to `async () =>`. With the default silent logger, they print
nothing.

- [ ] **Step 8: Run the API tests to verify they fail**

Run: `node --test test/api.test.js`
Expected: FAIL. The request log test finds no entries, and the two 500 tests
find no `request failed` entry. `static files aren't logged` already passes,
because nothing logs yet. The two edited tests print `console.error` output.

- [ ] **Step 9: Log requests and errors in the app**

In `server/app.js`, add the import after the `./errors.js` import:

```js
import { silentLogger } from "./logger.js";
```

Add these functions after the `PUBLIC_DIR` constant:

```js
/** The path of a request, without its query string. */
function pathOf(req) {
  return req.originalUrl.split("?")[0];
}

/** Logs each request when its response finishes. */
function logRequests(logger) {
  return (req, res, next) => {
    const started = performance.now();
    res.on("finish", () => {
      logger.info("request", {
        method: req.method,
        path: pathOf(req),
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
      });
    });
    next();
  };
}
```

Change the start of `createApp` to:

```js
export function createApp({ ingredients, recipes, weeks }, { logger = silentLogger } = {}) {
  const app = express();
  app.use("/api", logRequests(logger));
  app.use(express.json());
```

In the final error handler, rename `_req` to `req`, and replace
`if (status === 500) console.error(err);` with:

```js
    if (status === 500) {
      logger.error("request failed", { method: req.method, path: pathOf(req), error: err.stack });
    }
```

- [ ] **Step 10: Run the API tests to verify they pass**

Run: `node --test test/api.test.js`
Expected: PASS, with no `console.error` output.

- [ ] **Step 11: Run the checks**

Run: `npm run format && npm run lint && npm test`
Expected: both pass, and `npm test` prints only the TAP summary.

- [ ] **Step 12: Commit**

```bash
git add server/app.js server/logger.js test/api.test.js test/helpers.js test/logger.test.js
git commit -m "feat(server): log requests and errors as JSON lines"
```

---

### Task 2: Health endpoint

**Files:**
- Modify: `server/app.js`
- Modify: `test/api.test.js`
- Modify: `README.md` (API reference)

**Interfaces:**
- Consumes: `createApp(stores, { logger })` and `collectingLogger()` from
  Task 1.
- Produces: `createApp(stores, { dataDir, logger, version } = {})` and
  `GET /api/health`.

- [ ] **Step 1: Write the failing tests**

In `test/api.test.js`, add `chmod` to the `node:fs/promises` import, keeping
the names sorted:

```js
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
```

Insert this section after the `// ---------- Logs ----------` section:

```js
// ---------- Health ----------

test("GET /api/health returns 200 with the version when the data directory is writable", async () => {
  const healthApp = createApp(createStores({ dataDir }), { dataDir, version: "1.2.3" });

  const res = await request(healthApp).get("/api/health");

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.deepEqual(res.body, { status: "ok", version: "1.2.3" });
});

test("GET /api/health returns 503 when the data directory isn't writable", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root can write to any directory");
    return;
  }
  // afterEach removes the directory, which is empty, so the mode can stay.
  await chmod(dataDir, 0o500);
  const healthApp = createApp(createStores({ dataDir }), { dataDir, version: "1.2.3" });

  const res = await request(healthApp).get("/api/health");

  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { status: "error", version: "1.2.3" });
});

test("GET /api/health returns 503 when the data directory doesn't exist", async () => {
  const missing = path.join(dataDir, "missing");
  const healthApp = createApp(createStores({ dataDir: missing }), {
    dataDir: missing,
    version: "1.2.3",
  });

  const res = await request(healthApp).get("/api/health");

  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { status: "error", version: "1.2.3" });
});

test("successful health checks aren't logged, and failed ones are", async () => {
  const { entries, logger } = collectingLogger();
  const missing = path.join(dataDir, "missing");

  await request(createApp(createStores({ dataDir }), { dataDir, logger })).get("/api/health");
  await request(createApp(createStores({ dataDir: missing }), { dataDir: missing, logger })).get(
    "/api/health",
  );

  assert.deepEqual(
    entries.map((entry) => ({ msg: entry.msg, path: entry.path, status: entry.status })),
    [{ msg: "request", path: "/api/health", status: 503 }],
  );
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/api.test.js`
Expected: FAIL. `GET /api/health` returns `404`.

- [ ] **Step 3: Add the endpoint**

In `server/app.js`, add this import before the `node:url` import:

```js
import { access, constants } from "node:fs/promises";
```

In `logRequests`, skip successful health checks. The `finish` handler
becomes:

```js
    res.on("finish", () => {
      const path = pathOf(req);
      // Docker checks the health every 30 seconds. Log only the failures.
      if (path === "/api/health" && res.statusCode === 200) return;
      logger.info("request", {
        method: req.method,
        path,
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
      });
    });
```

Change the signature of `createApp`, and add the route right after
`app.use(express.json());`:

```js
export function createApp(
  { ingredients, recipes, weeks },
  { dataDir, logger = silentLogger, version } = {},
) {
  const app = express();
  app.use("/api", logRequests(logger));
  app.use(express.json());

  // Healthy means the server can read and write the data directory. It
  // reads no data file, so a check every few seconds is cheap.
  app.get("/api/health", async (_req, res) => {
    try {
      await access(dataDir, constants.R_OK | constants.W_OK);
      res.json({ status: "ok", version });
    } catch {
      res.status(503).json({ status: "error", version });
    }
  });
```

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test test/api.test.js`
Expected: PASS.

- [ ] **Step 5: Document the endpoint**

In `README.md`, insert this section after the paragraph that starts with
`A week is identified by the date of its Monday` and its JSON example, and
before `### List recipes`:

````markdown
### Check the health

`GET /api/health`

| Status | Meaning |
|--------|---------|
| `200`  | The body is `{ "status": "ok", "version": "VERSION" }`, where `VERSION` is the version of the server, such as `0.2.0`. The server can read and write the data directory. |
| `503`  | The body is `{ "status": "error", "version": "VERSION" }`. The server can't read or write the data directory. |
````

- [ ] **Step 6: Run the checks**

Run: `npm run format && npm run lint && npm test`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add README.md server/app.js test/api.test.js
git commit -m "feat(server): add the health endpoint"
```

---

### Task 3: Graceful shutdown

**Files:**
- Create: `server/shutdown.js`
- Create: `server/start.js`
- Create: `test/server.test.js`
- Create: `test/shutdown.test.js`
- Modify: `server/index.js`
- Modify: `server/stores.js`
- Modify: `README.md` (Start the server)
- Modify: `package.json` (`test`)

**Interfaces:**
- Consumes: `createApp(stores, { dataDir, logger, version })`,
  `createLogger()`, and `silentLogger`.
- Produces: `createStores(...)` returns `{ idle, ingredients, recipes, weeks }`,
  where `idle() → Promise` resolves after every write queued before it.
- Produces: `start({ dataDir, logger, port, version }) → Promise<{ port, stop }>`
  in `server/start.js`, where `stop() → Promise`.
- Produces: `createShutdown({ exit, logger, stop, timeoutMs? }) → shutdown(signal)`
  and `SHUTDOWN_TIMEOUT_MS = 10_000` in `server/shutdown.js`.

- [ ] **Step 1: Write the failing shutdown tests**

Create `test/shutdown.test.js`:

```js
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { createShutdown } from "../server/shutdown.js";
import { collectingLogger } from "./helpers.js";

/** A stop() that resolves or rejects when the test says so. */
function controlledStop() {
  const control = {};
  control.stop = mock.fn(
    () =>
      new Promise((resolve, reject) => {
        control.resolve = resolve;
        control.reject = reject;
      }),
  );
  return control;
}

test("shutdown logs the signal, waits for stop(), logs the stop, and exits with 0", async () => {
  const { entries, logger } = collectingLogger();
  const exit = mock.fn();
  const control = controlledStop();
  const shutdown = createShutdown({ exit, logger, stop: control.stop });

  shutdown("SIGTERM");
  await setImmediate();
  assert.equal(control.stop.mock.callCount(), 1);
  assert.equal(exit.mock.callCount(), 0);

  control.resolve();
  await setImmediate();

  assert.deepEqual(
    exit.mock.calls.map((call) => call.arguments),
    [[0]],
  );
  assert.deepEqual(entries, [
    { level: "info", msg: "server stopping", signal: "SIGTERM" },
    { level: "info", msg: "server stopped" },
  ]);
});

test("a second signal doesn't stop the server again", (t) => {
  // Mock timers, so the 10-second deadline doesn't keep the test file running.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { logger } = collectingLogger();
  const control = controlledStop();
  const shutdown = createShutdown({ exit: mock.fn(), logger, stop: control.stop });

  shutdown("SIGTERM");
  shutdown("SIGINT");

  assert.equal(control.stop.mock.callCount(), 1);
});

test("shutdown exits with 1 when stop() takes longer than the deadline", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { entries, logger } = collectingLogger();
  const exit = mock.fn();
  const shutdown = createShutdown({ exit, logger, stop: controlledStop().stop });

  shutdown("SIGTERM");
  t.mock.timers.tick(9_999);
  assert.equal(exit.mock.callCount(), 0);
  t.mock.timers.tick(1);

  assert.deepEqual(
    exit.mock.calls.map((call) => call.arguments),
    [[1]],
  );
  assert.deepEqual(entries.at(-1), { level: "error", msg: "shutdown timed out" });
});

test("shutdown logs the error and exits with 1 when stop() fails", async () => {
  const { entries, logger } = collectingLogger();
  const exit = mock.fn();
  const control = controlledStop();
  const shutdown = createShutdown({ exit, logger, stop: control.stop });

  shutdown("SIGTERM");
  control.reject(new Error("disk gone"));
  await setImmediate();

  assert.deepEqual(
    exit.mock.calls.map((call) => call.arguments),
    [[1]],
  );
  assert.equal(entries.at(-1).msg, "shutdown failed");
  assert.match(entries.at(-1).error, /disk gone/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/shutdown.test.js`
Expected: FAIL with `Cannot find module` for `server/shutdown.js`.

- [ ] **Step 3: Write `server/shutdown.js`**

```js
// Stops the server once, on SIGINT or SIGTERM, within a deadline that's
// shorter than the container's 15-second grace period.

export const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Returns `shutdown(signal)`, which logs the signal, calls `stop()`, logs
 * the stop, and calls `exit(0)`. It calls `exit(1)` instead when `stop()`
 * fails or takes longer than `timeoutMs`. Later calls do nothing.
 */
export function createShutdown({ exit, logger, stop, timeoutMs = SHUTDOWN_TIMEOUT_MS }) {
  let stopping = false;
  return function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    logger.info("server stopping", { signal });
    const deadline = setTimeout(() => {
      logger.error("shutdown timed out");
      exit(1);
    }, timeoutMs);
    stop().then(
      () => {
        clearTimeout(deadline);
        logger.info("server stopped");
        exit(0);
      },
      (error) => {
        clearTimeout(deadline);
        logger.error("shutdown failed", { error: error.stack });
        exit(1);
      },
    );
  };
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test test/shutdown.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing server tests**

Create `test/server.test.js`:

```js
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

test("stop() waits for a request in progress, and then closes its keep-alive connection", async () => {
  const server = await start({ dataDir, logger: silentLogger, port: 0, version: "1.2.3" });
  const socket = net.connect(server.port, "127.0.0.1");
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
  await delay(100); // The server reads the headers, so the request is in progress.

  let stopped = false;
  const stopping = server.stop().then(() => {
    stopped = true;
  });
  await delay(100);
  assert.equal(stopped, false, "stop() resolved before the request finished");

  const sentAt = Date.now();
  socket.write(body);
  await stopping;
  // stop() can resolve before the client reads the response, so wait for the
  // server to close the connection.
  await socketClosed;

  // Without closing the connection, stop() waits for the 5-second keep-alive timeout.
  assert.ok(Date.now() - sentAt < 2000, "stop() waited for the keep-alive timeout");
  assert.match(response, /^HTTP\/1\.1 201 /);
  assert.deepEqual(await savedIngredients(), ["Onion"]);
});

test("node server/index.js logs its start, and on SIGTERM stops and exits with 0", async () => {
  const child = spawn(process.execPath, [INDEX], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const entries = [];
  const lines = createInterface({ input: child.stdout });
  const started = new Promise((resolve) => {
    lines.on("line", (line) => {
      entries.push(JSON.parse(line));
      if (entries.length === 1) resolve(entries[0]);
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
```

- [ ] **Step 6: Run them to verify they fail**

Run: `node --test test/server.test.js`
Expected: FAIL with `Cannot find module` for `server/start.js`.

- [ ] **Step 7: Add `idle()` to the stores**

In `server/stores.js`, replace `return { ingredients, recipes, weeks };`
with:

```js
  // An empty task runs after every write queued before it, so idle()
  // resolves once those writes are on disk.
  const idle = () => enqueue(() => {});
  return { idle, ingredients, recipes, weeks };
```

- [ ] **Step 8: Write `server/start.js`**

```js
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
      const closed = new Promise((resolve) => server.close(() => resolve()));
      server.closeIdleConnections();
      await closed;
      await stores.idle();
    },
  };
}
```

- [ ] **Step 9: Rewrite `server/index.js`**

```js
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

const server = await start({ dataDir, logger, port, version });
logger.info("server started", { version, port: server.port, dataDir });

const shutdown = createShutdown({ exit: process.exit, logger, stop: server.stop });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `node --test test/server.test.js test/shutdown.test.js`
Expected: PASS.

- [ ] **Step 10a: Silence the mock timers warning**

Node.js 22 prints `ExperimentalWarning: The MockTimers API is an
experimental feature` when a test enables mock timers, and a passing
`npm test` must print nothing extra. In `package.json`, change the `test`
script to:

```json
    "test": "node --test --disable-warning=ExperimentalWarning --test-timeout=10000 test/*.test.js"
```

Run: `npm test 2>&1 | grep -c ExperimentalWarning`
Expected: `0`.

- [ ] **Step 11: Update the start output in the README**

In `README.md`, in "Start the server", replace:

````markdown
   The server prints a line similar to the following:

   ```none
   Meals listening on http://0.0.0.0:3000 (data: /path/to/meals/data)
   ```
````

with:

````markdown
   The server logs one JSON object per line. The first one is similar to
   the following:

   ```json
   {"time":"2026-10-04T10:00:00.000Z","level":"info","msg":"server started","version":"0.2.0","port":3000,"dataDir":"/path/to/meals/data"}
   ```
````

- [ ] **Step 12: Run the checks**

Run: `npm run format && npm run lint && npm test`
Expected: both pass.

- [ ] **Step 13: Commit**

```bash
git add README.md package.json server/index.js server/shutdown.js server/start.js server/stores.js test/server.test.js test/shutdown.test.js
git commit -m "feat(server): stop cleanly on SIGINT and SIGTERM"
```

---

### Task 4: Container image and smoke test

**Files:**
- Create: `.dockerignore`
- Create: `.shellcheckrc`
- Create: `Dockerfile`
- Create: `deploy/compose.yaml`
- Create: `scripts/image-smoke.sh`
- Create: `server/healthcheck.js`
- Create: `test/healthcheck.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `start()` and `silentLogger`.
- Produces: `deploy/compose.yaml`, which reads `MEALS_GID`, `MEALS_IMAGE`,
  `MEALS_PORT`, and `MEALS_UID`, and declares the service `app`. Tasks 8, 9,
  and 10 run it.
- Produces: `scripts/image-smoke.sh IMAGE` and `npm run test:image`, which
  Tasks 5 and 6 run.

- [ ] **Step 1: Write the failing health check tests**

Create `test/healthcheck.test.js`:

```js
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

/** Runs healthcheck.js against PORT, and resolves to its exit code. */
function healthcheck(port) {
  return new Promise((resolve) => {
    const env = { ...process.env, PORT: String(port) };
    execFile(process.execPath, [HEALTHCHECK], { env }, (error) => resolve(error ? error.code : 0));
  });
}

test("healthcheck.js exits with 0 when the server is healthy", async (t) => {
  const server = await start({ dataDir, logger: silentLogger, port: 0, version: "1.2.3" });
  t.after(() => server.stop());

  assert.equal(await healthcheck(server.port), 0);
});

test("healthcheck.js exits with 1 when the health check returns 503", async (t) => {
  const missing = path.join(dataDir, "missing");
  const server = await start({ dataDir: missing, logger: silentLogger, port: 0, version: "1.2.3" });
  t.after(() => server.stop());

  assert.equal(await healthcheck(server.port), 1);
});

test("healthcheck.js exits with 1 when nothing listens on the port", async () => {
  const server = await start({ dataDir, logger: silentLogger, port: 0, version: "1.2.3" });
  await server.stop();

  assert.equal(await healthcheck(server.port), 1);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/healthcheck.test.js`
Expected: FAIL. The first test gets exit code `1` because the script
doesn't exist.

- [ ] **Step 3: Write `server/healthcheck.js`**

```js
// The image's HEALTHCHECK: exits with 0 when /api/health returns 200, and
// with 1 otherwise, so the image needs no curl or wget. It calls
// process.exit because an open keep-alive connection would keep it running.

const port = process.env.PORT || 3000;

try {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(2000),
  });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test test/healthcheck.test.js`
Expected: PASS.

- [ ] **Step 5: Add the ShellCheck and image scripts to `package.json`**

Replace the `scripts` object with:

```json
  "scripts": {
    "format": "biome check --write .",
    "lint": "biome ci . && shellcheck scripts/*.sh",
    "start": "node server/index.js",
    "test": "node --test --disable-warning=ExperimentalWarning --test-timeout=10000 test/*.test.js",
    "test:image": "docker build --tag meals:test . && scripts/image-smoke.sh meals:test"
  },
```

Create `.shellcheckrc`, so ShellCheck follows `source` to the files next to
each script:

```none
external-sources=true
source-path=SCRIPTDIR
```

- [ ] **Step 6: Write the smoke test**

Create `scripts/image-smoke.sh`, and make it executable with
`chmod +x scripts/image-smoke.sh`:

```bash
#!/usr/bin/env bash
# Usage: scripts/image-smoke.sh IMAGE
#
# Runs IMAGE through deploy/compose.yaml, as the host does, and checks that
# it becomes healthy, reports the version in package.json, keeps its data
# across a restart, and stops with exit code 0.
set -euo pipefail

image=${1:?Usage: scripts/image-smoke.sh IMAGE}
repo=$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")
version=$(jq -r .version "$repo/package.json")
work=$(mktemp -d)
mkdir "$work/data"

export MEALS_GID MEALS_IMAGE=$image MEALS_PORT=127.0.0.1:0 MEALS_UID
MEALS_GID=$(id -g)
MEALS_UID=$(id -u)

compose() {
  docker compose --project-name meals-smoke --project-directory "$work" \
    --file "$repo/deploy/compose.yaml" "$@"
}

cleanup() {
  compose down >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "Smoke test failed: $*" >&2
  compose logs app >&2 || true
  exit 1
}

# Prints the URL of PATH on the app's published port.
url() {
  echo "http://$(compose port app 3000)$1"
}

compose up --detach --wait --wait-timeout 60 || fail "the container didn't become healthy"

reported=$(curl -fsS "$(url /api/health)" | jq -r .version)
[[ $reported == "$version" ]] || fail "/api/health reports version $reported, not $version"

curl -fsS -X POST -H 'Content-Type: application/json' -d '{"name":"Smoke test","unit":"g"}' \
  "$(url /api/ingredients)" >/dev/null || fail "couldn't add an ingredient"
compose restart app >/dev/null 2>&1
compose up --detach --wait --wait-timeout 60 ||
  fail "the container didn't become healthy after a restart"
curl -fsS "$(url /api/ingredients)" | jq -e '.ingredients | any(.name == "Smoke test")' >/dev/null ||
  fail "the ingredient didn't survive a restart"

container=$(compose ps --quiet app)
compose stop app >/dev/null 2>&1
code=$(docker inspect --format '{{.State.ExitCode}}' "$container")
[[ $code == 0 ]] || fail "the container exited with code $code, not 0"

echo "Smoke test passed: $image reports version $version."
```

- [ ] **Step 7: Run the smoke test to verify it fails**

Run: `npm run test:image`
Expected: FAIL. `docker build` can't find a `Dockerfile`.

- [ ] **Step 8: Write the image and the Compose file**

Create `.dockerignore`. It lets in only what the image needs, so real data
never reaches the build context:

```none
*
!package-lock.json
!package.json
!public/
!server/
```

Create `Dockerfile`:

```dockerfile
# The Meals server image. docs/deployment.md explains how releases build it
# and how the host runs it.

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
ARG REVISION=unknown
ARG VERSION=unknown
LABEL org.opencontainers.image.revision=$REVISION \
      org.opencontainers.image.source=https://github.com/ruy-ggarcia/meals \
      org.opencontainers.image.version=$VERSION
ENV DATA_DIR=/data NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY public ./public
COPY server ./server
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=1s \
  CMD ["node", "server/healthcheck.js"]
# exec replaces the shell, so Node receives the signals. The umask keeps new
# data files writable by the docker group on the host.
CMD ["/bin/sh", "-c", "umask 0002 && exec node server/index.js"]
```

Create `deploy/compose.yaml`:

```yaml
# The Meals app on the host. The meals-* scripts run it with the variables in
# /opt/server/meals/.env, and scripts/image-smoke.sh runs it with its own.
name: meals
services:
  app:
    cap_drop: [ALL]
    image: ${MEALS_IMAGE:?MEALS_IMAGE is empty because no version is deployed}
    init: true
    ports: ["${MEALS_PORT:?MEALS_PORT must be set}:3000"]
    read_only: true
    restart: unless-stopped
    security_opt: ["no-new-privileges:true"]
    stop_grace_period: 15s
    user: "${MEALS_UID:?MEALS_UID must be set}:${MEALS_GID:?MEALS_GID must be set}"
    volumes: ["./data:/data"]
```

- [ ] **Step 9: Run the smoke test to verify it passes**

Run: `npm run test:image`
Expected: the build succeeds, and the script prints
`Smoke test passed: meals:test reports version 0.1.0.`

- [ ] **Step 10: Run the checks**

Run: `npm run format && npm run lint && npm test`
Expected: both pass. ShellCheck reports nothing for `scripts/image-smoke.sh`.

- [ ] **Step 11: Commit**

```bash
git add .dockerignore .shellcheckrc Dockerfile deploy/compose.yaml package.json scripts/image-smoke.sh server/healthcheck.js test/healthcheck.test.js
git commit -m "build: add the container image and its smoke test"
```

---

### Task 5: CI workflow and Dependabot

**Files:**
- Create: `.github/dependabot.yml`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm run lint`, `npm test`, and `npm run test:image`.
- Produces: the status checks `ci` and `image`.

- [ ] **Step 1: Rewrite the CI workflow**

Replace `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci:
    name: ci
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          cache: npm
          node-version: 22
      - name: Install ShellCheck
        run: command -v shellcheck || (sudo apt-get update && sudo apt-get install --yes shellcheck)
      - run: npm ci
      - run: npm run lint
      - run: npm test

  image:
    name: image
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - run: npm run test:image
```

- [ ] **Step 2: Add the Dependabot configuration**

Create `.github/dependabot.yml`:

```yaml
# The commit prefixes decide what reaches production: release-please turns
# fix commits into a patch release, and ignores build and ci commits.
version: 2
updates:
  - package-ecosystem: docker
    directory: /
    schedule:
      interval: weekly
    commit-message:
      prefix: fix
      include: scope
    groups:
      docker:
        update-types: [minor, patch]
    ignore:
      # A new major version of Node.js changes the image and the CI workflow
      # together, by hand.
      - dependency-name: node
        update-types: ["version-update:semver-major"]
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    commit-message:
      prefix: ci
      include: scope
    groups:
      github-actions:
        update-types: [minor, patch]
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    commit-message:
      prefix: fix
      prefix-development: build
      include: scope
    groups:
      npm:
        update-types: [minor, patch]
```

- [ ] **Step 3: Check the workflow syntax**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`
Expected: no output and exit code `0`.

- [ ] **Step 4: Run the checks**

Run: `npm run format && npm run lint && npm test`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add .github/dependabot.yml .github/workflows/ci.yml
git commit -m "ci: pin actions, add timeouts, test the image, and add Dependabot"
```

GitHub runs both jobs on the pull request of this branch. The final review
checks that `ci` and `image` pass there.

---

### Task 6: Release workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `.release-please-manifest.json`
- Create: `CHANGELOG.md`
- Create: `release-please-config.json`

**Interfaces:**
- Consumes: `scripts/image-smoke.sh`.
- Produces: GitHub Releases `vX.Y.Z` with the asset `image.txt`, which holds
  `ghcr.io/ruy-ggarcia/meals@sha256:DIGEST`. Task 9 reads it.

- [ ] **Step 1: Configure release-please**

Create `release-please-config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "bootstrap-sha": "800df15721691697727bd48cd6c2c8d65b9e0593",
  "packages": {
    ".": {
      "bump-minor-pre-major": true,
      "include-component-in-tag": false,
      "release-type": "node"
    }
  }
}
```

Create `.release-please-manifest.json`:

```json
{ ".": "0.1.0" }
```

Create `CHANGELOG.md`, with the entry for `0.1.0` from the message of the
`v0.1.0` tag:

```markdown
# Changelog

## 0.1.0 (2026-09-26)

Initial release. Meals is a weekly meal planner for the home network: a
grid of 7 days by 5 meals, shared by every desktop and mobile browser on the
network.

### Features

* Plan any week, past or future, with previous, next, and Today controls.
* Keep the displayed week in the URL, show the dates in the day headers, and
  mark today.
* Save each cell when you leave it, change days or weeks, or hide the page,
  and show its save status. Changing weeks never discards unsaved text
  without asking.
* Store each week in its own JSON file under `data/weeks/`, written
  atomically.
```

- [ ] **Step 2: Write the release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  release-please:
    name: release-please
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions: {}
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
      version: ${{ steps.release.outputs.version }}
    steps:
      # A token of the GitHub App, so the release pull request runs the
      # required checks. Pull requests opened with GITHUB_TOKEN don't.
      - id: app-token
        uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
        with:
          client-id: ${{ vars.RELEASE_APP_CLIENT_ID }}
          private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}
      - id: release
        uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0
        with:
          token: ${{ steps.app-token.outputs.token }}

  publish:
    name: publish
    needs: release-please
    if: needs.release-please.outputs.release_created == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write
      packages: write
    env:
      IMAGE: ghcr.io/ruy-ggarcia/meals
      TAG: ${{ needs.release-please.outputs.tag_name }}
      VERSION: ${{ needs.release-please.outputs.version }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
          ref: ${{ needs.release-please.outputs.tag_name }}
      - name: Check that the tag matches package.json
        run: test "$TAG" = "v$(jq -r .version package.json)"
      - name: Build the image
        run: >-
          docker build
          --build-arg "REVISION=$(git rev-parse HEAD)"
          --build-arg "VERSION=$VERSION"
          --tag "$IMAGE:$VERSION" .
      - name: Run the smoke test
        run: scripts/image-smoke.sh "$IMAGE:$VERSION"
      # Pushes the image that passed the smoke test, not a rebuild.
      - name: Push the image
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: |
          echo "$GITHUB_TOKEN" | docker login ghcr.io --username "$GITHUB_ACTOR" --password-stdin
          docker push "$IMAGE:$VERSION"
          # Picks the GHCR digest: the image can have other repository digests.
          docker inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$IMAGE:$VERSION" \
            | grep -Ex 'ghcr\.io/ruy-ggarcia/meals@sha256:[0-9a-f]{64}' > image.txt
      - name: Attach image.txt to the release
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release upload "$TAG" image.txt
```

- [ ] **Step 3: Check the workflow syntax**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`
Expected: no output and exit code `0`.

- [ ] **Step 4: Run the checks**

Run: `npm run format && npm run lint && npm test`
Expected: both pass. Biome checks the two JSON files.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml .release-please-manifest.json CHANGELOG.md release-please-config.json
git commit -m "ci: release with release-please and publish the image to GHCR"
```

---

### Task 7: Host test harness and backups

**Files:**
- Create: `scripts/lib/common.sh`
- Create: `scripts/meals-backup`
- Create: `test/backup.test.js`
- Create: `test/host-helpers.js`
- Create: `test/stubs/curl`
- Create: `test/stubs/docker`
- Modify: `package.json` (`lint`)

**Interfaces:**
- Produces, in `scripts/lib/common.sh`: `MEALS_ROOT`, `MEALS_SCRIPTS`,
  `log MESSAGE`, `die MESSAGE`, `take_lock`, `env_get FILE NAME`,
  `deployed_version`, `validate_data DIR`, `extract_valid ARCHIVE DIR`, and
  `list_backups [KIND]`.
- Produces: `meals-backup daily|pre-deploy|pre-restore`, which prints
  `Backed up the data to backups/NAME.`
- Produces, in `test/host-helpers.js`: `DATA`, `imageFor(version)`, and
  `createHost({ version = "0.2.0" }) → Host`. `Host` has `root`, `stubDir`,
  `run(script, ...args) → Promise<{ status, stdout, stderr }>`,
  `runFromUnreadableDir(script, ...args)`, which resolves like `run()`, `calls()`,
  `stub(relPath, content, { executable })`, `addRelease(version, options)`,
  `readData(relPath)`, `writeData(relPath, content)`, `readEnv()`,
  `exists(relPath)`, `backups()`, `writeBackup(name, content)`,
  `writeRootFile(relPath, content)`, `makeBackup(name, files)`,
  `archiveEntries(name)`, `holdLock(ms)`, and `cleanup()`.

- [ ] **Step 1: Write the stubs**

Create `test/stubs/docker`:

```bash
#!/usr/bin/env bash
# Stub docker for the host script tests. It logs each call to
# $STUB_DIR/calls, keeps whether the app runs in $STUB_DIR/running, and
# answers from the files that the test writes in $STUB_DIR.
printf 'docker %s\n' "$*" >>"$STUB_DIR/calls"
args=" $* "
case $args in
  *" compose "*" ps "*)
    if [[ -e $STUB_DIR/running ]]; then echo app-container; fi
    ;;
  *" compose "*" up "*)
    touch "$STUB_DIR/running"
    if [[ -x $STUB_DIR/on-up ]]; then "$STUB_DIR/on-up"; fi
    # A version listed in $STUB_DIR/broken never becomes healthy.
    version=$(sed -n 's/^MEALS_VERSION=//p' "$MEALS_ROOT/.env")
    if grep -qxF "$version" "$STUB_DIR/broken" 2>/dev/null; then exit 1; fi
    ;;
  *" compose "*" stop "* | *" compose "*" down "*)
    rm -f "$STUB_DIR/running"
    ;;
  *" compose "*" logs "* | " image rm "*) ;;
  *" compose "*" port app 3000 "*)
    echo 127.0.0.1:49153
    ;;
  " pull "*)
    if [[ -e $STUB_DIR/pull-fails ]]; then exit 1; fi
    ;;
  " image ls "*)
    cat "$STUB_DIR/images" 2>/dev/null || true
    ;;
  *)
    echo "docker stub: unexpected call: $*" >&2
    exit 64
    ;;
esac
```

Create `test/stubs/curl`:

```bash
#!/usr/bin/env bash
# Stub curl for the host script tests. It logs each call to $STUB_DIR/calls
# and answers from the files that the test writes in $STUB_DIR. The URL is
# the last argument.
printf 'curl %s\n' "$*" >>"$STUB_DIR/calls"
url=${*: -1}
api=https://api.github.com/repos/ruy-ggarcia/meals/
downloads=https://github.com/ruy-ggarcia/meals/releases/download/
case $url in
  "$api"*)
    file=$STUB_DIR/github/${url#"$api"}
    ;;
  "$downloads"*)
    file=$STUB_DIR/downloads/${url#"$downloads"}
    ;;
  http://127.0.0.1:*/api/health)
    # The app reports the version in .env, unless the test overrides it.
    version=$(cat "$STUB_DIR/health-version" 2>/dev/null ||
      sed -n 's/^MEALS_VERSION=//p' "$MEALS_ROOT/.env")
    printf '{"status":"ok","version":"%s"}\n' "$version"
    exit 0
    ;;
  http://127.0.0.1:*)
    path=/${url#http://127.0.0.1:*/}
    if grep -qxF "$path" "$STUB_DIR/failing-paths" 2>/dev/null; then exit 22; fi
    echo '{}'
    exit 0
    ;;
  *)
    echo "curl stub: unexpected URL: $url" >&2
    exit 64
    ;;
esac
[[ -f $file ]] || exit 22
cat "$file"
```

Make both executable: `chmod +x test/stubs/curl test/stubs/docker`.

- [ ] **Step 2: Write the host helpers**

Create `test/host-helpers.js`:

```js
// Runs the host scripts in scripts/ against a temporary MEALS_ROOT, with the
// stub docker and curl commands in test/stubs/ first in PATH. The stubs log
// each call and answer from files in a separate stub directory.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = fileURLToPath(new URL("../scripts/", import.meta.url));
const STUBS_DIR = fileURLToPath(new URL("./stubs/", import.meta.url));

/** The data directory of a new host. */
export const DATA = {
  "v2/ingredients.json": '{ "ingredients": [] }\n',
  "v2/recipes.json": '{ "recipes": [] }\n',
  "v2/weeks/2026-09-21.json": "{}\n",
};

/** The image reference by digest of VERSION in the tests. */
export function imageFor(version) {
  const digest = createHash("sha256").update(version).digest("hex");
  return `ghcr.io/ruy-ggarcia/meals@sha256:${digest}`;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function writeFiles(dir, files) {
  for (const [relPath, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, relPath)), { recursive: true });
    await writeFile(path.join(dir, relPath), content);
  }
}

/**
 * Creates a host with DATA, backups/, and .env with VERSION deployed, or
 * nothing deployed when VERSION is "". The app runs when a version is
 * deployed.
 */
export async function createHost({ version = "0.2.0" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "meals-host-"));
  const stubDir = await mkdtemp(path.join(os.tmpdir(), "meals-stub-"));
  await mkdir(path.join(root, "backups"));
  await writeFiles(path.join(root, "data"), DATA);
  const image = version ? imageFor(version) : "";
  await writeFile(
    path.join(root, ".env"),
    `MEALS_GID=1000\nMEALS_IMAGE=${image}\nMEALS_PORT=3000\nMEALS_UID=1000\nMEALS_VERSION=${version}\n`,
  );
  if (version) await writeFile(path.join(stubDir, "running"), "");
  return new Host(root, stubDir);
}

class Host {
  constructor(root, stubDir) {
    this.root = root;
    this.stubDir = stubDir;
  }

  /** Runs scripts/SCRIPT with ARGS, and resolves to its status and output. */
  run(script, ...args) {
    return this.#spawn(path.join(SCRIPTS_DIR, script), args);
  }

  /**
   * Runs scripts/SCRIPT like run(), from a working directory that it can't
   * read, as with sudo -u deployer from your home directory.
   */
  async runFromUnreadableDir(script, ...args) {
    const dir = path.join(this.stubDir, "unreadable");
    await mkdir(dir);
    const command = 'cd "$1" && chmod 000 . && shift && exec "$@"';
    return this.#spawn("bash", ["-c", command, "bash", dir, path.join(SCRIPTS_DIR, script), ...args]);
  }

  #spawn(command, args) {
    const env = {
      ...process.env,
      MEALS_ROOT: this.root,
      MEALS_VERIFY_TIMEOUT: "5",
      PATH: `${STUBS_DIR}:${process.env.PATH}`,
      STUB_DIR: this.stubDir,
    };
    delete env.MEALS_LOCKED;
    const child = spawn(command, args, { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    return new Promise((resolve) => {
      // A script that doesn't exist yet fails with ENOENT instead of a status.
      child.on("error", (error) => resolve({ status: null, stdout, stderr: error.message }));
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });
  }

  /** The commands that the stubs received, one string per call. */
  async calls() {
    const file = path.join(this.stubDir, "calls");
    if (!(await exists(file))) return [];
    return (await readFile(file, "utf8")).split("\n").filter(Boolean);
  }

  /** Writes a file that the stubs read, such as "broken" or "github/releases/latest". */
  async stub(relPath, content, { executable = false } = {}) {
    await writeFiles(this.stubDir, { [relPath]: content });
    if (executable) await chmod(path.join(this.stubDir, relPath), 0o755);
  }

  /**
   * Publishes release VERSION on the stub GitHub: as the latest release
   * unless LATEST is false, and with image.txt holding IMAGE unless
   * WITHIMAGE is false.
   */
  async addRelease(version, { image = imageFor(version), latest = true, withImage = true } = {}) {
    const tag = `v${version}`;
    const release = {
      tag_name: tag,
      assets: withImage
        ? [
            {
              name: "image.txt",
              browser_download_url: `https://github.com/ruy-ggarcia/meals/releases/download/${tag}/image.txt`,
            },
          ]
        : [],
    };
    await this.stub(`github/releases/tags/${tag}`, JSON.stringify(release));
    if (latest) await this.stub("github/releases/latest", JSON.stringify(release));
    if (withImage) await this.stub(`downloads/${tag}/image.txt`, `${image}\n`);
  }

  readData(relPath) {
    return readFile(path.join(this.root, "data", relPath), "utf8");
  }

  writeData(relPath, content) {
    return writeFiles(path.join(this.root, "data"), { [relPath]: content });
  }

  /** The variables in .env, or in .env.previous with FILE. */
  async readEnv(file = ".env") {
    const text = await readFile(path.join(this.root, file), "utf8");
    return Object.fromEntries(
      text
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
  }

  exists(relPath) {
    return exists(path.join(this.root, relPath));
  }

  /** The file names in backups/, sorted. */
  async backups() {
    return (await readdir(path.join(this.root, "backups"))).sort();
  }

  writeBackup(name, content) {
    return writeFile(path.join(this.root, "backups", name), content);
  }

  /** Writes a file in the host root, such as "failed" or "hold". */
  writeRootFile(relPath, content) {
    return writeFile(path.join(this.root, relPath), content);
  }

  /** Writes backups/NAME as a real archive of FILES under data/. */
  async makeBackup(name, files = DATA) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "meals-archive-"));
    await writeFiles(path.join(dir, "data"), files);
    spawnSync("tar", ["-C", dir, "-czf", path.join(this.root, "backups", name), "data"]);
    await rm(dir, { recursive: true, force: true });
  }

  /** The files in backups/NAME, sorted. */
  archiveEntries(name) {
    const listing = spawnSync("tar", ["-tzf", path.join(this.root, "backups", name)], {
      encoding: "utf8",
    });
    return listing.stdout
      .split("\n")
      .filter((entry) => entry && !entry.endsWith("/"))
      .sort();
  }

  /**
   * Holds the scripts' lock for MS milliseconds. Resolves once the lock is
   * held, to `{ released }`, a promise that resolves when it's released. The
   * promise is wrapped, because an async function would wait for it.
   */
  async holdLock(ms) {
    const ready = path.join(this.stubDir, "lock-held");
    const holder = spawn("flock", [
      path.join(this.root, ".lock"),
      "sh",
      "-c",
      `touch "$0"; sleep ${ms / 1000}`,
      ready,
    ]);
    const released = once(holder, "close");
    while (!(await exists(ready))) await delay(10);
    return { released };
  }

  async cleanup() {
    await rm(this.root, { recursive: true, force: true });
    await rm(this.stubDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 3: Write the failing backup tests**

Create `test/backup.test.js`:

```js
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createHost } from "./host-helpers.js";

let host;

beforeEach(async () => {
  host = await createHost();
});

afterEach(async () => {
  await host.cleanup();
});

/** The name of an old backup of KIND, taken on day DAY of January. */
function oldBackup(day, kind) {
  return `2026-01-${String(day).padStart(2, "0")}T033000Z-${kind}-v0.2.0.tar.gz`;
}

test("meals-backup archives the data directory, named after the time, the kind, and the version", async () => {
  const result = await host.run("meals-backup", "daily");

  assert.equal(result.status, 0, result.stderr);
  const backups = await host.backups();
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^\d{4}-\d{2}-\d{2}T\d{6}Z-daily-v0\.2\.0\.tar\.gz$/);
  assert.ok(result.stdout.includes(`Backed up the data to backups/${backups[0]}.`));
  assert.deepEqual(host.archiveEntries(backups[0]), [
    "data/v2/ingredients.json",
    "data/v2/recipes.json",
    "data/v2/weeks/2026-09-21.json",
  ]);
});

test("meals-backup takes no backup when no version is deployed", async () => {
  await host.cleanup();
  host = await createHost({ version: "" });

  const result = await host.run("meals-backup", "daily");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No version is deployed/);
  assert.deepEqual(await host.backups(), []);
});

test("meals-backup fails on invalid JSON, and keeps no archive or .partial file", async () => {
  await host.writeData("v2/recipes.json", "{ not json");

  const result = await host.run("meals-backup", "daily");

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Invalid JSON: v2\/recipes\.json/);
  assert.match(result.stderr, /failed validation/);
  assert.deepEqual(await host.backups(), []);
});

test("a pre-restore backup keeps invalid JSON, so a restore can replace damaged data", async () => {
  await host.writeData("v2/recipes.json", "{ not json");

  const result = await host.run("meals-backup", "pre-restore");

  assert.equal(result.status, 0, result.stderr);
  const backups = await host.backups();
  assert.equal(backups.length, 1);
  assert.match(backups[0], /-pre-restore-v0\.2\.0\.tar\.gz$/);
});

test("meals-backup keeps the 14 newest daily backups, and leaves other kinds and .partial files alone", async () => {
  for (let day = 1; day <= 14; day++) await host.writeBackup(oldBackup(day, "daily"), "");
  for (let day = 1; day <= 12; day++) await host.writeBackup(oldBackup(day, "pre-deploy"), "");
  await host.writeBackup(`${oldBackup(15, "daily")}.partial`, "");

  const result = await host.run("meals-backup", "daily");

  assert.equal(result.status, 0, result.stderr);
  const backups = await host.backups();
  const daily = backups.filter((name) => name.includes("-daily-") && name.endsWith(".tar.gz"));
  assert.equal(daily.length, 14);
  assert.ok(!daily.includes(oldBackup(1, "daily")), "the oldest daily backup is gone");
  assert.ok(daily.includes(oldBackup(2, "daily")));
  assert.equal(backups.filter((name) => name.includes("-pre-deploy-")).length, 12);
  assert.ok(backups.includes(`${oldBackup(15, "daily")}.partial`));
  assert.match(result.stdout, new RegExp(`Deleted the old backup backups/${oldBackup(1, "daily")}`));
});

test("meals-backup keeps the 10 newest pre-deploy and pre-restore backups", async () => {
  for (const kind of ["pre-deploy", "pre-restore"]) {
    for (let day = 1; day <= 10; day++) await host.writeBackup(oldBackup(day, kind), "");

    const result = await host.run("meals-backup", kind);

    assert.equal(result.status, 0, result.stderr);
    const ofKind = (await host.backups()).filter((name) => name.includes(`-${kind}-`));
    assert.equal(ofKind.length, 10, kind);
    assert.ok(!ofKind.includes(oldBackup(1, kind)), kind);
  }
});

test("meals-backup works from a working directory that it can't read", async () => {
  const result = await host.runFromUnreadableDir("meals-backup", "daily");

  assert.equal(result.status, 0, result.stderr);
  assert.equal((await host.backups()).length, 1);
});

test("meals-backup rejects an unknown kind", async () => {
  const result = await host.run("meals-backup", "weekly");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: meals-backup daily\|pre-deploy\|pre-restore/);
  assert.deepEqual(await host.backups(), []);
});

test("meals-backup waits for the lock that another script holds", async () => {
  const { released } = await host.holdLock(1000);
  const startedAt = Date.now();

  const result = await host.run("meals-backup", "daily");

  assert.equal(result.status, 0, result.stderr);
  assert.ok(Date.now() - startedAt >= 800, "meals-backup didn't wait for the lock");
  await released;
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `node --test test/backup.test.js`
Expected: FAIL. Each run gets the status `null`, because
`scripts/meals-backup` doesn't exist (`ENOENT`).

- [ ] **Step 5: Write the shared functions**

Create `scripts/lib/common.sh`:

```bash
# shellcheck shell=bash
# Shell functions shared by the meals-* scripts, which source this file.
# Log lines go to standard output and errors to standard error. Under
# systemd, both reach the journal.

MEALS_ROOT=${MEALS_ROOT:-/opt/server/meals}
# sudo -u deployer keeps your working directory, which deployer might not be
# able to read. find and docker compose fail there.
cd "$MEALS_ROOT" || exit 1
# shellcheck disable=SC2034 # The scripts that source this file use it.
MEALS_SCRIPTS=$(dirname "$(readlink -f "$0")")
# deployer has no home directory, so the Docker CLI keeps its settings here.
export DOCKER_CONFIG=${DOCKER_CONFIG:-$MEALS_ROOT/.docker}
# New files stay writable by the docker group, whoever runs the script.
umask 0002

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

# Takes the lock that every script shares, and waits while another script
# holds it. A script that another script runs inherits the lock instead.
take_lock() {
  if [[ ${MEALS_LOCKED:-} == 1 ]]; then
    return
  fi
  exec 9>>"$MEALS_ROOT/.lock"
  flock 9
  export MEALS_LOCKED=1
}

# Prints the value of the variable NAME in the env file FILE, or nothing.
env_get() {
  sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -n 1
}

# Prints the deployed version, or nothing before the first deployment.
deployed_version() {
  env_get "$MEALS_ROOT/.env" MEALS_VERSION
}

# Succeeds if every .json file under DIR parses.
validate_data() {
  local dir=$1 file
  while IFS= read -r -d '' file; do
    if ! jq empty "$file" >/dev/null 2>&1; then
      log "Invalid JSON: ${file#"$dir"/}"
      return 1
    fi
  done < <(find "$dir" -type f -name '*.json' -print0)
}

# Extracts the backup ARCHIVE into DIR, so the data ends up in DIR/data, and
# succeeds if the archive is intact and every .json file in it parses.
extract_valid() {
  local archive=$1 dir=$2
  if ! gzip -t "$archive" 2>/dev/null; then
    log "The archive is damaged: $(basename "$archive")"
    return 1
  fi
  tar -C "$dir" -xzf "$archive" || return 1
  if [[ ! -d $dir/data ]]; then
    log "The archive has no data directory: $(basename "$archive")"
    return 1
  fi
  validate_data "$dir/data"
}

# Prints the file names of the backups, only of KIND if given, oldest first.
# Interrupted backups, which end in .partial, don't count.
list_backups() {
  find "$MEALS_ROOT/backups" -maxdepth 1 -type f -name "*-${1:-*}-v*.tar.gz" -printf '%f\n' |
    sort
}
```

- [ ] **Step 6: Write `meals-backup`**

Create `scripts/meals-backup`, and make it executable with
`chmod +x scripts/meals-backup`:

```bash
#!/usr/bin/env bash
# Usage: meals-backup daily|pre-deploy|pre-restore
#
# Archives the data directory into backups/, named after the time, the
# kind, and the deployed version, validates the archive, and deletes the
# oldest backups of the same kind beyond its retention.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "$(readlink -f "$0")")/lib/common.sh"

kind=${1:-}
case $kind in
  daily) keep=14 ;;
  pre-deploy | pre-restore) keep=10 ;;
  *) die "Usage: meals-backup daily|pre-deploy|pre-restore" ;;
esac

take_lock

version=$(deployed_version)
if [[ -z $version ]]; then
  log "No version is deployed, so no version has written the data yet. Skipped the backup."
  exit 0
fi

name="$(date -u +%Y-%m-%dT%H%M%SZ)-$kind-v$version.tar.gz"
partial=$MEALS_ROOT/backups/$name.partial
check=$(mktemp -d)
trap 'rm -rf "$partial" "$check"' EXIT

tar -C "$MEALS_ROOT" -czf "$partial" data
# A pre-restore backup keeps the data as it is, even with invalid JSON, so
# you can restore over damaged data and still undo the restore.
if [[ $kind == pre-restore ]]; then
  gzip -t "$partial" || die "The backup archive is damaged, so it wasn't kept."
else
  extract_valid "$partial" "$check" ||
    die "The backup failed validation, so it wasn't kept. Check the data files in $MEALS_ROOT/data."
fi
mv "$partial" "$MEALS_ROOT/backups/$name"
log "Backed up the data to backups/$name."

list_backups "$kind" | head -n "-$keep" | while IFS= read -r old; do
  rm -f "$MEALS_ROOT/backups/$old"
  log "Deleted the old backup backups/$old."
done
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test test/backup.test.js`
Expected: PASS.

- [ ] **Step 8: Lint every shell script**

In `package.json`, change the `lint` script to:

```json
    "lint": "biome ci . && shellcheck scripts/*.sh scripts/lib/*.sh scripts/meals-* test/stubs/*",
```

- [ ] **Step 9: Run the checks**

Run: `npm run format && npm run lint && npm test`
Expected: both pass.

- [ ] **Step 10: Commit**

```bash
git add package.json scripts/lib/common.sh scripts/meals-backup test/backup.test.js test/host-helpers.js test/stubs/curl test/stubs/docker
git commit -m "feat(host): back up the data with a version and a retention"
```

---

### Task 8: Restore a backup

**Files:**
- Create: `scripts/meals-restore`
- Create: `test/restore.test.js`
- Modify: `scripts/lib/common.sh`

**Interfaces:**
- Consumes: the functions of Task 7, `meals-backup pre-restore`, and the
  `Host` helpers.
- Produces, in `scripts/lib/common.sh`: `compose ARGS...`,
  `backup_version ARCHIVE`, `version_lt A B`, `swap_data STAGING`, and
  `start_and_verify VERSION`.
- Produces: `meals-restore BACKUP`.

- [ ] **Step 1: Write the failing tests**

Create `test/restore.test.js`:

```js
import assert from "node:assert/strict";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createHost, DATA } from "./host-helpers.js";

const BACKUP = "2026-10-01T033000Z-daily-v0.2.0.tar.gz";

let host;

beforeEach(async () => {
  host = await createHost();
});

afterEach(async () => {
  await host.cleanup();
});

/** Fails unless the data directory holds exactly DATA. */
async function assertOriginalData() {
  for (const [relPath, content] of Object.entries(DATA)) {
    assert.equal(await host.readData(relPath), content, relPath);
  }
  assert.equal(await host.exists("data/v2/weeks/2026-09-28.json"), false);
}

test("meals-restore brings back the data of a backup, after a pre-restore backup", async () => {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/recipes.json", '{ "recipes": [{ "id": "new" }] }\n');
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 0, result.stderr);
  await assertOriginalData();
  const preRestore = (await host.backups()).filter((name) => name.includes("-pre-restore-v0.2.0"));
  assert.equal(preRestore.length, 1);
  assert.ok(host.archiveEntries(preRestore[0]).includes("data/v2/weeks/2026-09-28.json"));
  const calls = await host.calls();
  const stop = calls.findIndex((call) => / compose .* stop$/.test(call));
  const up = calls.findIndex((call) => / compose .* up --detach --wait /.test(call));
  assert.ok(stop >= 0 && up > stop, calls.join("\n"));
  assert.equal(await host.exists("data.old"), false);
  assert.match(result.stdout, /Restored 2026-10-01T033000Z-daily-v0\.2\.0\.tar\.gz/);
});

test("a backup by meals-backup and a restore by meals-restore give back identical data", async () => {
  assert.equal((await host.run("meals-backup", "daily")).status, 0);
  const [daily] = await host.backups();
  await host.writeData("v2/recipes.json", '{ "recipes": [{ "id": "new" }] }\n');
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");

  const result = await host.run("meals-restore", daily);

  assert.equal(result.status, 0, result.stderr);
  await assertOriginalData();
});

test("meals-restore replaces data with invalid JSON", async () => {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/recipes.json", "{ not json");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 0, result.stderr);
  await assertOriginalData();
});

test("meals-restore starts the app again when the pre-restore backup fails", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root can write to any directory");
    return;
  }
  await host.makeBackup(BACKUP);
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");
  const backups = path.join(host.root, "backups");
  await chmod(backups, 0o555);
  let result;
  try {
    result = await host.run("meals-restore", BACKUP);
  } finally {
    await chmod(backups, 0o755);
  }

  assert.equal(result.status, 1);
  assert.match(result.stderr, /The pre-restore backup failed, so nothing changed/);
  assert.equal(await host.exists("data/v2/weeks/2026-09-28.json"), true);
  assert.match((await host.calls()).at(-1), / compose .* up --detach$/);
});

test("meals-restore works from a working directory that it can't read", async () => {
  await host.makeBackup(BACKUP);
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");

  const result = await host.runFromUnreadableDir("meals-restore", BACKUP);

  assert.equal(result.status, 0, result.stderr);
  await assertOriginalData();
});

test("meals-restore accepts an absolute path, and a backup from an older version", async () => {
  const older = "2026-09-01T033000Z-daily-v0.1.0.tar.gz";
  await host.makeBackup(older);
  await host.writeData("v2/recipes.json", '{ "recipes": [{ "id": "new" }] }\n');

  const result = await host.run("meals-restore", `${host.root}/backups/${older}`);

  assert.equal(result.status, 0, result.stderr);
  await assertOriginalData();
});

test("meals-restore fails without changing anything when no version is deployed", async () => {
  await host.cleanup();
  host = await createHost({ version: "" });
  await host.makeBackup(BACKUP);

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No version is deployed\. .*meals-deploy VERSION/);
  assert.deepEqual(await host.calls(), []);
});

test("meals-restore fails without changing anything on a damaged archive", async () => {
  await host.writeBackup(BACKUP, "not an archive");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /The archive is damaged/);
  assert.deepEqual(await host.calls(), []);
  await assertOriginalData();
});

test("meals-restore fails without changing anything on invalid JSON", async () => {
  await host.makeBackup(BACKUP, { ...DATA, "v2/recipes.json": "{ not json" });
  await host.writeData("v2/weeks/2026-09-28.json", "{}\n");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Invalid JSON: v2\/recipes\.json/);
  assert.deepEqual(await host.calls(), []);
  assert.equal(await host.exists("data/v2/weeks/2026-09-28.json"), true);
});

test("meals-restore refuses a backup from a newer version", async () => {
  await host.makeBackup("2026-10-01T033000Z-daily-v0.10.0.tar.gz");

  const result = await host.run("meals-restore", "2026-10-01T033000Z-daily-v0.10.0.tar.gz");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /from version 0\.10\.0, which is newer .* meals-deploy 0\.10\.0/);
  assert.deepEqual(await host.calls(), []);
});

test("meals-restore fails on a backup that doesn't exist", async () => {
  const result = await host.run("meals-restore", "no-such-backup.tar.gz");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No backup named no-such-backup\.tar\.gz/);
});

test("meals-restore fails when the app doesn't come back healthy", async () => {
  await host.makeBackup(BACKUP);
  await host.stub("broken", "0.2.0\n");

  const result = await host.run("meals-restore", BACKUP);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /didn't come back healthy/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/restore.test.js`
Expected: FAIL, because `scripts/meals-restore` doesn't exist.

- [ ] **Step 3: Add the shared functions**

Append to `scripts/lib/common.sh`:

```bash

# Runs docker compose on the deployed app, with MEALS_ROOT as the project
# directory, so Compose reads .env and mounts data/ from there.
compose() {
  docker compose --project-directory "$MEALS_ROOT" --file "$MEALS_ROOT/compose.yaml" "$@"
}

# Prints the version in the file name of the backup ARCHIVE.
backup_version() {
  local name
  name=$(basename "$1")
  [[ $name =~ -v([0-9]+\.[0-9]+\.[0-9]+)\.tar\.gz$ ]] || return 1
  printf '%s\n' "${BASH_REMATCH[1]}"
}

# Succeeds if version A is older than version B.
version_lt() {
  [[ $1 != "$2" && $(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1) == "$1" ]]
}

# Replaces data/ with STAGING/data. The app must be stopped. Each step
# returns on failure, because callers run it in an `if`, where set -e is off.
swap_data() {
  local staging=$1
  rm -rf "$MEALS_ROOT/data.old" || return 1
  mv "$MEALS_ROOT/data" "$MEALS_ROOT/data.old" || return 1
  mv "$staging/data" "$MEALS_ROOT/data" || return 1
  chmod 2775 "$MEALS_ROOT/data" || return 1
  rm -rf "$MEALS_ROOT/data.old"
}

# Starts the app, and succeeds if Compose sees it healthy within
# MEALS_VERIFY_TIMEOUT seconds and it reports VERSION.
start_and_verify() {
  local version=$1 port
  compose up --detach --wait --wait-timeout "${MEALS_VERIFY_TIMEOUT:-60}" || return 1
  port=$(env_get "$MEALS_ROOT/.env" MEALS_PORT)
  curl -fsS --max-time 5 "http://127.0.0.1:$port/api/health" |
    jq -e --arg version "$version" '.status == "ok" and .version == $version' >/dev/null
}
```

- [ ] **Step 4: Write `meals-restore`**

Create `scripts/meals-restore`, and make it executable with
`chmod +x scripts/meals-restore`:

```bash
#!/usr/bin/env bash
# Usage: meals-restore BACKUP
#
# Restores BACKUP, a path or a file name in backups/, into the data
# directory. BACKUP is an absolute path or a file name in backups/. Before it
# changes anything, it validates the backup and refuses one from a version
# newer than the deployed one. It takes a pre-restore backup first, so you
# can undo a restore.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "$(readlink -f "$0")")/lib/common.sh"

[[ $# == 1 ]] || die "Usage: meals-restore BACKUP"
# common.sh changed to MEALS_ROOT, so a relative path would be ambiguous.
if [[ $1 == /* ]]; then
  archive=$1
else
  archive=$MEALS_ROOT/backups/$1
fi
[[ -f $archive ]] || die "No backup named $1. Give an absolute path or a file name in backups/."
name=$(basename "$archive")

take_lock

deployed=$(deployed_version)
[[ -n $deployed ]] ||
  die "No version is deployed. To restore a backup on a new host, first deploy the backup's version with meals-deploy VERSION."
version=$(backup_version "$archive") || die "The name of $name has no version."
if version_lt "$deployed" "$version"; then
  die "The backup is from version $version, which is newer than the deployed version, $deployed. Deploy that version first with meals-deploy $version."
fi

staging=$(mktemp -d "$MEALS_ROOT/.restore.XXXXXX")
trap 'rm -rf "$staging"' EXIT
extract_valid "$archive" "$staging" || die "The backup $name failed validation. Nothing changed."

compose stop
if ! "$MEALS_SCRIPTS/meals-backup" pre-restore; then
  compose up --detach || true
  die "The pre-restore backup failed, so nothing changed, and version $deployed runs again."
fi
swap_data "$staging"
start_and_verify "$deployed" ||
  die "Version $deployed didn't come back healthy after the restore. See docker compose logs in $MEALS_ROOT."
log "Restored $name, and version $deployed is running."
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/restore.test.js`
Expected: PASS.

- [ ] **Step 6: Run the checks**

Run: `npm run format && npm run lint && npm test`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/common.sh scripts/meals-restore test/restore.test.js
git commit -m "feat(host): restore a validated backup"
```

---

### Task 9: Deployments

**Files:**
- Create: `scripts/meals-deploy`
- Create: `test/deploy.test.js`

**Interfaces:**
- Consumes: `compose`, `deployed_version`, `env_get`, `extract_valid`,
  `list_backups`, `start_and_verify`, `swap_data`, `take_lock`, and
  `version_lt` from `scripts/lib/common.sh`, and `meals-backup pre-deploy`.
- Produces: `meals-deploy [VERSION | --resume]`, and the files `.env`,
  `.env.previous`, `failed`, and `hold`.

- [ ] **Step 1: Write the failing tests**

Create `test/deploy.test.js`:

```js
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createHost, DATA, imageFor } from "./host-helpers.js";

let host;

beforeEach(async () => {
  host = await createHost();
});

afterEach(async () => {
  await host.cleanup();
});

/** An on-up stub that rewrites the recipe book when VERSION starts. */
function migrateOnUp(version) {
  return [
    "#!/usr/bin/env bash",
    `if grep -qx 'MEALS_VERSION=${version}' "$MEALS_ROOT/.env"; then`,
    `  echo '{ "recipes": "migrated" }' > "$MEALS_ROOT/data/v2/recipes.json"`,
    "fi",
    "",
  ].join("\n");
}

async function dockerCalls() {
  return (await host.calls()).filter((call) => call.startsWith("docker "));
}

test("meals-deploy deploys a newer release: pull, stop, backup, start, and verify", async () => {
  await host.addRelease("0.3.0");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Deployed version 0\.3\.0\./);
  const env = await host.readEnv();
  assert.equal(env.MEALS_IMAGE, imageFor("0.3.0"));
  assert.equal(env.MEALS_VERSION, "0.3.0");
  assert.equal(env.MEALS_PORT, "3000");
  assert.equal((await host.readEnv(".env.previous")).MEALS_VERSION, "0.2.0");
  const backups = await host.backups();
  assert.equal(backups.length, 1);
  assert.match(backups[0], /-pre-deploy-v0\.2\.0\.tar\.gz$/);
  const calls = await dockerCalls();
  const pull = calls.indexOf(`docker pull --quiet ${imageFor("0.3.0")}`);
  const stop = calls.findIndex((call) => / compose .* stop$/.test(call));
  const up = calls.findIndex((call) => / compose .* up --detach --wait /.test(call));
  assert.ok(pull >= 0 && stop > pull && up > stop, calls.join("\n"));
});

test("meals-deploy only checks that the deployed version runs when it's the latest release", async () => {
  await host.addRelease("0.2.0");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Version 0\.2\.0 is deployed already\./);
  assert.deepEqual(
    (await dockerCalls()).map((call) => call.replace(/ --project-directory .* ps /, " ps ")),
    ["docker compose ps --quiet app"],
  );
});

test("meals-deploy starts the deployed version when it isn't running", async () => {
  await host.addRelease("0.2.0");
  await rm(path.join(host.stubDir, "running"));

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Version 0\.2\.0 wasn't running\. Starting it\./);
  assert.match((await dockerCalls()).at(-1), / compose .* up --detach$/);
});

test("meals-deploy skips a latest release that's older than the deployed version", async () => {
  await host.addRelease("0.1.0");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await dockerCalls(), []);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("meals-deploy fails, without deploying, while the latest release is a failed version", async () => {
  await host.addRelease("0.3.0");
  await host.writeRootFile("failed", "0.3.0\n");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /The latest release, 0\.3\.0, failed before/);
  assert.deepEqual(await dockerCalls(), []);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("meals-deploy starts the previous version again when the pre-deploy backup fails", async () => {
  await host.addRelease("0.3.0");
  await host.writeData("v2/recipes.json", "{ not json");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /The pre-deploy backup failed, so version 0\.2\.0 runs again/);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  assert.equal(await host.exists("failed"), false);
  assert.match((await dockerCalls()).at(-1), / compose .* up --detach$/);
});

test("meals-deploy rejects extra arguments", async () => {
  const result = await host.run("meals-deploy", "0.1.0", "extra");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: meals-deploy \[VERSION \| --resume\]/);
  assert.deepEqual(await host.calls(), []);
});

test("meals-deploy waits while the latest release has no image.txt", async () => {
  await host.addRelease("0.3.0", { withImage: false });

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Version 0\.3\.0 has no image\.txt yet\./);
  assert.deepEqual(await dockerCalls(), []);
});

test("meals-deploy does nothing on hold, without asking GitHub", async () => {
  await host.addRelease("0.3.0");
  await host.writeRootFile("hold", "");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /on hold/);
  assert.deepEqual(await host.calls(), []);
});

test("meals-deploy fails without changing anything when GitHub doesn't answer", async () => {
  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Couldn't get the latest release from GitHub/);
  assert.deepEqual(await dockerCalls(), []);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("meals-deploy fails on an image.txt that isn't a reference by digest", async () => {
  await host.addRelease("0.3.0", { image: "ghcr.io/ruy-ggarcia/meals:0.3.0" });

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /isn't an image reference by digest/);
  assert.deepEqual(await dockerCalls(), []);
});

test("meals-deploy changes nothing, and doesn't record a failed version, when the pull fails", async () => {
  await host.addRelease("0.3.0");
  await host.stub("pull-fails", "");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Couldn't pull/);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  assert.deepEqual(await host.backups(), []);
  assert.equal(await host.exists("failed"), false);
  assert.deepEqual(
    (await dockerCalls()).filter((call) => call.includes(" compose ")),
    [],
  );
});

test("meals-deploy VERSION doesn't put the host on hold when the pull fails", async () => {
  await host.addRelease("0.1.0", { latest: false });
  await host.stub("pull-fails", "");

  const result = await host.run("meals-deploy", "0.1.0");

  assert.equal(result.status, 1);
  assert.equal(await host.exists("hold"), false);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("meals-deploy rolls back the image and the data when the new version isn't healthy", async () => {
  await host.addRelease("0.3.0");
  await host.stub("broken", "0.3.0\n");
  await host.stub("on-up", migrateOnUp("0.3.0"), { executable: true });

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Rolled back to version 0\.2\.0 and its data\./);
  assert.match(result.stderr, /Version 0\.3\.0 failed/);
  const env = await host.readEnv();
  assert.equal(env.MEALS_IMAGE, imageFor("0.2.0"));
  assert.equal(env.MEALS_VERSION, "0.2.0");
  assert.equal(await host.readData("v2/recipes.json"), DATA["v2/recipes.json"]);
  assert.equal(await readFile(path.join(host.root, "failed"), "utf8"), "0.3.0\n");
  assert.deepEqual(
    (await host.backups()).map((name) => name.replace(/^.*Z-/, "")),
    ["pre-deploy-v0.2.0.tar.gz"],
  );
  assert.equal(await host.exists(".env.previous"), false);
});

test("meals-deploy rolls back when the new version reports another version", async () => {
  await host.addRelease("0.3.0");
  await host.stub("health-version", "0.2.0\n");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("the first deployment takes no backup", async () => {
  await host.cleanup();
  host = await createHost({ version: "" });
  await host.addRelease("0.2.0");

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
  assert.deepEqual(await host.backups(), []);
  assert.ok(!(await dockerCalls()).some((call) => / compose .* stop$/.test(call)));
});

test("a failed first deployment leaves the data as it is and starts nothing", async () => {
  await host.cleanup();
  host = await createHost({ version: "" });
  await host.addRelease("0.2.0");
  await host.stub("broken", "0.2.0\n");
  await host.stub("on-up", migrateOnUp("0.2.0"), { executable: true });

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 1);
  const env = await host.readEnv();
  assert.equal(env.MEALS_IMAGE, "");
  assert.equal(env.MEALS_VERSION, "");
  assert.equal(await host.readData("v2/recipes.json"), '{ "recipes": "migrated" }\n');
  assert.deepEqual(await host.backups(), []);
  assert.equal(await readFile(path.join(host.root, "failed"), "utf8"), "0.2.0\n");
  assert.match((await dockerCalls()).at(-1), / compose .* stop$/);
});

test("meals-deploy VERSION deploys an older release and holds it, and --resume ends the hold", async () => {
  await host.addRelease("0.1.0", { latest: false });
  await host.addRelease("0.2.0");

  const manual = await host.run("meals-deploy", "0.1.0");
  assert.equal(manual.status, 0, manual.stderr);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.1.0");
  assert.equal(await host.exists("hold"), true);

  const held = await host.run("meals-deploy");
  assert.equal(held.status, 0, held.stderr);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.1.0");

  const resume = await host.run("meals-deploy", "--resume");
  assert.equal(resume.status, 0, resume.stderr);
  assert.equal(await host.exists("hold"), false);

  const latest = await host.run("meals-deploy");
  assert.equal(latest.status, 0, latest.stderr);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.2.0");
});

test("meals-deploy accepts a version with its tag prefix", async () => {
  await host.addRelease("0.1.0", { latest: false });

  const result = await host.run("meals-deploy", "v0.1.0");

  assert.equal(result.status, 0, result.stderr);
  assert.equal((await host.readEnv()).MEALS_VERSION, "0.1.0");
});

test("meals-deploy VERSION fails on a release that doesn't exist", async () => {
  const result = await host.run("meals-deploy", "9.9.9");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No release v9\.9\.9 on GitHub/);
  assert.equal(await host.exists("hold"), false);
});

test("a deployment removes the meals images other than the current and the previous one", async () => {
  await host.addRelease("0.3.0");
  await host.stub("images", [imageFor("0.1.0"), imageFor("0.2.0"), imageFor("0.3.0"), ""].join("\n"));

  const result = await host.run("meals-deploy");

  assert.equal(result.status, 0, result.stderr);
  const removed = (await dockerCalls()).filter((call) => call.startsWith("docker image rm "));
  assert.deepEqual(removed, [`docker image rm ${imageFor("0.1.0")}`]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/deploy.test.js`
Expected: FAIL, because `scripts/meals-deploy` doesn't exist.

- [ ] **Step 3: Write `meals-deploy`**

Create `scripts/meals-deploy`, and make it executable with
`chmod +x scripts/meals-deploy`:

```bash
#!/usr/bin/env bash
# Usage: meals-deploy [VERSION | --resume]
#
# Without arguments, deploys the latest release, unless the host is on hold,
# or the release is deployed, older, failed, or has no image.txt yet. It
# starts the deployed version if it isn't running, and fails while the
# latest release is a failed version. With VERSION, deploys that release,
# whatever its version, and puts the host on hold. With --resume, ends the
# hold.
#
# A deployment pulls the image, stops the app, takes a pre-deploy backup,
# and starts and verifies the new version. If the backup fails, the previous
# version runs again. If the verification fails, it goes back to the
# previous version and its data, and records the version in failed.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "$(readlink -f "$0")")/lib/common.sh"

readonly IMAGE_PATTERN='^ghcr\.io/ruy-ggarcia/meals@sha256:[0-9a-f]{64}$'

# Prints the GitHub API response for PATH in the repository.
github_api() {
  curl -fsSL --max-time 20 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/ruy-ggarcia/meals/$1"
}

# Writes .env atomically with IMAGE and VERSION, and keeps the other values.
write_env() {
  local env=$MEALS_ROOT/.env
  {
    printf 'MEALS_GID=%s\n' "$(env_get "$env" MEALS_GID)"
    printf 'MEALS_IMAGE=%s\n' "$1"
    printf 'MEALS_PORT=%s\n' "$(env_get "$env" MEALS_PORT)"
    printf 'MEALS_UID=%s\n' "$(env_get "$env" MEALS_UID)"
    printf 'MEALS_VERSION=%s\n' "$2"
  } >"$env.tmp"
  mv "$env.tmp" "$env"
}

# Removes the meals images other than the ones in .env and .env.previous.
prune_images() {
  local keep ref
  keep=" $(env_get "$MEALS_ROOT/.env" MEALS_IMAGE) $(env_get "$MEALS_ROOT/.env.previous" MEALS_IMAGE) "
  docker image ls --digests --format '{{.Repository}}@{{.Digest}}' ghcr.io/ruy-ggarcia/meals |
    while IFS= read -r ref; do
      if [[ -n $ref && $keep != *" $ref "* ]]; then
        docker image rm "$ref" >/dev/null || log "Couldn't remove the image $ref."
      fi
    done
}

# Deploys VERSION from IMAGE, which is pulled already, and rolls back if the
# verification fails.
deploy() {
  local version=$1 image=$2 previous backup="" before staging
  previous=$(deployed_version)
  if [[ -n $previous ]]; then
    compose stop
    before=$(list_backups pre-deploy)
    if ! "$MEALS_SCRIPTS/meals-backup" pre-deploy; then
      compose up --detach || true
      die "The pre-deploy backup failed, so version $previous runs again. Nothing changed."
    fi
    # The new backup is the one that wasn't there before, whatever the clock says.
    backup=$(comm -13 <(printf '%s\n' "$before") <(list_backups pre-deploy) | tail -n 1)
  fi
  cp "$MEALS_ROOT/.env" "$MEALS_ROOT/.env.previous"
  write_env "$image" "$version"

  if start_and_verify "$version"; then
    prune_images
    log "Deployed version $version."
    return
  fi

  log "Version $version failed the verification. Rolling back."
  compose logs --tail 50 app || true
  compose stop || true
  mv "$MEALS_ROOT/.env.previous" "$MEALS_ROOT/.env"
  if [[ -n $previous ]]; then
    # Restores the data like meals-restore, but without a pre-restore backup:
    # that backup would hold data that the failed version wrote, under the
    # previous version's name.
    staging=$(mktemp -d "$MEALS_ROOT/.restore.XXXXXX")
    if extract_valid "$MEALS_ROOT/backups/$backup" "$staging" && swap_data "$staging" &&
      start_and_verify "$previous"; then
      log "Rolled back to version $previous and its data."
    else
      log "The rollback failed too. See docker compose logs in $MEALS_ROOT."
    fi
    rm -rf "$staging"
  fi
  echo "$version" >>"$MEALS_ROOT/failed"
  die "Version $version failed. $MEALS_ROOT/failed records it, so the timer skips it."
}

readonly USAGE="Usage: meals-deploy [VERSION | --resume]"
[[ $# -le 1 ]] || die "$USAGE"
case ${1:-} in
  --resume)
    take_lock
    rm -f "$MEALS_ROOT/hold"
    log "Resumed the automatic deployments."
    exit 0
    ;;
  -*)
    die "$USAGE"
    ;;
esac

take_lock

if [[ $# == 0 ]]; then
  if [[ -e $MEALS_ROOT/hold ]]; then
    log "The host is on hold, so the timer deploys nothing. To resume, run meals-deploy --resume."
    exit 0
  fi
  release=$(github_api releases/latest) || die "Couldn't get the latest release from GitHub."
else
  release=$(github_api "releases/tags/v${1#v}") || die "No release v${1#v} on GitHub."
fi

version=$(jq -r .tag_name <<<"$release")
version=${version#v}
deployed=$(deployed_version)

if [[ $# == 0 ]]; then
  if [[ $version == "$deployed" ]]; then
    log "Version $version is deployed already."
    # Starts it if it stopped, for example after an interrupted deployment.
    # To keep it stopped on purpose, put the host on hold.
    if [[ -z $(compose ps --quiet app) ]]; then
      log "Version $version wasn't running. Starting it."
      compose up --detach
    fi
    exit 0
  fi
  if [[ -n $deployed ]] && version_lt "$version" "$deployed"; then
    log "The latest release, $version, is older than the deployed version, $deployed. Skipped it."
    exit 0
  fi
  if grep -qxF "$version" "$MEALS_ROOT/failed" 2>/dev/null; then
    # Fails on every run, so the service stays in systemctl --failed until a
    # newer release or a hold.
    die "The latest release, $version, failed before, so the timer skips it until a newer release."
  fi
fi

url=$(jq -r '.assets[] | select(.name == "image.txt") | .browser_download_url' <<<"$release")
if [[ -z $url ]]; then
  [[ $# == 1 ]] && die "Version $version has no image.txt."
  log "Version $version has no image.txt yet."
  exit 0
fi
image=$(curl -fsSL --max-time 20 "$url") || die "Couldn't download the image.txt of version $version."
[[ $image =~ $IMAGE_PATTERN ]] ||
  die "The image.txt of version $version isn't an image reference by digest: $image"
# Pulls before anything changes, including the hold.
docker pull --quiet "$image" >/dev/null || die "Couldn't pull $image. Nothing changed."

if [[ $# == 1 ]]; then
  touch "$MEALS_ROOT/hold"
  log "Put the host on hold, so the timer keeps version $version. To resume, run meals-deploy --resume."
fi
deploy "$version" "$image"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/deploy.test.js`
Expected: PASS.

- [ ] **Step 5: Run the checks**

Run: `npm run format && npm run lint && npm test`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/meals-deploy test/deploy.test.js
git commit -m "feat(host): deploy releases with a backup, a verification, and a rollback"
```

---

### Task 10: Restore check

**Files:**
- Create: `scripts/meals-restore-check`
- Create: `test/restore-check.test.js`

**Interfaces:**
- Consumes: `deployed_version`, `die`, `env_get`, `extract_valid`,
  `list_backups`, `log`, and `take_lock`.
- Produces: `meals-restore-check`.

- [ ] **Step 1: Write the failing tests**

Create `test/restore-check.test.js`:

```js
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { afterEach, beforeEach, test } from "node:test";
import { createHost, DATA } from "./host-helpers.js";

const OLDER = "2026-10-01T033000Z-daily-v0.2.0.tar.gz";
const LATEST = "2026-10-02T033000Z-pre-deploy-v0.2.0.tar.gz";

let host;

beforeEach(async () => {
  host = await createHost();
});

afterEach(async () => {
  await host.cleanup();
});

/** DATA with the weeks WEEKS instead of its own. */
function withWeeks(...weeks) {
  const files = { "v2/ingredients.json": DATA["v2/ingredients.json"], "v2/recipes.json": DATA["v2/recipes.json"] };
  for (const week of weeks) files[`v2/weeks/${week}.json`] = "{}\n";
  return files;
}

async function requestedPaths() {
  return (await host.calls())
    .filter((call) => call.startsWith("curl "))
    .map((call) => call.split(" ").at(-1).replace("http://127.0.0.1:49153", ""));
}

async function leftovers() {
  return (await readdir(host.root)).filter((name) => name.startsWith(".restore-check."));
}

test("meals-restore-check checks the latest backup, each of its weeks, and cleans up", async () => {
  await host.makeBackup(OLDER, withWeeks("2026-09-21"));
  await host.makeBackup(LATEST, withWeeks("2026-09-28", "2026-10-05"));
  await host.writeBackup("2026-10-03T033000Z-daily-v0.2.0.tar.gz.partial", "interrupted");

  const result = await host.run("meals-restore-check");

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await requestedPaths(), [
    "/api/health",
    "/api/recipes",
    "/api/ingredients",
    "/api/weeks/2026-09-28",
    "/api/weeks/2026-10-05",
  ]);
  const compose = (await host.calls()).filter((call) => call.includes("--project-name meals-restore-check"));
  assert.ok(compose.some((call) => call.includes(" up --detach --wait ")), compose.join("\n"));
  assert.ok(compose.at(-1).endsWith(" down"), compose.join("\n"));
  assert.deepEqual(await leftovers(), []);
  assert.match(result.stdout, new RegExp(`The backup ${LATEST} restores into version 0\\.2\\.0`));
});

test("meals-restore-check fails, and cleans up, when a request fails", async () => {
  await host.makeBackup(LATEST, withWeeks("2026-09-28"));
  await host.stub("failing-paths", "/api/weeks/2026-09-28\n");

  const result = await host.run("meals-restore-check");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GET \/api\/weeks\/2026-09-28 failed/);
  assert.ok((await host.calls()).at(-1).endsWith(" down"));
  assert.deepEqual(await leftovers(), []);
});

test("meals-restore-check fails when the app doesn't become healthy on the backup", async () => {
  await host.makeBackup(LATEST);
  await host.stub("broken", "0.2.0\n");

  const result = await host.run("meals-restore-check");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /didn't become healthy/);
  assert.deepEqual(await leftovers(), []);
});

test("meals-restore-check does nothing without a deployed version or a backup", async () => {
  const noBackup = await host.run("meals-restore-check");
  assert.equal(noBackup.status, 0, noBackup.stderr);
  assert.match(noBackup.stdout, /There are no backups to check\./);

  await host.cleanup();
  host = await createHost({ version: "" });
  await host.makeBackup(LATEST);
  const noVersion = await host.run("meals-restore-check");
  assert.equal(noVersion.status, 0, noVersion.stderr);
  assert.match(noVersion.stdout, /No version is deployed/);
  assert.deepEqual(await host.calls(), []);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/restore-check.test.js`
Expected: FAIL, because `scripts/meals-restore-check` doesn't exist.

- [ ] **Step 3: Write `meals-restore-check`**

Create `scripts/meals-restore-check`, and make it executable with
`chmod +x scripts/meals-restore-check`:

```bash
#!/usr/bin/env bash
# Usage: meals-restore-check
#
# Proves that the latest backup restores into a working app. It runs the
# deployed image on a copy of the backup, as the separate Compose project
# meals-restore-check, and requests the health check, the recipe book, the
# ingredient catalog, and each week in the backup.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "$(readlink -f "$0")")/lib/common.sh"

take_lock

version=$(deployed_version)
if [[ -z $version ]]; then
  log "No version is deployed, so there's nothing to check the backups with."
  exit 0
fi
backup=$(list_backups "" | tail -n 1)
if [[ -z $backup ]]; then
  log "There are no backups to check."
  exit 0
fi

work=$(mktemp -d "$MEALS_ROOT/.restore-check.XXXXXX")
export MEALS_GID MEALS_IMAGE MEALS_PORT=127.0.0.1:0 MEALS_UID
MEALS_GID=$(env_get "$MEALS_ROOT/.env" MEALS_GID)
MEALS_IMAGE=$(env_get "$MEALS_ROOT/.env" MEALS_IMAGE)
MEALS_UID=$(env_get "$MEALS_ROOT/.env" MEALS_UID)

# Runs docker compose on the check's project, whose directory holds the copy.
check_compose() {
  docker compose --project-name meals-restore-check --project-directory "$work" \
    --file "$MEALS_ROOT/compose.yaml" "$@"
}

cleanup() {
  check_compose down >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

extract_valid "$MEALS_ROOT/backups/$backup" "$work" || die "The backup $backup failed validation."
check_compose up --detach --wait --wait-timeout "${MEALS_VERIFY_TIMEOUT:-60}" ||
  die "Version $version didn't become healthy on the backup $backup."
address=$(check_compose port app 3000)

paths=(/api/health /api/recipes /api/ingredients)
shopt -s nullglob
for week in "$work"/data/v2/weeks/*.json; do
  paths+=("/api/weeks/$(basename "$week" .json)")
done
for path in "${paths[@]}"; do
  curl -fsS --max-time 10 -o /dev/null "http://$address$path" ||
    die "GET $path failed on the backup $backup."
done
log "The backup $backup restores into version $version: ${#paths[@]} requests succeeded."
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/restore-check.test.js`
Expected: PASS.

- [ ] **Step 5: Run the checks**

Run: `npm run format && npm run lint && npm test`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/meals-restore-check test/restore-check.test.js
git commit -m "feat(host): check every week that the latest backup restores"
```

---

### Task 11: Installation and systemd units

**Files:**
- Create: `deploy/systemd/meals-backup.service`
- Create: `deploy/systemd/meals-backup.timer`
- Create: `deploy/systemd/meals-deploy.service`
- Create: `deploy/systemd/meals-deploy.timer`
- Create: `deploy/systemd/meals-restore-check.service`
- Create: `deploy/systemd/meals-restore-check.timer`
- Create: `scripts/install.sh`

**Interfaces:**
- Consumes: `deploy/compose.yaml`, `scripts/lib/common.sh`, and the four
  `meals-*` scripts.
- Produces: the host layout under `/opt/server/meals`, the user `deployer`,
  the links in `/usr/local/bin`, and the timers. Task 12 documents and
  manually tests them.

The installer needs root and changes the system, so the automated tests
don't run it. ShellCheck checks it, and `docs/manual-test-plan.md` covers it
in Task 12.

- [ ] **Step 1: Write the units**

Create `deploy/systemd/meals-backup.service`:

```ini
[Unit]
Description=Back up the Meals data

[Service]
Type=oneshot
User=deployer
Group=docker
UMask=0002
ExecStart=/opt/server/meals/scripts/meals-backup daily
```

Create `deploy/systemd/meals-backup.timer`:

```ini
[Unit]
Description=Back up the Meals data every day

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

Create `deploy/systemd/meals-deploy.service`:

```ini
[Unit]
Description=Deploy the latest Meals release
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=deployer
Group=docker
UMask=0002
ExecStart=/opt/server/meals/scripts/meals-deploy
```

Create `deploy/systemd/meals-deploy.timer`:

```ini
[Unit]
Description=Check for a new Meals release every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
```

Create `deploy/systemd/meals-restore-check.service`:

```ini
[Unit]
Description=Check that the latest Meals backup restores
After=docker.service

[Service]
Type=oneshot
User=deployer
Group=docker
UMask=0002
ExecStart=/opt/server/meals/scripts/meals-restore-check
```

Create `deploy/systemd/meals-restore-check.timer`:

```ini
[Unit]
Description=Check the latest Meals backup every week

[Timer]
OnCalendar=Sun *-*-* 04:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 2: Write the installer**

Create `scripts/install.sh`, and make it executable with
`chmod +x scripts/install.sh`:

```bash
#!/usr/bin/env bash
# Usage: sudo scripts/install.sh
#
# Installs or updates the Meals host tools from this checkout: the deployer
# user, /opt/server/meals, the scripts, the Compose file, and the systemd
# timers. It's idempotent. The first run puts the host on hold, so nothing
# deploys before you move your data in.
set -euo pipefail

readonly ROOT=/opt/server/meals
repo=$(dirname "$(dirname "$(readlink -f "$0")")")

if [[ $EUID != 0 ]]; then
  echo "Run install.sh as root: sudo scripts/install.sh" >&2
  exit 1
fi
if ! getent group docker >/dev/null; then
  echo "The docker group doesn't exist. Install Docker first." >&2
  exit 1
fi

if ! id deployer >/dev/null 2>&1; then
  useradd --system --gid docker --no-create-home --home-dir /nonexistent \
    --shell /usr/sbin/nologin deployer
  echo "Created the deployer user."
fi

install -d -o root -g docker -m 2775 /opt/server
install -d -o deployer -g docker -m 2775 \
  "$ROOT" "$ROOT/.docker" "$ROOT/backups" "$ROOT/data" "$ROOT/scripts" "$ROOT/scripts/lib"
install -o deployer -g docker -m 0664 "$repo/deploy/compose.yaml" "$ROOT/compose.yaml"
install -o deployer -g docker -m 0664 "$repo"/scripts/lib/*.sh "$ROOT/scripts/lib/"
install -o deployer -g docker -m 0775 "$repo"/scripts/meals-* "$ROOT/scripts/"

if [[ ! -e $ROOT/.env ]]; then
  printf 'MEALS_GID=%s\nMEALS_IMAGE=\nMEALS_PORT=3000\nMEALS_UID=%s\nMEALS_VERSION=\n' \
    "$(getent group docker | cut -d: -f3)" "$(id -u deployer)" >"$ROOT/.env"
  touch "$ROOT/hold"
  chown deployer:docker "$ROOT/.env" "$ROOT/hold"
  chmod 0664 "$ROOT/.env" "$ROOT/hold"
  echo "Created .env, and put the host on hold until you run: sudo -u deployer meals-deploy --resume"
fi

for script in "$ROOT"/scripts/meals-*; do
  ln -sfn "$script" "/usr/local/bin/$(basename "$script")"
done

install -m 0644 "$repo"/deploy/systemd/*.service "$repo"/deploy/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now meals-backup.timer meals-deploy.timer meals-restore-check.timer
echo "Installed the Meals host tools in $ROOT."
```

- [ ] **Step 3: Check the units and the installer**

Run: `npm run lint`
Expected: PASS. ShellCheck reports nothing for `scripts/install.sh`.

Run: `systemd-analyze verify --man=no deploy/systemd/*`
Expected: no errors about the timer syntax. Messages about missing files
under `/opt/server/meals` are expected on a computer without the host
tools.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add deploy/systemd scripts/install.sh
git commit -m "feat(host): install the host tools and their systemd timers"
```

---

### Task 12: Documentation

**Files:**
- Create: `docs/deployment.md`
- Modify: `README.md`
- Modify: `docs/manual-test-plan.md`

**Interfaces:**
- Consumes: every command, file, and value of Tasks 1 to 11.

- [ ] **Step 1: Write the operations guide**

Create `docs/deployment.md`:

````markdown
# Deploy Meals

Meals runs on one computer at home, the *host*, in a Docker container. Every
change reaches the host as a *release*: a version number, a changelog entry,
a Git tag, and a container image identified by its digest. The host checks
for new releases every 5 minutes and deploys each one on its own. It backs
up the data first, and if the new version doesn't come up healthy, it goes
back to the previous version and its data.

## How it works

1. You merge pull requests into `main`. release-please keeps a *release pull
   request* open, which bumps the version and adds the changes to
   `CHANGELOG.md`.
1. You merge the release pull request. The release workflow tags the
   release, builds the image, runs the smoke test on it, and pushes it to
   GitHub Container Registry. Then it attaches `image.txt`, the image
   reference by digest, to the GitHub Release.
1. Within 5 minutes, `meals-deploy` on the host finds the release, backs up
   the data, starts the new version, and checks its health. If the check
   fails, it *rolls back* to the previous version and its data.

Every day, `meals-backup` backs up the data. Every week,
`meals-restore-check` checks that the latest backup restores into a working
app.

## Set up GitHub

You set up GitHub once, before the first release. To set it up, do the
following:

1. Create a GitHub App for release-please:
   1. In GitHub, go to **Settings > Developer settings > GitHub Apps**, and
      click **New GitHub App**.
   1. Enter a name, such as `meals-release`, and the repository's URL as the
      homepage URL.
   1. Clear **Webhook > Active**.
   1. Under **Repository permissions**, set **Contents**, **Issues**, and
      **Pull requests** to **Read and write**.
   1. Under **Where can this GitHub App be installed?**, select **Only on
      this account**, and click **Create GitHub App**.
   1. Copy the **Client ID**. Then click **Generate a private key**, which
      downloads a `.pem` file.
   1. Click **Install App**, and install the app on the `meals` repository
      only.
1. Save the app's client ID and private key in the repository:

   ```bash
   gh variable set RELEASE_APP_CLIENT_ID --body CLIENT_ID
   gh secret set RELEASE_APP_PRIVATE_KEY < PEM_FILE
   ```

   Replace `CLIENT_ID` with the client ID and `PEM_FILE` with the path of the
   `.pem` file. Then delete the `.pem` file.
1. Require the `image` check before a pull request can merge into `main`:

   ```bash
   gh api --method POST \
     repos/ruy-ggarcia/meals/branches/main/protection/required_status_checks/contexts \
     -f 'contexts[]=image'
   ```

After the first release, make the image public, so the host can pull it
without credentials:

1. In GitHub, open the `meals` package from the repository's **Packages**
   list.
1. Click **Package settings**, and under **Danger Zone**, click **Change
   visibility**. Select **Public**, and confirm.

## Release a version

The version follows [Semantic Versioning](https://semver.org), and the
commit types since the last release decide the next version:

| Commits since the last release | Before `1.0.0` | From `1.0.0` on |
|--------------------------------|----------------|-----------------|
| A breaking change (`feat!:`, or a `BREAKING CHANGE:` footer) | Minor version | Major version |
| `feat` | Minor version | Minor version |
| `fix` | Patch version | Patch version |
| Only `build`, `ci`, `docs`, `refactor`, or `test` | No release | No release |

Dependabot uses `fix(deps)` for production dependencies and the base image,
so their updates reach the host in the next release. It uses
`build(deps-dev)` for development dependencies and `ci(deps)` for GitHub
Actions, which release nothing.

To release a version, do the following:

1. Open the pull request titled `chore(main): release X.Y.Z`, and check the
   version and the changelog.
1. When its checks pass, merge it. A few minutes later, the `publish` job
   attaches `image.txt` to the release, and the host deploys it within 5
   minutes after that.

To check that the release workflow published the image, run the following
command and look for `image.txt` under `ASSETS`:

```bash
gh release view vX.Y.Z
```

If the `publish` job fails, the release has no `image.txt`, and the host
doesn't deploy it. Fix the problem in a pull request, and release the fix as
the next version.

## Install the host tools

The host needs Docker Engine with the Compose plugin, `curl`, `flock`,
`gzip`, `jq`, and `tar`. On Ubuntu, `jq` is the one that's usually missing.
To install it, run `sudo apt install jq`.

To install the host tools, or to update them to a release, do the
following:

1. Get a checkout of the release tag:

   ```bash
   git clone https://github.com/ruy-ggarcia/meals.git
   cd meals
   git checkout vX.Y.Z
   ```

1. Run the installer:

   ```bash
   sudo scripts/install.sh
   ```

The installer creates the following. When you run it again, it replaces the
scripts, `compose.yaml`, and the units, and resets the directory owners and
modes. It keeps `.env`, `hold`, the data, and the backups.

- The system user `deployer`, whose primary group is `docker`. It has no
  home directory and can't log in.
- `/opt/server`, owned by `root:docker` with mode `2775`, and
  `/opt/server/meals`, owned by `deployer:docker`:

  ```none
  /opt/server/meals/
    .docker/        # Docker CLI settings of the scripts
    backups/        # Backups
    data/           # The data directory, mounted at /data in the container
    scripts/        # The meals-* scripts and their shared functions
    .env            # The deployed version and its settings
    compose.yaml    # The app service
  ```

- The commands `meals-backup`, `meals-deploy`, `meals-restore`, and
  `meals-restore-check` in `/usr/local/bin`.
- The timers `meals-backup.timer`, `meals-deploy.timer`, and
  `meals-restore-check.timer`, enabled and started.

On the first installation, the installer also puts the host *on hold*, so
it deploys nothing until you move your data in. To start without data, run
`sudo -u deployer meals-deploy --resume`. To keep the data of an earlier
installation, see [Move an existing installation](#move-an-existing-installation).

A release updates the app, but not the host tools. When the changelog
mentions a change to `deploy/` or `scripts/`, run the installer again from
that release.

## Deployments

`meals-deploy.timer` runs `meals-deploy` 2 minutes after boot, and then 5
minutes after each run. It deploys the latest release, unless one of the
following is true:

- The host is on hold.
- The release is the deployed version, or older.
- The release is a *failed version*: a version whose deployment was rolled
  back. `/opt/server/meals/failed` lists them.
- The release doesn't have `image.txt` yet.

When the latest release is the deployed version, `meals-deploy` starts it if
it isn't running, for example after an interrupted deployment. While the
latest release is a failed version, `meals-deploy.service` fails on every
run, so it stays in `systemctl --failed` until a newer release or a hold.

A deployment does the following:

1. Pulls the image by digest. If the pull fails, nothing changes, and the
   next run tries again.
1. Stops the app, and takes a `pre-deploy` backup. If the backup fails, for
   example because a data file has invalid JSON, the previous version runs
   again, and nothing changes.
1. Starts the new version, and waits up to 60 seconds for it to be healthy
   and to report its version.
1. If the check fails, stops the new version, restores the data and the
   previous version, and adds the version to `failed`.

The app stops for a few seconds during each deployment.

### Deploy a version by hand

The following commands control deployments:

| Command | Effect |
|---------|--------|
| `sudo systemctl start meals-deploy` | Deploys the latest release now, as the timer does. |
| `sudo -u deployer meals-deploy VERSION` | Deploys release `VERSION`, such as `0.2.0`, even if it's older or failed, and puts the host on hold so the timer keeps it. |
| `sudo -u deployer meals-deploy --resume` | Ends the hold, so the timer deploys the latest release again. |

To go back to an earlier release, deploy it by hand. When a newer release
fixes the problem, run `sudo -u deployer meals-deploy --resume`.

To keep the app stopped, for example while you repair the host, put the host
on hold first. Otherwise the timer starts the deployed version again.

## Backups

A backup is a `.tar.gz` archive of the whole data directory in
`/opt/server/meals/backups/`. Its name holds the time in UTC, the backup
kind, and the version that wrote the data, for example
`2026-10-04T033000Z-daily-v0.2.0.tar.gz`. The host takes no backups before
the first deployment, because no version has written the data yet.

| Kind | When | Backups kept |
|------|------|--------------|
| `daily` | Every day at 03:30, or at the next boot if the host was off. | 14 |
| `pre-deploy` | Before each deployment. | 10 |
| `pre-restore` | Before each restore. | 10 |

Each backup is checked after it's written: the archive must be intact, and
every JSON file in it must parse. If a data file is damaged, the backup
fails, and `meals-backup.service` shows in `systemctl --failed`. A
`pre-restore` backup only checks that the archive is intact, so you can
restore over damaged data and still undo the restore.

To take a backup now, run `sudo systemctl start meals-backup`.

### Restore a backup

To restore a backup, run the following command with its file name in
`backups/`, or with the absolute path of an archive elsewhere:

```bash
sudo -u deployer meals-restore 2026-10-04T033000Z-daily-v0.2.0.tar.gz
```

`meals-restore` checks the backup before it changes anything, stops the app,
takes a `pre-restore` backup, replaces the data directory, and starts the
app again. To undo a restore, restore that `pre-restore` backup.

`meals-restore` refuses a backup from a version newer than the deployed
one, because that version might store data in a format that the deployed
version doesn't read. To restore it, first deploy its version with
`meals-deploy VERSION`.

### Restore on a new host

To restore a backup on a new host, do the following:

1. Install the host tools, as in [Install the host tools](#install-the-host-tools).
1. Copy the backup to `/opt/server/meals/backups/`.
1. Deploy the backup's version, which is in its name:

   ```bash
   sudo -u deployer meals-deploy VERSION
   ```

1. Restore the backup with `meals-restore`.
1. When you're ready for new releases, run
   `sudo -u deployer meals-deploy --resume`.

### Copy backups off the host

The backups live on the host's disk, so they don't survive a disk failure.
To keep copies elsewhere, copy `/opt/server/meals/backups/` regularly to
another device, for example with `rsync`:

```bash
rsync -a /opt/server/meals/backups/ nas:/backups/meals/
```

### Restore check

Every Sunday at 04:00, `meals-restore-check` starts the deployed image on a
copy of the latest backup, as the separate Compose project
`meals-restore-check`. It requests the health check, the recipe book, the
ingredient catalog, and each week in the backup. If a request fails,
`meals-restore-check.service` shows in `systemctl --failed`. To run the
check now, run `sudo systemctl start meals-restore-check`.

## Move an existing installation

If you ran Meals from a checkout with `npm start`, you can move its data to
the host. Before you start, the first release must have `image.txt`, and its
image must be public.

To move the installation, do the following:

1. From a checkout of the release tag, run `sudo scripts/install.sh`. The
   host is on hold.
1. Stop the `npm start` server.
1. Copy the data directory of the checkout to the host, and give it to
   `deployer`:

   ```bash
   sudo cp -a data/. /opt/server/meals/data/
   sudo chown -R deployer:docker /opt/server/meals/data
   ```

1. Deploy the latest release:

   ```bash
   sudo -u deployer meals-deploy --resume
   sudo systemctl start meals-deploy
   ```

   As the first deployment, it takes no backup. The data directory of the
   checkout is the copy to go back to.
1. Check that `curl http://localhost:3000/api/health` returns the release's
   version, and that the meal plan, the recipe book, and the ingredient
   catalog look as before.
1. Take the first backup:

   ```bash
   sudo systemctl start meals-backup
   ```

1. Move the data directory of the checkout out of the working tree, for
   example into a dated archive:

   ```bash
   tar -czf ~/meals-data-before-move.tar.gz data && rm -r data
   ```

If the first deployment fails, copy the data directory of the checkout to
`/opt/server/meals/data/` again before you try another release.

## Logs

The scripts log to the journal, and the app logs one JSON object per line.
The `docker` commands need membership in the `docker` group, or `sudo`:

| To see | Run |
|--------|-----|
| The deployments | `journalctl -u meals-deploy` |
| The backups | `journalctl -u meals-backup` |
| The restore checks | `journalctl -u meals-restore-check` |
| The app | `docker compose --project-directory /opt/server/meals logs app` |
| The failed services | `systemctl --failed` |
| The timers and their next run | `systemctl list-timers 'meals-*'` |

To list only the app's errors, run the following command:

```bash
docker compose --project-directory /opt/server/meals logs --no-log-prefix app \
  | jq -c 'select(.level == "error")'
```
````

- [ ] **Step 2: Update the README**

In `README.md`, make these changes:

1. In "Before you begin", replace the list with:

   ```markdown
   - Node.js 22 or later. To check your version, run `node --version`.
   - npm. To check that it's installed, run `npm --version`.
   - ShellCheck, which `npm run lint` runs on the shell scripts. On Ubuntu,
     run `sudo apt install shellcheck`.
   - Optional: Docker with the Compose plugin, to build and test the image
     with `npm run test:image`.
   ```

1. In "Start the server", replace the heading and the first step:

   ````markdown
   ## Start the server

   1. Install the dependencies:

      ```bash
      npm install
      ```
   ````

   with:

   ````markdown
   ## Start the server

   This section starts a server from your checkout, for development. To run
   Meals on the home server, see [Deploy Meals](docs/deployment.md).

   1. Install the dependencies. Run this command again after you pull
      changes, so `node_modules` matches `package-lock.json`:

      ```bash
      npm ci
      ```
   ````

1. At the end of "Start the server", after `To stop the server, press
   Control+C.`, add:

   ```markdown
   If the computer also runs the deployed Meals, it uses port `3000`. To
   start a development server next to it, run `PORT=3001 npm start`.
   ```

1. In "Configure the server", after the table, add:

   ```markdown
   On the host, the container sets them. See [Deploy Meals](docs/deployment.md).
   ```

1. In "Back up and restore data", rename the heading to
   `## Data files`, and replace:

   ````markdown
   To back up your data, copy the directory:

   ```bash
   cp -r data/v2 "meals-backup-$(date +%F)"
   ```
   ````

   with:

   ```markdown
   On the host, backups are automatic. See
   [Backups](docs/deployment.md#backups).
   ```

1. In "Check your changes", replace the paragraph that starts with
   `[Biome](https://biomejs.dev) checks` with:

   ````markdown
   [Biome](https://biomejs.dev) checks the style of JavaScript, CSS, and JSON
   files. The settings are in `biome.json`.
   [ShellCheck](https://www.shellcheck.net) checks the shell scripts. The
   settings are in `.shellcheckrc`.

   If you change `Dockerfile`, `deploy/compose.yaml`, or `server/`, also
   build and test the image:

   ```bash
   npm run test:image
   ```
   ````

1. Replace the body of "Continuous integration" with:

   ```markdown
   GitHub Actions runs two checks on every pull request and on every push to
   `main`. The workflow is in `.github/workflows/ci.yml`:

   - `ci` runs `npm run lint` and `npm test` with Node.js 22.
   - `image` runs `npm run test:image`.

   Changes reach `main` only through pull requests that pass both checks.
   Each pull request merges with a merge commit.

   On every push to `main`, `.github/workflows/release.yml` keeps a release
   pull request up to date, and publishes a release when you merge it. See
   [Release a version](docs/deployment.md#release-a-version).

   Every week, Dependabot opens pull requests that update the npm
   dependencies, the GitHub Actions, and the base image. The settings are in
   `.github/dependabot.yml`.
   ```

1. Replace the tree in "Project structure" with:

   ```none
   .github/
     workflows/
       ci.yml              # Continuous integration: lint, tests, and the image.
       release.yml         # Releases: release-please, and the image in GHCR.
     dependabot.yml        # Weekly dependency updates.
   deploy/
     systemd/              # The host's timers and their services.
     compose.yaml          # The app service on the host.
   docs/
     deployment.md         # Releases, deployments, and backups.
     glossary.md           # The terms the app uses.
     manual-test-plan.md   # Checks that need a person with a browser or a host.
   public/            # User interface: HTML, CSS, and JavaScript, with no framework or build step.
     app.js               # Meal plan page: grid, week changes, and saves.
     catalog-list.js      # List logic shared by the Recipes and Ingredients pages.
     combobox.js          # The filter-and-pick field of the editors.
     dates.js             # Date helpers.*
     dom.js               # DOM helpers shared by the pages.
     editor-dialog.js     # The dialog lifecycle shared by the recipe and ingredient editors.
     http.js              # Requests with a timeout.*
     index.html           # Meal plan page.
     ingredient-editor.js # The ingredient editor dialog.
     ingredients.html     # Ingredients page.
     ingredients.js       # Ingredients page logic.
     menus.js             # Menu functions.*
     messages.js          # Recipe book message text.*
     name-search.js       # Name matching and sorting.*
     quantities.js        # Quantity parsing and shopping list arithmetic.*
     recipe-editor.js     # The recipe editor dialog.
     recipes.html         # Recipe book page.
     recipes.js           # Recipe book page logic.
     saves.js             # Save logic.*
     shopping-dialog.js   # The shopping list dialog.
     shopping-list.js     # Computes the shopping list.*
     slot-editor.js       # The slot editor dialog.
     styles.css
   scripts/
     lib/
       common.sh           # Functions shared by the meals-* scripts.
     image-smoke.sh        # Runs an image as the host does and checks it.
     install.sh            # Installs the host tools.
     meals-backup          # Backs up the data.
     meals-deploy          # Deploys a release, with a rollback.
     meals-restore         # Restores a backup.
     meals-restore-check   # Checks that the latest backup restores.
   server/
     app.js         # HTTP API (Express), static files, and the health check.
     errors.js      # Errors for bad input, which app.js maps to HTTP statuses.
     files.js       # JSON files and the write queue. The only module that touches disk.
     healthcheck.js # The image's health check.
     index.js       # Startup: reads DATA_DIR and PORT, and stops on SIGINT and SIGTERM.
     ingredients.js # The ingredient catalog: unique names, units, and archiving.
     logger.js      # Logs one JSON object per line.
     names.js       # Name rules shared by recipes and ingredients.
     recipes.js     # The recipe book: unique names, ingredients, and archiving.
     shutdown.js    # Stops the server once, within a deadline.
     start.js       # Listens, and stops without cutting a request or a write.
     stores.js      # Wires the stores to one write queue and to each other.
     weeks.js       # Weeks and the menu of each slot.
   test/              # Tests: node:test, with supertest for the API and happy-dom for the pages.
     stubs/           # Stub docker and curl for the host script tests.
   .dockerignore      # What the image build can read.
   .release-please-manifest.json # The current version, for release-please.
   .shellcheckrc      # ShellCheck settings.
   biome.json         # Lint and format settings.
   CHANGELOG.md       # The changes in each release.
   Dockerfile         # The server image.
   release-please-config.json # release-please settings.
   ```

- [ ] **Step 3: Update the manual test plan**

In `docs/manual-test-plan.md`, make these changes:

1. Move the test server to port `3001`, so it runs next to a deployed
   Meals:

   ```bash
   sed -i 's/localhost:3000/localhost:3001/g; s/IP_ADDRESS:3000/IP_ADDRESS:3001/g' docs/manual-test-plan.md
   ```

1. In "Set up a test server", replace the first step with:

   ```markdown
   1. If a development server is running on port `3001`, stop it. In its
      terminal, press `Control+C`. A deployed Meals on port `3000` can keep
      running.
   ```

   Replace the step that starts the test server with:

   ````markdown
   1. Start the test server on port `3001`. If the phone can't reach it,
      open the port as in [Open the app](../README.md#open-the-app), with
      `3001` instead of `3000`.

      ```bash
      DATA_DIR=~/meals-test PORT=3001 npm start
      ```
   ````

1. In the introduction, replace `Run this plan before you merge a change to
   the user interface.` with:

   ```markdown
   Run sections 1 to 12 before you merge a change to the user interface.
   Run section 13 on the host before you merge a change to `deploy/` or
   `scripts/`, and when you move an installation.
   ```

1. Insert this section before `## Clean up`:

   ````markdown
   ## 13. Host

   Run these tests on the host, from a checkout of the branch or release
   that you test. Tests `13.4`, `13.5`, `13.9`, and `13.10` need published releases.

   | ID   | Step | Expected result |
   |------|------|-----------------|
   | 13.1 | Run `sudo scripts/install.sh`. Then run `id deployer` and `stat -c '%A %U:%G %n' /opt/server /opt/server/meals /opt/server/meals/data`. | `id` shows the group `docker`. The output reads `drwxrwsr-x root:docker /opt/server`, and `drwxrwsr-x deployer:docker` for the other two. `/opt/server/meals/hold` exists. |
   | 13.2 | Run `systemctl list-timers 'meals-*'`. | The list shows `meals-backup.timer`, `meals-deploy.timer`, and `meals-restore-check.timer`, each with a next run. |
   | 13.3 | Run `sudo scripts/install.sh` again, and compare `/opt/server/meals/.env` with its content before. | The file is unchanged, and `hold` still exists. |
   | 13.4 | Move the data in, as in [Move an existing installation](deployment.md#move-an-existing-installation). | `curl http://localhost:3000/api/health` returns `ok` and the release's version, and every week, recipe, and ingredient is there. |
   | 13.5 | Run `sudo -u deployer meals-deploy` with an older release's version, such as `0.2.0`. Then run `sudo -u deployer meals-deploy --resume` and `sudo systemctl start meals-deploy`. | The health check reports the older version and `hold` exists. After the resume, it reports the latest version again. |
   | 13.6 | Rename a recipe in the app. Run `sudo systemctl start meals-backup`, rename the recipe again, and restore the new `daily` backup with `sudo -u deployer meals-restore`. | The recipe has the first new name, and `backups/` has a new `pre-restore` backup. |
   | 13.7 | Run `sudo systemctl start meals-restore-check`, and then `journalctl -u meals-restore-check -n 5`. | The journal reads `The backup ... restores into version ...`. `docker ps -a` lists no `meals-restore-check` container. |
   | 13.8 | Reboot the host. | Within 2 minutes after boot, `curl http://localhost:3000/api/health` returns `ok`, and `systemctl list-timers 'meals-*'` lists the three timers. |
   | 13.9 | Remove the image of an older release with `docker image rm`, and block GHCR with `echo '127.0.0.1 ghcr.io' \| sudo tee -a /etc/hosts`. Run `sudo -u deployer meals-deploy` with that release's version. Then delete the line from `/etc/hosts`. | The command fails with `Couldn't pull`. The health check still reports the same version, `hold` doesn't exist, and `failed` doesn't list the release. |
   | 13.10 | Merge a release pull request. When `gh release view` lists `image.txt`, wait 5 minutes without running any command on the host. | `curl http://localhost:3000/api/health` reports the new version, and `journalctl -u meals-deploy` shows `Deployed version`. |
   ````

- [ ] **Step 4: Check the documentation against the code**

Run: `grep -rn "RELEASE_APP_ID\|bin/meals\|unversioned\|Meals listening" README.md docs/deployment.md docs/manual-test-plan.md`
Expected: no output.

Read `docs/deployment.md` next to `scripts/meals-deploy`,
`scripts/meals-backup`, `scripts/meals-restore`, and `scripts/install.sh`,
and check that every command, path, time, and number matches.

- [ ] **Step 5: Run the checks**

Run: `npm run format && npm run lint && npm test`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/deployment.md docs/manual-test-plan.md
git commit -m "docs: document releases, deployments, and backups"
```
