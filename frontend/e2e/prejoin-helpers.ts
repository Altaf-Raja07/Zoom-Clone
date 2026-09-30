/**
 * The two things every pre-join test needs before it can say anything.
 *
 * Both were written twice — once in each Playwright project — and drifted while
 * they were: one copy grew a `contextOptions` parameter and the other did not,
 * and one of the copies opened a second tab to read an Invite Link that most of
 * its callers never used. A helper that exists twice is not a helper. It is the
 * shape of the setup that has to be kept in step by hand, which is exactly the
 * kind of thing that makes "works on my machine" bugs.
 */

import {
  Browser,
  BrowserContext,
  Locator,
  Page,
  expect,
} from "@playwright/test";

/**
 * A Host with a Meeting, sitting on its pre-join screen.
 *
 * The Meeting is created over the real API by clicking the real button, so a test
 * is never asserting against a Meeting the application could not actually make,
 * and the identity cookie is whatever the dashboard minted — which is what makes
 * this browser the Host rather than a guest.
 *
 * The Invite Link is only fetched when `withInviteLink` is asked for. It costs a
 * second tab in the same context, and most callers of this helper are testing the
 * host's own screen and have nothing to do with sharing.
 */
export async function hostOnPreJoin(
  browser: Browser,
  withInviteLink = false,
): Promise<{
  context: BrowserContext;
  page: Page;
  meetingUuid: string;
  inviteLink: string | null;
}> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/");
  await page.getByRole("button", { name: "New Meeting" }).click();
  await expect(page).toHaveURL(/\/prejoin\/[0-9a-f-]{36}$/);
  const meetingUuid = page.url().split("/prejoin/")[1] ?? "";
  expect(meetingUuid).toMatch(/^[0-9a-f-]{36}$/);

  let inviteLink: string | null = null;
  if (withInviteLink) {
    // Read in a *second* tab in the same context, so the tab under test stays on
    // the pre-join screen rather than being navigated away from it to fetch a
    // string. Same cookie, so it is the same Host either way.
    const reader = await context.newPage();
    await reader.goto(`/room/${meetingUuid}`);
    await expect(reader.getByTestId("invite-path")).toBeVisible();
    inviteLink = (await reader.getByTestId("invite-path").textContent()) ?? "";
    await reader.close();
  }

  return { context, page, meetingUuid, inviteLink };
}

/**
 * A guest, from an Invite Link to the pre-join screen, named.
 *
 * Two steps, because there are two: the join screen resolves *which* Meeting, and
 * the pre-join screen is where the name is confirmed beside a preview. Filling a
 * name on the join screen would be testing a field that is deliberately not there
 * any more.
 */
export async function guestOnPreJoin(
  browser: Browser,
  inviteLink: string,
  name: string,
): Promise<{ guest: BrowserContext; page: Page }> {
  const guest = await browser.newContext();
  const page = await guest.newPage();

  await page.goto(inviteLink);
  await page.getByTestId("join-button").click();
  await expect(page).toHaveURL(/\/prejoin\//);
  await page.getByTestId("display-name").fill(name);

  return { guest, page };
}

/**
 * Wait for the browser to have answered about the devices.
 *
 * The toggles render as *on* until it does, because that is the state a person is
 * in who has not been asked. A test that reads one straight after navigation is
 * reading a decision that is about to be revised, and on a machine with no camera
 * it will be wrong about the meeting while being right about the DOM.
 */
export async function waitForDevices(page: Page) {
  await expect(page.locator("main[data-devices]")).toHaveAttribute(
    "data-devices",
    "settled",
  );
}

/**
 * What a device toggle is currently claiming.
 *
 * A read rather than an `expect`, because several callers need the answer to
 * *decide what to assert* rather than to assert it: on a machine with no webcam,
 * "the camera is off" is both the pre-join default and the correct outcome, and a
 * test that hard-codes either one passes whether or not the behaviour under test
 * happened. Read it, then assert that the room matches.
 *
 * Waits for the devices to have been answered first, or it reads the state a
 * person is in *before they have been asked*, which is on for both toggles.
 */
export async function isPressed(page: Page, testId: string): Promise<boolean> {
  await waitForDevices(page);
  return (await page.getByTestId(testId).getAttribute("aria-pressed")) === "true";
}

/**
 * Put a device toggle into a known state, clicking until it is there.
 *
 * Not `click()` and assume. On a machine with no camera the toggle *starts off* —
 * pre-join sets it off on arrival, because the button would otherwise claim video
 * is on while nothing is being sent — so a bare click turns it **on**. A test that
 * clicks and then asserts "off" passes on a machine with a camera and fails
 * without one, which is the same "only works on my laptop" bug the pre-join
 * screen exists to avoid, one level up.
 *
 * Clicking at most twice means a test that has already put it where it wants does
 * no clicking at all, so this is also a no-op in the camera project.
 */
export async function setToggle(
  page: Page,
  testId: string,
  wantPressed: boolean,
) {
  await waitForDevices(page);
  const toggle = page.getByTestId(testId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if ((await toggle.getAttribute("aria-pressed")) === String(wantPressed)) return;
    await toggle.click();
  }
  expect(await toggle.getAttribute("aria-pressed")).toBe(String(wantPressed));
}

/**
 * Refuse one device, in the way a browser refuses it.
 *
 * `getUserMedia` rejects with a `DOMException` whose `name` is the only thing
 * distinguishing the failures, so the stub rejects with the same one a browser
 * does. This is the *only* thing stubbed: the page, the API and the storage are
 * all real.
 *
 * Needed because a headless browser cannot refuse a permission on demand. With no
 * device present the answer is always `NotFoundError` — a missing device — and the
 * `--use-fake-ui-for-media-stream` flag that would make a permission grantable is
 * also what makes it grantable to refuse. So "denied" has to be produced, and
 * "missing" is left genuine.
 *
 * `times` is how many calls refuse before the stub gets out of the way. It has to
 * be a count rather than a switch because a stub installed before a page load
 * survives a *reload* — so a test for the retry button, which is the whole point
 * of offering one, would find the camera failing for ever and the retry
 * meaningless. `times: 1` is the shape of that test: the person arrives to a
 * refusal, unblocks, and the retry succeeds.
 *
 * "For ever" is spelled `null` rather than `Infinity` because Playwright
 * serialises the argument into the page, and `JSON.stringify(Infinity)` is
 * `null` — which would arrive as "refuse never" and quietly turn every one of
 * these tests into a test of a working camera.
 */
export async function refuseDevice(
  page: Page,
  kind: "video" | "audio",
  { name = "NotAllowedError", times = null }: {
    name?: "NotAllowedError" | "NotFoundError";
    /** How many calls refuse, or `null` for all of them. */
    times?: number | null;
  } = {},
) {
  await page.addInitScript(
    ({ kind, name, times }) => {
      let refusalsLeft = times;
      const real =
        navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (constraints: MediaStreamConstraints) => {
        if (constraints[kind] && refusalsLeft !== 0) {
          if (refusalsLeft !== null) refusalsLeft -= 1;
          return Promise.reject(new DOMException("Refused", name));
        }
        return real(constraints);
      };
    },
    { kind, name, times },
  );
}

/**
 * How wide a `<video>` really is, once it has settled.
 *
 * The measurement the happy path needs and the measurement the *unhappy* paths
 * need are the same question — "is there a stream in this element, or is it a
 * black rectangle?" — and `toBeVisible()` cannot answer it: a `<video>` with
 * nothing in it renders at any size and passes. `videoWidth` is zero until a
 * stream actually arrives, which is the one honest signal a page can read.
 *
 * Resolves rather than throws on timeout, so a caller asserting "greater than
 * zero" gets a failure naming the width instead of a timeout naming nothing.
 */
export async function streamWidth(preview: Locator): Promise<number> {
  return preview.evaluate(
    (element) =>
      new Promise<number>((resolve) => {
        const video = element as HTMLVideoElement;
        const report = () => resolve(video.videoWidth);
        if (video.videoWidth > 0) {
          report();
          return;
        }
        video.addEventListener("loadedmetadata", report, { once: true });
        setTimeout(report, 4_000);
      }),
  );
}
