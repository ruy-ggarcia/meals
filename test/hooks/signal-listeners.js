// Preloaded with `node --import` by test/server.test.js. When the process
// writes its "server started" line, this hook first writes a line to standard
// error with the number of SIGINT and SIGTERM listeners at that moment, so a
// test can tell whether the process was ready for a signal when it said that
// it started.

const write = process.stdout.write.bind(process.stdout);

process.stdout.write = /** @type {any} */ (
  (/** @type {any} */ chunk, /** @type {any[]} */ ...args) => {
    if (String(chunk).includes('"server started"')) {
      const listeners = {
        SIGINT: process.listenerCount("SIGINT"),
        SIGTERM: process.listenerCount("SIGTERM"),
      };
      process.stderr.write(`${JSON.stringify({ listeners })}\n`);
    }
    return write(chunk, ...args);
  }
);
