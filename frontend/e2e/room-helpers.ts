/**
 * Getting two people into one Meeting, for the browser tests.
 *
 * Its own module rather than exported from a spec, because Playwright refuses to
 * let one test file import another — and the two camera specs genuinely need the
 * same two helpers. Each spec file that rolls its own copy is one copy to keep in
 * step with the pre-join flow, and this flow changes whenever the room does.
 *
 * Not a `.spec.ts` file, so it is never collected as a test. It holds no
 * assertions and no `test` calls, only the walk to a room.
 */

import { Browser, BrowserContext, Page, expect } from "@playwright/test";

/** A host who has created a Meeting and walked into its room. */
export async function hostInRoom(
  browser: Browser,
  name = "Altaf",
): Promise<{ context: BrowserContext; page: Page; invitePath: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "New Meeting" }).click();
  await expect(page).toHaveURL(/\/prejoin\/[0-9a-f-]{36}$/);
  await page.getByTestId("display-name").fill(name);
  await page.getByTestId("join-button").click();
  await expect(page).toHaveURL(/\/room\/[0-9a-f-]{36}$/);
  const invitePath = (await page.getByTestId("invite-path").textContent()) ?? "";
  return { context, page, invitePath };
}

/** A second person, in a second context, arriving by the host's Invite Link. */
export async function guestInRoom(
  browser: Browser,
  invitePath: string,
  name: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(invitePath);
  await page.getByTestId("join-button").click();
  await expect(page).toHaveURL(/\/prejoin\/[0-9a-f-]{36}$/);
  await page.getByTestId("display-name").fill(name);
  await page.getByTestId("join-button").click();
  await expect(page).toHaveURL(/\/room\/[0-9a-f-]{36}$/);
  return { context, page };
}
