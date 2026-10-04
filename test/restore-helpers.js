/** Helpers shared by the meals-restore test files. */
import assert from "node:assert/strict";
import { DATA } from "./host-helpers.js";

/** The backup that the meals-restore tests restore. */
export const BACKUP = "2026-10-01T033000Z-daily-v0.2.0.tar.gz";

/** Fails unless the data directory of HOST holds exactly DATA. */
export async function assertOriginalData(host) {
  for (const [relPath, content] of Object.entries(DATA)) {
    assert.equal(await host.readData(relPath), content, relPath);
  }
  assert.equal(await host.exists("data/v2/weeks/2026-09-28.json"), false);
}
