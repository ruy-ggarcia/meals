// Settings of the browser tests in e2e/. Each test starts its own server, so
// there's no web server to start here.

import { defineConfig, devices } from "@playwright/test";

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: ci,
  // In CI, a test that passes only on its retry fails the run.
  failOnFlakyTests: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [["dot"], ["html", { open: "never" }]] : "dot",
  use: {
    locale: "en-US",
    timezoneId: "Europe/Madrid",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/*.mobile.spec.js",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      testIgnore: "**/*.mobile.spec.js",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testIgnore: "**/*.mobile.spec.js",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "pixel",
      testMatch: "**/*.mobile.spec.js",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "iphone",
      testMatch: "**/*.mobile.spec.js",
      use: { ...devices["iPhone 15"] },
    },
  ],
});
