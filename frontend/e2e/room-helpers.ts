/**
 * Getting two people into one Meeting, for the browser tests.
 *
 * Its own module rather than exported from a spec, because a test file that
 * imported another would be collecting that file's tests a second time. The two
 * specs that need these both talk to the room through here, so the walk from
 * "New Meeting" to a room with a socket in it is written once — and it changes
 * whenever the room does, which is more often than it looks.
 *
 * Not a `.spec.ts` file, so it is never collected as a test. It holds no
 * assertions and no `test` calls, only the walk to a room.
 */

import { Browser, BrowserContext, Page, expect } from "@playwright/test";

/** Optional things a test wants to do on the pre-join screen before entering. */
type OnPreJoin = (page: Page) => Promise<void>;

/**
 * A host who has created a Meeting and walked into its room.
 *
 * `onPreJoin` exists because a device decision has to be made *before* entering
 * to be a pre-join decision, and a test that wanted one used to re-implement the
 * whole walk by hand — which is how a spec ends up with a second, quietly
 * different copy of the flow.
 */
export async function hostInRoom(
  browser: Browser,
  name = "Altaf",
  onPreJoin?: OnPreJoin,
): Promise<{ context: BrowserContext; page: Page; invitePath: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "New Meeting" }).click();
  await expect(page).toHaveURL(/\/prejoin\/[0-9a-f-]{36}$/);
  await page.getByTestId("display-name").fill(name);
  if (onPreJoin) await onPreJoin(page);
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
