// Usage: node scripts/clean-release-notes.js < NOTES > CLEANED
//
// Removes the entries that link to a merge commit from release notes in
// release-please's Markdown. The body of a merge commit repeats the pull
// request title, and release-please lists it as one more change, next to the
// commits of the pull request. A section that loses all its entries goes too.
// Every other line, with its line ending, stays as it is.
//
// Run it in a Git working tree that has the linked commits. A commit that Git
// doesn't know fails the script, with no output, so it never guesses.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ENTRY = /^\* .*https:\/\/github\.com\/ruy-ggarcia\/meals\/commit\/([0-9a-f]{40})\b/;
const HEADING = /^### /;
const SECTION_END = /^(#|---)/;

/** Whether SHA has more than one parent. */
function isMerge(sha) {
  let line;
  try {
    line = execFileSync("git", ["rev-list", "--parents", "-n", "1", sha], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(`Unknown commit ${sha}`);
  }
  return line.trim().split(" ").length > 2;
}

/**
 * Returns NOTES without the entries of merge commits, and without the
 * sections that lose all their entries.
 *
 * @param {string} notes
 */
function clean(notes) {
  // Each line keeps its ending, and a last line may have none.
  const lines = notes.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const kept = lines.map((line) => {
    const sha = line.match(ENTRY)?.[1];
    return sha === undefined || !isMerge(sha);
  });
  for (let start = 0; start < lines.length; start += 1) {
    if (!HEADING.test(lines[start])) continue;
    let end = start + 1;
    while (end < lines.length && !SECTION_END.test(lines[end])) end += 1;
    const entries = [];
    for (let i = start + 1; i < end; i += 1) if (ENTRY.test(lines[i])) entries.push(i);
    if (entries.length > 0 && entries.every((i) => !kept[i])) {
      kept.fill(false, start, end);
    }
  }
  return lines.filter((_, i) => kept[i]).join("");
}

try {
  process.stdout.write(clean(readFileSync(0, "utf8")));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
