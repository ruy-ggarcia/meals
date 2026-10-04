// Runs the host scripts in scripts/ against a temporary MEALS_ROOT, with the
// stub docker and curl commands in test/stubs/ first in PATH. The stubs log
// each call and answer from files in a separate stub directory.

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
    const env = {
      ...process.env,
      MEALS_ROOT: this.root,
      MEALS_VERIFY_TIMEOUT: "5",
      // A test can replace any other command with an executable stub in bin/.
      PATH: `${path.join(this.stubDir, "bin")}:${STUBS_DIR}:${process.env.PATH}`,
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
   * Holds the scripts' lock for MS milliseconds. Resolves once the lock is
   * held, to `{ released }`, a promise that resolves when it's released. The
   * promise is wrapped, because an async function would wait for it. Just
   * before the release, it adds "released the lock" to the calls, so a test
   * can check that a script made its calls after the release.
   */
  async holdLock(ms) {
    const ready = path.join(this.stubDir, "lock-held");
    const holder = spawn("flock", [
      path.join(this.root, ".lock"),
      "sh",
      "-c",
      `touch "$0"; sleep ${ms / 1000}; echo "released the lock" >>"$1"`,
      ready,
      path.join(this.stubDir, "calls"),
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
