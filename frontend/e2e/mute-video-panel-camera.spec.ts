/**
 * Seam 2: mute, video, and the local camera, in a room with real devices.
 *
 * These run in the `chromium-camera` Playwright project rather than in a
 * `describe` with `test.use({launchOptions})`, because the fake-device flags are
 * read at browser launch and cannot be changed per test — Playwright refuses
 * that combination for exactly that reason. The same arrangement is used by
 * `pre-join-camera.spec.ts`, and the project matches the `-camera.spec.ts`
 * pattern rather than one filename at a time.
 *
 * **Everything that asserts a device *transition* lives here, and not in the
 * plain project, and the reason is worth stating.** The plain project has no
 * camera and no microphone, which is the honest version of a locked-down
 * machine — and a person arriving on one is *correctly* muted with their camera
 * off, because pre-join found no devices and said so. A test there that pressed
 * mute and asserted "now muted" would therefore be asserting something that was
 * already true before the click: it would pass against a mute control that did
 * nothing at all. With a fake device the starting state is known — unmuted,
 * camera on — so a transition is a transition.
 */

import { expect, test } from "@playwright/test";

import { guestInRoom, hostInRoom } from "./room-helpers";

test.describe("mute and video, between two browsers", () => {
  test("muting in one browser reaches the other without a refresh", async ({
    browser,
  }) => {
    const host = await hostInRoom(browser);
    const guest = await guestInRoom(browser, host.invitePath, "Priya");
    await expect(host.page.getByTestId("participant-name")).toHaveCount(2);

    // Known starting state: with a fake device present, pre-join leaves both
    // devices on, so "not muted yet" is a real assertion here.
    await expect(
      host.page
        .getByTestId("participant-row")
        .filter({ hasText: "Priya" })
        .getByTestId("participant-muted"),
    ).toHaveCount(0);

    await guest.page.getByTestId("toggle-microphone").click();

    // The host's page, untouched. The guest's row is the one that changed, and
    // it changed without a reload, a navigation or a click over here.
    await expect(
      host.page
        .getByTestId("participant-row")
        .filter({ hasText: "Priya" })
        .getByTestId("participant-muted"),
    ).toBeVisible();

    await guest.context.close();
    await host.context.close();
  });

  test("turning the camera off in one browser reaches the other", async ({
    browser,
  }) => {
    const host = await hostInRoom(browser);
    const guest = await guestInRoom(browser, host.invitePath, "Priya");
    await expect(host.page.getByTestId("participant-name")).toHaveCount(2);

    const guestTile = host.page.getByTestId("remote-tile").filter({
      hasText: "Priya",
    });
    await expect(guestTile.getByTestId("tile-simulated")).toHaveText(
      "Camera simulated",
    );

    await guest.page.getByTestId("toggle-camera").click();

    // The tile is where a host looks to answer "who can see me", so the camera
    // state is asserted there and not only in the panel list.
    await expect(guestTile.getByTestId("tile-simulated")).toHaveText("Camera off");

    await guest.context.close();
    await host.context.close();
  });

  test("unmuting reaches the other browser too", async ({ browser }) => {
    const host = await hostInRoom(browser);
    const guest = await guestInRoom(browser, host.invitePath, "Priya");
    const guestRow = host.page
      .getByTestId("participant-row")
      .filter({ hasText: "Priya" });

    await guest.page.getByTestId("toggle-microphone").click();
    await expect(guestRow.getByTestId("participant-muted")).toBeVisible();

    // The round trip matters because the failure is not symmetric: a control
    // that only ever announced people going quiet would pass the test above.
    await guest.page.getByTestId("toggle-microphone").click();
    await expect(guestRow.getByTestId("participant-muted")).toHaveCount(0);

    await guest.context.close();
    await host.context.close();
  });

  test("a person sees their own mute state on the control and in the panel", async ({
    browser,
  }) => {
    const host = await hostInRoom(browser);
    const button = host.page.getByTestId("toggle-microphone");

    // `aria-pressed` rather than a class, so the assertion is about the state a
    // screen reader would read and not about a colour a test picked.
    await expect(button).toHaveAttribute("aria-pressed", "false");

    await button.click();

    await expect(button).toHaveAttribute("aria-pressed", "true");
    // The label inverts with the state, so the control says what pressing it
    // will do rather than only what it currently is.
    await expect(button).toHaveText(/Unmute/i);

    // And the same fact is on their own tile, not only on the control.
    await expect(
      host.page.getByTestId("own-tile").getByTestId("tile-muted"),
    ).toBeVisible();

    await host.context.close();
  });

  test("each person's own state is theirs, and nobody else's", async ({ browser }) => {
    const host = await hostInRoom(browser);
    const guest = await guestInRoom(browser, host.invitePath, "Priya");
    await expect(host.page.getByTestId("participant-name")).toHaveCount(2);

    await host.page.getByTestId("toggle-microphone").click();

    // The host is muted; the guest is not, in *both* browsers. A single
    // room-wide flag would pass every other test in this file and fail here.
    await expect(host.page.getByTestId("toggle-microphone")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(guest.page.getByTestId("toggle-microphone")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await guest.context.close();
    await host.context.close();
  });

  test("a device turned off on pre-join is off in the room too", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "New Meeting" }).click();
    await expect(page).toHaveURL(/\/prejoin\/[0-9a-f-]{36}$/);
    // Named, because a generated default would make the guest's room below
    // unidentifiable — the assertions are by name, and a name nobody chose is
    // exactly the thing this file's other half exists to check.
    await page.getByTestId("display-name").fill("Altaf");

    // Both devices are on by default here, so **turning one off is the only
    // thing that distinguishes this from arriving with the defaults** — which is
    // why this test exists rather than being left to the "camera on" assertions
    // elsewhere. Every other test in this file would pass with the room ignoring
    // pre-join's record entirely, because the recorded value and the fallback
    // happen to be the same.
    await page.getByTestId("toggle-camera").click();
    await expect(page.getByTestId("toggle-camera")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await page.getByTestId("join-button").click();
    await expect(page).toHaveURL(/\/room\//);

    // The room draws the person with no camera, and — the part that matters —
    // tells the *server* so, which is the claim another browser reads.
    await expect(page.getByTestId("own-video")).toHaveCount(0);
    const row = page.getByTestId("participant-row").filter({ hasText: "Altaf" });
    await expect(row).toBeVisible();

    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    // The host's Invite Link is the only way in, and it is rendered host-only.
    const hostInvite =
      (await page.getByTestId("invite-path").textContent()) ?? "";
    await guestPage.goto(hostInvite);
    await guestPage.getByTestId("join-button").click();
    await expect(guestPage).toHaveURL(/\/prejoin\//);
    await guestPage.getByTestId("display-name").fill("Priya");
    await guestPage.getByTestId("join-button").click();
    await expect(guestPage).toHaveURL(/\/room\//);

    // In the guest's room, the host's tile says the camera is off. If the room
    // had fallen back to the defaults, the server would have recorded the host
    // as broadcasting and this would read "Camera simulated".
    const hostTile = guestPage.getByTestId("remote-tile").filter({
      hasText: "Altaf",
    });
    await expect(hostTile.getByTestId("tile-simulated")).toHaveText("Camera off");

    await guest.close();
    await context.close();
  });

  test("the viewer sees their own camera, and only their own", async ({ browser }) => {
    const host = await hostInRoom(browser);
    const guest = await guestInRoom(browser, host.invitePath, "Priya");
    await expect(host.page.getByTestId("participant-name")).toHaveCount(2);

    // The local tile is a real `getUserMedia` stream. Asserted as *playing*,
    // not merely present: a `<video>` element renders at any size whether or
    // not a stream arrived, and a black rectangle is the exact failure a person
    // opens their camera to catch.
    const own = host.page.getByTestId("own-video");
    await expect(own).toBeVisible();
    await expect
      .poll(async () =>
        own.evaluate((element) => {
          const video = element as HTMLVideoElement;
          return video.videoWidth > 0 && video.readyState >= 2;
        }),
      )
      .toBe(true);

    // The remote tile has none, and says so.
    const guestTile = host.page.getByTestId("remote-tile").filter({
      hasText: "Priya",
    });
    await expect(guestTile.locator("video")).toHaveCount(0);
    await expect(guestTile.getByTestId("tile-simulated")).toHaveText(
      "Camera simulated",
    );

    await guest.context.close();
    await host.context.close();
  });

  test("turning the camera off replaces the preview with the viewer's initial", async ({
    browser,
  }) => {
    const host = await hostInRoom(browser);
    await expect(host.page.getByTestId("own-video")).toBeVisible();

    await host.page.getByTestId("toggle-camera").click();

    // The stream is *disabled*, not torn down, so this is a swap of what is
    // drawn rather than a second permission prompt.
    await expect(host.page.getByTestId("own-video")).toHaveCount(0);
    await expect(
      host.page.getByTestId("own-tile").getByTestId("tile-initial"),
    ).toHaveText("A");

    // And back again, still without asking for the camera a second time.
    await host.page.getByTestId("toggle-camera").click();
    await expect(host.page.getByTestId("own-video")).toBeVisible();

    await host.context.close();
  });
});
