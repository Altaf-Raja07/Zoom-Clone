/**
 * Seam 2: the running frontend, driven in a browser.
 *
 * What only a browser can show: that one click on New Meeting ends in a room,
 * that the Meeting ID is in Zoom's grouped format where a host can read it
 * aloud, and that the Invite Link reaches the clipboard in one action. The
 * backend runs for real, so none of it is stubbed.
 */

import { expect, test } from "@playwright/test";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("clicking New Meeting takes the host straight into the room", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Meeting" }).click();

  await expect(page).toHaveURL(/\/room\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("meeting-id")).toBeVisible();
});

test("the room shows a meeting id Zoom could have printed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Meeting" }).click();

  // Eleven digits in three spoken groups, because a host reads this out loud.
  await expect(page.getByTestId("meeting-id")).toHaveText(/^\d{3} \d{4} \d{4}$/);
});

test("reloading the room shows the same meeting, not a new one", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Meeting" }).click();
  await expect(page).toHaveURL(/\/room\//);
  const url = page.url();
  const meetingId = await page.getByTestId("meeting-id").textContent();

  await page.reload();

  await expect(page).toHaveURL(url);
  await expect(page.getByTestId("meeting-id")).toHaveText(meetingId ?? "");
});

test("the invite link is copied in one action", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Meeting" }).click();

  const invitePath = await page.getByTestId("invite-path").textContent();
  await page.getByRole("button", { name: "Copy invite link" }).click();

  await expect(page.getByTestId("copied")).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain(invitePath ?? "");
  expect(clipboard).toMatch(/\/join\/\d{11}$/);
});
