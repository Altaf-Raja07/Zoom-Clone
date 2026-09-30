/**
 * Seam 2: the running frontend, driven in a browser.
 *
 * What only a browser can show: that one click on New Meeting creates a Meeting,
 * that the host passes through pre-join and arrives in the room, that the Meeting
 * ID is in Zoom's grouped format where a host can read it aloud, and that the
 * Invite Link reaches the clipboard in one action. The backend runs for real, so
 * none of it is stubbed.
 *
 * The pre-join step between New Meeting and the room is *tolerated* rather than
 * ignored: these tests are about the Meeting the button makes, and the join is the
 * one click that a host who has just decided to have a meeting would make next.
 * Pre-join's own behaviour is asserted in `pre-join-screen.spec.ts` and
 * `pre-join-camera.spec.ts`.
 */

import { Page, expect, test } from "@playwright/test";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** The room, with a host's Meeting created and the host walked into it. */
async function startAMeeting(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New Meeting" }).click();
  // New Meeting lands on pre-join: the host is a participant like any other and
  // gets the same camera check before anyone can see them.
  await expect(page).toHaveURL(/\/prejoin\/[0-9a-f-]{36}$/);
  await page.getByTestId("join-button").click();
  await expect(page).toHaveURL(/\/room\/[0-9a-f-]{36}$/);
}

test("clicking New Meeting takes the host into the room", async ({ page }) => {
  await startAMeeting(page);

  await expect(page.getByTestId("meeting-id")).toBeVisible();
});

test("the room shows a meeting id Zoom could have printed", async ({ page }) => {
  await startAMeeting(page);

  // Eleven digits in three spoken groups, because a host reads this out loud.
  await expect(page.getByTestId("meeting-id")).toHaveText(/^\d{3} \d{4} \d{4}$/);
});

test("reloading the room shows the same meeting, not a new one", async ({ page }) => {
  await startAMeeting(page);
  const url = page.url();
  const meetingId = await page.getByTestId("meeting-id").textContent();

  await page.reload();

  await expect(page).toHaveURL(url);
  await expect(page.getByTestId("meeting-id")).toHaveText(meetingId ?? "");
});

test("the invite link is copied in one action", async ({ page }) => {
  await startAMeeting(page);

  const invitePath = await page.getByTestId("invite-path").textContent();
  await page.getByRole("button", { name: "Copy invite link" }).click();

  await expect(page.getByTestId("copied")).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain(invitePath ?? "");
  expect(clipboard).toMatch(/\/join\/\d{11}$/);
});

test("the room calls its creator the host, and a guest something else", async ({
  page,
  browser,
}) => {
  await startAMeeting(page);
  await expect(page.getByTestId("host-badge")).toHaveText("Host");

  // Someone else following the Invite Link is a guest in the room, and the
  // badge must not claim otherwise.
  const secondContext = await browser.newContext();
  const guest = await secondContext.newPage();
  await guest.goto(page.url());

  await expect(guest.getByTestId("host-badge")).toHaveText(/^Hosted by \S+/);
  await secondContext.close();
});
