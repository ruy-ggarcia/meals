import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_ITEMS as CLIENT_MAX_ITEMS,
  MAX_SERVINGS as CLIENT_MAX_SERVINGS,
  MIN_SERVINGS as CLIENT_MIN_SERVINGS,
} from "../public/menus.js";
import {
  MAX_INGREDIENTS as CLIENT_MAX_INGREDIENTS,
  MAX_QUANTITY as CLIENT_MAX_QUANTITY,
  MIN_QUANTITY as CLIENT_MIN_QUANTITY,
} from "../public/quantities.js";
import {
  MAX_INGREDIENTS as SERVER_MAX_INGREDIENTS,
  MAX_QUANTITY as SERVER_MAX_QUANTITY,
  MIN_QUANTITY as SERVER_MIN_QUANTITY,
} from "../server/recipes.js";
import {
  MAX_ITEMS as SERVER_MAX_ITEMS,
  MAX_SERVINGS as SERVER_MAX_SERVINGS,
  MIN_SERVINGS as SERVER_MIN_SERVINGS,
} from "../server/weeks.js";

test("the client's menu limits equal the server's", () => {
  assert.equal(CLIENT_MAX_ITEMS, SERVER_MAX_ITEMS);
  assert.equal(CLIENT_MIN_SERVINGS, SERVER_MIN_SERVINGS);
  assert.equal(CLIENT_MAX_SERVINGS, SERVER_MAX_SERVINGS);
});

test("the client's recipe limits equal the server's", () => {
  assert.equal(CLIENT_MAX_INGREDIENTS, SERVER_MAX_INGREDIENTS);
  assert.equal(CLIENT_MIN_QUANTITY, SERVER_MIN_QUANTITY);
  assert.equal(CLIENT_MAX_QUANTITY, SERVER_MAX_QUANTITY);
});
