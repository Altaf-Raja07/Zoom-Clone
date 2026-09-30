/**
 * Seam 2: the running frontend, driven in a browser — with a camera.
 *
 * The half of the pre-join screen that needs a working `getUserMedia`: a real
 * preview, a real Display Name to correct, two real toggles whose states arrive
 * in the room, and — because a working camera is the only place it is observable
 * — one device failing while the other works.
 *
 * **These run in the `chromium-camera` Playwright project, not in a `describe`
 * block**, because Chromium's fake-device flags are read at browser launch.
 * `test.use({launchOptions})` inside a `describe` is refused by Playwright for
 * exactly that reason, so the two halves of this ticket — a machine *with* a
 * camera and a machine without one — are two projects rather than two flag
 * toggles. `pre-join-screen.spec.ts` is the other half.
 *
 * `--use-fake-device-for-media-stream` supplies a camera and microphone that
 * produce real frames, and `--use-fake-ui-for-media-stream` grants the permission
 * without a prompt. Both are needed: the first alone still hits a permission
 * dialog a headless browser cannot answer.
 *
 * That is also what makes this the right place for the *per-device* failures.
 * Removing one device while keeping the other working is not something a machine
 * can be talked into, but it is exactly what a refusal stub can produce — and the
 * claim under test (that one failure must not take the other down) is only
 * meaningful when the survivor genuinely works.
 */

import { expect, test } from "@playwright/test";

import {
  guestOnPreJoin,
  hostOnPreJoin,
  isPressed,
  refuseDevice,
  setToggle,
  streamWidth,
  waitForDevices,
} from "./prejoin-helpers";

test.describe("with a working camera", () => {
  test("pre-join shows a live local camera preview", async ({ browser }) => {
    const { context, page } = await hostOnPreJoin(browser);

    // Straight to the pre-join screen rather than through the room: the host is
    // answered here now, and going via the room would be testing a path that no
    // longer exists.
    const preview = page.getByTestId("camera-preview");
    await expect(preview).toBeVisible();

    // A real preview has real dimensions and is actually playing. A black tile
    // and a live video are the same element with different `videoWidth`, which is
    // why the visible-and-sized check alone is not enough: `<video>` renders at
    // any size whether or not a stream arrived.
    expect(await streamWidth(preview)).toBeGreaterThan(0);
    expect(
      await preview.evaluate(
        (element) => (element as HTMLVideoElement).readyState,
      ),
    ).toBeGreaterThanOrEqual(2);

    await context.close();
  });

  test("the display name arrives pre-filled and stays editable", async ({
    browser,
  }) => {
    const { context, page } = await hostOnPreJoin(browser);
    const name = page.getByTestId("display-name");
    await expect(name).not.toHaveValue("");

    await name.fill("Altaf R.");

    // And the edited value is what reaches the room, not the generated one — the
    // whole point of pre-filling is that it can be corrected.
    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("your-name")).toHaveText("Altaf R.");

    await context.close();
  });

  test("camera and microphone can each be turned off before entering", async ({
    browser,
  }) => {
    const { context, page } = await hostOnPreJoin(browser);
    await expect(page.getByTestId("camera-preview")).toBeVisible();

    // `setToggle` rather than a bare `click()`: it waits for the browser to have
    // answered about the devices, and a click that lands first is undone by that
    // answer arriving. A test that clicks and asserts would be asserting against a
    // state the screen is about to revise.
    await setToggle(page, "toggle-camera", false);
    await setToggle(page, "toggle-microphone", false);

    // The controls say what they will do, so the state is legible without
    // decoding an icon.
    await expect(page.getByTestId("toggle-camera")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByTestId("toggle-microphone")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\//);

    // Both states arrived, not just the fact of arriving.
    await expect(page.getByTestId("room-camera-state")).toHaveText(/off/i);
    await expect(page.getByTestId("room-microphone-state")).toHaveText(/off/i);

    await context.close();
  });

  test("turning the camera off and on again comes back as a live preview", async ({
    browser,
  }) => {
    const { context, page } = await hostOnPreJoin(browser);
    await expect(page.getByTestId("camera-preview")).toBeVisible();
    await waitForDevices(page);

    // The preview is unmounted while the camera is off, so turning it back on
    // mounts a *new* video element. If nothing attaches the stream to it, what
    // the person sees is a black rectangle with the camera light on and no
    // explanation — the exact failure this screen must not have, and one that a
    // test checking only `aria-pressed` would sail straight past.
    await page.getByTestId("toggle-camera").click();
    await expect(page.getByTestId("camera-fallback")).toBeVisible();
    await expect(page.getByTestId("camera-preview")).toHaveCount(0);

    await page.getByTestId("toggle-camera").click();
    const preview = page.getByTestId("camera-preview");
    await expect(preview).toBeVisible();

    // Live, not merely present: a `<video>` renders at any size with nothing in
    // it, and only a stream gives it dimensions.
    expect(await streamWidth(preview)).toBeGreaterThan(0);

    await context.close();
  });

  test("device choices survive being left on defaults", async ({ browser }) => {
    const { context, page } = await hostOnPreJoin(browser);
    await expect(page.getByTestId("camera-preview")).toBeVisible();

    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\//);

    await expect(page.getByTestId("room-camera-state")).toHaveText(/on/i);
    await expect(page.getByTestId("room-microphone-state")).toHaveText(/on/i);

    await context.close();
  });
});

test.describe("with one device refused", () => {
  test("a refused camera comes back when the person retries, and is honest until then", async ({
    browser,
  }) => {
    const { context, page } = await hostOnPreJoin(browser);
    // Once, not always: the retry is what this test is about, and a stub that
    // refused for ever would leave the retry untested and still green.
    await refuseDevice(page, "video", { times: 1 });
    await page.reload();
    await waitForDevices(page);

    // The refusal is reported and the toggle is *off*, because nothing is being
    // sent. A button reading "On" here is what the ticket calls out: the room
    // would be told the opposite of what is true.
    await expect(page.getByTestId("camera-notice")).toBeVisible();
    expect(await isPressed(page, "toggle-camera")).toBe(false);
    await expect(page.getByTestId("camera-preview")).toHaveCount(0);

    // A refusal is the one failure a person can undo, so there is something to
    // try. `NotAllowedError` is what this stubs; the flag that auto-grants is
    // still in place for this project, so the retry genuinely succeeds.
    await page.getByTestId("retry-devices").click();
    await expect(page.locator("main[data-devices]")).toHaveAttribute(
      "data-devices",
      "settled",
    );

    // The notice is gone and the preview is there. Not just *an* element: a
    // retry that left a mounted `<video>` with no stream in it would satisfy
    // `toBeVisible` and be a black tile, so the width is the assertion.
    await expect(page.getByTestId("camera-notice")).toHaveCount(0);
    const preview = page.getByTestId("camera-preview");
    await expect(preview).toBeVisible();
    expect(await isPressed(page, "toggle-camera")).toBe(true);
    expect(await streamWidth(preview)).toBeGreaterThan(0);

    await context.close();
  });

  test("a missing camera is explained differently, and is not offered a retry", async ({
    browser,
  }) => {
    const { context, page } = await hostOnPreJoin(browser);
    // `NotFoundError` is what a machine with no webcam answers with, as distinct
    // from the refusal above. The two call for opposite actions — grant a
    // permission, or buy a camera — so they must not read the same.
    await refuseDevice(page, "video", { name: "NotFoundError" });
    await page.reload();
    await waitForDevices(page);

    const notice = page.getByTestId("camera-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/camera/i);
    // The way forward, and it has to be joining: nothing on this machine is
    // going to change if they wait.
    await expect(notice).toContainText(/join/i);

    // No retry. A button that can only fail is a promise not kept, and retrying a
    // machine with no webcam produces the same answer for ever.
    await expect(page.getByTestId("retry-devices")).toHaveCount(0);

    // The camera is off because there is nothing to turn on, and the room is told
    // so.
    expect(await isPressed(page, "toggle-camera")).toBe(false);
    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\//);
    await expect(page.getByTestId("room-camera-state")).toHaveText("Off");

    await context.close();
  });

  test("a refused camera does not take the microphone down with it", async ({
    browser,
  }) => {
    const { context, page } = await hostOnPreJoin(browser);
    await refuseDevice(page, "video");
    await page.reload();
    await waitForDevices(page);

    // This is why the devices are asked for separately. One
    // `getUserMedia({video, audio})` call fails *entirely* if either is missing,
    // which is the difference between a person who cannot be seen and a person
    // who is merely not heard. A machine with a camera but no microphone is the
    // only place that difference is observable, which is why this is here and not
    // in the project with no devices at all.
    await expect(page.getByTestId("camera-preview")).toHaveCount(0);
    expect(await isPressed(page, "toggle-microphone")).toBe(true);

    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\//);
    await expect(page.getByTestId("room-camera-state")).toHaveText("Off");
    await expect(page.getByTestId("room-microphone-state")).toHaveText("On");

    await context.close();
  });

  test("a refused microphone does not take the camera down with it", async ({
    browser,
  }) => {
    const { context, page } = await hostOnPreJoin(browser);
    await refuseDevice(page, "audio", { name: "NotFoundError" });
    await page.reload();
    await waitForDevices(page);

    // The camera survived, and is still live.
    await expect(page.getByTestId("camera-preview")).toBeVisible();
    expect(await isPressed(page, "toggle-camera")).toBe(true);

    // The microphone is off — nothing is being sent — and says why, in its own
    // words rather than the camera's.
    await expect(page.getByTestId("microphone-notice")).toContainText(
      /microphone/i,
    );
    expect(await isPressed(page, "toggle-microphone")).toBe(false);

    // And a microphone that is not there is not offered a retry, because the
    // answer would be the same for ever.
    await expect(page.getByTestId("retry-devices")).toHaveCount(0);

    // Still enterable, and the room is told the truth about both devices.
    await expect(page.getByTestId("join-button")).toBeEnabled();
    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\//);
    await expect(page.getByTestId("room-camera-state")).toHaveText("On");
    await expect(page.getByTestId("room-microphone-state")).toHaveText("Off");

    await context.close();
  });
});

test.describe("two people, one meeting", () => {
  test("the host's and the guest's device choices are each their own", async ({
    browser,
  }) => {
    // Opposite states on purpose, and this is the project where that is possible:
    // a real camera for both, so the host can turn theirs off and leave the
    // guest's on. On a machine with no webcam both would be off and the test could
    // not tell "the guest's own choice arrived" from "both were off for the same
    // boring reason".
    const host = await hostOnPreJoin(browser, true);
    await setToggle(host.page, "toggle-camera", false);
    await host.page.getByTestId("join-button").click();
    await expect(host.page).toHaveURL(/\/room\//);
    await expect(host.page.getByTestId("room-camera-state")).toHaveText("Off");

    const { guest, page: guestPage } = await guestOnPreJoin(
      browser,
      host.inviteLink ?? "",
      "Priya",
    );

    // The guest's link carried nothing, and their camera is on because this
    // machine has one — not because the host turned theirs off.
    expect(await isPressed(guestPage, "toggle-camera")).toBe(true);
    await guestPage.getByTestId("join-button").click();
    await expect(guestPage).toHaveURL(/\/room\/[0-9a-f-]{36}$/);
    await expect(guestPage.getByTestId("room-camera-state")).toHaveText("On");

    // Two people, one Meeting, opposite cameras. The whole point of the handoff
    // being per-tab and per-meeting rather than in the link.
    await expect(host.page.getByTestId("room-camera-state")).toHaveText("Off");

    await guest.close();
    await host.context.close();
  });
});

// Desktop, tablet and narrow, because a preview that does not fit is not a
// preview. Three widths for the reason the other screens are checked at three.
for (const width of [1280, 768, 375]) {
  test(`pre-join fits a ${width}px screen`, async ({ browser }) => {
    const { context, page } = await hostOnPreJoin(browser);
    await page.setViewportSize({ width, height: 720 });
    await expect(page.getByTestId("join-button")).toBeVisible();

    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);

    await context.close();
  });
}
