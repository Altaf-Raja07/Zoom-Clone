/**
 * Seam 2: the running frontend, driven in a browser — with a camera.
 *
 * The half of the pre-join screen that needs a working `getUserMedia`: a real
 * preview, a real Display Name to correct, and two real toggles whose states
 * arrive in the room.
 *
 * **These run in the `chromium-camera` Playwright project, not in a
 * `describe` block**, because Chromium's fake-device flags are read at browser
 * launch. `test.use({launchOptions})` inside a `describe` is refused by Playwright
 * for exactly that reason, so the two halves of this ticket — a machine *with* a
 * camera and a machine without one — are two projects rather than two flag
 * toggles. `pre-join-screen.spec.ts` is the other half.
 *
 * `--use-fake-device-for-media-stream` supplies a camera and microphone that
 * produce real frames, and `--use-fake-ui-for-media-stream` grants the permission
 * without a prompt. Both are needed: the first alone still hits a permission
 * dialog a headless browser cannot answer.
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

  // The Invite Link is read from a *second* tab in the same context, so the tab
  // under test stays on the pre-join screen rather than being navigated away from
  // it to fetch a string. Same cookie, so it is the same Host.
  const reader = await context.newPage();
  const meetingUuid = page.url().split("/prejoin/")[1] ?? "";
  await reader.goto(`/room/${meetingUuid}`);
  await expect(reader.getByTestId("invite-path")).toBeVisible();
  const inviteLink = (await reader.getByTestId("invite-path").textContent()) ?? "";
  await reader.close();

  return { context, page, inviteLink };
}

/** The Meeting's internal id, read off a room URL. */
async function meetingUuidFrom(page: Page): Promise<string> {
  return (await page.url()).split("/room/")[1] ?? "";
}

test.describe("with a working camera", () => {
  test("pre-join shows a live local camera preview", async ({ browser }) => {
    const { context, page } = await hostContextWithMeeting(browser);

    // Straight to the pre-join screen rather than through the room: the host is
    // answered here now, and going via the room would be testing a path that no
    // longer exists.
    const preview = page.getByTestId("camera-preview");
    await expect(preview).toBeVisible();

    // A real preview has real dimensions and is actually playing. A black tile
    // and a live video are the same element with different `videoWidth`, which
    // is why the visible-and-sized check alone is not enough: `<video>` renders
    // at any size whether or not a stream arrived.
    const playing = await preview.evaluate(
      (element) =>
        new Promise<{ width: number; readyState: number }>((resolve) => {
          const video = element as HTMLVideoElement;
          if (video.videoWidth > 0) {
            resolve({ width: video.videoWidth, readyState: video.readyState });
            return;
          }
          video.addEventListener(
            "loadedmetadata",
            () =>
              resolve({ width: video.videoWidth, readyState: video.readyState }),
            { once: true },
          );
          setTimeout(() => resolve({ width: 0, readyState: video.readyState }), 4000);
        }),
    );

    expect(playing.width).toBeGreaterThan(0);
    expect(playing.readyState).toBeGreaterThanOrEqual(2);

    await context.close();
  });

  test("the display name arrives pre-filled and stays editable", async ({
    browser,
  }) => {
    const { context, page } = await hostContextWithMeeting(browser);
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
    const { context, page } = await hostContextWithMeeting(browser);
    await expect(page.getByTestId("camera-preview")).toBeVisible();

    await page.getByTestId("toggle-camera").click();
    await page.getByTestId("toggle-microphone").click();

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

  test("device choices survive being left on defaults", async ({ browser }) => {
    const { context, page } = await hostContextWithMeeting(browser);
    await expect(page.getByTestId("camera-preview")).toBeVisible();

    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\//);

    await expect(page.getByTestId("room-camera-state")).toHaveText(/on/i);
    await expect(page.getByTestId("room-microphone-state")).toHaveText(/on/i);

    await context.close();
  });

  test("a refused microphone does not take the camera down with it", async ({
    browser,
  }) => {
    const { context, page } = await hostContextWithMeeting(browser);
    await expect(page.getByTestId("camera-preview")).toBeVisible();

    // This is the test that only a machine with a working camera can make, and it
    // is the one that matters. `getLocalMedia` asks for the two devices
    // separately because a single `getUserMedia({video, audio})` call fails
    // *entirely* if either is missing — the difference between a person who
    // cannot be seen and a person who is merely not heard. A machine with a
    // camera but no microphone is the only place that difference is observable.
    await page.addInitScript(() => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (constraints: MediaStreamConstraints) => {
        if (constraints.audio) {
          return Promise.reject(
            new DOMException("Requested device not found", "NotFoundError"),
          );
        }
        return real(constraints);
      };
    });
    await page.reload();
    await expect(page.locator("main[data-devices]")).toHaveAttribute(
      "data-devices",
      "settled",
    );

    // The camera survived, and is still live.
    await expect(page.getByTestId("camera-preview")).toBeVisible();
    await expect(page.getByTestId("toggle-camera")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // The microphone is off — nothing is being sent — and says why, in its own
    // words rather than the camera's.
    await expect(page.getByTestId("microphone-notice")).toContainText(/microphone/i);
    await expect(page.getByTestId("toggle-microphone")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // And a microphone problem is not a microphone that cannot be recovered, so
    // no retry is offered for a device that is not there.
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

// Desktop, tablet and narrow, because a preview that does not fit is not a
// preview. Three widths for the reason the other screens are checked at three.
for (const width of [1280, 768, 375]) {
  test(`pre-join fits a ${width}px screen`, async ({ browser }) => {
    const { context, page } = await hostContextWithMeeting(browser);
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
