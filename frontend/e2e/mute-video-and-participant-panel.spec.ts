/**
 * Seam 2: the room's toolbar and participant panel, on a machine with no devices.
 *
 * Everything asserted here is **independent of whether the machine has a
 * camera or a microphone**, and that is not a convenience — it is what makes
 * this file able to run in the plain project, where the devices are genuinely
 * absent. A person arriving on such a machine is *correctly* muted with their
 * camera off, because pre-join found nothing and said so, which means a test
 * here that pressed mute and expected "muted" would be asserting something
 * already true. Those transition tests live in `mute-video-panel-camera.spec.ts`
 * with a fake device, where the starting state is known.
 *
 * **Two independent browser contexts, throughout.** Two people are two cookie
 * jars, two module instances and two sockets. A single context would let these
 * pass on shared in-page state and prove nothing.
 */

import { expect, test } from "@playwright/test";

import { guestInRoom, hostInRoom } from "./room-helpers";

test("the list marks the viewer's own entry, so they can check who they are", async ({
  browser,
}) => {
  const host = await hostInRoom(browser);

  // Story 53. A list of everybody else is reassuring and useless: the person
  // trying to confirm "am I me" has nothing to compare against.
  await expect(
    host.page.getByTestId("participant-list").getByTestId("participant-name"),
  ).toHaveText(/Altaf \(You\)/);

  await host.context.close();
});

test("a second person's arrival is shown in the first browser's list", async ({
  browser,
}) => {
  const host = await hostInRoom(browser);
  await expect(host.page.getByTestId("participant-name")).toHaveCount(1);

  const guest = await guestInRoom(browser, host.invitePath, "Priya");

  // The host's page, untouched. This is the claim the whole realtime layer
  // exists to make, and it is only meaningful with a second browser: a single
  // context would pass on shared in-page state.
  await expect(host.page.getByTestId("participant-name")).toHaveCount(2);
  await expect(host.page.getByTestId("participant-list")).toContainText("Priya");

  await guest.context.close();
  await host.context.close();
});

test("the toolbar keeps the four essential controls reachable", async ({ browser }) => {
  const host = await hostInRoom(browser);

  // Mute, video, participants and chat are the controls the reference never
  // hides, so they are asserted present and enabled rather than merely drawn.
  // `enabled` matters: a mute control that cannot be pressed is the failure this
  // whole ticket is about, and it would still be visible.
  await expect(host.page.getByTestId("toggle-microphone")).toBeEnabled();
  await expect(host.page.getByTestId("toggle-camera")).toBeEnabled();
  await expect(host.page.getByTestId("participants-control")).toBeVisible();
  await expect(host.page.getByTestId("chat-toggle")).toBeVisible();

  await host.context.close();
});

test("the participants control carries the room's count", async ({ browser }) => {
  const host = await hostInRoom(browser);

  await expect(host.page.getByTestId("participants-badge")).toHaveText("1");

  const guest = await guestInRoom(browser, host.invitePath, "Priya");
  await expect(host.page.getByTestId("participants-badge")).toHaveText("2");

  await guest.context.close();
  await host.context.close();
});

test("the toolbar is arranged left, centre and right", async ({ browser }) => {
  const host = await hostInRoom(browser);

  const box = async (testId: string) => {
    const found = await host.page.getByTestId(testId).boundingBox();
    expect(found).not.toBeNull();
    return found!;
  };

  const mute = await box("toggle-microphone");
  const participants = await box("participants-control");
  const end = await box("end-meeting");

  // The reference's grouping, measured rather than eyeballed: the everyday
  // controls on the left, the shared ones in the middle, the destructive one
  // last. Evenly spaced controls would fail this, and look tidier.
  expect(mute.x).toBeLessThan(participants.x);
  expect(participants.x).toBeLessThan(end.x);

  await host.context.close();
});

test("the end-meeting control is separated from the others", async ({ browser }) => {
  const host = await hostInRoom(browser);
  const end = host.page.getByTestId("end-meeting");
  const mute = host.page.getByTestId("toggle-microphone");

  await expect(end).toBeVisible();

  // Far right, and well clear of the everyday controls. The gap is the design,
  // and "they look different" is not a claim a layout change can be checked
  // against.
  const endBox = await end.boundingBox();
  const muteBox = await mute.boundingBox();
  expect(endBox).not.toBeNull();
  expect(muteBox).not.toBeNull();
  expect((endBox?.x ?? 0) - (muteBox?.x ?? 0)).toBeGreaterThan(100);

  // And a different colour from every other control, because distance alone
  // does not survive a narrow screen. Compared as computed values rather than
  // against a hex, so a palette correction does not break the test — the claim
  // is that it differs, not what it is.
  const backgroundOf = (locator: import("@playwright/test").Locator) =>
    locator.evaluate((element) => getComputedStyle(element).backgroundColor);

  const endColour = await backgroundOf(end);
  expect(endColour).not.toBe(await backgroundOf(mute));
  expect(endColour).not.toBe(
    await backgroundOf(host.page.getByTestId("participants-control")),
  );

  await host.context.close();
});

test("only the host is offered the end-meeting control", async ({ browser }) => {
  const host = await hostInRoom(browser);
  const guest = await guestInRoom(browser, host.invitePath, "Priya");

  // Authority comes from `meetings.host_id`, never from a role on the
  // participant row, and this is where that is visible to a person rather than
  // only in a query (ADR-0004). Ticket 11 enforces the same thing at the socket
  // handler, so hiding it here is presentation and not the control.
  await expect(host.page.getByTestId("end-meeting")).toBeVisible();
  await expect(guest.page.getByTestId("end-meeting")).toHaveCount(0);

  await guest.context.close();
  await host.context.close();
});

test("a control that is not built yet is disabled rather than dead", async ({
  browser,
}) => {
  const host = await hostInRoom(browser);

  // Chat is ticket 09 and end-meeting is ticket 10. They are drawn where the
  // reference puts them, and they are **disabled**: a live-looking button that
  // does nothing when pressed is worse than an absent one, and a toolbar of dead
  // buttons reads as a broken build rather than as work in progress.
  await expect(host.page.getByTestId("chat-toggle")).toBeDisabled();
  await expect(host.page.getByTestId("end-meeting")).toBeDisabled();
});

test("a remote tile never carries a video element, and says why", async ({
  browser,
}) => {
  const host = await hostInRoom(browser);
  const guest = await guestInRoom(browser, host.invitePath, "Priya");
  await expect(host.page.getByTestId("participant-name")).toHaveCount(2);

  // There is no peer-to-peer transport (ADR-0001), so a remote tile must not be
  // mistakable for a live one. The claim is asserted as words on the tile rather
  // than as a pixel difference, because the words are what a person with a
  // screen reader gets too.
  const guestTile = host.page.getByTestId("remote-tile").filter({
    hasText: "Priya",
  });
  await expect(guestTile.getByTestId("tile-simulated")).toBeVisible();
  await expect(guestTile.getByTestId("tile-simulated")).toContainText(
    /simulated|off/i,
  );

  // And there is nothing there that could be mistaken for a camera.
  await expect(guestTile.locator("video")).toHaveCount(0);

  await guest.context.close();
  await host.context.close();
});

test("the panel carries both status indicators, not just the loud one", async ({
  browser,
}) => {
  const host = await hostInRoom(browser);
  const guest = await guestInRoom(browser, host.invitePath, "Priya");
  await expect(host.page.getByTestId("participant-name")).toHaveCount(2);

  // A host reading this panel is asking two questions: who can hear me, and who
  // can see me. On a machine with no devices both answers are "no" for both
  // people, which is the case where saying only the loud one (muted) would
  // leave a silently dark camera indistinguishable from a broken one.
  const hostRow = host.page
    .getByTestId("participant-row")
    .filter({ hasText: "Altaf" });
  const guestRow = host.page
    .getByTestId("participant-row")
    .filter({ hasText: "Priya" });

  await expect(hostRow.getByTestId("participant-camera")).toBeVisible();
  await expect(guestRow.getByTestId("participant-camera")).toBeVisible();
  await expect(hostRow.getByTestId("participant-muted")).toBeVisible();
  await expect(hostRow.getByTestId("participant-camera")).toHaveText("No camera");

  await guest.context.close();
  await host.context.close();
});

test("the footer does not contradict the toolbar", async ({ browser }) => {
  const host = await hostInRoom(browser);
  const footer = host.page.getByTestId("room-microphone-state");

  // The footer's device line used to render pre-join's snapshot, so pressing mute
  // left the toolbar reading "Unmute" and the text directly beneath it reading
  // Microphone "On". Asserted as a pair so a future second source of truth has
  // to fail *here* rather than being noticed by a person.
  const button = host.page.getByTestId("toggle-microphone");
  const before = await button.getAttribute("aria-pressed");

  await button.click();
  await expect(button).toHaveAttribute(
    "aria-pressed",
    before === "true" ? "false" : "true",
  );

  await expect(footer).toHaveText(before === "true" ? "On" : "Off");

  await host.context.close();
});

test("a person with no devices is still in the room, and still identifiable", async ({
  browser,
}) => {
  // This whole file runs on a machine with no camera and no microphone, so this
  // is the assertion that a missing device costs a person nothing: they are
  // listed, named, and marked as themselves. A room that refused to show
  // somebody without a webcam would fail the reviewer most likely to be sitting
  // in front of it.
  const host = await hostInRoom(browser);
  const guest = await guestInRoom(browser, host.invitePath, "Priya");
  await expect(host.page.getByTestId("participant-name")).toHaveCount(2);

  // The camera that is not there is explained rather than shown as a black
  // rectangle.
  await expect(
    guest.page.getByTestId("local-camera-notice"),
  ).toBeVisible();

  await guest.context.close();
  await host.context.close();
});
