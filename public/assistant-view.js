// What the assistant's window shows of a conversation: the text of a reply,
// the summary and the details of the pending changes, the rows of an apply
// or a discard, the mark of its button, and the checks of the attachments
// before they're sent. No DOM access, so tests import this module directly
// in Node.js.

import { addDays, formatDayDate, formatWeekStart, isWeekId, weekStart } from "./dates.js";
import { describeItem } from "./menus.js";

const MB = 1024 * 1024;
// The limits of the server, which checks them again.
export const MAX_ATTACHMENTS = 5;
export const MAX_FILE_BYTES = 10 * MB;
export const MAX_IMAGE_BYTES = 7 * MB;
export const MAX_CONVERSATION_BYTES = 20 * MB;
const IMAGE_TYPES = ["image/jpeg", "image/png"];
const MEDIA_TYPES = ["application/pdf", ...IMAGE_TYPES];

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const MEAL_LABELS = {
  breakfast: "Breakfast",
  snack_am: "Morning snack",
  lunch: "Lunch",
  snack_pm: "Afternoon snack",
  dinner: "Dinner",
};
const ACTION_LABELS = {
  create: "New",
  change: "Changed",
  archive: "Archived",
  restore: "Restored",
};

/**
 * `text` without the bold markers of Markdown, the pairs of `**` around
 * words on one line, which the model writes even when told not to: the
 * window shows plain text, so the words stay and the markers go. A single
 * `*` stays, as in "2 * 100 g".
 * @param {string} text
 */
export function withoutBold(text) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1");
}

/** For example, "New recipe" or "Archived ingredient". */
function changeLabel(view) {
  return `${ACTION_LABELS[view.action]} ${view.kind}`;
}

/** For example, "Week of Nov 16". */
function weekLabel(week) {
  return `Week of ${formatWeekStart(week)}`;
}

/** For example, "1 slot" or "4 new recipes". */
function countOf(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function isMenu(view) {
  return view.kind === "menu";
}

// The slots of a week in the order of the meal plan: by day, and then by meal.
const MEALS = Object.keys(MEAL_LABELS);
function slotOrder(view) {
  return DAYS.indexOf(view.day) * MEALS.length + MEALS.indexOf(view.meal);
}

/**
 * The pending changes in groups, each under its line of the summary: the
 * slots of each week, from the earliest, by day and meal, such as "Week of
 * Nov 16: 35 slots", and then the recipes and the ingredients of each
 * action, such as "4 new recipes". The changes of a recipe or an ingredient
 * keep their order.
 * @param {any[]} pending The pending changes of the conversation.
 * @returns {{ heading: string, changes: any[] }[]}
 */
export function groupPending(pending) {
  const weeks = [...new Set(pending.filter(isMenu).map((view) => view.week))].sort();
  const groups = weeks.map((week) => {
    const changes = pending
      .filter((view) => isMenu(view) && view.week === week)
      .sort((a, b) => slotOrder(a) - slotOrder(b));
    return { heading: `${weekLabel(week)}: ${countOf(changes.length, "slot")}`, changes };
  });
  for (const kind of ["recipe", "ingredient"]) {
    for (const action of Object.keys(ACTION_LABELS)) {
      const changes = pending.filter((view) => view.kind === kind && view.action === action);
      if (changes.length > 0) {
        const noun = `${ACTION_LABELS[action].toLowerCase()} ${kind}`;
        groups.push({ heading: countOf(changes.length, noun), changes });
      }
    }
  }
  return groups;
}

/**
 * The pending changes as counts, one line each, in the order of
 * `groupPending`: the slots of each week, and then the recipes and the
 * ingredients of each action, such as "Week of Nov 16: 35 slots" and "4 new
 * recipes". The names show only in the details, so the summary stays short
 * however large the plan is.
 * @param {any[]} pending The pending changes of the conversation.
 * @returns {string[]}
 */
export function summarize(pending) {
  return groupPending(pending).map((group) => group.heading);
}

/**
 * The summary in one line, for a short screen: the slots of every week
 * together, and then the counts of the recipes and the ingredients, such as
 * "35 slots, 4 new recipes, 6 new ingredients".
 * @param {any[]} pending The pending changes of the conversation.
 */
export function summaryLine(pending) {
  const slots = pending.filter(isMenu).length;
  const counts = groupPending(pending)
    .filter((group) => !isMenu(group.changes[0]))
    .map((group) => group.heading);
  return [...(slots > 0 ? [countOf(slots, "slot")] : []), ...counts].join(", ");
}

/**
 * How many pending changes have a problem after a rejected Apply, such as "2
 * changes have a problem", or an empty text when none has.
 * @param {any[]} pending The pending changes of the conversation.
 */
export function problemCount(pending) {
  const count = pending.filter((view) => view.problem).length;
  if (count === 0) return "";
  return count === 1 ? "1 change has a problem" : `${count} changes have a problem`;
}

/**
 * What View details shows of one pending change: the slot of a menu with its
 * menu items, or a recipe or an ingredient with its fields. An archive or a
 * restore shows only the name.
 * @param {any} view A pending change of the conversation.
 * @returns {{ title: string, lines: string[] }}
 */
export function pendingDetail(view) {
  if (view.kind === "menu") {
    const date = addDays(weekStart(view.week), DAYS.indexOf(view.day));
    const items = view.items.map((item) => describeItem(item.name, item.servings));
    return {
      title: `${formatDayDate(date)} · ${MEAL_LABELS[view.meal]}`,
      lines: items.length === 0 ? ["Empty"] : items,
    };
  }
  const title = `${changeLabel(view)}: ${view.name}`;
  if (view.action === "archive" || view.action === "restore") return { title, lines: [] };
  if (view.kind === "recipe") {
    const lines = view.ingredients.map((line) => `${line.name}: ${line.quantity} ${line.unit}`);
    return { title, lines: lines.length === 0 ? ["No ingredients"] : lines };
  }
  return {
    title,
    lines: [
      `Unit: ${view.unit}`,
      ...view.measures.map((measure) => `${measure.name}: ${measure.amount} ${view.unit}`),
    ],
  };
}

/**
 * What the row of an event of the conversation says: what an apply saved, such
 * as "Applied: 35 slots, 4 recipes, and 6 ingredients.", without the counts
 * of zero, or that a discard discarded the pending changes.
 * @param {{ kind: string, counts?: { slots: number, recipes: number, ingredients: number } }} event
 */
export function eventText(event) {
  if (event.kind !== "applied") return "Discarded the pending changes.";
  const counts = /** @type {Record<string, number>} */ (event.counts);
  const nouns = { slots: "slot", recipes: "recipe", ingredients: "ingredient" };
  const parts = Object.entries(nouns)
    .filter(([key]) => counts[key] > 0)
    .map(([key, noun]) => countOf(counts[key], noun));
  if (parts.length === 0) return "Applied the pending changes.";
  const list = new Intl.ListFormat("en-US", { type: "conjunction" });
  return `Applied: ${list.format(parts)}.`;
}

/**
 * The text of the link of an applied event to a week that it changed, such as
 * "Show the week of Nov 16".
 * @param {string} week
 */
export function weekLinkText(week) {
  return `Show the week of ${formatWeekStart(week)}`;
}

/**
 * Whether the collapsed window's button shows a mark: the conversation has
 * more replies than the `seen` ones, or has pending changes.
 * @param {{ open: boolean, messages: { role: string }[], seen: number, pending: any[] }} state
 */
export function hasMark({ open, messages, seen, pending }) {
  if (open) return false;
  const replies = messages.filter((message) => message.role === "assistant").length;
  return replies > seen || pending.length > 0;
}

/**
 * Whether the page at `pathname` is the meal plan, at `/` or `/index.html`.
 * @param {{ pathname: string }} location
 */
export function isMealPlan({ pathname }) {
  return pathname === "/" || pathname === "/index.html";
}

/**
 * The week that the meal plan shows, from the hash of its URL, or undefined
 * on the other pages.
 * @param {{ pathname: string, hash: string }} location
 * @returns {string | undefined}
 */
export function displayedWeek({ pathname, hash }) {
  if (!isMealPlan({ pathname })) return undefined;
  const week = hash.slice(1);
  return isWeekId(week) ? week : undefined;
}

/**
 * Why `files` can't go in one message, with the texts of the server, or
 * undefined when they can. `usedBytes` counts the attachments that the
 * conversation already holds. A file whose type the browser doesn't know
 * goes to the server, which decides by its bytes.
 * @param {{ name: string, size: number, type: string }[]} files
 * @param {number} usedBytes
 * @returns {string | undefined}
 */
export function attachmentProblem(files, usedBytes) {
  if (files.length > MAX_ATTACHMENTS) {
    return `A message holds at most ${MAX_ATTACHMENTS} attachments.`;
  }
  for (const file of files) {
    if (file.type !== "" && !MEDIA_TYPES.includes(file.type)) {
      return `"${file.name}" isn't a PDF, a JPEG, or a PNG.`;
    }
    if (file.size > MAX_FILE_BYTES) return `"${file.name}" is larger than 10 MB.`;
    if (IMAGE_TYPES.includes(file.type) && file.size > MAX_IMAGE_BYTES) {
      return `"${file.name}" is an image larger than 7 MB.`;
    }
  }
  const total = files.reduce((sum, file) => sum + file.size, usedBytes);
  if (total > MAX_CONVERSATION_BYTES) {
    return "The attachments of a conversation total at most 20 MB. Start a new conversation to attach more.";
  }
  return undefined;
}
