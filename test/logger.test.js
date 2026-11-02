import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createLogger } from "../server/logger.js";

describe("createLogger", () => {
  test("writes each entry as one line that ends with a newline", () => {
    const lines = [];
    const logger = createLogger((line) => lines.push(line));

    logger.info("server started", { port: 3000 });
    logger.error("shutdown timed out");

    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.ok(line.endsWith("\n"), "each entry ends its line");
      assert.ok(!line.slice(0, -1).includes("\n"), "each entry takes one line");
      assert.doesNotThrow(() => JSON.parse(line), "each line is JSON");
    }
  });

  test("writes the time, level, msg, and fields of an entry, in that order", () => {
    const lines = [];
    const logger = createLogger((line) => lines.push(line));

    logger.info("server started", { port: 3000 });

    const entry = JSON.parse(lines[0]);
    assert.deepEqual(Object.keys(entry), ["time", "level", "msg", "port"]);
    assert.equal(new Date(entry.time).toISOString(), entry.time);
    assert.deepEqual(
      { ...entry, time: "TIME" },
      { time: "TIME", level: "info", msg: "server started", port: 3000 },
    );
  });

  test("writes only the time, level, and msg of an entry without fields", () => {
    const lines = [];
    const logger = createLogger((line) => lines.push(line));

    logger.error("shutdown timed out");

    assert.deepEqual(
      { ...JSON.parse(lines[0]), time: "TIME" },
      { time: "TIME", level: "error", msg: "shutdown timed out" },
    );
  });
});
