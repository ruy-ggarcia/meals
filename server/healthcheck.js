// The image's HEALTHCHECK: exits with 0 when /api/health returns a 2xx
// status, and with 1 otherwise, so the image needs no curl or wget. It calls
// process.exit because an open keep-alive connection would keep it running.

const port = process.env.PORT || 3000;

try {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(2000),
  });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
