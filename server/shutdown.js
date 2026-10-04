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
