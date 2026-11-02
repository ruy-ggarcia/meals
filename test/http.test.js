import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import { getJson, REQUEST_TIMEOUT_MS, sendJson } from "../public/http.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  mock.restoreAll();
});

test("the timeout constant is 5 seconds", () => {
  assert.equal(REQUEST_TIMEOUT_MS, 5000);
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
});

test("getJson rejects on a status other than 2xx", async () => {
  mock.method(globalThis, "fetch", async () => jsonResponse(500, { error: "Internal" }));
  await assert.rejects(getJson("/api/recipes"), /HTTP 500/);
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

  test("returns the status and body, whatever the status", async () => {
    mock.method(globalThis, "fetch", async () =>
      jsonResponse(409, { error: "Taken", recipe: { id: "1" } }),
    );

    const result = await sendJson("POST", "/api/recipes", { name: "Soup" });

    assert.deepEqual(result, { status: 409, body: { error: "Taken", recipe: { id: "1" } } });
  });
});

test("sendJson returns an empty body when the response isn't JSON", async () => {
  mock.method(globalThis, "fetch", async () => new Response("Bad gateway", { status: 502 }));
  assert.deepEqual(await sendJson("PATCH", "/api/recipes/1", { archived: true }), {
    status: 502,
    body: {},
  });
});

test("sendJson rejects on a network error", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Network error");
  });
  await assert.rejects(sendJson("POST", "/api/recipes", { name: "Soup" }), TypeError);
});
