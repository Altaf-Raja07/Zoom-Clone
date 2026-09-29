# Zoom Reference Notes

Captured from screenshots supplied by the user. **These are observations from
images only.** No live Zoom surface has been inspected and no CSS values have
been read from DevTools, so no hex codes are recorded below and none should be
quoted as Zoom's actual palette. See "Known gaps" at the bottom.

## Source surfaces

The screenshots are of **Zoom Workplace** (the current product), not the
classic Zoom web client that the assignment text describes. The two differ
substantially in layout. See ADR-0003.

## Observed: in-meeting room (screenshot 4)

Layout, top to bottom:

- **Top bar** — white, spanning the full width, with the Zoom wordmark, a
  back/forward pair, a search field, then right-aligned utility items and a
  circular avatar at the far right.
- **Left icon rail** — narrow, light, vertical, with icon + label pairs:
  Home, Chat, Meetings, Contacts. Settings is pinned to the bottom of the rail.
  The active item is indicated by a filled/pill background.
- **Meeting title bar** — dark, immediately below the top bar. Info icon and
  meeting title on the left. On the right: a security shield, a sparkle/AI
  affordance, a grid icon, and a small circular attendee count.
- **Stage** — very dark (near-black), occupies the bulk of the area. With a
  single participant it shows one centred tile: a coloured square avatar with
  a large initial, and a name label pinned to the bottom-left of the tile. A
  muted mic is drawn crossed-out next to the name.
- **Toolbar** — dark, full-width, pinned to the bottom. Controls are icon
  above label, arranged left / centre / right rather than evenly centred.

Observed toolbar order:

| Position | Control | Notes |
|---|---|---|
| Left | Unmute | crossed-out mic when muted |
| Left | Video | has a chevron for a submenu |
| Centre | Participants | carries a numeric count badge |
| Centre | Chat | has a chevron |
| Centre | React | **excluded from our build** |
| Centre | Share | has a chevron |
| Centre | Host tools | host-only |
| Centre | More | overflow, has a chevron |
| Right | End | destructive, visually distinct (red) |

Three controls carry chevrons (Video, Chat, Share), which is how Zoom signals a
submenu without opening one. The destructive action is isolated at the far
right, well clear of everything else.

**Not visible in this capture:** the right-hand Participants/Chat panel, a
multi-participant video grid, host-tool panel contents, and every hover state.

## Observed: meetings tab (screenshot 5)

- Same top bar and left rail as the room.
- Two-column body: a left column (~⅓ width) and a large right detail pane,
  divided by a vertical rule.
- Left column is headed "Upcoming" with a refresh icon, and contains a
  prominent blue card (the PMI) followed by centred grey empty-state text.
  Footer row has an "Add a calendar" link.
- Right pane shows the selected meeting's title, its ID as plain text, and a
  row of three buttons: a filled blue primary, then two outlined secondary.
- Empty-state text observed: **"No upcoming meetings"**.

## Observed: schedule form (screenshot 3)

- Dark navy top bar, then a light two-column form layout with a left settings
  rail (Home / My Products / Meetings / Recordings / Summaries / Hub / …) and
  the form on the right.
- The real form is far larger than our requirement: it includes Topic,
  Description, When (date + time + AM/PM), Duration, Time Zone, Recurring,
  Invitees, Meeting ID, Template, Whiteboard, Docs, Passcode, Waiting Room,
  Encryption, My Notes, Meeting chat, and per-role Video toggles.
- **We build only Topic, Description, When, Duration** (per the assignment) and
  omit the rest entirely. Rendering a truncated version of the full dialog is
  worse than not rendering it.
- Also visible: amber warning banners for the 40-minute limit and for
  unconnected-calendar invitees; a blue Save button and a plain Cancel.

## Observed: join page (screenshot 2)

This is the **signed-out marketing-site** join page, not the signed-in app.
Layout: centred single column, heading, one labelled input, terms text, a
disabled primary button until valid, and a footer. Minimal, near-white.

## Designed without a reference (resolved by decision, still unvalidated)

These three surfaces have no screenshot behind them. Per decision, they are
built to a consistent Zoom-inspired design derived from the observed visual
language, not invented ad hoc and not left as placeholders. **They are
unvalidated** and must be described as such in the README.

- **Pre-join screen** — dedicated screen between creating/joining and the room.
  Local camera preview, display name, mic and camera toggles, prominent Join
  button. Must handle denied permissions, no-device, and camera-off states, and
  must carry the chosen display name and device preferences into the room.
- **Participants and Chat panel** — dark meeting-stage language, a clearly
  separated participant panel and an ephemeral live-chat panel. Must keep names,
  status indicators, in-connection message history, and the composer readable.
  On narrow screens these become drawers or tabs; the meeting stage is never
  compressed to fit them.
- **Mobile / narrow layouts** — verified at desktop, tablet, and narrow mobile
  widths. No horizontal overflow, no overlapping controls, essential meeting
  actions always visible, secondary actions into an overflow menu. Applies to
  dashboard cards, schedule form, pre-join preview, participant panel, and chat
  composer.

## Known gaps

- **No multi-participant grid** — only the single-tile stage was captured, so
  our 2×2 / grid layouts are unvalidated too.
- **No mobile or narrow-viewport captures** for any surface.
- **No exact colour values.** Instructions called for reading them from
  DevTools; that was not done, and cannot be done from images. Palette is
  currently approximate.
- **No dashboard matching the assignment's description.** The assignment asks
  for a home page with New Meeting / Join Meeting / Schedule Meeting buttons
  plus Upcoming and Recent sections. No supplied screenshot shows those
  buttons; see ADR-0003.
- **No multi-participant grid** — only the single-tile stage was captured.
- No dark/light mode question has been settled; the room is dark and the app
  chrome is light, which may be intentional.
