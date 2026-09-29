/**
 * Seam 2: the running frontend, driven in a browser.
 *
 * These cover what cannot be asserted at the API: that a visitor arriving with
 * no cookie and no login step is greeted by name, and that coming back in the
 * same browser greets them by the same name. The backend runs for real, so the
 * identity cookie is exercised the way a browser exercises it.
 */

import { Page, expect, test } from "@playwright/test";

/**
 * Hold the session response open until the returned function is called.
 *
 * The race this exists for is a race — the only way to see it reliably is to
 * refuse to let the session land, which a real network does often enough by
 * accident. Routing the request and parking it turns a coin-flip into a
 * certainty, and a coin-flip is not something to leave in a regression test.
 */
async function holdSessionOpen(page: Page): Promise<() => Promise<void>> {
  let release: () => void = () => {};
  const parked = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/session", async (route) => {
    await parked;
    await route.continue();
  });

  return async () => {
    release();
    // The held request still has to make it back before anything downstream of
    // the cookie can be asserted.
    await page.waitForResponse((response) => response.url().endsWith("/api/session"));
  };
}

test("a first-time visitor is greeted by a display name with no login step", async ({
  page,
}) => {
  await page.goto("/");

  // There is no login form, so the greeting is the first thing that resolves.
  const greeting = page.getByTestId("greeting");
  await expect(greeting).toBeVisible();
  await expect(greeting).toHaveText(/^Hi, \S+/);
  await expect(page.getByLabel("Sign in")).toHaveCount(0);
});

test("a returning visitor is greeted by the same display name", async ({ page }) => {
  await page.goto("/");
  const first = await page.getByTestId("greeting").textContent();

  await page.reload();

  await expect(page.getByTestId("greeting")).toHaveText(first ?? "");
});

test("two browsers get two different identities", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();

  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  await first.goto("/");
  await second.goto("/");

  const firstName = await first.getByTestId("greeting").textContent();
  const secondName = await second.getByTestId("greeting").textContent();

  expect(firstName).not.toEqual(secondName);

  await firstContext.close();
  await secondContext.close();
});

test("a first visit's later requests all carry the cookie the first one set", async ({
  browser,
}) => {
  // The dashboard makes several requests of its own — the session, then the two
  // sections, then the Demo Identity probe — and a first visit has none of them
  // carrying a cookie. Every one depends on `current_user`, which mints a *new*
  // User for anything arriving without a cookie, so requests racing on a cold
  // browser are several Users and the browser keeps whichever cookie landed last.
  //
  // What is asserted is the *cause*, not the symptom: once the session request has
  // gone out, every subsequent request must carry a cookie. A name on screen
  // cannot show this — the greeting is rendered from whichever request answered,
  // which is not necessarily the one whose cookie survived, so a dashboard can
  // mint three Users and still show one consistent name.
  //
  // Read off the outgoing requests, because that is where the cookie is or is
  // not. Counting response bodies would only ever see the session's own id: the
  // section responses are lists, and carry no User id to disagree about.
  const context = await browser.newContext();
  const page = await context.newPage();

  // `allHeaders()` rather than `headers()`: the latter omits headers the browser
  // treats as sensitive, and `Cookie` is one of them — so reading it there would
  // report every request as bare and the assertion below would be a tautology
  // about Playwright rather than about the app.
  const cookieOnRequest: Promise<boolean>[] = [];
  page.on("request", (request) => {
    if (!request.url().includes("/api/")) return;
    cookieOnRequest.push(
      request.allHeaders().then((headers) => headers.cookie !== undefined),
    );
  });

  await page.goto("/");
  await expect(page.getByTestId("greeting")).toBeVisible();
  await page.getByTestId("upcoming-empty").waitFor();
  await page.getByTestId("recent-empty").waitFor();
  await page.waitForLoadState("networkidle");

  const carried = await Promise.all(cookieOnRequest);

  // More than one request, or there is nothing to order and the assertion below
  // would pass on a dashboard that made a single request.
  expect(carried.length).toBeGreaterThan(1);
  // The first is allowed to be bare — that is what mints the identity. Nothing
  // after it may be, because by then the cookie exists.
  expect(carried.slice(1)).not.toContain(false);

  await context.close();
});

test("a reload reuses the identity instead of minting another", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("greeting")).toBeVisible();
  await page.waitForLoadState("networkidle");

  const before = (await page.getByTestId("greeting").textContent()) ?? "";

  await page.reload();
  await expect(page.getByTestId("greeting")).toHaveText(before);
  await page.waitForLoadState("networkidle");

  await context.close();
});

test("the demo-availability probe cannot mint an identity of its own", async ({
  browser,
}) => {
  // The probe is a fourth `current_user` request, and it is the easiest one to
  // get wrong: it is a *feature* of the demo, so it is easy to reason about as
  // "the demo's request" rather than as one more request from this browser. If it
  // were issued in parallel with the session on a cold browser it would mint a
  // second User, and the reviewer's own sections would then belong to whichever
  // cookie survived.
  //
  // Held open deliberately so it can only resolve *after* the session has, and
  // so the ordering it depends on is forced rather than lucky.
  const context = await browser.newContext();
  const page = await context.newPage();

  let releaseProbe: () => void = () => {};
  const parked = new Promise<void>((resolve) => {
    releaseProbe = resolve;
  });
  let sessionSettled = false;

  await page.route("**/api/session", async (route) => {
    await route.continue();
    sessionSettled = true;
  });

  await page.route("**/api/dashboard/demo", async (route) => {
    // Fails if the probe went out before the session had been established — which
    // is the whole claim.
    expect(sessionSettled).toBe(true);
    await parked;
    await route.continue();
  });

  await page.goto("/");
  await expect(page.getByTestId("greeting")).toBeVisible();
  await page.waitForTimeout(250);

  releaseProbe();
  await page.getByTestId("show-demo").waitFor();

  const identity = await page.evaluate(async () => {
    const response = await fetch("http://localhost:8000/api/session", {
      credentials: "include",
    });
    return (await response.json()).id as string;
  });

  // The probe answered for this browser's User, and the browser still agrees.
  await expect(page.getByTestId("greeting")).toBeVisible();
  expect(identity).toBeTruthy();

  await context.close();
});

test("the dashboard shows the three primary actions", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "New Meeting" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Join Meeting" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Schedule Meeting" })).toBeVisible();
});

test("the actions wait until the visitor is known", async ({ page }) => {
  const release = await holdSessionOpen(page);
  await page.goto("/");

  // Every action is inert while the session is in flight, because the API mints
  // a User for any request without a cookie — and two of those at once is two
  // people, one of whom is then told they are a guest in the meeting they just
  // created. This is the half of that bug that can be pinned deterministically.
  await expect(page.getByRole("button", { name: "New Meeting" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Join Meeting" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Schedule Meeting" })).toBeDisabled();

  await release();

  await expect(page.getByRole("button", { name: "New Meeting" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Join Meeting" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Schedule Meeting" })).toBeEnabled();
});

test("a meeting created on a first visit belongs to the person who created it", async ({
  page,
}) => {
  await page.goto("/");

  // No waiting on the greeting first: the point is that pressing the button
  // immediately — before a visitor has any reason to think they are being made
  // to wait — still produces a Meeting that belongs to them.
  await page.getByRole("button", { name: "New Meeting" }).click();

  await expect(page).toHaveURL(/\/room\/[0-9a-f-]{36}$/);
  // The failure this pins was the creator landing on the guest's screen:
  // "You are in the meeting", hosted by a stranger, with no Invite Link at all.
  await expect(page.getByTestId("host-badge")).toHaveText("Host");
  await expect(page.getByTestId("invite-path")).toBeVisible();
});

test("a booking form waits until the visitor is known", async ({ page }) => {
  const release = await holdSessionOpen(page);
  await page.goto("/schedule");

  // The same rule as the dashboard, on the screen that books Meetings. Opened
  // from a cold browser this form used to be the first thing to reach the API,
  // which is the same race with the same outcome.
  //
  // The date field is waited on first because it is filled in by an effect, so
  // it is the proof that the page has hydrated. Without that this would read the
  // server-rendered button — which is disabled for the uninteresting reason that
  // no date has been chosen yet — and pass with the gate removed.
  await expect(page.getByTestId("schedule-date")).not.toHaveValue("");

  const schedule = page.getByTestId("schedule-submit");
  await expect(schedule).toBeDisabled();
  await expect(schedule).toHaveText("Getting your session…");

  await release();

  await expect(schedule).toBeEnabled();
  await expect(schedule).toHaveText("Schedule");
});
