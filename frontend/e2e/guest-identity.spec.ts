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

test("a first visit mints one User, not one per request", async ({ page }) => {
  // The dashboard makes three requests of its own — the session, then the two
  // sections — and a first visit has no cookie. Every one of those requests
  // depends on `current_user`, which mints a *new* User for anything arriving
  // without a cookie, so three cookie-less requests are three Users and the
  // browser keeps whichever cookie landed last.
  //
  // The visible symptom is a returning visitor greeted by a different name: the
  // greeting came from one request and the cookie that survived was another's.
  // So this counts Users rather than checking a name, which would only catch the
  // case where the losing request happened to be the one that answered.
  await page.goto("/");
  await expect(page.getByTestId("greeting")).toBeVisible();
  // Every section has resolved, so every request the dashboard makes has landed.
  await page.getByTestId("upcoming-empty").waitFor();
  await page.getByTestId("recent-empty").waitFor();

  // Asking the API who this browser is, four times. Each call goes out with the
  // cookie the browser ended up keeping, so four identical answers is the shape
  // a correct run has. It is asked from inside the page so the requests carry
  // exactly the credentials the dashboard's own carried.
  const identities = await page.evaluate(async () => {
    const seen: string[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch("http://localhost:8000/api/session", {
        credentials: "include",
      });
      seen.push((await response.json()).id);
    }
    return seen;
  });

  expect(new Set(identities).size).toBe(1);

  // And the same identity survives a reload, which is the other half: a page
  // that had minted a fresh User per request would still be internally
  // consistent here, and would only show the bug by losing a name.
  const before = await page.getByTestId("greeting").textContent();
  await page.reload();
  await expect(page.getByTestId("greeting")).toHaveText(before ?? "");
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
