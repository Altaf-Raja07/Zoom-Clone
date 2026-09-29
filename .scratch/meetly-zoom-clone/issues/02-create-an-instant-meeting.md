# 02: Create an Instant Meeting

**What to build:** A user clicks New Meeting on the dashboard and is
immediately in a Meeting. The Meeting has a unique, readable Meeting ID it can
be joined by, and a shareable Invite Link it can send to someone who would
rather not type a code.

The Meeting ID is Zoom's own convention — 11 digits grouped 3-4-4, such as
123 456 789 — because the ID has to be read aloud over a phone call. It is a
separate unique field from the Meeting's internal UUID key, so the public format
can change later without a migration touching every referencing table. An
Instant Meeting has no title and no scheduled start time; the difference between
this and a Scheduled Meeting is the absence of data, not a discriminator column
(ADR-0004).

This ticket also carries the early deployment de-risking. Once the create path
works, the app is deployed to Render in its minimal form, proving the platform,
the HTTPS-only cookie path, the single-instance constraint, and the mounted disk
while the app is still nearly empty. Discovering any of that later, once the room
is built, is the expensive way to find it.

**Blocked by:** 01 (Project spine and first-run guest identity).

**Status:** ready-for-agent

- [ ] Clicking New Meeting creates a Meeting and takes the user to the room
- [ ] The Meeting receives an 11-digit Meeting ID displayed grouped 3-4-4
- [ ] The Meeting ID is unique, and a collision is retried rather than raising an error
- [ ] The Meeting has a separately-stored Invite Link carrying the Meeting ID
- [ ] The Invite Link can be copied to the clipboard in one action
- [ ] The Meeting stores a creation timestamp and a null scheduled start time
- [ ] API tests assert the create response, the ID format, and the collision-retry behaviour
- [ ] The app is deployed to Render as a single instance with one worker, and the guest cookie survives a restart of that instance
