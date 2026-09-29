# Zoom Clone (Meetly) — Product Spec

## Problem Statement

A candidate has been given a one-day assignment to build a Zoom clone: a
video conferencing web application that replicates Zoom's design, user
experience, and core meeting workflows. The grader evaluates six things —
functionality, UI/UX similarity to Zoom, database design, code quality, code
modularity, and the candidate's ability to explain the implementation in an
interview.

The problem is that the assignment is internally inconsistent and unbounded. It
calls the product a "Video Conferencing Platform" and demands the UI match Zoom
"exactly", yet none of its Must Have requirements mention video or audio
transport. It says "No Login Required: Assume a default user is logged in"
while listing authentication as a Good to Have. It asks for a landing dashboard
with three specific action buttons, but the only available visual reference —
Zoom Workplace — has no such buttons. And it gives a one-day deadline for work
that includes real-time state, a database schema that will be scrutinised, and
responsive design.

The risk is not building too little. It is spending the entire budget on the
wrong thing: attempting real WebRTC media transport, or pixel-matching settings
dialogs the brief never asks for, and submitting four required workflows that
do not work.

## Solution

A Zoom-styled conferencing platform where the four required workflows — create
an instant meeting, join a meeting, schedule a meeting, and meet in a live
room — work correctly, presented in a visual language modelled on Zoom
Workplace, on a hand-designed schema with real relationships, deployed and
reachable by a link.

The deliberate boundaries: no real media transport (real local camera preview,
simulated remote tiles, real-time state for everything else), no authentication
(cookie-backed guest identity that still produces a real `User` row with real
ownership), and no clone of the Zoom Workplace product surface. Each is recorded
in an ADR with its reasoning, so the trade-off is explainable rather than
accidental.

## User Stories

### Identity and first run

1. As a first-time visitor, I want to be identified automatically without a signup or login form, so that I can start using the product immediately.
2. As a first-time visitor, I want to be asked for a display name, so that other participants see something recognisable rather than "Guest 4".
3. As a returning visitor, I want my display name and identity to be remembered, so that I don't have to reintroduce myself at every meeting.
4. As a returning visitor, I want my own meetings still to be mine after a redeploy, so that my meeting history isn't lost when the server restarts.
5. As a developer, I want the database to be seeded automatically on first run, so that a grader opening the app sees a populated dashboard rather than an empty one.
6. As a developer, I want seeding to be idempotent, so that restarting the server repeatedly does not duplicate users, meetings, or attendance records.
7. As a reviewer, I want to see a completed meeting with real attendance history on first load, so that the schema's design decisions are visible rather than merely claimed.

### Landing dashboard

8. As a user, I want to land on a dashboard that immediately shows New Meeting, Join Meeting, and Schedule Meeting actions, so that every primary workflow is one click away.
9. As a user, I want to see my upcoming scheduled meetings with their date and time, so that I know what's coming.
10. As a user, I want to see my recent meetings, so that I can rejoin or reference something I hosted earlier.
11. As a user, I want to be able to see an upcoming-meetings section that is visibly populated on a fresh database, on request, so that the app doesn't look empty or broken and I can tell the feature works before I have booked anything myself.
    *Acceptance:* on a fresh, seeded database, selecting the Demo Identity's dashboard
    shows a populated Upcoming Meetings section. A guest who has booked nothing sees
    their own two sections with their empty states — which is a correct answer, not a
    broken one — and is offered a control that shows the Demo Identity's populated
    sections. A production guest never receives or inherits the Demo Identity's
    Meetings; see the deviation recorded under Implementation Decisions.
12. As a user, I want an empty Recent Meetings list when I have hosted nothing, so that the app doesn't fabricate history I don't have.
13. As a user, I want recent meetings ordered so the most recently active is first, so that my latest meeting is always at the top.
14. As a user, I want an instant meeting to appear in my recent meetings as soon as I create it, so that the list reflects what I just did.
15. As a user, I want a clear empty state when there are no upcoming meetings, so that a blank area isn't mistaken for a bug.
16. As a user, I want a navbar with a profile avatar and a settings placeholder, so that the chrome resembles Zoom's.
17. As a mobile user, I want the dashboard cards to reflow for a narrow screen, so that the app is usable on a phone.

### Creating an instant meeting

18. As a user, I want to start a new meeting with one click, so that I can invite people immediately.
19. As a user, I want to be given a unique meeting ID, so that I have something to share.
20. As a user, I want the meeting ID formatted the way Zoom formats it, so that it reads aloud cleanly.
21. As a user, I want to be given a shareable invite link, so that I can send it to people who don't want to type a code.
22. As a user, I want to copy the invite link to my clipboard in one click, so that sharing is frictionless.
23. As a user, I want to be taken to the meeting room after creating a meeting, so that I can check my camera before others arrive.
24. As a user, I want an instant meeting to have no title and no start time, so that the interface doesn't ask me for information I don't have.

### Joining a meeting

25. As a user, I want to join a meeting by typing its ID, so that I can get in from a phone without a link.
26. As a user, I want to join a meeting by opening an invite link, so that I don't have to transcribe a code.
27. As a user, I want to be told when a meeting ID doesn't exist, so that I know I mistyped rather than being left on a blank screen.
28. As a user, I want to be told when a meeting has already ended, so that I understand why I can't enter.
29. As a user, I want to confirm my display name before entering, so that I'm not named "Guest" by accident.
30. As a user, I want the join button to be disabled until the field is valid, so that I don't submit an empty code.
31. As a guest, I want to join someone else's meeting without any login step, so that the barrier to entry is only the link.

### Scheduling meetings

32. As a user, I want to schedule a meeting with a title, so that it's recognisable on a shared calendar.
33. As a user, I want to add a description, so that participants know what the meeting is for.
34. As a user, I want to pick a date and time, so that the meeting appears at the right time.
35. As a user, I want to pick a duration, so that the meeting's length is explicit.
36. As a user, I want a scheduled meeting to receive an auto-generated invite link, so that I can share it before the meeting happens.
37. As a user, I want the scheduled meeting to appear under Upcoming Meetings, so that I can find it again.
38. As a user, I want to join my own scheduled meeting when its time arrives, so that the schedule is actionable and not just a calendar entry.
39. As a user, I want the schedule form to fit a narrow screen, so that I can schedule from a phone.

### Pre-join

40. As a user, I want to see my own camera preview before entering a meeting, so that I know I'm framed and lit properly.
41. As a user, I want to choose my display name on the pre-join screen, so that I can correct it before people see it.
42. As a user, I want to mute and unmute before entering, so that I join quietly when I need to.
43. As a user, I want to turn my camera off before entering, so that I can join without video.
44. As a user, I want to be told clearly when camera or microphone permission is denied, so that a silent black tile isn't a mystery.
45. As a user, I want to proceed into the meeting even with no camera, so that a missing device doesn't block me from attending.
46. As a user, I want to proceed into the meeting even with no microphone, so that a missing device doesn't block me from attending.
47. As a user, I want my display name and device choices to carry into the room, so that I don't reconfigure anything on arrival.
48. As a user, I want a prominent Join button, so that entering a meeting is unmistakable.

### Inside the meeting room

49. As a participant, I want to see the meeting's title, so that I know which meeting I'm in.
50. As a participant, I want to see other participants appear as they join, so that I know who's present.
51. As a participant, I want to see other participants disappear as they leave, so that the list reflects reality.
52. As a participant, I want a participant panel listing everyone currently in the room, so that I can see who I've invited and who's actually here.
53. As a participant, I want to see my own name in the participant panel, so that I can confirm I'm identified correctly.
54. As a participant, I want my mute state to be visible, so that I know whether I'm broadcasting audio.
55. As a participant, I want to mute and unmute myself, so that I control whether I'm audible.
56. As a participant, I want other participants' mute states to be visible, so that I can tell who's speaking.
57. As a participant, I want to turn my camera on and off, so that I control whether I'm visible.
58. As a participant, I want to see my own camera feed, so that I can verify my video is working.
59. As a participant, I want to be able to end the meeting if I host it, so that the session can be closed.
60. As a participant, I want the toolbar to keep essential controls — mute, video, participants, chat, end — visible at all times, so that I can always act.
61. As a participant, I want secondary controls to collapse into an overflow menu on a narrow screen, so that the essential controls remain reachable.
62. As a participant, I want the end-meeting control visually separated from everything else, so that I don't end a meeting by accident.
63. As a participant, I want the room's dark stage to look like Zoom's, so that the app is visually familiar.
64. As a participant, I want to see a clear indicator when remote video is simulated rather than real, so that I'm not misled about what I'm seeing.
65. As a participant, I want the participant and chat panels to become drawers or tabs on a narrow screen, so that the meeting stage is never squeezed to make room for them.
66. As a participant, I want to end up back on the dashboard after the meeting ends, so that I'm not stranded.
67. As a host, I want to see a "X has left" notification, so that I notice when someone disconnects.
68. As a participant, I want to see the participant count on the toolbar, so that I know the room size at a glance.

### Live chat

69. As a participant, I want to open a chat panel, so that I can read and send messages.
70. As a participant, I want to send a message, so that I can communicate without speaking.
71. As a participant, I want to see messages from other participants arrive live, so that conversation is real-time.
72. As a participant, I want each message attributed to its sender, so that I know who's talking.
73. As a participant, I want my own messages visually distinct, so that I can follow the conversation.
74. As a participant, I want to see message history from the current session, so that I can scroll back through what was said.
75. As a participant, I want a readable message composer on a narrow screen, so that I can reply from a phone.
76. As a participant, I want chat to work in a real meeting with two people in two browsers, so that it's demonstrably live rather than simulated.
77. As a participant, I want to understand that chat is not stored after the meeting, so that I'm not misled about where my messages go.

### Responsive behaviour

78. As a mobile user, I want no horizontal scrolling anywhere, so that the app doesn't feel broken on a phone.
79. As a mobile user, I want no overlapping controls, so that every control is clickable.
80. As a tablet user, I want layouts that use the extra width sensibly, so that the app doesn't look stretched.
81. As a participant on a narrow screen, I want to open participants and chat without leaving the meeting, so that I can multitask.

### Deployment and operations

82. As a reviewer, I want the app deployed and reachable at a public URL, so that I can evaluate it without running anything locally.
83. As a reviewer, I want the app to still work after a server restart, so that my evaluation isn't wasted on a cold database.
84. As a developer, I want the backend to survive a long idle period without dropping my meeting, so that the free hosting tier doesn't break a live session.
85. As a developer, I want the database to self-heal to a seeded state if its storage is lost, so that a wiped volume doesn't produce an empty app.
86. As a developer, I want CORS and cookie settings configured in exactly one place, so that I have one thing to debug when identity misbehaves.
87. As a developer, I want all colour, spacing, and typography values in a single token layer, so that correcting the palette later is a one-file change.

### Non-goals made visible

88. As a user, I want the app to not pretend to record meetings, so that I don't expect a recording that will never exist.
89. As a user, I want the app to not present half-built settings screens, so that what I see is deliberate rather than broken.
90. As an interviewer, I want the deliberate omissions documented, so that I can tell design decisions from unfinished work.

## Implementation Decisions

Recorded in full in `GLOSSARY.md` and `docs/adr/0001`–`0004`. Summary:

**Stack.** Next.js frontend (single page application), FastAPI + SQLAlchemy backend, SQLite. FastAPI chosen over Django because the assignment states the schema will be evaluated and an ORM that authors the schema works against that criterion; Pydantic gives typed request validation and WebSockets are first-class. Accepted costs: no admin panel, migrations on us.

**Two identifiers per Meeting.** A Meeting has a UUID surrogate key and, separately, a unique 11-digit `join_code` grouped 3-4-4, which is the public identity carried by the invite link and read aloud. The assignment requires both a typed ID and a shareable link, and a UUID serves neither. Keeping the public code off the primary key means the code format can change without a migration touching every referencing table. Collision on insert is retried.

**Participation is soft-deleted.** Leaving stamps `left_at`; the row survives. Consequence: "who is in this room" is a query, not a table, and the `left_at IS NULL` filter lives in exactly one repository function that no other code bypasses. A bare `WHERE meeting_id = ?` is a bug that returns past attendees.

**Authority is derived, not denormalised.** No `role` column on participants. "Is this user the host?" is `meetings.host_id`. A denormalised role column could silently disagree with the meeting and would let a non-host act on host-only controls.

**One meetings table.** Instant and Scheduled Meetings are the same table; a nullable `scheduled_start_at` distinguishes them. There is deliberately no `kind` discriminator, because a column duplicating a fact already implied by a null is the same failure mode as the role column.

**New nullable column: `started_at`**, set when the first participant joins. It orders in-progress meetings to the top and is the honest test for whether a meeting has actually begun.

**Recent Meetings: hosted only.** Filtered by `host_id`, indexed, with no union and therefore no deduplication. The hosted-or-attended union was considered and rejected in favour of a simple query; participation-based history is a later addition. An empty list is valid and is never backfilled with fabricated history. Ordered by a recency timestamp — the later of `created_at` and `started_at`, falling back to `created_at` — descending, with `id` as a deterministic tie-break. It does not order by `scheduled_start_at`, which is null for Instant Meetings and represents a planned rather than actual time. The recency expression is written explicitly in SQL rather than relying on `COALESCE` semantics, with a comment explaining that the intent is the later of the two values, not the first non-null.

**Realtime.** One WebSocket per client to a meeting-scoped endpoint, with an in-process broadcast hub. The hub holds participant state in process memory, which is why the backend must run as exactly one instance with exactly one worker — a second instance would scatter participants into rooms that cannot see each other. Clients send a ~25s heartbeat, which keeps the free tier from idling the service and doubles as the meeting-still-alive signal.

**Identity.** No authentication. A signed cookie references a real `User` row, so ownership and attendance are genuine relationships. Cookie attributes are `SameSite=None; Secure`, with CORS configured once from an env-var origin allowlist. Accepted risk: losing the cookie costs a guest their identity, not access to anything.

**Network topology.** The browser talks directly to FastAPI rather than through a Next.js proxy, because the WebSocket must connect directly anyway and a single CORS configuration is easier to reason about than a cookie story on one path and none on the other.

**Media.** No real peer-to-peer transport. Real `getUserMedia` preview for the local participant; simulated tiles for everyone else, visually distinct so they are not mistaken for real video. The signalling channel is real, so adding peer connections later is additive. Do not wire up `RTCPeerConnection` without TURN: it works on localhost and fails in the deployed demo.

**Chat.** Live-only, carried over the existing WebSocket, with no messages table. Ephemeral by design, stated plainly in the README.

**Visual authority.** Where the assignment names an explicit requirement, the assignment wins — so the dashboard has New Meeting, Join Meeting, Schedule Meeting, plus Upcoming and Recent sections, and no left icon rail. Where the assignment is silent, the supplied Zoom Workplace screenshots govern spacing, typography, radii, surfaces, button and icon treatment, and colour relationships. The room adopts the Workplace left rail and dark stage where it doesn't obscure panels or controls. The Zoom Workplace *product* surface — Admin Center, Upgrade, Host Tools, AI features, account management — is not cloned.

**Palette is approximated, not measured.** No CSS values were read from a live Zoom surface. Colour values are provisional and must be documented as such. Three surfaces — pre-join, participants/chat panel, mobile layouts — are designed from Zoom convention with no screenshot behind them and are unvalidated.

**Styling.** CSS Modules plus a single token file in three layers: primitives (raw palette, spacing, typography, radii, shadows, sizing), semantic tokens (page background, card surface, primary action, text roles, meeting-stage background, toolbar background, borders, status), and component styles consuming semantic tokens only. No raw colour values in component styles; no duplicating a spacing, radius, or typography value when a token applies; components reference semantic tokens rather than raw palette tokens. Avoided arbitrary-value utilities specifically because they let components bypass the token layer, which is the one thing the system exists to prevent. Breakpoints and media queries are consistent across the app. When measured reference values become available, the token layer is updated rather than individual components.

**Seed.** Demo identity "Altaf Raja" plus three or four guest users; one completed Instant Meeting hosted by the demo user with real join and leave timestamps; two or three scheduled meetings over the next few days so Upcoming is populated on first run. Timestamps are relative to the current date. No fake active presence and no seeded chat messages. Seeding is idempotent. The demo identity is only offered where explicitly initialised and never shadows production guest-cookie identity — a production guest always receives their own `User`. Reviewers create their own meeting to test live state. Documented in the README.

**Story 11 is satisfied on request, and a guest's own dashboard is left alone.** Upcoming and Recent are both filtered on the Host, so a reviewer who has booked nothing has two genuinely empty sections — and populating them for that reviewer requires showing them something that is not theirs, by one of three routes, none of which is acceptable:

- widen Upcoming to every Scheduled Meeting in the app, which puts a stranger's
  private booking on a first-run screen and makes the two sections of one dashboard
  answer different questions about whose Meetings they are holding;
- hand the reviewer the Demo Identity, which moves their real Meetings onto a
  shared User and makes their Display Name and ownership a shared fiction;
- leave it as it is and offer an explicit, read-only control.

The third is what is built. `GET /api/dashboard/demo` reads the Demo Identity's two
sections without touching the caller's cookie or their own rows, and the dashboard
hides the control entirely where the API reports no Demo Identity exists — GLOSSARY's
"only offered where explicitly initialised" taken literally rather than as a promise.
So the acceptance criteria above were rewritten to match the behaviour rather than the
behaviour bent to match the wording, and the cost is recorded here: **on a fresh
database a guest's own dashboard is empty until they book something or ask to see the
Demo Identity's.** That is a deliberate trade, it is the first thing to revisit if a
reviewer says the dashboard looks empty, and it is not a bug in either section.

**The seed keeps a state, rather than running once.** Its Meetings are dated from whenever it last ran, so a database seeded once has an empty Upcoming five days later — and the free tier redeploys constantly. A seeded Meeting whose start time has passed is therefore *rolled forward* to the next slot in the plan, not replaced. Rolling rather than adding is what keeps the row count fixed, so running the seed on every restart still cannot grow the database.

**Stretch tier, only if the core is demonstrably working.** Host controls — mute all, remove participant — with the host permission check enforced in the WebSocket handler rather than only hidden in the UI. Chat is Must tier, and is the first thing cut if the four required workflows are complete but the schedule is behind.

## Testing Decisions

**What makes a good test here.** Assert externally observable behaviour — HTTP responses, rendered output, database state after an operation, messages arriving over a socket. Do not assert on internal structure, component rendering details, or query shapes. The seam is the API and the WebSocket; nothing below that should be directly unit-tested, because testing a repository function in isolation would assert the implementation rather than the behaviour the grader evaluates.

**Two seams, deliberately.**

**Seam 1 — the FastAPI application.** Exercised through its HTTP and WebSocket endpoints against a real SQLite database, using **pytest**. This is the highest available seam and the one that matches how the grader will evaluate the work, so it is the seam the design aims at. Repository functions are reached only through the API, which is also what enforces the "one place guards the `left_at IS NULL` filter" rule — if the filter were tested directly, the constraint would not be under test. **No unit tests below this seam**, including for the join-code generator and the recency-sorting expression: a direct test of either would pass whether or not the rest of the application respected the constraint it encodes.

**Seam 2 — the running frontend, driven in a browser.** Using **Playwright**, for what cannot be asserted at the API: that a second browser context joining a meeting appears in the first context's participant list without a refresh, that a mute toggled in one context updates the other, that a chat message appears in both, and that a participant leaving removes them from the panel. The responsive requirements are checked the same way, at desktop, tablet, and narrow mobile widths, asserting no horizontal overflow, no overlapping controls, essential controls visible, and panels presented as drawers or tabs rather than compressing the stage.

Two browser contexts are required for the realtime assertions, not one. A single context would let a test pass on shared in-page state and prove nothing about the WebSocket.

**Database-backed behaviour worth explicit coverage**, because each is a decision we made deliberately and each has a failure mode that would be silent:

- A Meeting's `join_code` is unique, and a collision is retried rather than raising.
- Leaving a meeting stamps `left_at` and preserves the row; attendance survives the meeting ending.
- "Who is in this room" returns only participants with a null `left_at` — a past attendee does not reappear.
- "Is this user the host" resolves from `meetings.host_id`, and a non-host is refused host-only actions at the socket handler, not merely in the UI.
- Recent Meetings returns only hosted meetings, excludes attended-only meetings, and returns an empty list rather than fabricating history.
- **Recency ordering, with the overdue-unstarted case as explicit regression coverage.** Three cases: a scheduled meeting, an instant meeting, and a meeting with a null `started_at`. The case that matters and will otherwise be "fixed" by mistake: a **scheduled meeting whose start time has passed but which nobody has joined** has a null `started_at`, so it sorts by `created_at` and can fall below a freshly created Instant Meeting. That is correct — nobody started it — but it looks like a bug, so it is named as a regression test rather than left to chance.
- Seeding is idempotent: running it repeatedly does not increase user, meeting, or attendance counts.
- Chat is never persisted — a message exists for the connection and is absent afterwards.
- A guest's own cookie survives a server restart, and a lost database re-seeds to a usable state.

**Pre-join coverage**, because the unhandled states are the interesting ones: camera granted, permission denied, no device present, and camera toggled off. Each must still allow the user to proceed into the room, and the chosen display name and device preferences must carry through.

**Tooling: pytest for the API seam, Playwright for the browser seam.** Both are decided, so phase one is not blocked on a tooling choice.

**No existing prior art.** This is a greenfield repository — there are no existing tests to match, and no established test conventions to follow. The conventions set here (API-level only, no units beneath) are the prior art for everything that follows.

## Out of Scope

- **Real audio or video transport.** No WebRTC peer connections, no SFU, no TURN. Local camera preview only; remote participants are simulated.
- **Authentication.** No passwords, no signup, no login, no session expiry, no access control between users. Cookie-backed guest identity only.
- **Chat persistence.** No messages table, no history across meetings, no attachments, no threads, no reactions or emoji.
- **Meeting recordings**, local or cloud, and any recording storage.
- **Breakout rooms, polling, Q&A, live transcription, AI features, or reactions.**
- **Scheduling beyond the required fields.** No recurrence, no invitees by email, no time-zone selection, no calendar integration, no passcode, no waiting room, no template.
- **Editing or deleting meetings.** Recurring, notable.
- **The Zoom Workplace product surface.** Admin Center, Upgrade, Host Tools, account management, PMI, contacts, Chat app, search.
- **Settings, profile editing, and avatar upload** beyond the navbar placeholders the assignment explicitly permits.
- **Internationalisation** and language selection.
- **Native mobile applications.** Responsive web only.
- **Horizontal scaling.** The in-process hub makes multiple instances and multiple workers incorrect, not merely undesirable.
- **Multiple simultaneous participants beyond what a single in-process instance supports**, and any form of media server.

## Further Notes

**A deviation the user should know about.** The assignment says the database schema "will be evaluated", and separately implies the app is a working video platform. We are shipping a real-time meeting room with no media transport. That is a deliberate product compromise, not an oversight, and ADR-0001 says so plainly — including an instruction not to "fix" it by wiring up peer connections without TURN, because that works on localhost and fails in the deployed demo.

**The honesty constraint is load-bearing.** The assignment repeats the fidelity requirement three times and no CSS values were ever measured. The palette is approximated from screenshots, and three surfaces have no reference at all. The spec therefore forbids describing any colour as Zoom's actual value or any layout as pixel-perfect, and requires the README to document the unvalidated surfaces. This is worth holding to under deadline pressure: a reviewer who discovers a claimed colour was guessed is worse for us than one who was told up front which parts were unverified.

**A decision the user reversed twice.** Recent Meetings was specified as hosted-or-attended, then reversed to hosted-only. ADR-0004 records that the union was considered and rejected rather than pretending it was never on the table — which is the better answer in the interview.

**Sequencing risk.** The riskiest component is the WebSocket on Render's free tier, which idles aggressively. The heartbeat mitigates this, but a build order that reaches deployment late will discover the problem too late to react. Recommended phases: schema and seed; dashboard; room and realtime; responsive; deploy. Each phase should leave the app in a demonstrable state.
