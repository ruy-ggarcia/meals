import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import { getJson, REQUEST_TIMEOUT_MS, sendJson, UPLOAD_TIMEOUT_MS } from "../public/http.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  mock.restoreAll();
});

describe("public/http.js", () => {
  test("has a request timeout of 5 seconds", () => {
    assert.equal(REQUEST_TIMEOUT_MS, 5000);
  });

  test("has an upload timeout of 2 minutes", () => {
    assert.equal(UPLOAD_TIMEOUT_MS, 120000);
  });
});

describe("getJson", () => {
  test("returns the parsed body", async () => {
    mock.method(globalThis, "fetch", async () => jsonResponse(200, { recipes: [] }));

    assert.deepEqual(await getJson("/api/recipes"), { recipes: [] });
  });

  test("requests the URL with a timeout signal", async () => {
    const fetch = mock.method(globalThis, "fetch", async () => jsonResponse(200, { recipes: [] }));

    await getJson("/api/recipes");

    const [url, options] = fetch.mock.calls[0].arguments;
    assert.equal(url, "/api/recipes");
    assert.ok(options.signal instanceof AbortSignal, "the request has a timeout signal");
  });

  test("rejects when the status isn't 2xx", async () => {
    mock.method(globalThis, "fetch", async () => jsonResponse(500, { error: "Internal" }));
    await assert.rejects(getJson("/api/recipes"), /HTTP 500/);
  });

  test("rejects with the status of the response", async () => {
    mock.method(globalThis, "fetch", async () => jsonResponse(404, { error: "Not found" }));
    await assert.rejects(getJson("/api/recipes"), { status: 404 });
  });
});

describe("sendJson", () => {
  test("sends the method, the content type, and the body as JSON", async () => {
    const fetch = mock.method(globalThis, "fetch", async () => jsonResponse(201, { id: "1" }));

    await sendJson("POST", "/api/recipes", { name: "Soup" });

    const [url, options] = fetch.mock.calls[0].arguments;
    assert.equal(url, "/api/recipes");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.equal(options.body, '{"name":"Soup"}');
    assert.ok(options.signal instanceof AbortSignal, "the request has a timeout signal");
  });

  test("gives up after the request timeout by default", async () => {
    mock.method(globalThis, "fetch", async () => jsonResponse(200, {}));
    const timeout = mock.method(AbortSignal, "timeout");

    await sendJson("POST", "/api/recipes", { name: "Soup" });

    assert.deepEqual(timeout.mock.calls[0].arguments, [5000]);
  });

  test("gives up after the timeout that the caller asks for", async () => {
    mock.method(globalThis, "fetch", async () => jsonResponse(202, {}));
    const timeout = mock.method(AbortSignal, "timeout");

    await sendJson("POST", "/api/assistant/conversations/1/messages", {}, { timeoutMs: 120000 });

    assert.deepEqual(timeout.mock.calls[0].arguments, [120000]);
  });

  test("returns the status and body, whatever the status", async () => {
    mock.method(globalThis, "fetch", async () =>
      jsonResponse(409, { error: "Taken", recipe: { id: "1" } }),
    );

    const result = await sendJson("POST", "/api/recipes", { name: "Soup" });

    assert.deepEqual(result, { status: 409, body: { error: "Taken", recipe: { id: "1" } } });
  });

  test("returns an empty body when the response isn't JSON", async () => {
    mock.method(globalThis, "fetch", async () => new Response("Bad gateway", { status: 502 }));
    assert.deepEqual(await sendJson("PATCH", "/api/recipes/1", { archived: true }), {
      status: 502,
      body: {},
    });
  });

  test("rejects when the network fails", async () => {
    mock.method(globalThis, "fetch", async () => {
      throw new TypeError("Network error");
    });
    await assert.rejects(sendJson("POST", "/api/recipes", { name: "Soup" }), TypeError);
  });
});
