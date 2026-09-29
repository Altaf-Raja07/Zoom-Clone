/**
 * Seam 2: the running frontend, driven in a browser.
 *
 * What only a browser can show: that a link someone was sent actually lands
 * them in a room, that a Meeting ID typed on a phone gets them in, and that the
 * two reach the *same* room. The refusals are asserted here too, because a
 * message that reads as a server fault in the API can still read as a sentence a
 * person can act on in the page.
 *
 * Two independent browser contexts throughout — a guest is a different person
 * with a different cookie, and a single context would prove nothing about
 * either identity or who is host.
 */

import { Browser, Page, expect, test } from "@playwright/test";

/** A host with a Meeting created, in their own context. */
async function hostAMeeting(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "New Meeting" }).click();
  await expect(page).toHaveURL(/\/room\/[0-9a-f-]{36}$/);
  const meetingId = (await page.getByTestId("meeting-id").textContent()) ?? "";
  const invitePath = (await page.getByTestId("invite-path").textContent()) ?? "";
  return { context, page, meetingId, invitePath };
}

test("an invite link takes a guest into the meeting", async ({ browser }) => {
  const host = await hostAMeeting(browser);

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(host.invitePath);

  // The link carried the code, so the field is already filled — nobody should
  // have to transcribe a number they were just handed a link for.
  await expect(guestPage.getByTestId("join-code")).toHaveValue(
    host.meetingId.replaceAll(" ", ""),
  );

  await guestPage.getByTestId("display-name").fill("Priya");
  await guestPage.getByTestId("join-button").click();

  // The same room the host is in, reached by the guest's cookie.
  await expect(guestPage).toHaveURL(new RegExp(`/room/[0-9a-f-]{36}$`));
  await expect(guestPage.getByTestId("meeting-id")).toHaveText(host.meetingId);
  await expect(guestPage.getByTestId("host-badge")).toHaveText(/^Hosted by \S+/);

  await guest.close();
  await host.context.close();
});

test("a typed meeting id takes a guest into the meeting", async ({ browser }) => {
  const host = await hostAMeeting(browser);

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto("/");

  // Through the dashboard's Join Meeting action, which is where someone with a
  // number and no link starts.
  await guestPage.getByRole("button", { name: "Join Meeting" }).click();
  await expect(guestPage).toHaveURL(/\/join$/);

  // Typed with the grouping spaces, because that is how the host read it aloud.
  await guestPage.getByTestId("join-code").fill(host.meetingId);
  await guestPage.getByTestId("display-name").fill("Priya");
  await guestPage.getByTestId("join-button").click();

  await expect(guestPage).toHaveURL(/\/room\/[0-9a-f-]{36}$/);
  await expect(guestPage.getByTestId("meeting-id")).toHaveText(host.meetingId);

  await guest.close();
  await host.context.close();
});

test("the join control stays disabled until the id is complete", async ({ page }) => {
  await page.goto("/join");

  const join = page.getByTestId("join-button");
  await expect(join).toBeDisabled();

  await page.getByTestId("join-code").fill("12345");
  await expect(join).toBeDisabled();

  await page.getByTestId("join-code").fill("not a meeting id");
  await expect(join).toBeDisabled();

  // A complete code is not enough on its own. The Display Name arrives
  // pre-filled from the guest identity, so blanking it is what makes the name
  // unconfirmable — and then there is nothing to enter under.
  await page.getByTestId("join-code").fill("123 456 789 01");
  await expect(join).toBeEnabled();

  await page.getByTestId("display-name").fill("");
  await expect(join).toBeDisabled();

  await page.getByTestId("display-name").fill("Priya");
  await expect(join).toBeEnabled();
});

test("an unknown meeting id says so, and no room is entered", async ({ page }) => {
  await page.goto("/join");

  await page.getByTestId("join-code").fill("123 456 789 01");
  await page.getByTestId("display-name").fill("Priya");
  await page.getByTestId("join-button").click();

  await expect(page.getByTestId("join-error")).toContainText(
    "No meeting has that Meeting ID",
  );
  await expect(page).toHaveURL(/\/join$/);
});

test("a meeting id that does not exist cannot be submitted at all", async ({ page }) => {
  await page.goto("/join/99999999999");

  // The Invite Link path does not pre-emptively decide what an arriving code
  // means; the API is what refuses a Meeting nobody has.
  await page.getByTestId("display-name").fill("Priya");
  await page.getByTestId("join-button").click();

  await expect(page.getByTestId("join-error")).toBeVisible();
  await expect(page).toHaveURL(/\/join\/99999999999$/);
});

test("a guest is greeted by the name they confirmed, not a generated one", async ({
  browser,
}) => {
  const host = await hostAMeeting(browser);
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();

  await guestPage.goto(host.invitePath);
  // Pre-filled from the guest identity minted on first visit, and editable.
  await expect(guestPage.getByTestId("display-name")).not.toHaveValue("");
  await guestPage.getByTestId("display-name").fill("Priya Raman");
  await guestPage.getByTestId("join-button").click();
  await expect(guestPage).toHaveURL(/\/room\/[0-9a-f-]{36}$/);

  // The confirmed name is the stored one, so the dashboard greets them by it —
  // which is the same value the room will show other participants.
  await guestPage.goto("/");
  await expect(guestPage.getByTestId("greeting")).toHaveText("Hi, Priya Raman");

  await guest.close();
  await host.context.close();
});

test("a guest is never offered the host's own arrival screen", async ({ browser }) => {
  const host = await hostAMeeting(browser);

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(host.invitePath);
  await guestPage.getByTestId("display-name").fill("Priya");
  await guestPage.getByTestId("join-button").click();
  await expect(guestPage).toHaveURL(/\/room\/[0-9a-f-]{36}$/);

  // Not the badge alone. A guest who is told "Your meeting is ready" and handed
  // a Copy Invite Link button has been given the host's screen, and a badge that
  // says "Hosted by …" somewhere else on the page does not undo that.
  await expect(guestPage.getByTestId("host-badge")).not.toHaveText("Host");
  await expect(guestPage.getByRole("heading", { level: 1 })).toHaveText(
    "You are in the meeting",
  );
  await expect(
    guestPage.getByRole("button", { name: "Copy invite link" }),
  ).toHaveCount(0);
  await expect(guestPage.getByTestId("invite-path")).toHaveCount(0);

  await guest.close();
  await host.context.close();
});

test("the host still gets the invite link to share", async ({ browser }) => {
  const host = await hostAMeeting(browser);

  // The guest's screen is not the host's: the host must keep the share controls.
  await expect(host.page.getByRole("button", { name: "Copy invite link" })).toBeVisible();
  await expect(host.page.getByTestId("invite-path")).toBeVisible();

  await host.context.close();
});

test("a guest is not in the room until they confirm a name", async ({ browser }) => {
  const host = await hostAMeeting(browser);

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(host.invitePath);

  await guestPage.getByTestId("display-name").fill("   ");
  await expect(guestPage.getByTestId("join-button")).toBeDisabled();
  await expect(guestPage).toHaveURL(new RegExp(`/join/${host.meetingId.replaceAll(" ", "")}$`));

  await guest.close();
  await host.context.close();
});
