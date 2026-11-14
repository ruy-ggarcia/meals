import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  attachmentProblem,
  displayedWeek,
  hasMark,
  pendingDetail,
  summarize,
} from "../public/assistant-view.js";

const MB = 1024 * 1024;

/** A pending menu of `week`, as the server describes it. */
function menu(week, day, meal, items = []) {
  return { target: `menu:${week}/${day}/${meal}`, kind: "menu", week, day, meal, items };
}

/** A pending recipe, as the server describes it. */
function recipe(action, name, ingredients = []) {
  return { target: `recipe:${name}`, kind: "recipe", action, name, ingredients };
}

/** A pending ingredient, as the server describes it. */
function ingredient(action, name, unit = "g", measures = []) {
  return { target: `ingredient:${name}`, kind: "ingredient", action, name, unit, measures };
}

/** A file as the browser describes it. */
function file(name, size, type = "application/pdf") {
  return { name, size, type };
}

describe("summarize", () => {
  test("returns no line without pending changes", () => {
    assert.deepEqual(summarize([]), []);
  });

  test("counts the slots of each week, from the earliest week", () => {
    const pending = [
      menu("2026-11-23", "mon", "lunch"),
      menu("2026-11-16", "mon", "lunch"),
      menu("2026-11-16", "tue", "dinner"),
    ];

    assert.deepEqual(summarize(pending), [
      { label: "Week of Nov 16", detail: "2 slots" },
      { label: "Week of Nov 23", detail: "1 slot" },
    ]);
  });

  test("names what each change does to a recipe or an ingredient", () => {
    const pending = [
      recipe("create", "A"),
      recipe("change", "B"),
      recipe("archive", "C"),
      recipe("restore", "D"),
      ingredient("create", "E"),
      ingredient("change", "F"),
      ingredient("archive", "G"),
      ingredient("restore", "H"),
    ];

    assert.deepEqual(
      summarize(pending).map((line) => line.label),
      [
        "New recipe",
        "Changed recipe",
        "Archived recipe",
        "Restored recipe",
        "New ingredient",
        "Changed ingredient",
        "Archived ingredient",
        "Restored ingredient",
      ],
    );
  });

  test("lists weeks, then recipes, then ingredients, each from A to Z", () => {
    const pending = [
      ingredient("create", "pumpkin"),
      recipe("create", "Soup"),
      menu("2026-11-16", "mon", "lunch"),
      ingredient("change", "Carrot"),
      recipe("archive", "Éclair"),
    ];

    assert.deepEqual(summarize(pending), [
      { label: "Week of Nov 16", detail: "1 slot" },
      { label: "Archived recipe", detail: "Éclair" },
      { label: "New recipe", detail: "Soup" },
      { label: "Changed ingredient", detail: "Carrot" },
      { label: "New ingredient", detail: "pumpkin" },
    ]);
  });
});

describe("pendingDetail", () => {
  test("shows the slot of a menu with its recipes and servings", () => {
    const view = menu("2026-11-16", "tue", "dinner", [
      { name: "Pumpkin soup", servings: 2 },
      { name: "Bread", servings: 0.5 },
    ]);

    assert.deepEqual(pendingDetail(view), {
      title: "Tuesday, Nov 17 · Dinner",
      lines: ["Pumpkin soup × 2", "Bread × 0.5"],
    });
  });

  test("says that a menu is empty", () => {
    assert.deepEqual(pendingDetail(menu("2026-11-16", "sun", "snack_am")).lines, ["Empty"]);
  });

  test("shows a new or changed recipe with its ingredients per serving", () => {
    const view = recipe("create", "Pumpkin soup", [
      { name: "Pumpkin", quantity: 200, unit: "g" },
      { name: "Onion", quantity: 0.5, unit: "medium" },
    ]);

    assert.deepEqual(pendingDetail(view), {
      title: "New recipe: Pumpkin soup",
      lines: ["Pumpkin: 200 g", "Onion: 0.5 medium"],
    });
  });

  test("says that a recipe has no ingredients", () => {
    assert.deepEqual(pendingDetail(recipe("change", "Toast")).lines, ["No ingredients"]);
  });

  test("shows a new or changed ingredient with its unit and measures", () => {
    const view = ingredient("change", "Onion", "g", [{ name: "medium", amount: 150 }]);

    assert.deepEqual(pendingDetail(view), {
      title: "Changed ingredient: Onion",
      lines: ["Unit: g", "medium: 150 g"],
    });
  });

  test("shows only the name of an archived or restored entry", () => {
    const archived = recipe("archive", "Toast", [{ name: "Bread", quantity: 1, unit: "pcs" }]);
    const restored = ingredient("restore", "Bread", "pcs");

    assert.deepEqual(pendingDetail(archived), { title: "Archived recipe: Toast", lines: [] });
    assert.deepEqual(pendingDetail(restored), { title: "Restored ingredient: Bread", lines: [] });
  });
});

describe("hasMark", () => {
  const reply = { role: "assistant", text: "Done." };
  const question = { role: "user", text: "Plan next week." };

  test("marks a reply that isn't seen while collapsed", () => {
    const messages = [question, reply];
    assert.equal(hasMark({ open: false, messages, seen: 0, pending: [] }), true);
  });

  test("doesn't mark replies that were seen", () => {
    const messages = [question, reply, question];
    assert.equal(hasMark({ open: false, messages, seen: 1, pending: [] }), false);
  });

  test("marks pending changes while collapsed", () => {
    const pending = [recipe("create", "Soup")];
    assert.equal(hasMark({ open: false, messages: [], seen: 0, pending }), true);
  });

  test("never marks an open window", () => {
    const pending = [recipe("create", "Soup")];
    assert.equal(hasMark({ open: true, messages: [reply], seen: 0, pending }), false);
  });
});

describe("displayedWeek", () => {
  test("returns the week in the hash of the meal plan", () => {
    assert.equal(displayedWeek({ pathname: "/", hash: "#2026-11-16" }), "2026-11-16");
    assert.equal(displayedWeek({ pathname: "/index.html", hash: "#2026-11-16" }), "2026-11-16");
  });

  test("returns nothing on another page", () => {
    assert.equal(displayedWeek({ pathname: "/recipes.html", hash: "#2026-11-16" }), undefined);
  });

  test("returns nothing when the hash isn't a week", () => {
    assert.equal(displayedWeek({ pathname: "/", hash: "#2026-11-17" }), undefined);
    assert.equal(displayedWeek({ pathname: "/", hash: "" }), undefined);
  });
});

describe("attachmentProblem", () => {
  test("returns nothing for files within the limits", () => {
    const files = [file("menu.pdf", 10 * MB), file("a.jpg", MB, "image/jpeg")];
    assert.equal(attachmentProblem(files, 9 * MB), undefined);
  });

  test("rejects more than 5 attachments", () => {
    const files = Array.from({ length: 6 }, (_, index) => file(`${index}.png`, 1, "image/png"));
    assert.equal(attachmentProblem(files, 0), "A message holds at most 5 attachments.");
  });

  test("rejects a file that isn't a PDF, a JPEG, or a PNG", () => {
    assert.equal(
      attachmentProblem([file("notes.txt", 1, "text/plain")], 0),
      '"notes.txt" isn\'t a PDF, a JPEG, or a PNG.',
    );
  });

  test("leaves a file of unknown type to the server", () => {
    assert.equal(attachmentProblem([file("scan", 1, "")], 0), undefined);
  });

  test("rejects a file larger than 10 MB", () => {
    assert.equal(
      attachmentProblem([file("menu.pdf", 10 * MB + 1)], 0),
      '"menu.pdf" is larger than 10 MB.',
    );
  });

  test("rejects files that take the conversation beyond 20 MB", () => {
    assert.equal(
      attachmentProblem([file("menu.pdf", MB + 1)], 19 * MB),
      "The attachments of a conversation total at most 20 MB. Start a new conversation to attach more.",
    );
  });
});
