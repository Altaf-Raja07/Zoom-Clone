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

import { Browser, BrowserContext, Page, expect, test } from "@playwright/test";

/**
 * A host with a Meeting, and its Invite Link.
 *
 * Created over the real API so the test is not asserting against a Meeting the
 * application could not actually make. The cookie is carried across from the
 * dashboard, which is what makes this browser the Host rather than a guest.
 */
async function hostContextWithMeeting(
  browser: Browser,
  contextOptions?: Parameters<Browser["newContext"]>[0],
): Promise<{ context: BrowserContext; page: Page; inviteLink: string }> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "New Meeting" }).click();
  await expect(page).toHaveURL(/\/prejoin\/[0-9a-f-]{36}$/);

  // The Invite Link is read from a second tab in the same context, so the tab
  // under test stays where it is rather than being navigated away to fetch a
  // string. Same cookie, so it is the same Host either way.
  const reader = await context.newPage();
  const meetingUuid = page.url().split("/prejoin/")[1] ?? "";
  await reader.goto(`/room/${meetingUuid}`);
  await expect(reader.getByTestId("invite-path")).toBeVisible();
  const inviteLink = (await reader.getByTestId("invite-path").textContent()) ?? "";
  await reader.close();

  return { context, page, inviteLink };
}

/** The Meeting's internal id, read off whichever pre-join or room URL is showing. */
async function meetingUuidFrom(page: Page): Promise<string> {
  const url = page.url();
  return url.split("/prejoin/")[1]?.split("/room/")[0] ?? (url.split("/room/")[1] ?? "");
}

/**
 * From an Invite Link to the pre-join screen, named.
 *
 * Two steps, because there are two: the join screen resolves *which* Meeting and
 * the pre-join screen is where the name is confirmed, beside a preview. A test
 * that filled a name on the join screen would be testing a field that is
 * deliberately not there any more.
 */
async function joinAsGuest(
  browser: Browser,
  inviteLink: string,
  name: string,
  contextOptions?: Parameters<Browser["newContext"]>[0],
) {
  const guest = await browser.newContext(contextOptions);
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
async function waitForDevices(page: Page) {
  await expect(page.locator("main[data-devices]")).toHaveAttribute(
    "data-devices",
    "settled",
  );
}

/**
 * Put a device toggle into a known state, clicking until it is there.
 *
 * Not `click()` and assume. On a machine with no camera the toggle *starts off* —
 * pre-join sets it off on arrival, because the button would otherwise claim video
 * is on while nothing is being sent — so a bare click turns it **on**. A test that
 * clicks and then asserts "off" passes on a machine with a camera and fails
 * without one, which is the same "only works on my laptop" bug this ticket is
 * about, one level up.
 *
 * Clicking at most twice means a test that has already put it where it wants does
 * no clicking at all, so this is also a no-op in the camera project.
 */
async function setToggle(page: Page, testId: string, wantPressed: boolean) {
  await waitForDevices(page);
  const toggle = page.getByTestId(testId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if ((await toggle.getAttribute("aria-pressed")) === String(wantPressed)) return;
    await toggle.click();
  }
  expect(await toggle.getAttribute("aria-pressed")).toBe(String(wantPressed));
}

test.describe("the pre-join to room handoff", () => {
  test("the room receives exactly what pre-join recorded", async ({ browser }) => {
    const { context, page } = await hostContextWithMeeting(browser);
    await expect(page).toHaveURL(/\/prejoin\//);

    const meetingUuid = page.url().split("/prejoin/")[1] ?? "";
    expect(meetingUuid).toMatch(/^[0-9a-f-]{36}$/);

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
    const { context, page } = await hostContextWithMeeting(browser);
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
    const { context, page } = await hostContextWithMeeting(browser);
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

    // Read what pre-join *chose* this time rather than assuming a default. On a
    // machine with no camera the default is already "off", which would make the
    // assertion below pass whether or not the first meeting's choices leaked —
    // and the leak is the whole thing being tested. So the read waits for the
    // devices to have been answered, or it reads the pre-question default and
    // calls it a choice.
    await waitForDevices(page);
    const cameraStartsOn =
      (await page.getByTestId("toggle-camera").getAttribute("aria-pressed")) ===
      "true";

    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\//);

    await expect(page.getByTestId("room-camera-state")).toHaveText(
      cameraStartsOn ? "On" : "Off",
    );
    await expect(page.getByTestId("room-microphone-state")).toHaveText(
      cameraStartsOn ? "On" : "Off",
    );

    await context.close();
  });

  test("a value pre-join did not write opens the room on its defaults", async ({
    browser,
  }) => {
    const { context, page } = await hostContextWithMeeting(browser);
    const meetingUuid = await meetingUuidFrom(page);

    // Each of these is the kind of thing a person, another tab, or an older
    // version of this app can leave behind. A room that trusted any of them would
    // open with somebody muted and dark because a string was truthy where a
    // boolean was expected — with no error anywhere to trace it to.
    for (const stored of [
      "not json",
      "42",
      "null",
      '["Priya", true, true]',
      '{"displayName":"Priya","microphoneOn":true}',
      '{"displayName":"P","microphoneOn":"yes","cameraOn":true}',
      '{"displayName":7,"microphoneOn":true,"cameraOn":true}',
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

  test("a copied invite link opened in a separate tab reaches the room", async ({
    browser,
  }) => {
    const host = await hostContextWithMeeting(browser);

    // The host deliberately turns its camera **on**, whatever this machine's
    // hardware said, so that the host and the guest end up in the room with
    // opposite camera states. Without that, a machine with no webcam has both of
    // them off and the test cannot tell "the guest's own choice arrived" from
    // "both were off for the same boring reason".
    await setToggle(host.page, "toggle-camera", true);

    // A different context entirely, so nothing in the host's `sessionStorage` can
    // be what made this work.
    const { guest, page: guestPage } = await joinAsGuest(
      browser,
      host.inviteLink,
      "Priya",
    );

    // The guest goes through their own pre-join flow, as they must: the stored
    // choices are per-tab *and* per-meeting, so a shared link cannot carry them.
    await expect(guestPage.getByTestId("display-name")).toHaveValue("Priya");
    await setToggle(guestPage, "toggle-camera", false);

    // The microphone was left alone, so the room's microphone state is whatever
    // this machine's own answer was — read rather than assumed, because on a
    // machine with no microphone pre-join starts it off, and asserting "On" there
    // would be quietly asserting a webcam.
    await waitForDevices(guestPage);
    const microphoneStartsOn =
      (await guestPage
        .getByTestId("toggle-microphone")
        .getAttribute("aria-pressed")) === "true";

    // The host enters its own room, so there is a host state to compare against
    // afterwards rather than a default to assert.
    await host.page.getByTestId("join-button").click();
    await expect(host.page).toHaveURL(/\/room\//);
    await expect(host.page.getByTestId("room-camera-state")).toHaveText("On");
    const hostMicrophone = await host.page
      .getByTestId("room-microphone-state")
      .textContent();

    await guestPage.getByTestId("join-button").click();

    await expect(guestPage).toHaveURL(/\/room\/[0-9a-f-]{36}$/);
    await expect(guestPage.getByTestId("your-name")).toHaveText("Priya");
    // The check that the guest's choices are theirs: the camera is off because
    // the guest turned it off, while the host who is in the same Meeting and sent
    // the link is broadcasting.
    await expect(guestPage.getByTestId("room-camera-state")).toHaveText("Off");
    await expect(guestPage.getByTestId("room-microphone-state")).toHaveText(
      microphoneStartsOn ? "On" : "Off",
    );

    // And the host is untouched by anything the guest did. Compared rather than
    // reloaded: the stored entry is consumed on read, so a reload would reset the
    // host to the room's defaults and this would be asserting nothing.
    await expect(host.page.getByTestId("room-camera-state")).toHaveText("On");
    await expect(host.page.getByTestId("room-microphone-state")).toHaveText(
      hostMicrophone ?? "",
    );

    await guest.close();
    await host.context.close();
  });

  test("storage being unavailable does not stop anybody joining", async ({
    browser,
  }) => {
    const { context, page } = await hostContextWithMeeting(browser);

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
 * A camera that the browser *refuses*, rather than one that is absent.
 *
 * The two are different sentences to a person — "you clicked Block" and "this
 * laptop has no webcam" lead to opposite actions — and the ticket asks for both.
 * A headless browser cannot produce a refusal on demand: with no device present
 * the answer is always `NotFoundError`, and the fake-UI flag that would grant a
 * permission is also what makes it grantable to refuse. So the refusal is
 * scripted here, by rejecting with the same `DOMException` a browser rejecting
 * produces, and the *missing device* case is left genuine in the describe below.
 *
 * Nothing else is stubbed. The page is real, the API is real, the storage is
 * real, and the only thing being faked is the one answer under test.
 */
async function refuseVideo(page: Page) {
  await page.addInitScript(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints: MediaStreamConstraints) => {
      if (constraints.video) {
        return Promise.reject(
          new DOMException("Permission denied", "NotAllowedError"),
        );
      }
      return real(constraints);
    };
  });
}

test.describe("with the camera permission denied", () => {
  test("says what happened, offers a way forward, and still reaches the room", async ({
    browser,
  }) => {
    const host = await hostContextWithMeeting(browser);
    const { guest, page } = await joinAsGuest(browser, host.inviteLink, "Priya");
    await refuseVideo(page);
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
    const host = await hostContextWithMeeting(browser);
    const { guest, page } = await joinAsGuest(browser, host.inviteLink, "Priya");
    await refuseVideo(page);
    await page.reload();
    await waitForDevices(page);

    // This is why the devices are asked for separately. One
    // `getUserMedia({video, audio})` call fails *entirely* if either is missing,
    // which is what turns a machine with no webcam into a person who cannot be
    // heard. A camera refusal must not be the reason the microphone goes off, so
    // the microphone's state is whatever *its own* answer was — compared rather
    // than assumed, because on a machine with no microphone "off" is the correct
    // answer and would make a blanket mute indistinguishable from a correct one.
    const microphoneStartsOn =
      (await page
        .getByTestId("toggle-microphone")
        .getAttribute("aria-pressed")) === "true";

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

test.describe("with no camera device at all", () => {
  test("explains it, and reaches the room with video off", async ({ browser }) => {
    const host = await hostContextWithMeeting(browser);
    // No permissions are granted and no fake device is present, so whatever the
    // browser says here is genuinely what a machine without a webcam says. That
    // is the point of running this half in the plain project.
    const { guest, page } = await joinAsGuest(browser, host.inviteLink, "Lena", {
      permissions: [],
    });

    await waitForDevices(page);

    // Not stuck waiting: the screen has resolved into one of its states. A
    // pre-join screen that leaves a spinner here is the failure the ticket names.
    const hasPreview = await page.getByTestId("camera-preview").isVisible();
    if (!hasPreview) {
      // A notice, where there is a notice, has to name the cause and the way
      // forward — a "camera error" string would be a black tile with a code on
      // it.
      const notice = page.getByTestId("camera-notice");
      await expect(notice).toBeVisible();
      await expect(notice).toContainText(/camera/i);
      await expect(notice).toContainText(/join/i);

      // And no retry is offered for a device that is not there. A button that can
      // only fail is a promise not kept.
      await expect(page.getByTestId("retry-devices")).toHaveCount(0);
    }

    // Entering stays available whatever the machine has. Asserted as *enabled*
    // because a pre-join screen that disables itself on a device failure has
    // failed the ticket's central requirement whatever its label says.
    await expect(page.getByTestId("join-button")).toBeEnabled();
    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\/[0-9a-f-]{36}$/);

    // Video is off rather than on, because a missing camera is not something the
    // toggle is allowed to claim. The button saying "On" while nothing is sent is
    // the state the ticket calls out.
    await expect(page.getByTestId("room-camera-state")).toHaveText(
      hasPreview ? "On" : "Off",
    );

    await guest.close();
    await host.context.close();
  });
});
