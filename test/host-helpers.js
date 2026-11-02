// Runs the host scripts in scripts/ against a temporary MEALS_ROOT, with the
// stub docker and curl commands in test/stubs/ first in PATH. The stubs log
// each call and answer from files in a separate stub directory.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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

/**
 * The `skip` option of a test that relies on file permissions: REASON as
 * root, who has every permission, and false otherwise.
 */
export function skipAsRoot(reason) {
  return process.getuid?.() === 0 ? reason : false;
}

/** Runs FN with the mode of FILE set to MODE, and then sets it back. */
export async function withMode(file, mode, fn) {
  const original = (await stat(file)).mode & 0o7777;
  await chmod(file, mode);
  try {
    return await fn();
  } finally {
    await chmod(file, original);
  }
}

// Whether a process waits for the lock on FILE: /proc/locks lists a blocked
// request with an arrow after the number of the lock.
async function hasLockWaiter(file) {
  const { ino } = await stat(file);
  const locks = await readFile("/proc/locks", "utf8");
  return locks.split("\n").some((line) => {
    const [, kind, inode] = line.match(/^\d+: -> (\w+) .* \w+:\w+:(\d+) /) ?? [];
    return kind === "FLOCK" && Number(inode) === ino;
  });
}

/**
 * Polls until CONDITION holds. It has no time limit of its own, so a slow
 * machine doesn't fail it. A hang ends in one of two ways, and both call
 * STOP and fail with the message that FAILURE returns. The signal of the
 * test aborts, or the test runner ends the whole file with SIGTERM, which it
 * does when the file times out before the test does, as the runner's
 * timeout applies to both.
 *
 * @param {() => boolean | Promise<boolean>} condition
 * @param {AbortSignal} signal
 * @param {() => string} failure
 * @param {() => void} stop
 */
async function waitUntil(condition, signal, failure, stop) {
  // The runner shows the standard error of a test that it ends.
  const giveUp = () => {
    stop();
    process.stderr.write(`${failure()}\n`);
  };
  const onTerminate = () => {
    giveUp();
    process.exit(1);
  };
  process.once("SIGTERM", onTerminate);
  try {
    while (!(await condition())) {
      if (signal.aborted) {
        giveUp();
        throw new Error(failure());
      }
      await delay(10);
    }
  } finally {
    process.off("SIGTERM", onTerminate);
  }
}

/**
 * Checks that the host script SCRIPT, run with ARGS, waits for the lock that
 * another script holds. The holder keeps the lock until the kernel lists the
 * script as waiting for it, so the check doesn't depend on how long the
 * script takes to start. It resolves to the calls of the host. When the test
 * times out first, it stops the script and the holder, and fails with what
 * didn't happen. T is the context of the test.
 *
 * @param {import("node:test").TestContext} t
 * @param {Host} host
 * @param {string} script
 * @param {string[]} [args]
 */
export async function assertWaitsForLock(t, host, script, args = []) {
  const lock = await host.holdLock(t.signal);
  let ended;
  const run = host.run(script, ...args).then((result) => {
    ended = result;
    return result;
  });
  try {
    await waitUntil(
      async () => ended || (await hasLockWaiter(path.join(host.root, ".lock"))),
      t.signal,
      () => `${script} never blocked on the lock`,
      () => host.stopProcesses(),
    );
    assert.equal(
      ended,
      undefined,
      `${script} ended without waiting for the lock: ${ended?.stderr}`,
    );
    assert.deepEqual(
      await host.calls(),
      [],
      `${script} made calls while another script held the lock`,
    );
  } catch (error) {
    // Don't leave the script running while the test cleans up.
    host.stopProcesses();
    throw error;
  } finally {
    await lock.release();
    await run;
  }

  const result = await run;
  assert.equal(result.status, 0, result.stderr);
  const calls = await host.calls();
  assert.equal(calls[0], "released the lock", `${script} didn't wait:\n${calls.join("\n")}`);
  return calls;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** Runs tar with ARGS, and returns its output, or throws if it fails. */
function tar(args) {
  const result = spawnSync("tar", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`tar ${args.join(" ")} failed: ${result.stderr || result.error?.message}`);
  }
  return result.stdout;
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
  /** @type {import("node:child_process").ChildProcess[]} */
  #holders = [];
  /** @type {Set<import("node:child_process").ChildProcess>} */
  #scripts = new Set();

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
   * read, as with sudo -u deployer from your home directory. It fails with
   * status 99 if it can still read the directory, as root can.
   */
  async runFromUnreadableDir(script, ...args) {
    const dir = path.join(this.stubDir, "unreadable");
    await mkdir(dir);
    const command = [
      'cd "$1" && chmod 000 . || exit 99',
      'if ls . >/dev/null 2>&1; then echo "Can still read $1." >&2; exit 99; fi',
      'shift && exec "$@"',
    ].join("\n");
    return this.#spawn("bash", [
      "-c",
      command,
      "bash",
      dir,
      path.join(SCRIPTS_DIR, script),
      ...args,
    ]);
  }

  #spawn(command, args) {
    /** @type {NodeJS.ProcessEnv} */
    const env = {
      ...process.env,
      // The messages of the host tools, such as those of find, stay in English.
      LC_ALL: "C",
      MEALS_ROOT: this.root,
      MEALS_VERIFY_TIMEOUT: "5",
      // A test can replace any other command with an executable stub in bin/.
      PATH: `${path.join(this.stubDir, "bin")}:${STUBS_DIR}:${process.env.PATH}`,
      STUB_DIR: this.stubDir,
    };
    delete env.MEALS_LOCKED;
    // Its own process group, so stopProcesses() also stops what the script runs.
    const child = spawn(command, args, { detached: true, env });
    this.#scripts.add(child);
    child.on("close", () => this.#scripts.delete(child));
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
   * Replaces COMMAND with a stub that fails when CONDITION holds, and runs
   * COMMAND otherwise. CONDITION is a bash [[ ]] expression, which can use
   * $last, the last argument. Without CONDITION, the stub always fails.
   */
  failCommand(command, condition) {
    const lines = ["#!/usr/bin/env bash", "set -euo pipefail"];
    if (condition === undefined) {
      lines.push("exit 1");
    } else {
      lines.push(
        `last=\${*: -1}`,
        `if [[ ${condition} ]]; then exit 1; fi`,
        `command -p ${command} "$@"`,
      );
    }
    return this.stub(`bin/${command}`, `${lines.join("\n")}\n`, { executable: true });
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

  /**
   * Writes backups/NAME as a real archive of FILES under data/, with
   * DATAMODE as the mode of data/ if given.
   *
   * @param {string} name
   * @param {Record<string, string>} [files]
   * @param {{ dataMode?: number }} [options]
   */
  async makeBackup(name, files = DATA, { dataMode } = {}) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "meals-archive-"));
    await mkdir(path.join(dir, "data"));
    await writeFiles(path.join(dir, "data"), files);
    if (dataMode !== undefined) await chmod(path.join(dir, "data"), dataMode);
    try {
      tar(["-C", dir, "-czf", path.join(this.root, "backups", name), "data"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** The files in backups/NAME, sorted. */
  archiveEntries(name) {
    return tar(["-tzf", path.join(this.root, "backups", name)])
      .split("\n")
      .filter((entry) => entry && !entry.endsWith("/"))
      .sort();
  }

  /**
   * Holds the scripts' lock until `release()`. Resolves once the lock is
   * held, to `{ release }`. `release()` frees the lock and resolves when it's
   * free. Just before it frees the lock, the holder adds "released the lock"
   * to the calls, so a test can check that a script made its calls after the
   * release. `cleanup()` releases a lock that a test didn't. If the holder
   * ends first, or SIGNAL aborts, which node:test does when the test times
   * out, it stops the holder and throws.
   *
   * @param {AbortSignal} signal
   */
  async holdLock(signal) {
    const ready = path.join(this.stubDir, "lock-held");
    // The holder keeps the lock until its standard input closes.
    const holder = spawn(
      "flock",
      [
        path.join(this.root, ".lock"),
        "sh",
        "-c",
        'touch "$0"; read -r _; echo "released the lock" >>"$1"',
        ready,
        path.join(this.stubDir, "calls"),
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let stderr = "";
    holder.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    let ended = false;
    const closed = new Promise((resolve) => {
      holder.on("close", () => {
        ended = true;
        resolve(undefined);
      });
      // A flock that doesn't start has no exit status.
      holder.on("error", (error) => {
        stderr += error.message;
        ended = true;
        resolve(undefined);
      });
    });
    this.#holders.push(holder);
    const failure = () => `the lock holder never took the lock: ${stderr}`;
    try {
      await waitUntil(
        async () => (await exists(ready)) || ended,
        signal,
        failure,
        () => this.stopProcesses(),
      );
      if (!(await exists(ready))) throw new Error(failure());
    } catch (error) {
      this.stopProcesses();
      await closed;
      throw error;
    }
    const release = async () => {
      holder.stdin.end();
      await closed;
    };
    return { release };
  }

  /**
   * Stops the scripts that `run()` started and the lock holders that haven't
   * ended, with what they started, and doesn't wait for them.
   */
  stopProcesses() {
    for (const child of this.#scripts) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The script ended already.
      }
    }
    for (const holder of this.#holders) {
      holder.stdin.end();
      holder.kill();
    }
  }

  async cleanup() {
    this.stopProcesses();
    await rm(this.root, { recursive: true, force: true });
    await rm(this.stubDir, { recursive: true, force: true });
  }
}
