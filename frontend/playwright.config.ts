/**
 * The browser seam needs both halves of the app genuinely running: the identity
 * cookie only exists if a real browser is talking to a real FastAPI, and a
 * stubbed backend would prove nothing about identity at all.
 *
 * So both servers are started here, and each waits for its own health signal
 * rather than for a fixed delay. `reuseExistingServer` keeps a local
 * `./scripts/dev-*.sh` session usable without a port clash — with two traps
 * that both look like flaky tests rather than like the environment:
 *
 * - A reused server keeps whatever settings it was already started with, so a
 *   CORS allowlist that does not include the frontend origin shows up as every
 *   test failing rather than as one clear error.
 * - A reused *frontend* can also be a stale or wedged one. A `next dev` left
 *   running for hours across many edits eventually answers every route with a
 *   500, and the health probe still passes, so the run borrows it and fails one
 *   unrelated test at a time. Before believing a flake, check
 *   `curl -o /dev/null -w '%{http_code}' http://localhost:3100/` — and if it is
 *   not 200, restart the dev server rather than the test.
 */

import { defineConfig, devices } from "@playwright/test";

// Both ports are overridable, so a run can be pointed somewhere other than the
// defaults — at a second worktree, or away from whatever else already holds
// 8000 on this machine. The collision that makes this necessary looks like a
// test failure: `reuseExistingServer` sees *something* answering on the port,
// reuses it, and then the run fails against code that is not its own.
//
// Note what this does **not** isolate: `MEETLY_DATABASE_PATH` and
// `MEETLY_COOKIE_SECRET` below are still the defaults, so two concurrent runs
// share one database. Separate the ports *and* those two before running two
// suites at once, or they will interleave rows.
const FRONTEND_PORT = Number(process.env.MEETLY_TEST_FRONTEND_PORT ?? 3100);
const BACKEND_PORT = Number(process.env.MEETLY_TEST_BACKEND_PORT ?? 8000);
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
      env: {
        // The browser talks to the API directly, so the *frontend* has to be
        // built with the same backend origin the tests are about to start. Left
        // unset it falls back to port 8000 in `src/lib/api.ts`, which silently
        // points a run on any other port at whatever else is listening there.
        NEXT_PUBLIC_API_BASE_URL: `http://localhost:${BACKEND_PORT}`,
        PORT: String(FRONTEND_PORT),
      },
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
        PORT: String(BACKEND_PORT),
      },
    },
  ],
  use: {
    baseURL: FRONTEND_ORIGIN,
  },
  // Two projects rather than one, because the camera flags are read at browser
  // launch and cannot be changed per test — `test.use({launchOptions})` inside a
  // `describe` is refused by Playwright for exactly that reason. The pre-join
  // screen needs both worlds to be testable: a machine *with* a camera, and a
  // machine without one. Chromium's fake device is the stand-in for the former,
  // and the plain project's genuine absence is the honest version of the latter.
  //
  // Matched on the `-camera.spec.ts` *suffix* rather than on one filename, so a
  // second spec that needs the fake device joins the right project by following
  // the convention instead of by editing this file. `pre-join-camera` and
  // `mute-video-panel-camera` are both routed this way, and each of them says so
  // in its own header.
  projects: [
    {
      name: "chromium",
      testIgnore: /-camera\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-camera",
      testMatch: /-camera\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["camera", "microphone"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
  ],
});
