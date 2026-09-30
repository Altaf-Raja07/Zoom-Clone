/**
 * Seam 2: the running frontend, driven in a browser.
 *
 * The realtime claim cannot be made anywhere else. "A second person appears in
 * the first person's list" is a statement about two browsers and one server at
 * the same time, and no amount of testing one of them proves it.
 *
 * **Two independent browser contexts, throughout.** A single context would let
 * every one of these pass on shared in-page state — one `localStorage`, one
 * module instance, one cookie — and prove nothing about the WebSocket. Two
 * contexts means two cookie jars, two module instances, two sockets, and the
 * only thing they share is the server.
 *
 * **The assertion that matters is on the *first* context.** The guest's own list
 * is not the test: the guest's list is populated by the same fetch the room
 * would have done on load. What proves the socket is the host's list changing
 * while the host does nothing — no reload, no navigation, no click. So the
 * helper returns the host's page and every assertion is made there, after the
 * guest has arrived and gone back to sleep.
 */

import { Browser, BrowserContext, Page, expect, test } from "@playwright/test";

import { HEARTBEAT_INTERVAL_MS } from "../src/lib/realtime";

/**
 * The backend's own origin, for the tests that book a Meeting over the API
 * rather than through the UI.
 *
 * Derived from **the same env var the Playwright config uses**, not from
 * `NEXT_PUBLIC_API_BASE_URL`, which is set for the *dev server* and never for the
 * test process. Reading it here looked right and was: under a port override the
 * spec quietly talked to whatever else was listening on 8000, and the failures
 * that produced were about a Meeting that did not exist.
 */
const API_BASE_URL = `http://localhost:${
  process.env.MEETLY_TEST_BACKEND_PORT ?? 8000
}`;

/**
 * A host who has created a Meeting and walked to the pre-join screen, in their
 * own context.
 *
 * The pre-join step is walked rather than skipped because it is the real path
 * for everybody — the host included — and a test that jumped straight to
 * `/room/<id>` would be testing a route no person uses.
 */
async function hostOnPreJoin(
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
async function guestInRoom(
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

test("a second person appears in the first person's list without a refresh", async ({
  browser,
}) => {
  const host = await hostOnPreJoin(browser);
  await expect(host.page.getByTestId("participant-list")).toContainText("Altaf");

  const guest = await guestInRoom(browser, host.invitePath, "Priya");

  // The host's page, untouched. No reload, no navigation, no click — the only
  // thing that happened is that somebody else walked in. This is the assertion
  // that could not be made with one context.
  await expect(host.page.getByTestId("participant-list")).toContainText("Priya");
  await expect(host.page.getByTestId("participant-name")).toHaveCount(2);

  await guest.context.close();
  await host.context.close();
});

test("a person who leaves the room stops being listed", async ({ browser }) => {
  const host = await hostOnPreJoin(browser);
  const guest = await guestInRoom(browser, host.invitePath, "Priya");
  await expect(host.page.getByTestId("participant-name")).toHaveCount(2);

  // The tab closing is a departure, and the room has to notice. A participant
  // left listed is a person the room believes is still there — which is how a
  // host ends up talking to an empty room.
  await guest.context.close();

  await expect(host.page.getByTestId("participant-name")).toHaveCount(1);
  await expect(host.page.getByTestId("participant-list")).not.toContainText("Priya");

  await host.context.close();
});

test("the participant list includes the viewer's own entry", async ({ browser }) => {
  const host = await hostOnPreJoin(browser, "Altaf");

  // Story 53. Your own name in the list is the only way to confirm you are
  // identified the way you chose to be — and a socket bound to the wrong
  // identity looks exactly like an empty room, so this is the assertion that
  // would notice.
  await expect(host.page.getByTestId("participant-list")).toContainText("Altaf");
  await expect(host.page.getByTestId("your-name")).toHaveText("Altaf");

  await host.context.close();
});

test("the count on the title bar matches the people in the room", async ({
  browser,
}) => {
  const host = await hostOnPreJoin(browser);
  const guest = await guestInRoom(browser, host.invitePath, "Priya");

  // The count is the server's number, not `participants.length` computed in the
  // browser — the two agreeing here is what makes the title bar trustworthy
  // when a participant asks how many people are in the meeting.
  await expect(host.page.getByTestId("participant-count")).toHaveText("2");
  await expect(host.page.getByTestId("participant-name")).toHaveCount(2);

  await guest.context.close();
  await host.context.close();
});

test("the meeting's title is shown in the room", async ({ browser }) => {
  // Booked over the API with a start time an hour ago, so the Meeting is open
  // and the host can walk straight into its room. Going through the schedule
  // form would mean waiting for a clock, and a test that waits for a clock is a
  // test that fails on a slow machine.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  // The greeting only renders once `/api/session` has answered, and that answer
  // is what sets the identity cookie. Booking before it lands would create the
  // Meeting under a *different* User — `context.request` shares the cookie jar,
  // but only one that has been filled — so the page would arrive as a guest in
  // somebody else's Meeting and the host-only copy would be missing.
  await expect(page.getByTestId("greeting")).toBeVisible();

  const booked = await context.request.post(`${API_BASE_URL}/api/meetings/scheduled`, {
    data: {
      title: "Design review",
      description: "",
      scheduled_start_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      duration_minutes: 30,
    },
  });
  expect(booked.ok()).toBe(true);
  const meeting = (await booked.json()) as { id: string };

  await page.goto(`/room/${meeting.id}`);

  // Story 49. A person in a meeting needs to know which meeting they are in,
  // and an untitled Meeting says so with the same fallback the dashboard and the
  // schedule confirmation use — one word for "this Meeting has no name".
  await expect(page.getByTestId("room-title")).toHaveText("Design review");

  await context.close();
});

test("a meeting with no title is named rather than left blank", async ({ browser }) => {
  const host = await hostOnPreJoin(browser);

  await expect(host.page.getByTestId("room-title")).toHaveText("Untitled meeting");

  await host.context.close();
});

test("the client keeps the connection alive with a heartbeat", async ({ browser }) => {
  const context = await browser.newContext();

  // Recorded from *inside* the page, before any of the app's code runs, so what
  // is measured is the real client rather than a stand-in for it. Two things are
  // recorded: the frames the client sends, and the interval it asked for.
  await context.addInitScript(() => {
    const sent: string[] = [];
    const delays: number[] = [];

    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function patched(this: WebSocket, data: string) {
      sent.push(data);
      return originalSend.call(this, data);
    };

    const originalInterval = window.setInterval.bind(window);
    const patchedInterval = function (
      handler: TimerHandler,
      timeout?: number,
      ...rest: unknown[]
    ): number {
      if (typeof timeout === "number") delays.push(timeout);
      return originalInterval(handler, timeout, ...rest) as unknown as number;
    };
    window.setInterval = patchedInterval as unknown as typeof window.setInterval;

    Object.defineProperty(window, "__meetly", {
      value: {
        sent: () => sent,
        delays: () => delays,
      },
    });
  });

  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "New Meeting" }).click();
  await expect(page).toHaveURL(/\/prejoin\/[0-9a-f-]{36}$/);
  await page.getByTestId("join-button").click();
  await expect(page).toHaveURL(/\/room\/[0-9a-f-]{36}$/);

  // A ping goes out as soon as the socket opens, so the round trip is proven
  // while somebody is still watching rather than half a minute into the meeting.
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (window as unknown as { __meetly: { sent: () => string[] } }).__meetly
          .sent()
          .some((frame) => frame.includes('"ping"')),
      ),
    )
    .toBe(true);

  // And an interval at the heartbeat cadence is registered, which is what keeps
  // Render's free tier from idling the service out from under a meeting that is
  // still happening (ADR-0002).
  //
  // **What this does not prove, stated rather than glossed:** that the interval
  // is the thing that sends the ping. It proves the client asks for a 25-second
  // interval and that it pings on open; whether the callback behind that
  // interval pings is read from `src/lib/realtime.ts`, where the two sit on
  // adjacent lines. Proving it in the browser would mean either waiting 25
  // seconds per run or adding a test-only override of the interval, and this
  // repository has already ruled the latter out — `conftest.py` states that a
  // second door for tests only is a door the application no longer needs. The
  // server's side of the contract *is* tested properly, over the socket, in
  // `test_a_heartbeat_is_answered_so_a_live_socket_is_distinguishable`.
  const scheduled = await page.evaluate(
    () => (window as unknown as { __meetly: { delays: () => number[] } }).__meetly.delays(),
  );
  expect(scheduled).toContain(HEARTBEAT_INTERVAL_MS);

  await context.close();
});

test("the room explains itself when the meeting is not open yet", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  // As above: the greeting is the signal that the identity cookie exists, and a
  // Meeting booked before it lands would belong to a different User — which
  // would remove the very Invite Link this test is here to show is still there.
  await expect(page.getByTestId("greeting")).toBeVisible();

  const booked = await context.request.post(`${API_BASE_URL}/api/meetings/scheduled`, {
    data: {
      title: "Later",
      description: "",
      scheduled_start_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      duration_minutes: 30,
    },
  });
  const meeting = (await booked.json()) as { id: string };

  await page.goto(`/room/${meeting.id}`);

  // A room whose socket is refused says *why* in words. The alternative — a
  // participant panel that is simply empty, with nothing on it — is
  // indistinguishable from a meeting nobody has joined yet, and a person
  // standing in front of one has no way to tell whether to wait or to give up.
  await expect(page.getByTestId("connection-notice")).toContainText(/not started/i);

  // And the room is still usable for the thing the host came for: the Invite
  // Link they are about to send. A refused socket must not empty the screen.
  await expect(page.getByTestId("invite-path")).toBeVisible();

  await context.close();
});

test("a healthy room shows no connection warning", async ({ browser }) => {
  const host = await hostOnPreJoin(browser);

  // The other half of the notice above, and the reason it is worth a test: a
  // warning rendered unconditionally is a warning nobody reads, and it would
  // make the real one above invisible.
  await expect(host.page.getByTestId("connection-notice")).toHaveCount(0);

  await host.context.close();
});
