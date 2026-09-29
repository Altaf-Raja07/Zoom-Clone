# 11: Responsive layouts, host controls, and deployment

**What to build:** The application works on a phone, and it is deployed and
reachable at a public link with the host controls a host would expect.

Three pieces land here, grouped because each is verification and polish over
work already built rather than new behaviour:

**Responsive.** Every earlier ticket builds mobile-first. This ticket is the
sweep that proves it: no horizontal overflow, no overlapping controls, essential
Meeting actions always visible with secondary actions in an overflow menu, and
the participant and chat panels presented as drawers or tabs rather than
compressing the Meeting stage. It covers the dashboard cards, the schedule form,
the pre-join preview, the participant panel, and the chat composer, at desktop,
tablet, and narrow mobile widths.

**Host controls (stretch).** Mute all and remove participant, with the host
permission check enforced in the WebSocket handler rather than only hidden in the
interface. This is a bonus feature the assignment lists as Good to Have. It is
conditional on everything above working, and if the core is not solid it is cut
first.

**Deployment.** A single Render Web Service, one instance, one worker, with the
SQLite file on a mounted disk, seeding on startup so a lost volume degrades to a
demoable state, and CORS from a single origin allowlist. The skeleton was already
deployed in ticket 02; this is the full application.

**Blocked by:** 09 (Live chat), 10 (Leaving and ending a Meeting).

**Status:** ready-for-agent

- [ ] No horizontal scrolling at desktop, tablet, or narrow mobile widths
- [ ] No controls overlap at any of those widths
- [ ] Essential Meeting actions remain visible, with secondary actions in an overflow menu
- [ ] The participant and chat panels are presented as drawers or tabs on narrow screens, and the Meeting stage is not compressed to make room for them
- [ ] Dashboard cards, the schedule form, the pre-join preview, the participant panel, and the chat composer all adapt to a narrow width
- [ ] The host can mute all participants, and the check is enforced in the WebSocket handler
- [ ] The host can remove a participant, and a non-host is refused at the handler
- [ ] The application is deployed at a public URL and both services are reachable
- [ ] The backend runs as exactly one instance with one worker
- [ ] The database survives a service restart, and a lost volume re-seeds to a usable state
- [ ] Playwright verifies the responsive requirements at all three widths
- [ ] The README documents setup, stack, assumptions, and seed behaviour, including which surfaces are unvalidated and that the colour palette is approximated rather than measured
