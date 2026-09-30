/**
 * Seam 2: the running frontend, driven in a browser — without a camera.
 *
 * The half of the pre-join screen that the ticket is actually about: what happens
 * when the camera is denied, when the machine has none, and when somebody
 * deliberately turns their video off. All three must say what happened and all
 * three must still reach the room.
 *
 * A pre-join screen that works only on a machine with a webcam proves nothing the
 * happy path does not already prove, and the failure it hides is the one a
 * reviewer on a locked-down laptop hits first. That is why these run against the
 * plain `chromium` project with no fake device at all: the absence here is
 * genuine rather than staged. `pre-join-camera.spec.ts` is the other half, and
 * runs in the `chromium-camera` project because Chromium's fake-device flags are
 * read at browser launch and cannot be set per `describe`.
 *
 * Also here: the pre-join → room handoff, because the malformed and missing cases
 * are states of the *browser* — a bookmarked room URL, a value another tab left
 * behind — and only a real browser can be put into them.
 */

import { expect, test } from "@playwright/test";

import {
  guestOnPreJoin,
  hostOnPreJoin,
  isPressed,
  refuseDevice,
  setToggle,
  waitForDevices,
} from "./prejoin-helpers";

test.describe("the pre-join to room handoff", () => {
  test("the room receives exactly what pre-join recorded", async ({ browser }) => {
    const { context, page, meetingUuid } = await hostOnPreJoin(browser);

    await page.getByTestId("display-name").fill("Tomas");
    await setToggle(page, "toggle-camera", false);
    await setToggle(page, "toggle-microphone", false);
    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\//);

    await expect(page.getByTestId("your-name")).toHaveText("Tomas");
    await expect(page.getByTestId("room-camera-state")).toHaveText("Off");
    await expect(page.getByTestId("room-microphone-state")).toHaveText("Off");

    await context.close();
  });

  test("the entry is consumed, so a reload does not re-apply it", async ({
    browser,
  }) => {
    const { context, page } = await hostOnPreJoin(browser);
    await setToggle(page, "toggle-microphone", false);
    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\//);
    await expect(page.getByTestId("room-microphone-state")).toHaveText("Off");

    // The storage key is gone once the room has read it. This is what stops a
    // reload silently un-muting somebody who muted to get into a meeting — the
    // worst failure this handoff could have.
    const remaining = await page.evaluate(
      () =>
        Object.keys(window.sessionStorage).filter((key) =>
          key.startsWith("meetly:prejoin:"),
        ),
    );
    expect(remaining).toEqual([]);

    await page.reload();
    // Defaults on a reload, because there is nothing left to apply.
    await expect(page.getByTestId("room-microphone-state")).toHaveText("On");

    await context.close();
  });

  test("a second meeting in the same tab does not inherit the first one's choices", async ({
    browser,
  }) => {
    const { context, page } = await hostOnPreJoin(browser);
    await setToggle(page, "toggle-camera", false);
    await setToggle(page, "toggle-microphone", false);
    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\//);
    await expect(page.getByTestId("room-camera-state")).toHaveText("Off");

    // A second Meeting, created from this same tab. Two meetings in one tab is
    // the ordinary case, not an edge case.
    await page.goto("/");
    await page.getByRole("button", { name: "New Meeting" }).click();
    await expect(page).toHaveURL(/\/prejoin\//);

    // Read what pre-join *chose* this time, for each device **on its own**
    // rather than assuming a default. Two reasons, and they are different: on a
    // machine with no camera the default is already "off", which would make the
    // assertion pass whether or not the first meeting's choices leaked — and the
    // leak is the whole thing being tested. And the microphone starts off for a
    // reason of its own, so deriving its expectation from the *camera* would fail
    // on a machine with a camera and no microphone, where pre-join is right and
    // the test is not.
    await waitForDevices(page);
    const cameraStartsOn = await isPressed(page, "toggle-camera");
    const microphoneStartsOn = await isPressed(page, "toggle-microphone");

    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\//);

    await expect(page.getByTestId("room-camera-state")).toHaveText(
      cameraStartsOn ? "On" : "Off",
    );
    await expect(page.getByTestId("room-microphone-state")).toHaveText(
      microphoneStartsOn ? "On" : "Off",
    );

    await context.close();
  });

  test("a value pre-join did not write opens the room on its defaults", async ({
    browser,
  }) => {
    const { context, page, meetingUuid } = await hostOnPreJoin(browser);

    // Each of these is the kind of thing a person, another tab, or an older
    // version of this app can leave behind. A room that trusted any of them would
    // open with somebody muted and dark because a string was truthy where a
    // boolean was expected — with no error anywhere to trace it to.
    for (const stored of [
      "not json",
      "42",
      "null",
      "[true, true]",
      // A name in the entry is no longer a field we write, and a stored one is
      // not a reason to reject a value whose two booleans are sound.
      '{"displayName":"Priya","microphoneOn":true}',
      // The two that must be rejected, because a string is truthy where a boolean
      // was expected — a meeting that opens with somebody muted, with no error
      // anywhere to trace it to.
      '{"microphoneOn":"yes","cameraOn":true}',
      '{"microphoneOn":true,"cameraOn":1}',
      '{"microphoneOn":true}',
      "{}",
    ]) {
      await page.evaluate(
        ({ key, value }) => window.sessionStorage.setItem(key, value),
        { key: `meetly:prejoin:${meetingUuid}`, value: stored },
      );

      await page.goto(`/room/${meetingUuid}`);
      await expect(page.getByTestId("room-camera-state")).toHaveText("On");
      await expect(page.getByTestId("room-microphone-state")).toHaveText("On");
    }

    await context.close();
  });

  test("a copied invite link carries nothing of the host's into the guest", async ({
    browser,
  }) => {
    const host = await hostOnPreJoin(browser, true);

    // The host enters first, so its own state is on the record and its stored
    // entry has been consumed — the arrangement that makes a leak possible.
    await host.page.getByTestId("join-button").click();
    await expect(host.page).toHaveURL(/\/room\//);
    const hostCamera = await host.page
      .getByTestId("room-camera-state")
      .textContent();
    const hostMicrophone = await host.page
      .getByTestId("room-microphone-state")
      .textContent();

    // A different context entirely, so nothing in the host's `sessionStorage` can
    // be what made this work.
    const { guest, page: guestPage } = await guestOnPreJoin(
      browser,
      host.inviteLink ?? "",
      "Priya",
    );

    // The link is a `/join` path and carries nothing. This is the assertion that
    // makes the rest mean anything: a device preference in a link would be a
    // stranger's camera settings arriving in somebody else's browser, and it is
    // asserted before the guest has pressed anything, so nothing they did can be
    // mistaken for it.
    expect(
      await guestPage.evaluate(() =>
        Object.keys(window.sessionStorage).filter((key) =>
          key.startsWith("meetly:prejoin:"),
        ),
      ),
    ).toEqual([]);

    // The guest's own name, and their own devices — whatever *this* machine's
    // answer was, read rather than assumed. On a machine with no webcam that is
    // "off", and asserting anything else would be asserting hardware.
    await expect(guestPage.getByTestId("display-name")).toHaveValue("Priya");
    const guestCamera = await isPressed(guestPage, "toggle-camera");
    const guestMicrophone = await isPressed(guestPage, "toggle-microphone");

    await guestPage.getByTestId("join-button").click();
    await expect(guestPage).toHaveURL(/\/room\/[0-9a-f-]{36}$/);
    await expect(guestPage.getByTestId("your-name")).toHaveText("Priya");
    await expect(guestPage.getByTestId("room-camera-state")).toHaveText(
      guestCamera ? "On" : "Off",
    );
    await expect(guestPage.getByTestId("room-microphone-state")).toHaveText(
      guestMicrophone ? "On" : "Off",
    );

    // And the host is untouched by anything the guest did. Compared rather than
    // reloaded: the stored entry is consumed on read, so a reload would reset the
    // host to the room's defaults and this would be asserting nothing.
    await expect(host.page.getByTestId("room-camera-state")).toHaveText(
      hostCamera ?? "",
    );
    await expect(host.page.getByTestId("room-microphone-state")).toHaveText(
      hostMicrophone ?? "",
    );

    await guest.close();
    await host.context.close();
  });

  test("storage being unavailable does not stop anybody joining", async ({
    browser,
  }) => {
    const { context, page } = await hostOnPreJoin(browser);

    // Private browsing and blocked third-party contexts both produce a
    // `sessionStorage` that throws. The person loses their device preferences for
    // one visit, which is a far smaller cost than refusing to let them into a
    // meeting they are standing in front of.
    await page.addInitScript(() => {
      Object.defineProperty(window, "sessionStorage", {
        configurable: true,
        get() {
          throw new Error("SecurityError: storage is not available");
        },
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "New Meeting" }).click();
    await expect(page).toHaveURL(/\/prejoin\//);

    await page.getByTestId("display-name").fill("No Storage");
    await expect(page.getByTestId("join-button")).toBeEnabled();
    await page.getByTestId("join-button").click();

    await expect(page).toHaveURL(/\/room\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("room-camera-state")).toHaveText("On");

    await context.close();
  });
});

/**
 * A camera the browser *refuses*, rather than one that is absent.
 *
 * The two are different sentences to a person — "you clicked Block" and "this
 * laptop has no webcam" lead to opposite actions — and the ticket asks for both.
 * The refusal has to be produced, because a headless browser cannot make one on
 * demand; the *missing device* case below is left genuine. `refuseDevice` is the
 * one thing stubbed: the page, the API and the storage are all real.
 */
test.describe("with the camera permission denied", () => {
  test("says what happened, offers a way forward, and still reaches the room", async ({
    browser,
  }) => {
    const host = await hostOnPreJoin(browser, true);
    const { guest, page } = await guestOnPreJoin(
      browser,
      host.inviteLink ?? "",
      "Priya",
    );
    await refuseDevice(page, "video");
    await page.reload();
    await expect(page).toHaveURL(/\/prejoin\//);
    await waitForDevices(page);

    // A sentence naming the cause *and* the way forward. Asserted on the words
    // being present and specific rather than on any exact phrasing, because a
    // notice that said "error" would satisfy a looser test and tell a user
    // nothing. "Blocked" alone would name the cause and still leave them unsure
    // whether anything can be done about it.
    const notice = page.getByTestId("camera-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/camera/i);
    await expect(notice).toContainText(/permission|allow/i);
    await expect(notice).toContainText(/join/i);

    // The black rectangle is replaced by something that says what it is, rather
    // than a `<video>` with nothing in it.
    await expect(page.getByTestId("camera-fallback")).toBeVisible();
    await expect(page.getByTestId("camera-preview")).toHaveCount(0);

    // A refusal is the one device failure a person can undo, so the screen offers
    // the try-again that could actually work. "No camera" does not, and offering
    // it there would be a button that can only fail.
    await expect(page.getByTestId("retry-devices")).toBeVisible();

    // Entering is never taken away over a device, whatever the device said.
    await expect(page.getByTestId("join-button")).toBeEnabled();
    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\/[0-9a-f-]{36}$/);

    await guest.close();
    await host.context.close();
  });

  test("a refused camera does not stop the microphone being used", async ({
    browser,
  }) => {
    const host = await hostOnPreJoin(browser, true);
    const { guest, page } = await guestOnPreJoin(
      browser,
      host.inviteLink ?? "",
      "Priya",
    );
    await refuseDevice(page, "video");
    await page.reload();
    await waitForDevices(page);

    // This is why the devices are asked for separately. One
    // `getUserMedia({video, audio})` call fails *entirely* if either is missing,
    // which is what turns a machine with no webcam into a person who cannot be
    // heard. A camera refusal must not be the reason the microphone goes off, so
    // the microphone's state is whatever *its own* answer was — compared rather
    // than assumed, because on a machine with no microphone "off" is the correct
    // answer and would make a blanket mute indistinguishable from a correct one.
    const microphoneStartsOn = await isPressed(page, "toggle-microphone");

    // A control the screen has decided for the person is a control they cannot
    // change back, and the camera's failure is no reason to take one away.
    await expect(page.getByTestId("toggle-microphone")).toBeEnabled();
    await expect(page.getByTestId("join-button")).toBeEnabled();

    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("room-microphone-state")).toHaveText(
      microphoneStartsOn ? "On" : "Off",
    );

    await guest.close();
    await host.context.close();
  });
});

test.describe("on whatever machine this happens to be", () => {
  test("the screen resolves and entry is possible, with or without a camera", async ({
    browser,
  }) => {
    const { context, page } = await hostOnPreJoin(browser);
    await waitForDevices(page);

    // Deliberately not a branch. The *specific* answers are asserted in
    // `pre-join-camera.spec.ts`, where a device can be removed and a working one
    // kept, so they are the same on every machine. What is left here is the one
    // claim that has to hold on whatever hardware is present, and this project has
    // no fake device at all — so the absence is genuine rather than staged.
    await expect(
      page.getByTestId("camera-preview").or(page.getByTestId("camera-fallback")),
    ).toBeVisible();

    // A black rectangle with nothing in it and no explanation is the failure the
    // ticket names, so a fallback always has to say why it is standing in.
    if (await page.getByTestId("camera-fallback").isVisible()) {
      await expect(page.getByTestId("camera-fallback")).toContainText(/camera/i);
    }

    // Entry is never taken away over a device, whatever the device said. Read the
    // camera's own answer *before* joining, because after joining this is the
    // room and the toggle is gone.
    const cameraWasOn = await isPressed(page, "toggle-camera");
    await expect(page.getByTestId("join-button")).toBeEnabled();
    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\/[0-9a-f-]{36}$/);

    // And the room is told the truth about the camera: exactly the state the
    // toggle on screen was in, no more. A button reading "On" while nothing is
    // sent is the state the ticket calls out.
    await expect(page.getByTestId("room-camera-state")).toHaveText(
      cameraWasOn ? "On" : "Off",
    );

    await context.close();
  });
});
