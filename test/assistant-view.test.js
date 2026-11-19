import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  attachmentProblem,
  displayedWeek,
  eventText,
  groupPending,
  hasMark,
  isMealPlan,
  pendingDetail,
  problemCount,
  summarize,
  summaryLine,
  weekLinkText,
  withoutBold,
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

    assert.deepEqual(summarize(pending), ["Week of Nov 16: 2 slots", "Week of Nov 23: 1 slot"]);
  });

  test("counts the recipes and the ingredients of each action", () => {
    const pending = [
      recipe("create", "A"),
      recipe("create", "B"),
      recipe("change", "C"),
      recipe("change", "D"),
      recipe("archive", "E"),
      recipe("archive", "F"),
      recipe("restore", "G"),
      recipe("restore", "H"),
      ingredient("create", "I"),
      ingredient("create", "J"),
      ingredient("change", "K"),
      ingredient("change", "L"),
      ingredient("archive", "M"),
      ingredient("archive", "N"),
      ingredient("restore", "O"),
      ingredient("restore", "P"),
    ];

    assert.deepEqual(summarize(pending), [
      "2 new recipes",
      "2 changed recipes",
      "2 archived recipes",
      "2 restored recipes",
      "2 new ingredients",
      "2 changed ingredients",
      "2 archived ingredients",
      "2 restored ingredients",
    ]);
  });

  test("uses the singular for one recipe or ingredient", () => {
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

    assert.deepEqual(summarize(pending), [
      "1 new recipe",
      "1 changed recipe",
      "1 archived recipe",
      "1 restored recipe",
      "1 new ingredient",
      "1 changed ingredient",
      "1 archived ingredient",
      "1 restored ingredient",
    ]);
  });

  test("lists weeks, then recipes, then ingredients, each by action", () => {
    const pending = [
      ingredient("restore", "Salt"),
      recipe("archive", "Toast"),
      ingredient("create", "Pumpkin"),
      menu("2026-11-23", "mon", "lunch"),
      recipe("create", "Soup"),
      menu("2026-11-16", "mon", "lunch"),
    ];

    assert.deepEqual(summarize(pending), [
      "Week of Nov 16: 1 slot",
      "Week of Nov 23: 1 slot",
      "1 new recipe",
      "1 archived recipe",
      "1 new ingredient",
      "1 restored ingredient",
    ]);
  });

  test("leaves out the actions without changes", () => {
    const pending = [
      recipe("create", "Soup"),
      recipe("create", "Stew"),
      ingredient("change", "Salt"),
    ];

    assert.deepEqual(summarize(pending), ["2 new recipes", "1 changed ingredient"]);
  });
});

describe("summaryLine", () => {
  test("joins the counts in one line, with the slots of every week together", () => {
    const pending = [
      menu("2026-11-23", "mon", "lunch"),
      recipe("create", "Soup"),
      menu("2026-11-16", "mon", "lunch"),
      ingredient("archive", "Salt"),
      menu("2026-11-16", "tue", "dinner"),
    ];

    assert.equal(summaryLine(pending), "3 slots, 1 new recipe, 1 archived ingredient");
  });

  test("leaves out the slots when no menu is pending", () => {
    assert.equal(summaryLine([recipe("change", "Toast")]), "1 changed recipe");
  });
});

describe("groupPending", () => {
  /** The headings of the groups, each with the targets of its changes. */
  function outline(groups) {
    return groups.map(({ heading, changes }) => [heading, changes.map((view) => view.target)]);
  }

  test("groups the changes under the lines of the summary, in its order", () => {
    const pending = [
      ingredient("restore", "Salt"),
      recipe("archive", "Toast"),
      menu("2026-11-23", "mon", "lunch"),
      ingredient("create", "Pumpkin"),
      recipe("create", "Soup"),
      menu("2026-11-16", "mon", "lunch"),
      recipe("create", "Stew"),
    ];

    assert.deepEqual(outline(groupPending(pending)), [
      ["Week of Nov 16: 1 slot", ["menu:2026-11-16/mon/lunch"]],
      ["Week of Nov 23: 1 slot", ["menu:2026-11-23/mon/lunch"]],
      ["2 new recipes", ["recipe:Soup", "recipe:Stew"]],
      ["1 archived recipe", ["recipe:Toast"]],
      ["1 new ingredient", ["ingredient:Pumpkin"]],
      ["1 restored ingredient", ["ingredient:Salt"]],
    ]);
  });

  test("orders the slots of a week by day, and then by meal", () => {
    const pending = [
      menu("2026-11-16", "tue", "breakfast"),
      menu("2026-11-16", "mon", "dinner"),
      menu("2026-11-16", "mon", "snack_am"),
    ];

    assert.deepEqual(outline(groupPending(pending)), [
      [
        "Week of Nov 16: 3 slots",
        [
          "menu:2026-11-16/mon/snack_am",
          "menu:2026-11-16/mon/dinner",
          "menu:2026-11-16/tue/breakfast",
        ],
      ],
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

describe("problemCount", () => {
  test("returns nothing when no change has a problem", () => {
    assert.equal(problemCount([recipe("create", "Soup")]), "");
  });

  test("says that one change has a problem", () => {
    const pending = [recipe("create", "Soup"), { ...recipe("create", "Stew"), problem: "Taken." }];
    assert.equal(problemCount(pending), "1 change has a problem");
  });

  test("counts the changes that have a problem", () => {
    const pending = [
      { ...recipe("create", "Soup"), problem: "Taken." },
      recipe("create", "Toast"),
      { ...menu("2026-11-16", "mon", "lunch"), problem: "Changed by hand." },
    ];
    assert.equal(problemCount(pending), "2 changes have a problem");
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

describe("eventText", () => {
  /** The event of an apply that saved `counts`. */
  function applied(counts) {
    return { role: "event", kind: "applied", counts, weeks: [] };
  }

  test("lists the slots, the recipes, and the ingredients of an apply", () => {
    const event = applied({ slots: 35, recipes: 4, ingredients: 6 });
    assert.equal(eventText(event), "Applied: 35 slots, 4 recipes, and 6 ingredients.");
  });

  test("uses the singular for one slot, recipe, or ingredient", () => {
    const event = applied({ slots: 1, recipes: 1, ingredients: 1 });
    assert.equal(eventText(event), "Applied: 1 slot, 1 recipe, and 1 ingredient.");
  });

  test("leaves out the counts of zero", () => {
    assert.equal(
      eventText(applied({ slots: 0, recipes: 2, ingredients: 0 })),
      "Applied: 2 recipes.",
    );
    assert.equal(
      eventText(applied({ slots: 3, recipes: 0, ingredients: 1 })),
      "Applied: 3 slots and 1 ingredient.",
    );
  });

  test("says that an apply of nothing applied the pending changes", () => {
    const event = applied({ slots: 0, recipes: 0, ingredients: 0 });
    assert.equal(eventText(event), "Applied the pending changes.");
  });

  test("says that a discard discarded the pending changes", () => {
    const event = { role: "event", kind: "discarded" };
    assert.equal(eventText(event), "Discarded the pending changes.");
  });
});

describe("weekLinkText", () => {
  test("names the week by its Monday", () => {
    assert.equal(weekLinkText("2026-11-16"), "Show the week of Nov 16");
  });
});

describe("isMealPlan", () => {
  test("accepts the meal plan at / and at /index.html", () => {
    assert.equal(isMealPlan({ pathname: "/" }), true);
    assert.equal(isMealPlan({ pathname: "/index.html" }), true);
  });

  test("rejects another page", () => {
    assert.equal(isMealPlan({ pathname: "/recipes.html" }), false);
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
    const files = [file("menu.pdf", 10 * MB), file("a.png", 7 * MB, "image/png")];
    assert.equal(attachmentProblem(files, 3 * MB), undefined);
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

  test("rejects a JPEG or a PNG larger than 7 MB", () => {
    for (const type of ["image/jpeg", "image/png"]) {
      assert.equal(
        attachmentProblem([file("menu.jpg", 7 * MB + 1, type)], 0),
        '"menu.jpg" is an image larger than 7 MB.',
        type,
      );
    }
  });

  test("rejects files that take the conversation beyond 20 MB", () => {
    assert.equal(
      attachmentProblem([file("menu.pdf", MB + 1)], 19 * MB),
      "The attachments of a conversation total at most 20 MB. Start a new conversation to attach more.",
    );
  });
});

describe("withoutBold", () => {
  test("removes the bold markers around words and keeps the words", () => {
    assert.equal(
      withoutBold("Plan **Monday** and **Tuesday's dinner**."),
      "Plan Monday and Tuesday's dinner.",
    );
  });

  test("keeps a single asterisk", () => {
    assert.equal(withoutBold("Serve *warm*, 2 * 100 g."), "Serve *warm*, 2 * 100 g.");
  });

  test("keeps a bold marker without its pair", () => {
    assert.equal(withoutBold("Lunch ** dinner"), "Lunch ** dinner");
  });
});
