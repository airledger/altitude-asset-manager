// End-to-end run against the real beta site and database: every main part of Air Ledger, used the way a
// business would, on a desktop browser (Chrome) and on an iPhone-sized Safari. Run by .github/workflows/e2e.yml.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 10 * 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "report" }]],
  use: {
    baseURL: process.env.E2E_URL,
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    screenshot: "on",
    trace: "retain-on-failure",
    acceptDownloads: true,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } },
    { name: "iphone", use: { ...devices["iPhone 15"] } },
  ],
});
