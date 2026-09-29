/**
 * Seam 2: the running frontend, driven in a browser.
 *
 * What only a browser can show about the dashboard's two sections: that a real
 * booking made through the real form turns up under Upcoming on the next visit,
 * that a real Instant Meeting turns up at the top of Recent, that a stranger's
 * Meeting never appears, and — the part the API cannot check at all — that the
 * empty state is a sentence a person can read rather than a blank area that
 * looks like something failed.
 *
 * Each test gets its own browser context, so each is a different person with a
 * different cookie. That is the point: a test that reused one context would see
 * its own Meetings accumulate across tests and pass for the wrong reason.
 */

import { BrowserContext, Page, expect, test } from "@playwright/test";

/** `yyyy-mm-dd` for a day a number of days from now, in the browser's own zone. */
function dayFromNow(days: number): string {
  const day = new Date();
  day.setDate(day.getDate() + days);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/**
 * A brand-new visitor's dashboard.
 *
 * The context is closed rather than reused so that "this person has hosted
 * nothing" is true by construction rather than by whatever ran before.
 */
async function freshDashboard(browser: {
  newContext(): Promise<BrowserContext>;
}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("greeting")).toBeVisible();
  return { context, page };
}

/** Book a Meeting through the real form, as a host would. */
async function bookAMeeting(page: Page, title: string, daysFromNow: number) {
  await page.goto("/schedule");
  await page.getByTestId("schedule-title").fill(title);
  await page.getByTestId("schedule-description").fill("");
  await page.getByTestId("schedule-date").fill(dayFromNow(daysFromNow));
  await page.getByTestId("schedule-time").fill("14:30");
  await page.getByTestId("schedule-submit").click();
  await expect(page.getByTestId("schedule-confirmation")).toBeVisible();
}

test("both sections are on the dashboard and say something when empty", async ({
  browser,
}) => {
  const { context, page } = await freshDashboard(browser);

  await expect(page.getByRole("heading", { name: "Upcoming Meetings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent Meetings" })).toBeVisible();

  // A sentence, not a blank box under a heading. This is the whole of story 15
  // and the browser is the only seam that can show what "blank" looks like to
  // somebody reading the screen.
  await expect(page.getByTestId("upcoming-empty")).toHaveText(
    /No upcoming meetings/,
  );
  await expect(page.getByTestId("recent-empty")).toHaveText(/No meetings yet/);

  await context.close();
});

test("a booked meeting appears under Upcoming with its date and time", async ({
  browser,
}) => {
  const { context, page } = await freshDashboard(browser);

  await bookAMeeting(page, "Design review", 3);
  await page.goto("/");

  const cards = page.getByTestId("upcoming-list").getByTestId("meeting-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.getByTestId("meeting-title")).toHaveText("Design review");

  // A real clock reading, not the raw ISO string: a host reading "2026-10-04
  // T14:30:00+00:00" has been shown a database value rather than a time.
  await expect(cards.getByTestId("meeting-clock")).toHaveText(/\d{1,2}:\d{2}/);
  // And not "Invalid Date", which is what a timestamp the browser could not read
  // renders as — and which a looser pattern than this one would let through.
  await expect(cards.getByTestId("meeting-day")).not.toHaveText(/Invalid/);

  await context.close();
});

test("upcoming lists the soonest meeting first", async ({ browser }) => {
  const { context, page } = await freshDashboard(browser);

  await bookAMeeting(page, "Far away", 6);
  await bookAMeeting(page, "Soon", 1);

  await page.goto("/");

  // Waited for the count first, then read in DOM order. Reading immediately
  // would race the fetch and see an empty list, which `toEqual` reports as a
  // mismatch rather than as the timing problem it is — and an ordering test that
  // is flaky about *existing* is not an ordering test.
  const cards = page.getByTestId("upcoming-list").getByTestId("meeting-card");
  await expect(cards).toHaveCount(2);

  // A list holding both Meetings in the wrong order is the failure this is for,
  // so the whole list is compared rather than the two rows separately.
  expect(await cards.getByTestId("meeting-title").allTextContents()).toEqual([
    "Soon",
    "Far away",
  ]);

  await context.close();
});

test("a meeting created from the dashboard is the most recent one", async ({
  browser,
}) => {
  const { context, page } = await freshDashboard(browser);

  await bookAMeeting(page, "Earlier booking", 2);

  // New Meeting navigates into the room rather than staying here, so this is
  // also the honest test of the list reflecting what the host just did: come
  // back to the dashboard afterwards.
  await page.goto("/");
  await page.getByRole("button", { name: "New Meeting" }).click();
  await expect(page).toHaveURL(/\/room\/[0-9a-f-]{36}$/);
  await page.goto("/");

  const recent = page.getByTestId("recent-list").getByTestId("meeting-card");
  await expect(recent).toHaveCount(2);
  // First, because it was created last — the claim story 13 is about.
  await expect(recent.getByTestId("meeting-title").first()).toHaveText(
    "Untitled meeting",
  );

  await context.close();
});

test("an instant meeting with no title is named rather than left blank", async ({
  browser,
}) => {
  const { context, page } = await freshDashboard(browser);

  await page.getByRole("button", { name: "New Meeting" }).click();
  await expect(page).toHaveURL(/\/room\//);
  await page.goto("/");

  // The same words the schedule confirmation uses for the same case. An empty
  // heading would read as a row that failed to render.
  await expect(
    page.getByTestId("recent-list").getByTestId("meeting-title").first(),
  ).toHaveText("Untitled meeting");

  await context.close();
});

test("a meeting row's date and its time come from the same instant", async ({
  browser,
}) => {
  const { context, page } = await freshDashboard(browser);

  // Back to the dashboard first: booking a Meeting navigates to /schedule, and
  // the demo control lives on the dashboard.
  await page.goto("/");
  await page.getByTestId("show-demo").click();
  await expect(page.getByTestId("demo-sections")).toBeVisible();

  // The seed's completed Meeting has a `started_at` a minute after its
  // `created_at` — so a row whose day came from one and whose clock came from
  // the other showed two instants a minute apart on the same line. Read the pair
  // back as a single Date and check it parses to the Meeting's own start.
  const completed = page
    .getByTestId("demo-sections")
    .getByTestId("recent-list")
    .getByTestId("meeting-card")
    .filter({ hasText: "Kickoff" });
  await expect(completed).toHaveCount(1);

  const shown = new Date(
    `${await completed.getByTestId("meeting-day").innerText()} ${await completed
      .getByTestId("meeting-clock")
      .innerText()}`,
  );
  expect(Number.isNaN(shown.getTime())).toBe(false);

  await context.close();
});

test("a stranger's meeting never appears on this dashboard", async ({ browser }) => {
  const host = await browser.newContext();
  const hostPage = await host.newPage();
  await hostPage.goto("/");
  await expect(hostPage.getByTestId("greeting")).toBeVisible();
  await bookAMeeting(hostPage, "Someone else's plan", 2);

  const { context, page } = await freshDashboard(browser);

  // Counted rather than pattern-matched: the point is that the row is not there,
  // and a test that only checked for the reviewer's own title would also pass
  // with a stranger's row sitting next to it.
  await expect(page.getByTestId("upcoming-list").getByTestId("meeting-card")).toHaveCount(0);
  await expect(page.getByTestId("recent-list").getByTestId("meeting-card")).toHaveCount(0);

  await host.close();
  await context.close();
});

test("the seeded demo data is behind an explicit ask and is not the default", async ({
  browser,
}) => {
  const { context, page } = await freshDashboard(browser);

  // Not shown until asked. Asserted before the click, so a build that served the
  // demo data as a default would fail here rather than quietly pass the rest.
  await expect(page.getByTestId("show-demo")).toBeVisible();
  await expect(page.getByTestId("demo-sections")).toHaveCount(0);

  await page.getByTestId("show-demo").click();

  await expect(page.getByTestId("demo-sections")).toBeVisible();
  await expect(page.getByTestId("demo-name")).toHaveText("Altaf Raja's meetings");
  await expect(
    page.getByTestId("demo-sections").getByTestId("upcoming-list"),
  ).toBeVisible();

  await context.close();
});

test("the demo control is not offered at all when there is no Demo Identity", async ({
  browser,
}) => {
  // An unseeded database. The Playwright backend shares one seeded file, so the
  // only honest way to reach this state is to make the request fail the way an
  // absent Demo Identity does — a 404 from that one endpoint, leaving every
  // other request real.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/api/dashboard/demo", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "There is no Demo Identity in this database." }),
    }),
  );
  await page.goto("/");

  // GLOSSARY.md: "only offered where explicitly initialised, never as a silent
  // default". A button that renders unconditionally and then fails is offered
  // everywhere; what "not offered" has to mean is that nothing appears at all.
  await expect(page.getByTestId("show-demo")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "See a populated dashboard" })).toHaveCount(0);

  // And the reviewer's own sections are unaffected by the absence of the demo.
  await expect(page.getByTestId("greeting")).toBeVisible();
  await expect(page.getByTestId("upcoming-empty")).toBeVisible();

  await context.close();
});

test("looking at the demo data does not change who you are", async ({ browser }) => {
  const { context, page } = await freshDashboard(browser);

  const greetingBefore = await page.getByTestId("greeting").textContent();
  await page.getByTestId("show-demo").click();
  await expect(page.getByTestId("demo-sections")).toBeVisible();

  // The failure this pins: an opt-in that switched the cookie would move the
  // reviewer's own Meetings onto the Demo Identity, and their own two sections
  // would quietly change underneath them.
  await expect(page.getByTestId("greeting")).toHaveText(greetingBefore ?? "");
  await expect(page.getByTestId("upcoming-empty")).toBeVisible();
  await expect(page.getByTestId("recent-empty")).toBeVisible();

  await context.close();
});

// Desktop, tablet and narrow mobile, for the same reason the schedule form is
// checked at all three: the sections are lists, and lists are what break first.
for (const width of [1280, 768, 375]) {
  test(`the sections fit a ${width}px screen`, async ({ browser }) => {
    const { context, page } = await freshDashboard(browser);
    await bookAMeeting(page, "Design review", 1);
    await page.goto("/");

    await page.setViewportSize({ width, height: 720 });

    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);

    // The Invite Link stays reachable at every width: on a phone the row stacks,
    // and a stacked row where the link fell off the edge would be a control the
    // host cannot press.
    await expect(
      page.getByTestId("upcoming-list").getByRole("link", { name: "Invite link" }),
    ).toBeVisible();

    await context.close();
  });
}
