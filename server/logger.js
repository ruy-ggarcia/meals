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
