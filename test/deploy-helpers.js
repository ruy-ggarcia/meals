/** Helpers shared by the meals-deploy test files. */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { withMode } from "./host-helpers.js";

/** An on-up stub that rewrites the recipe book when VERSION starts. */
export function migrateOnUp(version) {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `if grep -qx 'MEALS_VERSION=${version}' "$MEALS_ROOT/.env"; then`,
    `  echo '{ "recipes": "migrated" }' > "$MEALS_ROOT/data/v2/recipes.json"`,
    "fi",
    "",
  ].join("\n");
}

/** Makes writing .env fail on HOST: its temporary file is a directory. */
export function blockEnvWrite(host) {
  return mkdir(path.join(host.root, ".env.tmp"));
}

/**
 * Runs meals-deploy on HOST with ARGS while backups/ is read-only, so the
 * pre-deploy backup fails.
 */
export function runWithReadOnlyBackups(host, ...args) {
  return withMode(path.join(host.root, "backups"), 0o555, () => host.run("meals-deploy", ...args));
}

/** The docker calls that the stubs logged on HOST, in order. */
export async function dockerCalls(host) {
  return (await host.calls()).filter((call) => call.startsWith("docker "));
}
