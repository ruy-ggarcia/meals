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
  assert.deepEqual(
    { ...timedOut, time: "TIME" },
    { time: "TIME", level: "error", msg: "shutdown timed out" },
  );
});
