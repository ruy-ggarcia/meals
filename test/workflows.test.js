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

describe(".github/workflows/release.yml", () => {
  // GitHub evaluates the env of a step before its if, so fromJSON of an empty
  // output fails the job even when the step would be skipped.
  // A release must publish even when the cleanup of the release pull request
  // fails, so publish can't need the job that runs the cleanup.
  test("publishes without the job that cleans the release notes", async () => {
    const workflow = await readFile(path.join(REPO, ".github", "workflows", "release.yml"), "utf8");

    // Each job runs from its key to the next line with less indentation.
    const jobs = Object.fromEntries(
      [...workflow.matchAll(/^ {2}([a-z-]+):\n((?:(?: {4}.*)?\n)*)/gm)].map((match) => [
        match[1],
        match[2],
      ]),
    );
    const cleaner = Object.keys(jobs).find((name) => jobs[name].includes("clean-release-notes.js"));
    const needs = jobs.publish?.match(/^ {4}needs: (.+)$/m)?.[1] ?? "";

    assert.ok(cleaner, "no job of release.yml runs scripts/clean-release-notes.js");
    assert.ok(
      !needs.includes(cleaner),
      `publish needs ${cleaner}, so a failed cleanup skips the release: run the cleanup in a job of its own`,
    );
  });

  test("calls fromJSON in no env of a step", async () => {
    const workflow = await readFile(path.join(REPO, ".github", "workflows", "release.yml"), "utf8");

    // Each env block runs from its key to the next line with less indentation.
    const envs = [...workflow.matchAll(/^( +)env:\n(?:\1 {2}.*\n)*/gm)].map((match) => match[0]);
    const offending = envs.filter((env) => env.includes("fromJSON("));

    assert.ok(envs.length > 0, "release.yml has no env block");
    assert.deepEqual(
      offending,
      [],
      "an env block of release.yml calls fromJSON: read the JSON with jq in the step instead",
    );
  });
});
