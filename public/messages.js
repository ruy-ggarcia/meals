// Recipe book message text, with no DOM access, so tests run it in Node.js.

export function quoted(name) {
  return `"${name}"`;
}

export function conflictText(holder) {
  return holder.archived
    ? `${quoted(holder.name)} is archived.`
    : `${quoted(holder.name)} already exists.`;
}
