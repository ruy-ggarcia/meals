// Preloaded with `node --import` by `npm test`, after test-timeout.js. Makes
// a failed comparison of node:assert/strict on a DOM object end as fast as
// any other failure.
//
// A failed comparison of node:assert on a happy-dom node, or on another
// object that reaches one, such as an event or a style, blocks the process:
// Node.js formats the value to 1,000 levels, which reaches the whole
// document and window, and then diffs the lines of the two values, with
// memory that grows with the square of their number, until the system kills
// the process. The time limit of a test and the watchdog of test-timeout.js
// are timers of the same process, so they can't end it.
//
// The hook wraps the comparisons of node:assert/strict. A wrapped comparison
// first passes the `FAILED` sentinel as the message, which node:assert
// throws as it is, without formatting the values. Only after a failure does
// it put a short text in place of each DOM object, in arrays and plain
// objects 3 levels deep, and throw its own AssertionError.
// `syncBuiltinESMExports()` makes `import { equal } from
// "node:assert/strict"` return the wrapped functions. Importing this file
// patches node:assert/strict once per process, wherever it's imported, as in
// its own tests.
//
// See docs/testing.md for what a test writer needs to know.

import { AssertionError } from "node:assert";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { types } from "node:util";

/** The comparisons of node:assert/strict that format their values. */
const COMPARISONS = [
  "deepEqual",
  "deepStrictEqual",
  "equal",
  "notDeepEqual",
  "notDeepStrictEqual",
  "notEqual",
  "notStrictEqual",
  "strictEqual",
];

/** What a comparison throws in place of its own error when it fails. */
const FAILED = new Error("The comparison failed.");

/** How deep in arrays and plain objects a failure looks for DOM objects. */
const MAX_NESTING = 3;

const ELEMENT_NODE = 1;
const ATTRIBUTE_NODE = 2;

/** Whether `value` is a node of a DOM, such as an element or a document. */
function isNode(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.nodeType === "number" &&
    typeof value.nodeName === "string"
  );
}

/** Whether `value` is the window of a DOM. */
function isWindow(value) {
  return (
    typeof value === "object" && value !== null && value.window === value && isNode(value.document)
  );
}

/**
 * Whether `value` is another object of a DOM, which reaches a node: an
 * object of a class whose `ownerDocument` or `document` is a node, such as a
 * range, or that holds a node or a window in a property of its own, also
 * under a symbol, such as an event or a node list. A proxy of an object of
 * a class counts too, as its own keys don't show what it holds: happy-dom
 * makes a style and a class list proxies of objects that hold their
 * element. A proxy of an array or a plain object counts as one, and the
 * hook looks into it.
 *
 * @param {any} value
 */
function isDomObject(value) {
  if (typeof value !== "object" || value === null || isPlain(value)) return false;
  // Bytes, such as the data of an attachment, hold no DOM object, and the
  // walk below would visit each of them.
  if (ArrayBuffer.isView(value) || types.isAnyArrayBuffer(value)) return false;
  if (types.isProxy(value)) return true;
  if (isNode(value.ownerDocument) || isNode(value.document)) return true;
  return Reflect.ownKeys(value).some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor?.enumerable === true && (isNode(descriptor.value) || isWindow(descriptor.value))
    );
  });
}

/** Whether `value` is an array or an object made by `{}`. */
function isPlain(value) {
  if (Array.isArray(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** The most characters of a node's text that a failure shows. */
const MAX_TEXT = 40;

/**
 * `text`, with its spaces collapsed, cut to `MAX_TEXT` characters, quoted,
 * and after a space, or nothing when it's blank or not a string.
 *
 * @param {unknown} text
 */
function shortText(text) {
  const plain = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (plain === "") return "";
  return ` ${JSON.stringify(plain.length > MAX_TEXT ? `${plain.slice(0, MAX_TEXT - 1)}…` : plain)}`;
}

/**
 * A short text for `node`: an element's start tag and text, as `<button
 * class="send"> "Send"`, an attribute's name and value, as `class="send"`,
 * or another node's name and text, as `#text "Hello"`.
 *
 * @param {any} node
 */
function describeNode(node) {
  if (node.nodeType === ATTRIBUTE_NODE) return `${node.name}="${node.value}"`;
  if (node.nodeType !== ELEMENT_NODE) return `${node.nodeName}${shortText(node.nodeValue)}`;
  const attributes = Array.from(
    node.attributes ?? [],
    (/** @type {any} */ { name, value }) => ` ${name}="${value}"`,
  ).join("");
  return `<${node.localName}${attributes}>${shortText(node.textContent)}`;
}

/**
 * `value` with a short text in place of each node, window, and other object
 * of a DOM, also in arrays and plain objects, `MAX_NESTING` levels deep.
 * Returns `value` itself when it holds none.
 *
 * @param {any} value
 * @param {number} [nesting]
 */
function withoutNodes(value, nesting = 0) {
  if (isNode(value)) return describeNode(value);
  if (isWindow(value)) return `[window ${value.location?.href}]`;
  if (isDomObject(value)) return `[${value.constructor?.name ?? "Object"}]`;
  if (nesting === MAX_NESTING || !isPlain(value)) return value;
  const entries = Object.entries(value);
  const shown = entries.map(([key, item]) => [key, withoutNodes(item, nesting + 1)]);
  if (shown.every(([, item], index) => Object.is(item, entries[index][1]))) return value;
  return Array.isArray(value) ? shown.map(([, item]) => item) : Object.fromEntries(shown);
}

/**
 * `compare`, a comparison of node:assert/strict, which fails with a short
 * text in place of each DOM object of its values, and otherwise as
 * `compare` does.
 *
 * @param {(...args: any[]) => void} compare
 */
function withShortNodes(compare) {
  /** @this {any} */
  function shortened(/** @type {any[]} */ ...args) {
    const [actual, expected, message] = args;
    if (args.length < 2 || message instanceof Error) return compare.apply(this, args);
    // node:assert throws an Error that it gets as the message as it is, without
    // formatting the values, so FAILED tells whether the comparison failed.
    // Only then does the hook look for DOM objects, so a passing comparison
    // costs nothing more.
    try {
      return compare.call(this, actual, expected, FAILED);
    } catch (error) {
      if (error !== FAILED) throw error;
    }
    const shownActual = withoutNodes(actual);
    const shownExpected = withoutNodes(expected);
    if (Object.is(shownActual, actual) && Object.is(shownExpected, expected)) {
      return compare.apply(this, args);
    }
    throw new AssertionError({
      actual: shownActual,
      expected: shownExpected,
      message,
      operator: compare.name,
      stackStartFn: shortened,
    });
  }
  return shortened;
}

/**
 * Replaces the comparisons of `strictAssert`, the default export of
 * node:assert/strict, such as `equal()` and `deepEqual()`, with ones that
 * fail with a short text in place of each DOM object, and returns it.
 *
 * @param {any} strictAssert
 */
export function shortenNodeFailures(strictAssert) {
  for (const name of COMPARISONS) strictAssert[name] = withShortNodes(strictAssert[name]);
  return strictAssert;
}

const require = createRequire(import.meta.url);
shortenNodeFailures(require("node:assert/strict"));
syncBuiltinESMExports();
