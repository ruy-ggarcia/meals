// What the assistant's window shows of a conversation: the summary and the
// details of the pending changes, the mark of its button, and the checks of
// the attachments before they're sent. No DOM access, so tests import this
// module directly in Node.js.

import { addDays, formatDayDate, isWeekId, weekStart } from "./dates.js";
import { describeItem } from "./menus.js";
import { sortByName } from "./name-search.js";

const MB = 1024 * 1024;
// The limits of the server, which checks them again.
const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 10 * MB;
const MAX_CONVERSATION_BYTES = 20 * MB;
const MEDIA_TYPES = ["application/pdf", "image/jpeg", "image/png"];

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

/** For example, "New recipe" or "Archived ingredient". */
function changeLabel(view) {
  return `${ACTION_LABELS[view.action]} ${view.kind}`;
}

/** For example, "Week of Nov 16". */
function weekLabel(week) {
  const format = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  return `Week of ${format.format(weekStart(week))}`;
}

/**
 * One line per week with menus, from the earliest, and then one line per
 * recipe and per ingredient, each group from A to Z by name, such as
 * `{ label: "Week of Nov 16", detail: "31 slots" }` and `{ label: "New
 * recipe", detail: "Pumpkin soup" }`.
 * @param {any[]} pending The pending changes of the conversation.
 * @returns {{ label: string, detail: string }[]}
 */
export function summarize(pending) {
  const slots = new Map();
  for (const view of pending) {
    if (view.kind === "menu") slots.set(view.week, (slots.get(view.week) ?? 0) + 1);
  }
  const weeks = [...slots.keys()].sort().map((week) => {
    const count = slots.get(week);
    return { label: weekLabel(week), detail: count === 1 ? "1 slot" : `${count} slots` };
  });
  const entries = (kind) =>
    sortByName(pending.filter((view) => view.kind === kind)).map((view) => ({
      label: changeLabel(view),
      detail: view.name,
    }));
  return [...weeks, ...entries("recipe"), ...entries("ingredient")];
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
 * The week that the meal plan shows, from the hash of its URL, or undefined
 * on the other pages.
 * @param {{ pathname: string, hash: string }} location
 * @returns {string | undefined}
 */
export function displayedWeek({ pathname, hash }) {
  if (pathname !== "/" && pathname !== "/index.html") return undefined;
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
  }
  const total = files.reduce((sum, file) => sum + file.size, usedBytes);
  if (total > MAX_CONVERSATION_BYTES) {
    return "The attachments of a conversation total at most 20 MB. Start a new conversation to attach more.";
  }
  return undefined;
}
