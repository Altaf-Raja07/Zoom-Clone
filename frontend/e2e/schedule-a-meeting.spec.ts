/**
 * Seam 2: the running frontend, driven in a browser.
 *
 * What only a browser can show about scheduling: that the form a host fills in
 * produces a Meeting with an Invite Link, that the link is *shareable* before
 * the Meeting's time — which is the whole claim of the ticket, since a schedule
 * you cannot share is a calendar entry — and that the thing the link does when
 * followed too early reads as a sentence a person can act on.
 *
 * The refusals are asserted through the real join screen rather than against the
 * API, because the part worth trusting is the one where a guest is told the
 * meeting has not started and stays where they were.
 *
 * Two browser contexts throughout, as in the join tests: the host who books and
 * the guest who is sent the link are different people with different cookies.
 */

import { Browser, Page, expect, test } from "@playwright/test";

/** `yyyy-mm-dd` for a day that has not arrived yet, in the browser's own zone. */
function tomorrow(): string {
  const day = new Date();
  day.setDate(day.getDate() + 1);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** The schedule form, filled in as a host would. */
async function bookAMeeting(
  page: Page,
  fields: { title?: string; description?: string; date?: string; time?: string } = {},
) {
  await page.getByTestId("schedule-title").fill(fields.title ?? "Design review");
  await page
    .getByTestId("schedule-description")
    .fill(fields.description ?? "Walk through the schedule ticket");
  await page.getByTestId("schedule-date").fill(fields.date ?? tomorrow());
  await page.getByTestId("schedule-time").fill(fields.time ?? "14:30");
  await page.getByTestId("schedule-duration").selectOption("45");
  await page.getByTestId("schedule-submit").click();
}

test("a host books a meeting and gets an invite link for it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Schedule Meeting" }).click();
  await expect(page).toHaveURL(/\/schedule$/);

  await bookAMeeting(page);

  await expect(page.getByTestId("schedule-confirmation")).toHaveText(
    "Your meeting is scheduled",
  );
  await expect(page.getByTestId("scheduled-title")).toHaveText("Design review");
  await expect(page.getByTestId("scheduled-description")).toHaveText(
    "Walk through the schedule ticket",
  );
  // The duration the host chose, and the moment they chose, in their own words.
  await expect(page.getByTestId("scheduled-duration")).toHaveText("45 minutes");
  await expect(page.getByTestId("scheduled-start")).toContainText(/\d{1,2}:\d{2}/);

  // A real Meeting ID, grouped for reading aloud, and a link carrying it.
  await expect(page.getByTestId("meeting-id")).toHaveText(
    /^\d{3} \d{4} \d{4}$/,
  );
  await expect(page.getByTestId("invite-path")).toHaveText(
    /^http:\/\/[^/]+\/join\/\d{11}$/,
  );
});

test("the schedule form asks for the four fields and nothing else", async ({ page }) => {
  await page.goto("/schedule");

  // Counted rather than pattern-matched, because "does not offer a passcode" is
  // only worth something next to a complete list of what it does offer: this is
  // a small form, not a truncated copy of Zoom's larger dialog.
  const labels = await page.locator("form label").allTextContents();

  expect(labels).toEqual([
    "Topic (optional)",
    "Description (optional)",
    "Date",
    "Time",
    "Duration",
  ]);
});

test("a meeting can be booked with no topic and no description", async ({ page }) => {
  await page.goto("/schedule");

  await bookAMeeting(page, { title: "", description: "" });

  // Still a Meeting, with a time and a duration — and named, rather than left
  // with an empty heading or a row of whitespace on the dashboard later.
  await expect(page.getByTestId("scheduled-title")).toHaveText("Untitled meeting");
  await expect(page.getByTestId("scheduled-description")).toHaveCount(0);
  await expect(page.getByTestId("scheduled-duration")).toHaveText("45 minutes");
  await expect(page.getByTestId("scheduled-start")).toContainText(/\d{1,2}:\d{2}/);
});

test("the schedule button waits for a time to be chosen", async ({ page }) => {
  await page.goto("/schedule");

  // Offered a sensible default, so the button is live the moment the form opens.
  await expect(page.getByTestId("schedule-time")).not.toHaveValue("");
  await expect(page.getByTestId("schedule-submit")).toBeEnabled();

  // Blanking it is what makes the start unknowable, and an unscheduled Meeting
  // is an Instant Meeting, which is a different button on the dashboard.
  await page.getByTestId("schedule-time").fill("");
  await expect(page.getByTestId("schedule-submit")).toBeDisabled();
});

test("the invite link can be followed before the meeting begins", async ({
  browser,
}) => {
  const host = await browser.newContext();
  const hostPage = await host.newPage();
  await hostPage.goto("/schedule");
  await bookAMeeting(hostPage);

  const inviteLink = (await hostPage.getByTestId("invite-path").textContent()) ?? "";
  const meetingId = (await hostPage.getByTestId("meeting-id").textContent()) ?? "";

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(inviteLink);

  // The link carried the Meeting ID, so nobody has to transcribe a number they
  // were just handed a link for.
  await expect(guestPage.getByTestId("join-code")).toHaveValue(
    meetingId.replaceAll(" ", ""),
  );
  await guestPage.getByTestId("display-name").fill("Priya");
  await guestPage.getByTestId("join-button").click();

  // Too early, and it says so in a way that names the situation rather than
  // blaming a host who never was, or declaring a meeting over that has not begun.
  await expect(guestPage.getByTestId("join-error")).toHaveText(
    "That meeting has not started yet. Try again when it is time to join.",
  );
  await expect(guestPage).toHaveURL(/\/join\/\d{11}$/);

  await guest.close();
  await host.close();
});

test("a scheduled meeting lets a guest in once its time has arrived", async ({
  browser,
}) => {
  const host = await browser.newContext();
  const hostPage = await host.newPage();
  await hostPage.goto("/schedule");

  // Booked for a time that has already passed, which is what the API is for: the
  // gate is one comparison against the clock, and a start time in the past
  // answers it by opening the Meeting. So the admitting side is reachable in a
  // test without waiting an hour for the refusing side's twin to expire — the
  // alternative was leaving the whole gate unproven in a browser.
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const pad = (part: number) => String(part).padStart(2, "0");
  const day = [
    yesterday.getFullYear(),
    pad(yesterday.getMonth() + 1),
    pad(yesterday.getDate()),
  ].join("-");

  await bookAMeeting(hostPage, { date: day, time: "09:00" });
  const inviteLink =
    (await hostPage.getByTestId("invite-path").textContent()) ?? "";

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(inviteLink);
  await guestPage.getByTestId("display-name").fill("Priya");
  await guestPage.getByTestId("join-button").click();

  // The same join screen that refused this Meeting on the other side of its
  // start time. Neither test hard-codes the other's half, so a gate that always
  // refused — or always admitted — would fail one of them.
  await expect(guestPage).toHaveURL(/\/room\/[0-9a-f-]{36}$/);
  await expect(guestPage.getByTestId("host-badge")).toHaveText(/^Hosted by \S+/);
  await expect(guestPage.getByTestId("join-error")).toHaveCount(0);

  await guest.close();
  await host.close();
});

// Desktop, tablet and narrow mobile, because SPEC.md asks for the responsive
// requirements to be checked at all three rather than only at the width that
// happens to be the one that broke.
for (const width of [1280, 768, 375]) {
  test(`the form fits a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/schedule");

    // Width, not a screenshot: a form that needs horizontal panning to be filled
    // in cannot be filled in on a phone, and that is requirement 39.
    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);

    await expect(page.getByTestId("schedule-submit")).toBeVisible();
    await expect(page.getByTestId("schedule-duration")).toBeVisible();
  });
}
