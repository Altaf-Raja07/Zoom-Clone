/**
 * The browser seam needs both halves of the app genuinely running: the identity
 * cookie only exists if a real browser is talking to a real FastAPI, and a
 * stubbed backend would prove nothing about identity at all.
 *
 * So both servers are started here, and each waits for its own health signal
 * rather than for a fixed delay. `reuseExistingServer` keeps a local
 * `./scripts/dev-*.sh` session usable without a port clash — note that a reused
 * server keeps whatever settings it was already started with, so a CORS
 * allowlist that does not include the frontend origin shows up as every test
 * failing rather than as one clear error.
 */

import { defineConfig, devices } from "@playwright/test";

const FRONTEND_PORT = 3100;
const BACKEND_PORT = 8000;
const FRONTEND_ORIGIN = `http://localhost:${FRONTEND_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  webServer: [
    {
      command: "../scripts/dev-frontend.sh",
      url: FRONTEND_ORIGIN,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // One entry point for running the backend, so a developer and the test
      // runner start the same thing with the same settings.
      command: "../scripts/dev-backend.sh",
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        // The frontend's origin has to be in the single CORS allowlist, or
        // every request from the browser is refused.
        MEETLY_CORS_ORIGINS: FRONTEND_ORIGIN,
        MEETLY_COOKIE_SECRET: "playwright-test-secret",
        // Relative to backend/, where the script runs from. Kept off the
        // development database so a test run cannot leave rows behind in it.
        MEETLY_DATABASE_PATH: "data/playwright.sqlite3",
      },
    },
  ],
  use: {
    baseURL: FRONTEND_ORIGIN,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
