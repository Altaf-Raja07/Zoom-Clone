# 08: Mute, video, and the participant panel

**What to build:** Everyone in the Meeting can see and control whether they are
audible and visible, and everyone else sees that state change as it happens. A
panel lists who is currently in the room along with each person's status, so a
host can tell who has actually arrived.

The toolbar follows the Zoom Workplace reference: controls arranged left, centre,
and right rather than evenly spaced; essential controls permanently visible;
secondary controls carrying a chevron to signal a submenu; and the destructive
end-meeting action isolated at the far right, visually distinct, so it is not
triggered by accident.

Authority is derived, never denormalised. There is no role column on
participants — whether someone is the host is a question about the Meeting's host
field, so there is exactly one source of truth. A denormalised role column could
quietly disagree with the Meeting and let a non-host appear to hold host rights,
which matters directly when host controls arrive in ticket 11 (ADR-0004).

**Blocked by:** 07 (Live room — participant list over WebSocket).

**Status:** done

- [x] A participant can mute and unmute themselves, and the change is visible to others without a refresh
- [x] A participant can turn their camera on and off, and the change is visible to others without a refresh
- [x] The user sees their own camera feed in the room, so they can confirm video works
- [x] A mute state is visible both on the participant's tile and in the participant panel
- [x] The participant panel lists everyone currently in the room, showing names and status indicators
- [x] A state change made in one browser context is visible in a second independent context
- [x] Whether a user is the host is resolved from the Meeting's host field, with no role column stored on participants
- [x] The toolbar keeps mute, video, participants, and chat reachable at all times
- [x] The end-meeting control is visually separated from all other controls
- [x] The toolbar follows the reference's left / centre / right arrangement, with chevrons on submenu controls
- [x] Remote participants are visually distinguishable from the real local camera preview, so simulated video is not mistaken for real

## What was built

- `frontend/src/components/Room/` — the toolbar, the local camera tile, the panel
  with both status indicators.
- `frontend/src/lib/realtime.ts` — `setDevices` on the connection, and a shared
  `sendDevices` so a `state` frame is written in one place.
- `frontend/e2e/mute-video-and-participant-panel.spec.ts` and
  `mute-video-panel-camera.spec.ts` — 11 browser tests, split by whether the
  machine has devices.
- `frontend/e2e/room-helpers.ts` — the walk to a room, written once.
- `backend/tests/test_mute_video_and_panel.py` — 11 tests at the socket seam.
- `backend/tests/conftest.py` — `Cast`, several identities in one browser.

**Almost no backend changed.** `state`, `join_meeting` and `set_device_state`
already existed from ticket 07, which stored the devices pre-join decided
precisely so that ticket 08's controls would have somewhere to send a change.
This ticket found that useful and added almost nothing to it.

## Four decisions worth flagging

- **Device *transitions* are tested only where a device exists.** The plain
  Playwright project has no camera and no microphone, so a person arriving there
  is *correctly* muted with their camera off — pre-join found nothing and said
  so. A test there that pressed mute and asserted "now muted" would be asserting
  something already true, and would pass against a mute control wired to nothing.
  So every transition test is in the `chromium-camera` project, where the
  starting state is known. The plain project's tests are the device-independent
  ones, and one of them asserts that a person with no devices is still listed and
  still named — the case a reviewer on a locked-down laptop hits first.

- **Chat and end-meeting are drawn where the reference puts them, and
  disabled.** The checklist wants them "reachable", and chat is ticket 09. A
  live-looking button that does nothing is worse than an absent one, and a
  toolbar of dead buttons reads as a broken build rather than as work in
  progress — so they are present, in the right place, with the reason on the
  control. This is the first of the ticket's criteria that is met by shape rather
  than by behaviour, and it is the one to revisit when 09 and 10 land.

- **The room's own device line follows the server, not pre-join.** It used to
  render pre-join's snapshot, which was right until somebody pressed mute: the
  toolbar would read "Unmute" and the line directly beneath it would read
  Microphone "On". Two truths about one person's own hardware, on one screen. A
  code review caught it and there is now a test that fails if it returns.

- **`is_muted` and `microphone_on` are opposites, and the conversion happens in
  exactly one place.** The mute control originally sent `microphone_on:
  myMuted` — which is *correct* and reads like a bug. The next version "fixed"
  it to `!myMuted` and silently broke the button: the value sent was always the
  one the server already held, `set_device_state` reported no change, nothing was
  broadcast, and the control did nothing. No error and no failing request. The
  room now derives one `liveDevices` object in the device's own language and
  each toggle negates only its own field, so there is no arithmetic across the
  two vocabularies left to get wrong. Both this regression and the one below are
  covered by tests checked to fail without the fix.

## What a code review changed

- **The room fell back to the defaults and told the server so.** Pre-join
  records the device decision in `sessionStorage` and the room *consumes* the
  entry as it reads it. React runs effects twice in development, so the second
  run found nothing and opened the room with both devices on — a person who
  turned their camera off on the pre-join screen arrived broadcasting it. The
  entry is now taken once, guarded by a ref, and the test for it is the only one
  that turns a device *off* on pre-join: with the fake device the recorded value
  and the fallback are identical, so nothing else in the file can tell the two
  apart.
- **The panel showed one status, not two.** It now carries the camera as well as
  the mute, because a host reading it is asking who can hear them *and* who can
  see them, and a silently dark camera is indistinguishable from a broken one.
- Dead helpers in ticket 07's test file, a duplicated pair of socket helpers, a
  dead `Cast.user_ids`, and two test helpers whose names (`mute`,
  `camera_off`) quietly set the *other* device — all removed or renamed.

## Not done here

- **No leave, no end-meeting behaviour, no chat.** Tickets 10, 10 and 09. The
  two controls exist and are disabled.
- **No host controls** — mute-all, remove participant. Ticket 11, and stretch.
- **No responsive drawers.** The toolbar wraps and the panel is a strip under
  the stage below the tablet breakpoint. Ticket 11 is the sweep that proves it,
  and the room's narrow-width behaviour is its work.
- **Remote video is still simulated**, and labelled `Camera simulated` on every
  remote tile. ADR-0001 has not changed, and this ticket did not come close to
  it: no `RTCPeerConnection`, no TURN, nothing that would work on localhost and
  fail in the deployed demo.

