# 09: Live chat

**What to build:** A participant opens a chat panel, sends a message, and sees
messages from others arrive live. Messages carry their sender, the sender's own
messages are visually distinct, and the conversation can be scrolled back through
for the duration of the session.

Chat is not in the assignment's requirements. It is here because none of the four
required workflows happen *inside* the room, and without something happening in
the room the application demonstrates very little about being a conferencing
product. It reuses the WebSocket the participant list already needs, which is
what makes it cheap.

It is **live-only and deliberately unstored** — no messages table, no history
after the Meeting ends. That is a product decision with a consequence worth
stating plainly rather than letting a reviewer assume otherwise: the README must
say so, because a user who sees a chat panel reasonably expects history. This is
also the reason no chat messages are seeded.

This is the second of three surfaces built **without a screenshot reference** —
there is no Zoom chat panel capture available. It is designed from Zoom
convention and recorded as unvalidated.

**Blocked by:** 07 (Live room — participant list over WebSocket).

**Status:** ready-for-agent

- [ ] A participant can open a chat panel alongside the Meeting
- [ ] A participant can send a message, which appears immediately
- [ ] A message sent in one browser context appears in a second independent context without a refresh
- [ ] Every message is attributed to its sender
- [ ] The sender's own messages are visually distinct
- [ ] Message history from the current connection can be scrolled back through
- [ ] The message composer is readable and usable at a narrow width
- [ ] No messages are persisted: a message exists for the connection and is absent afterwards
- [ ] No messages table exists in the schema
- [ ] Playwright asserts cross-context delivery using two independent browser contexts
- [ ] The absence of a reference capture is recorded as a known limitation
- [ ] The README states plainly that chat is not stored after the Meeting
