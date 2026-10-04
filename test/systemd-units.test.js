import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const UNITS = path.join(REPO, "deploy", "systemd");

/**
 * Parses the unit file NAME into { section: { key: [values] } }. Comments and
 * blank lines don't count, and a key keeps every value it's given.
 */
async function readUnit(name) {
  const unit = {};
  let section;
  for (const line of (await readFile(path.join(UNITS, name), "utf8")).split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const header = trimmed.match(/^\[(.+)\]$/);
    if (header) {
      unit[header[1]] ??= {};
      section = unit[header[1]];
      continue;
    }
    const [, key, value] = trimmed.match(/^([^=]+?)\s*=\s*(.*)$/);
    section[key] ??= [];
    section[key].push(value);
  }
  return unit;
}

/** The directory where scripts/install.sh installs the host tools. */
async function installRoot() {
  const install = await readFile(path.join(REPO, "scripts", "install.sh"), "utf8");
  return install.match(/^readonly ROOT=(.+)$/m)[1];
}

const SERVICES = {
  "meals-backup": { args: " daily", docker: false, timeout: "30min" },
  "meals-deploy": { args: "", docker: true, timeout: "15min" },
  "meals-restore-check": { args: "", docker: true, timeout: "15min" },
};

const TIMERS = {
  "meals-backup": { OnCalendar: ["*-*-* 03:30:00"], Persistent: ["true"] },
  "meals-deploy": { OnBootSec: ["2min"], OnUnitActiveSec: ["5min"] },
  "meals-restore-check": { OnCalendar: ["Sun *-*-* 04:00:00"], Persistent: ["true"] },
};

test("deploy/systemd has a service and a timer for each host script that runs on a schedule", async () => {
  const expected = Object.keys(SERVICES).flatMap((name) => [`${name}.service`, `${name}.timer`]);

  assert.deepEqual((await readdir(UNITS)).sort(), expected.sort());
});

for (const [name, { args, docker, timeout }] of Object.entries(SERVICES)) {
  test(`${name}.service runs the installed script once as deployer, with a start timeout`, async () => {
    const { Service, Unit } = await readUnit(`${name}.service`);

    assert.deepEqual(Service, {
      ExecStart: [`${await installRoot()}/scripts/${name}${args}`],
      Group: ["docker"],
      TimeoutStartSec: [timeout],
      Type: ["oneshot"],
      UMask: ["0002"],
      User: ["deployer"],
    });
    const after = (Unit.After ?? []).flatMap((value) => value.split(/\s+/));
    assert.equal(after.includes("docker.service"), docker, "After=docker.service");
  });

  test(`${name}.service starts a script that scripts/install.sh installs and can run`, async () => {
    // install.sh installs scripts/meals-* with mode 0775, whatever the mode
    // in the checkout, so a script that isn't executable here is a mistake.
    await access(path.join(REPO, "scripts", name), constants.X_OK);
  });
}

for (const [name, schedule] of Object.entries(TIMERS)) {
  test(`${name}.timer starts its service on schedule once install.sh enables it`, async () => {
    const { Install, Timer } = await readUnit(`${name}.timer`);

    assert.deepEqual(Timer, schedule);
    assert.deepEqual(Install, { WantedBy: ["timers.target"] });
  });
}
