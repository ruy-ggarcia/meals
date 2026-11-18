import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");

describe(".github/workflows/ci.yml", () => {
  // Dependabot updates @playwright/test but not the image of a workflow job,
  // so this test fails its pull request until the tag catches up. The test
  // can't check the digest offline.
  test("tags the e2e image with the @playwright/test version of package.json", async () => {
    const workflow = await readFile(path.join(REPO, ".github", "workflows", "ci.yml"), "utf8");
    const manifest = JSON.parse(await readFile(path.join(REPO, "package.json"), "utf8"));
    const expected = manifest.devDependencies["@playwright/test"];

    // The e2e job runs from its key to the next line with less indentation.
    const job = workflow.match(/^ {2}e2e:\n(?:(?: {4}.*)?\n)*/m)?.[0] ?? "";
    const image = job.match(/^ {6}image: mcr\.microsoft\.com\/playwright:v([^-@\s]+)-/m);

    assert.ok(
      image,
      "the e2e job of ci.yml has no container image from mcr.microsoft.com/playwright",
    );
    assert.equal(
      image[1],
      expected,
      `the e2e job of ci.yml runs the Playwright ${image[1]} image, but package.json has @playwright/test ${expected}: update the tag and the digest of the image`,
    );
  });
});
