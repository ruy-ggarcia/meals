// Message text, with no DOM access, so tests run it in Node.js.

export function quoted(name) {
  return `"${name}"`;
}

export function conflictText(holder) {
  return holder.archived
    ? `${quoted(holder.name)} is archived.`
    : `${quoted(holder.name)} already exists.`;
}

/** For example, "Monday lunch, Tuesday dinner, and Friday breakfast". */
export function joinNames(names) {
  if (names.length < 3) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

/** The title of the question before you leave a week with meals that weren't saved. */
export function unsavedTitle(count) {
  return count === 1 ? "1 meal wasn't saved" : `${count} meals weren't saved`;
}

/**
 * What leaving `place` does to the meals in `names`, such as "Monday lunch".
 * `place` is "this week" or "this page".
 */
export function unsavedMessage(names, place) {
  const outcome =
    names.length === 1
      ? "it goes back to its last saved menu"
      : "they go back to their last saved menus";
  return `${joinNames(names)} couldn't be saved. If you leave ${place}, ${outcome}.`;
}
