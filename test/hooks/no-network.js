// Preloaded with `node --import` by test/server.test.js. The server process
// builds the real providers, so this hook makes `fetch` fail: a test that
// reaches a provider fails instead of calling it.

globalThis.fetch = async () => {
  throw new Error("A test called a real provider.");
};
