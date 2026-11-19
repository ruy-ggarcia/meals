// The assistant on a desktop, against the real server with a scripted
// provider: a week planned and applied, the window across pages, the page
// behind the window, the focus and the skip link, attachments, and what the
// window asks or shows before it loses or saves pending changes, and after
// it saves them. A large plan checks the card of the pending changes and the
// layout of the window at the sizes of phones, tablets, and desktops. At the
// size of a phone, a desktop browser checks the sheet with a keyboard, which
// a phone's browser doesn't have.

import { devices } from "@playwright/test";
import {
  ask,
  assistantButton,
  assistantWindow,
  attachFile,
  LONG_INGREDIENT,
  largePlan,
  messageField,
  openAssistant,
  pendingCard,
  proposeMenus,
  SCHOOL_MENU,
  sendMessage,
} from "./assistant.js";
import { CURRENT_RANGE, CURRENT_WEEK, NEXT_RANGE, NEXT_WEEK } from "./catalog.js";
import { expect, test } from "./fixtures.js";
import { expectFocusTrapped } from "./keyboard.js";
import {
  expectClearOf,
  expectClickableInside,
  expectEachInsideSideways,
  expectInsideViewport,
  expectNoSidewaysScroll,
  expectWrapsInside,
} from "./layout.js";
import { expectWeek, openWeek, slotButton } from "./meal-plan.js";
import { pageLink } from "./navigation.js";
import { expectFillsScreen } from "./phone.js";

const QUESTION = "Plan Monday's lunch and Tuesday's dinner.";
const REPLY = "Here's Monday's lunch and Tuesday's dinner.";

// The assistant proposes two menus of the current week, and then answers.
const PLAN = [
  proposeMenus(CURRENT_WEEK, [
    ["mon", "lunch", { Omelette: 2 }],
    ["tue", "dinner", { "Lentil soup": 1 }],
  ]),
  { text: REPLY },
];

/** Opens the meal plan on the current week, and asks for the plan. */
async function askForPlan(page) {
  await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  await ask(page, QUESTION, REPLY);
  await expect(pendingCard(page)).toBeVisible();
}

const NEXT_QUESTION = "Plan Monday's lunch next week.";
const NEXT_REPLY = "Here's Monday's lunch next week.";

const LARGE_QUESTION = "Plan the whole week, with new recipes.";
const LARGE_REPLY = "Here's the whole week, with four new recipes.";

// The size of an iPhone 15 in landscape, whose screen is 500 px tall or less.
const LANDSCAPE = { width: 734, height: 343 };

// The sizes of the screens that the large plan checks: an iPhone 15 upright
// and in landscape, a small Android phone, the narrowest phone that the app
// supports, a Pixel 7, and two desktops.
const SCREENS = [
  devices["iPhone 15"].viewport,
  LANDSCAPE,
  { width: 360, height: 640 },
  { width: 320, height: 568 },
  devices["Pixel 7"].viewport,
  { width: 1280, height: 720 },
  { width: 1024, height: 600 },
];

/**
 * Opens the meal plan on the current week at the size of `screen`, asks for
 * the large plan, and returns the card of its pending changes, which a
 * screen 500 px tall or less summarizes in one line.
 */
async function askForLargePlan(page, screen) {
  await page.setViewportSize(screen);
  await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
  await ask(page, LARGE_QUESTION, LARGE_REPLY);
  const card = pendingCard(page);
  if (screen.height <= 500) {
    await expect(card.getByText("35 slots, 4 new recipes, 6 new ingredients")).toBeVisible();
  } else {
    await expect(card.getByRole("listitem")).toHaveText([
      "Week of Sep 21: 35 slots",
      "4 new recipes",
      "6 new ingredients",
    ]);
  }
  return card;
}

// Five files, the most that a message holds, with names long enough to fill
// their chips.
const FIVE_FILES = Array.from({ length: 5 }, (_, index) => ({
  ...SCHOOL_MENU,
  name: `school-menu-week-${index + 1}-with-the-dinners.pdf`,
}));

// A message of several lines, as the field grows with them.
const LONG_MESSAGE = [
  "Swap Tuesday's dinner for something lighter.",
  "Keep Friday's lunch.",
  "No fish on Monday.",
  "Use the leftovers on Thursday.",
  "Add a soup to Sunday's dinner.",
  "Plan two snacks a day.",
].join("\n");

/** Attaches five files, and then a sixth one, which the window refuses with a problem. */
async function attachTooMany(page) {
  await attachFile(page, FIVE_FILES);
  await attachFile(page, SCHOOL_MENU);
  await expect(composerProblem(page)).toHaveText("A message holds at most 5 attachments.");
}

// What the window says when the files of a conversation would pass its limit.
const LIMIT_PROBLEM =
  "The attachments of a conversation total at most 20 MB. Start a new conversation to attach more.";

/** Makes the conversation of the next page start with almost 20 MB of files sent. */
async function useAlmostAllSpace(page) {
  await page.addInitScript(() =>
    window.localStorage.setItem("meals.assistant.used", String(20 * 1024 * 1024 - 1000)),
  );
}

/**
 * Attaches four files to a conversation that already sent almost 20 MB (see
 * `useAlmostAllSpace`), and then one more, which the window refuses with a
 * long problem.
 */
async function attachBeyondLimit(page) {
  await attachFile(page, FIVE_FILES.slice(0, 4));
  await attachFile(page, { ...SCHOOL_MENU, buffer: Buffer.alloc(2000, SCHOOL_MENU.buffer) });
  await expect(composerProblem(page)).toHaveText(LIMIT_PROBLEM);
}

/** The problem that the window shows above the message field. */
function composerProblem(page) {
  return assistantWindow(page).locator(".composer-notes").getByRole("alert");
}

/** The button of the window's header that collapses it. */
function collapseButton(page) {
  return assistantWindow(page).getByRole("button", { name: "Collapse" });
}

/** Checks that the header of the window is in view: its Collapse can be clicked where it is. */
async function expectHeaderInView(page) {
  await expectClickableInside(collapseButton(page), assistantWindow(page));
}

/**
 * Presses Tab from New conversation, the first control of the window, until
 * the focus leaves the window or comes back to New conversation, and checks
 * after each press that the header is in view. Resolves to the names of the
 * controls that the focus reached.
 */
async function tabThroughWindow(page) {
  const chat = assistantWindow(page);
  await chat.getByRole("button", { name: "New conversation" }).focus();
  const names = [];
  for (let presses = 0; presses < 30; presses += 1) {
    await page.keyboard.press("Tab");
    const focus = await chat.evaluate((element) => {
      const active = document.activeElement;
      return {
        inside: element.contains(active),
        name: active?.getAttribute("aria-label") ?? active?.textContent.trim(),
      };
    });
    if (!focus.inside || focus.name === "New conversation") return names;
    names.push(focus.name);
    await expectHeaderInView(page);
  }
  return names;
}

/** Resolves once the transitions that run in `page`, such as the opening of the window, end. */
async function finishTransitions(page) {
  await page.evaluate(() =>
    // A transition that another one replaces ends too: its promise rejects.
    Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
  );
}

/** The red, green, blue, and opacity of the background of `locator`. */
async function colorOf(locator) {
  const color = await locator.evaluate((element) => getComputedStyle(element).backgroundColor);
  const [red, green, blue, alpha = 1] = color.match(/[\d.]+/g).map(Number);
  return { rgb: [red, green, blue], alpha };
}

/** The width of the grid of the meal plan. */
async function gridWidth(page) {
  const box = await page.getByRole("main").boundingBox();
  expect(box, "the grid has a box").not.toBeNull();
  return box.width;
}

/**
 * Opens the meal plan on the current week on a screen `width` wide and 720
 * tall, with the sidebar `shown` or `hidden`.
 */
async function openWideWeek(page, width, sidebar) {
  await page.setViewportSize({ width, height: 720 });
  await page.addInitScript(
    (choice) => window.localStorage.setItem("meals.sidebar", choice),
    sidebar,
  );
  await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
}

/**
 * Checks that the page made room for the open window, once its transitions
 * end: the grid keeps its minimum width of 780 px, and the window covers
 * none of its slots.
 */
async function expectRoomForWindow(page, chat) {
  await finishTransitions(page);
  await expectClearOf(page.getByRole("main").locator(":scope > *"), chat);
  expect(await gridWidth(page), "the width of the grid").toBeGreaterThanOrEqual(780);
  await expectNoSidewaysScroll(page);
}

// Twelve weeks from the current one, which the summary of their pending
// changes lists one per line.
const TWELVE_WEEKS = Array.from({ length: 12 }, (_, index) => {
  const monday = new Date(`${CURRENT_WEEK}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + 7 * index);
  return monday.toISOString().slice(0, 10);
});

const TWELVE_WEEKS_REPLY = "Here's Monday's lunch for twelve weeks.";

/** The details of the pending changes, which replace the conversation. */
function pendingDetails(page) {
  return pendingCard(page).getByRole("list", { name: "Pending changes details" });
}

/** Opens the meal plan on the current week, asks for the plan, and opens its details. */
async function openPlanDetails(page) {
  await askForPlan(page);
  await pendingCard(page).getByRole("button", { name: "View details" }).click();
  await expect(pendingDetails(page)).toBeVisible();
}

test.describe("assistant", () => {
  test.describe(() => {
    test.use({ assistant: { script: PLAN } });

    test("shows the menus in the grid after Apply without a reload", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      // A reload would lose this.
      await page.evaluate(() => {
        /** @type {any} */ (window).sameDocument = true;
      });
      await ask(page, QUESTION, REPLY);
      const card = pendingCard(page);

      await card.getByRole("button", { name: "Apply" }).click();

      await expect(slotButton(page, "Monday", "Lunch")).toHaveAccessibleName(
        "Monday, Lunch: Omelette × 2",
      );
      await expect(slotButton(page, "Tuesday", "Dinner")).toHaveAccessibleName(
        /^Tuesday, Dinner: Lentil soup/,
      );
      expect(
        await page.evaluate(() => /** @type {any} */ (window).sameDocument),
        "the page wasn't reloaded",
      ).toBe(true);
    });

    test("moves the focus to the message field after Apply", async ({ page }) => {
      await askForPlan(page);

      await pendingCard(page).getByRole("button", { name: "Apply" }).click();

      await expect(pendingCard(page)).toBeHidden();
      await expect(messageField(page)).toBeFocused();
    });

    test("moves the focus to the message field after Discard", async ({ page }) => {
      await askForPlan(page);

      await pendingCard(page).getByRole("button", { name: "Discard" }).click();

      await expect(pendingCard(page)).toBeHidden();
      await expect(messageField(page)).toBeFocused();
    });

    test("returns the focus to New conversation after Keep Conversation", async ({ page }) => {
      await askForPlan(page);
      const newConversation = assistantWindow(page).getByRole("button", {
        name: "New conversation",
      });
      await newConversation.click();

      await page.getByRole("button", { name: "Keep Conversation" }).click();

      await expect(newConversation).toBeFocused();
    });

    test("focuses the message field after Discard and Start", async ({ page }) => {
      await askForPlan(page);
      await assistantWindow(page).getByRole("button", { name: "New conversation" }).click();

      await page.getByRole("button", { name: "Discard and Start" }).click();

      await expect(messageField(page)).toBeFocused();
    });

    test("leaves no empty row under the one-line card on a short screen", async ({ page }) => {
      await page.setViewportSize(LANDSCAPE);

      await askForPlan(page);

      // The card ends with its padding right below its one line: the empty
      // error of Apply and the empty count of problems take no height.
      const gap = await pendingCard(page).evaluate((card) => {
        const line = [".pending-line", ".view-details", ".discard", ".apply"].map(
          (selector) => card.querySelector(selector).getBoundingClientRect().bottom,
        );
        const padding = Number.parseFloat(getComputedStyle(card).paddingBottom);
        return card.getBoundingClientRect().bottom - padding - Math.max(...line);
      });
      expect(gap, "the space between the line and the card's padding, in px").toBeCloseTo(0, 0);
    });

    // The window on a desktop isn't modal, so only the alert, above it, keeps
    // Tab off the window's controls.
    test("keeps the focus inside the alert of New conversation", async ({ page }) => {
      await askForPlan(page);
      await assistantWindow(page).getByRole("button", { name: "New conversation" }).click();
      const alert = page.getByRole("alertdialog", { name: "Start a new conversation?" });
      await expect(alert.getByRole("button", { name: "Keep Conversation" })).toBeFocused();

      await expectFocusTrapped(page, alert, {
        names: ["Discard and Start", "Keep Conversation"],
        presses: 5,
        exact: true,
      });
    });
  });

  test.describe(() => {
    test.use({
      assistant: {
        script: [
          proposeMenus(NEXT_WEEK, [["mon", "lunch", { Omelette: 2 }]]),
          { text: NEXT_REPLY },
        ],
      },
    });

    test("shows the week of the link in the row of an Apply", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      // A reload would lose this.
      await page.evaluate(() => {
        /** @type {any} */ (window).sameDocument = true;
      });
      const chat = await ask(page, NEXT_QUESTION, NEXT_REPLY);
      await pendingCard(page).getByRole("button", { name: "Apply" }).click();

      await chat.getByRole("link", { name: "Show the week of Sep 28" }).click();

      await expectWeek(page, NEXT_WEEK, NEXT_RANGE);
      await expect(slotButton(page, "Monday", "Lunch")).toHaveAccessibleName(
        "Monday, Lunch: Omelette × 2",
      );
      expect(
        await page.evaluate(() => /** @type {any} */ (window).sameDocument),
        "the page wasn't reloaded",
      ).toBe(true);
    });
  });

  test.describe(() => {
    test.use({ assistant: { script: PLAN } });

    test("shows the problem in the details after a rejected Apply from them", async ({
      app,
      consoleErrors,
      page,
    }) => {
      await openPlanDetails(page);
      // Monday's lunch, changed by hand after the assistant proposed it.
      await app.api.saveSlot(CURRENT_WEEK, "mon", "lunch", [
        { recipeId: app.recipes["Green salad"].id, servings: 1 },
      ]);
      // The browser logs the 409 of the rejected Apply.
      consoleErrors.allowed = true;

      await pendingCard(page).getByRole("button", { name: "Apply" }).click();

      const problem = pendingDetails(page)
        .locator(".pending-change")
        .filter({ hasText: "Monday, Sep 21 · Lunch" });
      await expect(problem.getByText(/changed after the assistant proposed this\.$/)).toBeVisible();
      await expect(problem).toBeFocused();
    });

    test("focuses the message field after New conversation in the details", async ({ page }) => {
      await openPlanDetails(page);

      await assistantWindow(page).getByRole("button", { name: "New conversation" }).click();
      await page.getByRole("button", { name: "Discard and Start" }).click();

      await expect(messageField(page)).toBeFocused();
    });

    test("shows a network error of Apply in the footer of the details", async ({
      network,
      page,
    }) => {
      await openPlanDetails(page);
      await network.down();

      const apply = pendingCard(page).getByRole("button", { name: "Apply" });
      await apply.click();

      const error = pendingCard(page).getByRole("alert");
      await expect(error).toHaveText("Couldn't apply the changes. Try again.");
      await expectClickableInside(error, assistantWindow(page));
      await expect(pendingDetails(page)).toBeVisible();
      await expect(apply).toBeFocused();
    });
  });

  test.describe(() => {
    test.use({
      assistant: {
        script: [
          ({ app }) => ({
            toolCalls: [
              {
                name: "propose_menus",
                input: {
                  menus: TWELVE_WEEKS.map((week) => ({
                    week,
                    day: "mon",
                    meal: "lunch",
                    items: [{ recipeId: app.recipes.Omelette.id, servings: 2 }],
                  })),
                },
              },
            ],
          }),
          { text: TWELVE_WEEKS_REPLY },
        ],
      },
    });

    for (const screen of [
      { width: 320, height: 568 },
      { width: 1024, height: 600 },
    ]) {
      test(`scrolls a summary that doesn't fit above Apply at ${screen.width}×${screen.height}`, async ({
        page,
      }) => {
        await page.setViewportSize(screen);
        await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
        await ask(page, "Plan Monday's lunch for twelve weeks.", TWELVE_WEEKS_REPLY);
        const card = pendingCard(page);
        const lines = card.getByRole("listitem");
        await expect(lines).toHaveCount(12);

        await lines.last().scrollIntoViewIfNeeded();

        const chat = assistantWindow(page);
        await expectClickableInside(lines.last(), chat);
        for (const name of ["View details", "Discard", "Apply"]) {
          await expectClickableInside(card.getByRole("button", { name }), chat);
        }
        expect(
          await card.locator(".pending-summary").evaluate((list) => list.scrollTop),
          "the scroll position of the summary",
        ).toBeGreaterThan(0);
      });
    }
  });

  test.describe(() => {
    test.use({ assistant: { script: largePlan(CURRENT_WEEK, LARGE_REPLY) } });

    test("returns the focus to Discard after Keep Changes", async ({ page }) => {
      const card = await askForLargePlan(page, { width: 1280, height: 720 });
      const discard = card.getByRole("button", { name: "Discard" });
      await discard.click();

      await page.getByRole("button", { name: "Keep Changes" }).click();

      await expect(discard).toBeFocused();
    });

    test("focuses the message field after Discard in the alert", async ({ page }) => {
      const card = await askForLargePlan(page, { width: 1280, height: 720 });
      await card.getByRole("button", { name: "Discard" }).click();

      await page
        .getByRole("alertdialog", { name: "Discard the pending changes?" })
        .getByRole("button", { name: "Discard" })
        .click();

      await expect(pendingCard(page)).toBeHidden();
      await expect(messageField(page)).toBeFocused();
    });

    for (const screen of SCREENS) {
      const size = `${screen.width}×${screen.height}`;

      test(`reaches Apply, Discard, and View details of a large plan at ${size}`, async ({
        page,
      }) => {
        const card = await askForLargePlan(page, screen);

        for (const name of ["View details", "Discard", "Apply"]) {
          const button = card.getByRole("button", { name });
          await expectClickableInside(button, assistantWindow(page));
          await button.click({ trial: true });
        }
      });

      test(`opens the details of a large plan and goes Back at ${size}`, async ({ page }) => {
        const card = await askForLargePlan(page, screen);

        await card.getByRole("button", { name: "View details" }).click();

        await expect(card.getByText("New ingredient: Zucchini")).toBeVisible();
        for (const name of ["Back", "Discard", "Apply"]) {
          await expectClickableInside(card.getByRole("button", { name }), assistantWindow(page));
        }
        await card.getByRole("button", { name: "Back" }).click();
        await expect(card.getByRole("button", { name: "View details" })).toBeFocused();
      });

      test(`wraps the long names in the details of a large plan at ${size}`, async ({ page }) => {
        const card = await askForLargePlan(page, screen);

        await card.getByRole("button", { name: "View details" }).click();

        await expect(card.getByText(`New ingredient: ${LONG_INGREDIENT}`)).toBeVisible();
        await expectEachInsideSideways(
          card.locator(".pending-change"),
          card.locator(".pending-details"),
        );
      });

      test(`shows the first problem of a large plan after Apply at ${size}`, async ({
        app,
        consoleErrors,
        page,
      }) => {
        const card = await askForLargePlan(page, screen);
        // A slot of the plan, far down the details, changed by hand.
        await app.api.saveSlot(CURRENT_WEEK, "thu", "dinner", [
          { recipeId: app.recipes.Omelette.id, servings: 1 },
        ]);
        // The browser logs the 409 of the rejected Apply.
        consoleErrors.allowed = true;

        await card.getByRole("button", { name: "Apply" }).click();

        await expect(card.getByText("1 change has a problem")).toBeVisible();
        await expect(card.getByRole("alert")).toHaveText(
          "The pending changes couldn't be applied.",
        );
        const problem = card
          .locator(".pending-change")
          .filter({ hasText: "Thursday, Sep 24 · Dinner" });
        await expect(problem).toBeFocused();
        // On a screen 500 px tall or less, the change's lines may not fit,
        // but its problem does.
        const shown =
          screen.height > 500
            ? problem
            : problem.getByText(/changed after the assistant proposed this\.$/);
        await expectClickableInside(shown, card.locator(".pending-details"));
      });

      test(`keeps the header in view on Tab through a large plan at ${size}`, async ({ page }) => {
        const card = await askForLargePlan(page, screen);

        const conversation = await tabThroughWindow(page);
        await card.getByRole("button", { name: "View details" }).click();
        const details = await tabThroughWindow(page);

        expect(conversation).toEqual(expect.arrayContaining(["View details", "Apply", "Message"]));
        expect(details).toEqual(
          expect.arrayContaining(["Back", "Pending changes details", "Apply"]),
        );
      });

      test(`keeps the header in view on focus of the message field at ${size}`, async ({
        page,
      }) => {
        const card = await askForLargePlan(page, screen);
        await card.getByRole("button", { name: "Apply" }).focus();

        await messageField(page).focus();

        await expectHeaderInView(page);
        await expectClickableInside(messageField(page), assistantWindow(page));
      });

      test(`keeps the header, Apply, and Send in view with five files at ${size}`, async ({
        page,
      }) => {
        const card = await askForLargePlan(page, screen);

        await attachFile(page, FIVE_FILES);
        await messageField(page).fill(LONG_MESSAGE);

        await expect(
          assistantWindow(page).getByRole("list", { name: "Attachments" }).getByRole("listitem"),
        ).toHaveCount(5);
        const chat = assistantWindow(page);
        await expectHeaderInView(page);
        await expectClickableInside(card.getByRole("button", { name: "Apply" }), chat);
        await expectClickableInside(messageField(page), chat);
        await expectClickableInside(chat.getByRole("button", { name: "Send" }), chat);
      });
    }

    test("leaves 60 px to the log beside a large plan on a short screen", async ({ page }) => {
      await askForLargePlan(page, LANDSCAPE);

      const log = await assistantWindow(page).getByRole("log", { name: "Messages" }).boundingBox();

      expect(log.height, "the height of the log").toBeGreaterThanOrEqual(60);
    });
  });

  test.describe(() => {
    test.use({ assistant: { script: [{ text: REPLY }] } });

    test("keeps the conversation and the open window on the recipes page", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      await ask(page, QUESTION, REPLY);

      await pageLink(page, "Recipes").click();

      await expect(page).toHaveURL(/\/recipes\.html$/);
      const chat = assistantWindow(page);
      await expect(chat).toBeVisible();
      await expect(chat.getByText(QUESTION)).toBeVisible();
      await expect(chat.getByText(REPLY)).toBeVisible();
    });

    // A click focuses Send, which turns off while the message sends. The
    // browser moves the focus off a disabled control to <body> at a time of
    // its own, so the focus must be on a control that stays on while the
    // test holds the message.
    test("keeps the focus in the window after Send", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      const chat = await openAssistant(page);
      await messageField(page).fill(QUESTION);
      const sent = Promise.withResolvers();
      await page.route(
        (url) => url.pathname.endsWith("/messages"),
        (route) => sent.resolve(route),
      );

      await chat.getByRole("button", { name: "Send" }).click();

      const held = await sent.promise;
      expect(
        await chat.evaluate((element) => {
          const active = /** @type {HTMLButtonElement} */ (document.activeElement);
          return element.contains(active) && !active.disabled;
        }),
        "the focus must be on a control of the window that is on while the message sends",
      ).toBe(true);
      await held.continue();
      await expect(chat.getByText(REPLY)).toBeVisible();
      await expect
        .poll(() => chat.evaluate((element) => element.contains(document.activeElement)), {
          message: "the focus must be inside the window",
        })
        .toBe(true);
    });

    test("attaches a PDF and shows its name in the sent message", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      const chat = await openAssistant(page);
      await attachFile(page, SCHOOL_MENU);
      await expect(chat.getByRole("list", { name: "Attachments" })).toHaveText(
        new RegExp(`^${SCHOOL_MENU.name}`),
      );

      await sendMessage(page, QUESTION);

      await expect(chat.getByText(REPLY)).toBeVisible();
      await expect(
        chat.getByRole("log", { name: "Messages" }).getByRole("list", { name: "Attachments" }),
      ).toHaveText(SCHOOL_MENU.name);
    });
  });

  test.describe(() => {
    test.use({ assistant: { script: [] } });

    // A scroll past the log's end would move the page behind it, unless the
    // log contains it. The browser scrolls in frames of its own, which the
    // fake clock can't wait for, so the test checks what contains it.
    test("contains the overscroll of the log on a phone", async ({ page }) => {
      await page.setViewportSize(devices["iPhone 15"].viewport);
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);

      const chat = await openAssistant(page);

      const log = chat.getByRole("log", { name: "Messages" });
      expect(
        await log.evaluate((element) => getComputedStyle(element).overscrollBehaviorY),
        "what the log does with a scroll past its end",
      ).toBe("contain");
    });
  });

  test.describe(() => {
    test.use({
      assistant: { script: [...PLAN, new Error("The model is overloaded.")] },
    });

    test("sets the chat apart from the sheet when the appearance is dark", async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize(devices["iPhone 15"].viewport);
      await askForPlan(page);
      const chat = assistantWindow(page);
      const sheet = await colorOf(chat);
      const colors = {
        "the reply": await colorOf(chat.locator(".message.from-assistant")),
        "the card of the pending changes": await colorOf(pendingCard(page)),
        "the row of the message field": await colorOf(chat.locator(".message-row")),
      };
      await pendingCard(page).getByRole("button", { name: "Apply" }).click();
      await expect(chat.getByText("Applied: 2 slots.")).toBeVisible();
      await sendMessage(page, "Plan Wednesday's dinner.");
      await expect(chat.getByRole("button", { name: "Retry" })).toBeVisible();
      colors["the row of the apply"] = await colorOf(chat.locator(".assistant-event"));
      colors["the row of the failed answer"] = await colorOf(chat.locator(".turn-failure"));

      for (const [name, color] of Object.entries(colors)) {
        // A translucent background would show the sheet through it.
        expect(color.alpha, `the opacity of the background of ${name}`).toBe(1);
        expect(color.rgb, `the color of ${name}, which must differ from the sheet's`).not.toEqual(
          sheet.rgb,
        );
      }
    });
  });

  test.describe(() => {
    test.use({ assistant: { script: [new Error("The model is overloaded."), { text: REPLY }] } });

    test("moves the focus to the message field after Retry", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      await ask(page, QUESTION, "The assistant couldn't answer.");

      await assistantWindow(page).getByRole("button", { name: "Retry" }).click();

      await expect(assistantWindow(page).getByText(REPLY)).toBeVisible();
      await expect(messageField(page)).toBeFocused();
    });
  });

  test.describe(() => {
    test.use({ assistant: { script: [] } });

    test("lets the window float over the grid at 1280 with the sidebar", async ({ page }) => {
      await openWideWeek(page, 1280, "shown");
      const before = await gridWidth(page);

      await openAssistant(page);
      await finishTransitions(page);

      expect(await gridWidth(page), "the width of the grid").toBe(before);
    });

    for (const [width, sidebar] of [
      [1280, "hidden"],
      [1440, "shown"],
      [1920, "shown"],
    ]) {
      const presence = sidebar === "shown" ? "with" : "without";
      test(`makes room for the window at ${width} ${presence} the sidebar`, async ({ page }) => {
        await openWideWeek(page, width, sidebar);

        const chat = await openAssistant(page);

        await expectRoomForWindow(page, chat);
      });
    }

    test("narrows the window to make room for it at 1440 with the sidebar", async ({ page }) => {
      await openWideWeek(page, 1440, "shown");

      const chat = await openAssistant(page);
      await finishTransitions(page);

      const { width } = await chat.boundingBox();
      expect(width, "the width of the window").toBeGreaterThanOrEqual(360);
      expect(width, "the width of the window").toBeLessThan(400);
    });

    test("keeps the full width of the window when it makes room at 1920", async ({ page }) => {
      await openWideWeek(page, 1920, "shown");

      const chat = await openAssistant(page);
      await finishTransitions(page);

      expect((await chat.boundingBox()).width, "the width of the window").toBe(400);
    });

    // A browser may paint the page before its modules run, so the page can
    // still slide once as it loads; the room is there before the window.
    test("makes room before a window that another page left open shows", async ({ page }) => {
      await openWideWeek(page, 1920, "shown");
      const full = await gridWidth(page);
      await openAssistant(page);
      // The page loads again while the server hasn't said yet whether the
      // assistant is on, so the window isn't there.
      const held = Promise.withResolvers();
      await page.route("**/api/assistant", async (route) => {
        await held.promise;
        await route.continue();
      });

      await page.reload();
      await expect(slotButton(page, "Monday", "Breakfast")).toBeVisible();

      await expect
        .poll(() => gridWidth(page), {
          message: `the width of the grid before the window shows must drop below ${full}px`,
        })
        .toBeLessThan(full);
      await finishTransitions(page);
      expect(
        await gridWidth(page),
        "the width of the grid before the window shows",
      ).toBeGreaterThanOrEqual(780);
      await expect(assistantWindow(page)).toBeHidden();
      held.resolve(undefined);
      await expect(assistantWindow(page)).toBeVisible();
      await expectRoomForWindow(page, assistantWindow(page));
    });

    test("keeps a problem and the chips of five files in view on a short screen", async ({
      page,
    }) => {
      await page.setViewportSize(LANDSCAPE);
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      const chat = await openAssistant(page);

      await attachTooMany(page);

      const notes = chat.locator(".composer-notes");
      await expectClickableInside(composerProblem(page), notes);
      await expectClickableInside(chat.getByRole("list", { name: "Attachments" }), notes);
    });

    // The narrowest phone, and a short desktop.
    for (const screen of [
      { width: 320, height: 568 },
      { width: 1024, height: 600 },
    ]) {
      const size = `${screen.width}×${screen.height}`;

      test(`keeps a long problem and the chips in view at ${size}`, async ({ page }) => {
        await page.setViewportSize(screen);
        await useAlmostAllSpace(page);
        await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
        const chat = await openAssistant(page);

        await attachBeyondLimit(page);

        const notes = chat.locator(".composer-notes");
        await expectClickableInside(composerProblem(page), notes);
        await expectClickableInside(chat.getByRole("list", { name: "Attachments" }), notes);
      });

      test(`wraps a long problem to show it in full at ${size}`, async ({ page }) => {
        await page.setViewportSize(screen);
        await useAlmostAllSpace(page);
        await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
        const chat = await openAssistant(page);

        await attachBeyondLimit(page);

        // The text, after the warning icon.
        await expectWrapsInside(
          composerProblem(page).locator(":scope > :last-child"),
          chat.locator(".composer-notes"),
        );
      });
    }

    // A desktop, where the field shows 5 lines, and a phone in landscape,
    // where it shows 2.
    for (const screen of [{ width: 1280, height: 720 }, LANDSCAPE]) {
      const size = `${screen.width}×${screen.height}`;

      test(`cuts at most 1 px of a line atop the message field at ${size}`, async ({ page }) => {
        await page.setViewportSize(screen);
        await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
        await openAssistant(page);

        await messageField(page).fill(`${LONG_MESSAGE}\n${LONG_MESSAGE}`);

        const field = await messageField(page).evaluate((element) => {
          element.scrollTop = element.scrollHeight;
          const style = getComputedStyle(element);
          const line = Number.parseFloat(style.lineHeight);
          return {
            scrolls: element.scrollHeight > element.clientHeight,
            cut: (element.scrollTop - Number.parseFloat(style.paddingTop)) % line,
            height: element.clientHeight % line,
          };
        });
        expect(field.scrolls, "the field holds more lines than it shows, so it scrolls").toBe(true);
        // Firefox scrolls a text area 1 px past its last line.
        expect(
          field.cut,
          "the part of a line above the first line in view, in px",
        ).toBeLessThanOrEqual(1);
        expect(field.height, "the height of the field beyond whole lines, in px").toBe(0);
      });
    }

    test("opens the window as a sheet on a phone in landscape", async ({ page }) => {
      await page.setViewportSize(LANDSCAPE);
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);

      const chat = await openAssistant(page);

      await expectFillsScreen(chat);
    });

    test("keeps the focus in the sheet on a phone", async ({ page }) => {
      await page.setViewportSize(devices["iPhone 15"].viewport);
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);

      const chat = await openAssistant(page);

      await expectFocusTrapped(page, chat, {
        names: ["New conversation", "Collapse", "Attach files", "Message", "Send"],
        presses: 8,
      });
    });

    // A desktop, and an iPad upright.
    for (const screen of [{ width: 1280, height: 720 }, devices["iPad (gen 7)"].viewport]) {
      const size = `${screen.width}×${screen.height}`;

      test(`hides the round button while the window is open at ${size}`, async ({ page }) => {
        await page.setViewportSize(screen);
        await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
        // The class, not the role: the hidden button leaves the accessibility
        // tree, where a role would match nothing.
        const roundButton = page.locator(".assistant-button");
        await expect(roundButton).toBeVisible();

        await openAssistant(page);

        await expect(roundButton).toHaveCount(1);
        await expect(roundButton).toBeHidden();
      });

      test(`shows and focuses the round button after Collapse at ${size}`, async ({ page }) => {
        await page.setViewportSize(screen);
        await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
        const chat = await openAssistant(page);

        await chat.getByRole("button", { name: "Collapse" }).click();

        await expect(assistantButton(page)).toBeVisible();
        await expect(assistantButton(page)).toBeFocused();
      });
    }

    test("keeps the meal plan usable while the window is open", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      await openAssistant(page);

      // The window floats in the lower right corner, far from Monday.
      await slotButton(page, "Monday", "Breakfast").click();

      await expect(page.getByRole("dialog", { name: "Breakfast" })).toBeVisible();
      await expect(assistantWindow(page)).toBeVisible();
    });

    test("keeps the toolbar as the only banner while the window is open", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);

      await openAssistant(page);

      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("banner")).toHaveClass(/\btoolbar\b/);
    });

    test("keeps the empty alert of the window in the accessibility tree", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);

      await openAssistant(page);

      await expect(assistantWindow(page).getByRole("alert")).toHaveText("");
    });

    test("makes Ask the assistant the first Tab stop of the page", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      await expect(assistantButton(page)).toBeVisible();

      await page.keyboard.press("Tab");

      const skipLink = page.getByRole("link", { name: "Ask the assistant" });
      await expect(skipLink).toBeFocused();
      await expectInsideViewport(skipLink);
    });

    test("hides Ask the assistant until it has the focus", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      await expect(assistantButton(page)).toBeVisible();

      const box = await page.getByRole("link", { name: "Ask the assistant" }).boundingBox();

      expect(box, "the skip link has a box").not.toBeNull();
      expect(box.width * box.height, "the area of the skip link").toBeLessThanOrEqual(1);
    });

    test("opens the window with Ask the assistant and focuses the field", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      await expect(assistantButton(page)).toBeVisible();
      await page.keyboard.press("Tab");

      await page.keyboard.press("Enter");

      await expect(assistantWindow(page)).toBeVisible();
      await expect(messageField(page)).toBeFocused();
      await expect(page).toHaveURL(new RegExp(`#${CURRENT_WEEK}$`));
    });

    test("focuses the round button after Escape", async ({ page }) => {
      await openWeek(page, CURRENT_WEEK, CURRENT_RANGE);
      await openAssistant(page);

      await messageField(page).press("Escape");

      await expect(assistantWindow(page)).toBeHidden();
      await expect(assistantButton(page)).toBeFocused();
    });
  });
});
