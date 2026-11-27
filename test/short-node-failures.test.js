// Tests for the hook in test/hooks/short-node-failures.js, on a stand-in for
// node:assert/strict, made of node:assert's own comparisons, and on
// stand-ins for DOM objects, such as a node, a window, and an event: a real
// one would hang the file if the hook broke. Two tests check the real
// node:assert/strict, which the hook has already patched, preloaded by
// `npm test` or imported by this file.

import nodeAssert from "node:assert";
import assert, * as strictExports from "node:assert/strict";
import { describe, test } from "node:test";
import { shortenNodeFailures } from "./hooks/short-node-failures.js";

/**
 * A stand-in for node:assert/strict, with the comparisons of node:assert,
 * which the hook leaves alone, before `shortenNodeFailures` replaces them.
 */
function fakeStrictAssert() {
  return shortenNodeFailures({
    deepEqual: nodeAssert.deepStrictEqual,
    deepStrictEqual: nodeAssert.deepStrictEqual,
    equal: nodeAssert.strictEqual,
    notDeepEqual: nodeAssert.notDeepStrictEqual,
    notDeepStrictEqual: nodeAssert.notDeepStrictEqual,
    notEqual: nodeAssert.notStrictEqual,
    notStrictEqual: nodeAssert.notStrictEqual,
    strictEqual: nodeAssert.strictEqual,
  });
}

/**
 * A stand-in for an element of a DOM, with the attributes `attributes` and a
 * property that a failure never shows.
 *
 * @param {Record<string, string>} [attributes]
 */
function fakeElement(attributes = {}) {
  return {
    nodeType: 1,
    nodeName: "BUTTON",
    localName: "button",
    attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
    hidden: "INSIDE",
  };
}

/** The error that `fn` throws, which must be an AssertionError. */
function failureOf(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof nodeAssert.AssertionError, `not an AssertionError: ${error}`);
    return error;
  }
  assert.fail("the assertion passed");
}

describe("shortenNodeFailures", () => {
  test("names an element by its start tag when equal fails", () => {
    const failure = failureOf(() => fakeStrictAssert().equal(fakeElement({ class: "send" }), null));

    assert.match(failure.message, /'<button class="send">'/);
  });

  test("keeps the properties of a node out of a failure", () => {
    const failure = failureOf(() => fakeStrictAssert().equal(fakeElement(), null));

    assert.equal(failure.message.includes("INSIDE"), false, failure.message);
    assert.deepEqual([failure.actual, failure.expected], ["<button>", null]);
  });

  test("adds the text of an element, cut to 40 characters, when equal fails", () => {
    const element = { ...fakeElement(), textContent: `  Plan\n  ${"the week ".repeat(9)}` };

    const failure = failureOf(() => fakeStrictAssert().equal(element, null));

    assert.match(failure.message, /'<button> "Plan the week the week the week the wee…"'/);
  });

  test("names a text node by its text when equal fails", () => {
    const text = { nodeType: 3, nodeName: "#text", nodeValue: "Hello" };

    const failure = failureOf(() => fakeStrictAssert().equal(text, null));

    assert.match(failure.message, /'#text "Hello"'/);
  });

  test("names an attribute by its name and value when equal fails", () => {
    // As happy-dom's, whose nodeName is empty.
    const attribute = { nodeType: 2, nodeName: "", name: "class", value: "send" };

    const failure = failureOf(() => fakeStrictAssert().equal(attribute, null));

    assert.deepEqual([failure.actual, failure.expected], ['class="send"', null]);
  });

  test("names a window by its address when equal fails", () => {
    const window = { location: { href: "http://localhost/" }, hidden: "INSIDE" };
    Object.assign(window, { window, document: { nodeType: 9, nodeName: "#document" } });

    const failure = failureOf(() => fakeStrictAssert().equal(window, null));

    assert.match(failure.message, /'\[window http:\/\/localhost\/\]'/);
  });

  test("names an object that holds a node by its class when equal fails", () => {
    // As a happy-dom event holds its target, under a symbol.
    class Event {
      constructor() {
        this[Symbol("target")] = fakeElement();
        this.hidden = "INSIDE";
      }
    }

    const failure = failureOf(() => fakeStrictAssert().equal(new Event(), null));

    assert.deepEqual([failure.actual, failure.expected], ["[Event]", null]);
  });

  test("names an object of a document by its class when equal fails", () => {
    // As a happy-dom range reads its document.
    class Range {
      get ownerDocument() {
        return { nodeType: 9, nodeName: "#document" };
      }
    }

    const failure = failureOf(() => fakeStrictAssert().equal(new Range(), null));

    assert.deepEqual([failure.actual, failure.expected], ["[Range]", null]);
  });

  test("names a proxy by its class when equal fails", () => {
    // As a happy-dom style, whose own keys don't show what it holds.
    class CSSStyleDeclaration {}
    const style = new Proxy(new CSSStyleDeclaration(), {});

    const failure = failureOf(() => fakeStrictAssert().equal(style, null));

    assert.deepEqual([failure.actual, failure.expected], ["[CSSStyleDeclaration]", null]);
  });

  test("names the nodes in an array when deepEqual fails", () => {
    const failure = failureOf(() => fakeStrictAssert().deepEqual([fakeElement()], []));

    assert.match(failure.message, /'<button>'/);
    assert.equal(failure.message.includes("INSIDE"), false, failure.message);
  });

  test("names the nodes in an object when deepEqual fails", () => {
    const failure = failureOf(() =>
      fakeStrictAssert().deepEqual({ button: fakeElement() }, { button: null }),
    );

    assert.match(failure.message, /button: '<button>'/);
    assert.equal(failure.message.includes("INSIDE"), false, failure.message);
  });

  test("names a node when notEqual of the node with itself fails", () => {
    const element = fakeElement();

    const failure = failureOf(() => fakeStrictAssert().notEqual(element, element));

    assert.match(failure.message, /'<button>'/);
    assert.equal(failure.message.includes("INSIDE"), false, failure.message);
  });

  test("keeps the message of the test when equal of a node fails", () => {
    const failure = failureOf(() =>
      fakeStrictAssert().equal(fakeElement(), null, "the page has a button"),
    );

    assert.match(failure.message, /^the page has a button/);
  });

  test("throws the Error that the test gives when equal of a node fails", () => {
    const error = new Error("the page has a button");

    assert.throws(
      () => fakeStrictAssert().equal(fakeElement(), null, error),
      (thrown) => thrown === error,
    );
  });

  test("passes equal of a node with itself", () => {
    const element = fakeElement();

    fakeStrictAssert().equal(element, element);
  });

  test("never looks into the values of a passing comparison", () => {
    let reads = 0;
    // Counts each look at the document of a value, which the check for DOM
    // objects does.
    class Value {
      get ownerDocument() {
        reads += 1;
        return undefined;
      }
    }
    const strictAssert = fakeStrictAssert();
    const bytes = new Uint8Array(1024 * 1024);

    strictAssert.equal(bytes, bytes);
    strictAssert.deepEqual(new Value(), new Value());
    strictAssert.deepEqual([new Value()], [new Value()]);

    assert.equal(reads, 0);
  });

  test("never looks into a typed array of a failure", () => {
    let reads = 0;
    class Bytes extends Uint8Array {
      get ownerDocument() {
        reads += 1;
        return undefined;
      }
    }

    failureOf(() => fakeStrictAssert().deepEqual(new Bytes([1]), new Bytes([2])));

    assert.equal(reads, 0);
  });

  test("leaves a failure of typed arrays as Node.js words it", () => {
    const [actual, expected] = [new Uint8Array([1, 2]), new Uint8Array([1, 3])];

    const failure = failureOf(() => fakeStrictAssert().deepEqual(actual, expected));

    assert.equal(
      failure.message,
      failureOf(() => nodeAssert.deepStrictEqual(actual, expected)).message,
    );
  });

  test("leaves a failure without nodes as Node.js words it", () => {
    const symbol = Symbol("s");
    // NaN isn't === to itself, so a check with === would take it for a
    // node, and word the failure from a copy, without the symbol keys.
    const cases = [
      [{ a: [1] }, { a: [2] }],
      [
        { a: NaN, [symbol]: 1 },
        { a: NaN, [symbol]: 2 },
      ],
    ];

    for (const [actual, expected] of cases) {
      const failure = failureOf(() => fakeStrictAssert().deepEqual(actual, expected));

      assert.equal(
        failure.message,
        failureOf(() => nodeAssert.deepStrictEqual(actual, expected)).message,
      );
    }
  });

  test("shortens the failures of the real node:assert/strict", () => {
    const failure = failureOf(() => assert.equal(fakeElement(), null));

    assert.deepEqual([failure.actual, failure.expected], ["<button>", null]);
  });

  test("exports the shortened comparisons of node:assert/strict by name", () => {
    assert.equal(strictExports.equal, assert.equal);
    assert.equal(strictExports.deepEqual, assert.deepEqual);
  });
});
