# Agent instructions

Follow these rules for every change in this repository.

## Language

Write every output artifact in US English unless the repository owner
explicitly asks for another language. Artifacts include the following:

- Source code, comments, and log messages
- User interface text
- Test names and fixture data
- Documentation, specs, and plans
- Commit messages

## Documentation style

Follow the
[Google developer documentation style guide](https://developers.google.com/style)
for all documentation. In particular:

- Use sentence case for headings.
- Address the reader as "you" and use present tense and active voice.
- Introduce each procedure with a sentence, and use numbered steps.
- Put code, commands, file names, and literal values in code font.
- Use the serial comma.

## Ordering

When you choose an order that nothing else determines, sort alphabetically
from A to Z. This applies to file lists such as `.gitignore` entries, include
lists, `git add` paths, and directory trees. Keep another order only when it
has a clear reason, such as execution order.

When a list mixes patterns, directories, and files, go from general to
specific: patterns first, then directories, then files. Sort each group from
A to Z.

## Testing

Use test-driven development whenever possible: write a failing test, watch it
fail, and then write the code that makes it pass.

Before you fix a bug, write an automated test that reproduces it, and watch
the test fail. The failure confirms your hypothesis about the cause. Only then
fix the bug and watch the test pass. If a behavior can't be tested
automatically, such as focus or layout in a real browser, cover it in
`docs/manual-test-plan.md`.

## Checks

Before every commit, run `npm run lint` and `npm test`, and make sure both
pass. To fix formatting, run `npm run format`.

## Content boundaries

Artifacts describe the product, not the conversations that produced it. Don't
include details from planning or review discussions that the artifact doesn't
need, such as possible future technology choices, who approved what, or how
the work was split among agents. Planning labels, such as milestone names,
stay out of files, commit messages, and pull requests.
