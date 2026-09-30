# 06: Pre-join screen

**What to build:** Before entering a Meeting, a person sees themselves. They
check their camera is framed, confirm the name they will be known by, choose
whether to be heard and seen, and then join. This is the most recognisable
moment in a Zoom flow, and it is nearly free for us because the local camera
preview is needed anyway.

The states that matter are the unhappy ones. A user who denies camera
permission, has no camera, or turns their camera off must be told what happened
and must still be able to enter the Meeting. A black tile with no explanation is
not acceptable; a message and a way forward are.

This is the first of three surfaces built **without a screenshot reference** —
there is no Zoom pre-join capture available. It is designed from Zoom convention
and must be recorded as unvalidated rather than presented as matched.

**Blocked by:** 03 (Join a Meeting by ID or Invite Link).

**Status:** done

- [x] Pre-join shows a live local camera preview
- [x] Pre-join shows a Display Name field, pre-filled from the guest identity and editable
- [x] Microphone and camera can each be toggled before entering
- [x] A prominent Join control enters the Meeting
- [x] Denied camera permission produces a clear explanation, and the user can still join
- [x] A machine with no camera device produces a clear explanation, and the user can still join
- [x] A user who turns their camera off can still join, and enters with video off
- [x] A user with no microphone can still join
- [x] The chosen Display Name and device preferences carry through into the room
- [x] Playwright asserts the denied-permission and no-device paths both reach the room
- [x] The absence of a reference capture is recorded as a known limitation

## What was built

- `frontend/src/app/prejoin/[id]/page.tsx` — the `/prejoin/<meeting id>` route. No
  Invite Link points at it, and the reason is in the file.
- `frontend/src/components/PreJoin/PreJoin.tsx` — the screen. Preview, name, two
  toggles, the Join control, and a notice per device failure.
- `frontend/src/lib/media.ts` — one `getUserMedia` call site, and the mapping
  from `DOMException.name` to something a person can act on.
- `frontend/src/lib/prejoin.ts` — the device choices handed to the room, in
  `sessionStorage`, consumed on read and validated field by field.
- `frontend/e2e/prejoin-helpers.ts` — the setup both Playwright projects share.
- `frontend/e2e/pre-join-screen.spec.ts`, `frontend/e2e/pre-join-camera.spec.ts` —
  22 browser tests across two Playwright projects.
- `frontend/playwright.config.ts` — a second project, `chromium-camera`.

## Six decisions worth flagging

- **The two devices are asked for separately.** A single
  `getUserMedia({video: true, audio: true})` fails *entirely* if either is
  missing, which is what turns a laptop with no webcam into a person who cannot
  be heard. This is the single most important thing `getLocalMedia` does, and it
  is asserted from both sides: the microphone refused while the camera works, and
  the camera refused while the microphone works.
- **The join screen stopped asking for the Display Name.** It used to, and
  ticket 03's file asserted it. The name is confirmed on pre-join instead,
  beside a preview, which is the one place where correcting it is worth doing.
  Asking twice means correcting twice. What is left on the join screen is the one
  thing pre-join does not know: *which* Meeting — so a Meeting that has not
  started, has ended, or does not exist is still refused **before** anybody is
  prompted for a camera for it.
- **Only the device choices cross in `sessionStorage`, not the name.** The two
  have different lifetimes: the name is a fact about the `User` and is written
  through the API before the person enters, so it is already the truth by the
  time the room asks; the two flags are a decision about *this visit in this tab*
  and exist nowhere else. Carrying the name as well would be a second copy of a
  fact already stored once, and two copies of a name are two chances to disagree.
  The entry is removed when the room reads it, which is what stops a second
  Meeting in the same tab inheriting the first one's device state — and a reload
  silently un-muting somebody who muted to get into a meeting. Every read is
  validated field by field and every failure is swallowed: storage being broken
  costs the person their preferences for one visit, and the alternative is
  refusing entry.
- **The camera's lifetime belongs to one effect, and the preview is a callback
  ref.** The preview element is unmounted whenever the camera is off, so a plain
  `useEffect` with no dependency on the element never hears about the new one, and
  turning the camera back on — or retrying after a refusal — leaves a mounted
  `<video>` with nothing in it while the camera light is on. That is precisely the
  black tile the ticket forbids, and a test checking only `aria-pressed` sails
  straight past it. Two tests here assert the *width* of the video element, which
  is the only signal that distinguishes a live preview from a black one.
- **A failed device cannot be switched on, and pressing its toggle asks again.**
  The button does not flip to "On" while nothing is being sent, because the room
  would then be told the opposite of what is true. Pressing it re-asks the
  browser instead, which is also how a person who has just unblocked the site in
  another tab gets their camera without hunting for the retry link.
- **Retry is offered for "denied" and "busy" only.** Those are the failures a
  person can undo. On a machine with no webcam the answer is the same for ever, and
  a button that can only fail is a promise not kept.
- **The microphone stream is released the moment it arrives.** Nothing plays it —
  ADR-0001 has remote audio simulated and there is no peer connection to feed — so
  a live track would be a recording indicator on a device capturing nothing. The
  *permission* is what the screen needs; the stream is not.

## Not done here

- **No reference capture, so nothing here is validated.** This is the first of
  the three surfaces designed from Zoom convention. It is recorded in the README's
  honesty notes as unvalidated rather than presented as matched, and it is stated
  at the top of `PreJoin.tsx` so it cannot be forgotten by the next person to edit
  it.
- **The denied-permission path is scripted; the no-device path is partly genuine.**
  A headless browser cannot refuse a permission on demand — with no device present
  the answer is always `NotFoundError` — so the refusal is produced by rejecting
  with the same `DOMException` a browser produces, and nothing else is stubbed.
  The plain project still runs with no fake device at all, so the *absence* there
  is genuine; but the specific "no camera was found" wording is asserted in the
  camera project with the device removed by stub, so that the assertion is the
  same on every machine rather than depending on the hardware a reviewer happens to
  have. The consequence is that the two halves are two Playwright **projects**:
  Chromium's fake-device flags are read at browser launch and
  `test.use({launchOptions})` inside a `describe` is refused.
- **The toggles render as "on" until the browser has answered.** That is the
  state a person is in who has not been asked, and starting them off would be a
  worse surprise. The cost is that a test can read a toggle mid-question and be
  right about the DOM and wrong about the meeting, so the screen carries
  `data-devices="pending|settled"` and the tests wait for it. That attribute is
  the only test-facing thing on the screen.
- **The preview is local and is stopped on leaving.** No `RTCPeerConnection`, no
  device enumeration, no device *selection*. ADR-0001 says why: it would work on
  localhost and fail in the deployed demo. Choosing a specific microphone is not
  built and is not in any later ticket.
- **The Meeting lists' "Invite link" link became "Open", pointing at pre-join.**
  Both lists are the Host's own Meetings, so a row is a way back into something
  they already made rather than something to share. It points at `/prejoin/<id>`
  and not at `/room/<id>`, because the host's own browser is still a person who
  gets to check their camera. A deliberate change to ticket 05's surface, made
  here because the room is now behind pre-join.
- **A rejected name no longer replaces the whole screen.** It is reported in
  place, with the form intact. A Meeting that could not be read and a name the
  API would not take are different failures with different recoveries, and one
  shared error state made a bad name destroy a camera the person had arranged.


