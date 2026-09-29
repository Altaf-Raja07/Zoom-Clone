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

**Status:** ready-for-agent

- [ ] A participant can mute and unmute themselves, and the change is visible to others without a refresh
- [ ] A participant can turn their camera on and off, and the change is visible to others without a refresh
- [ ] The user sees their own camera feed in the room, so they can confirm video works
- [ ] A mute state is visible both on the participant's tile and in the participant panel
- [ ] The participant panel lists everyone currently in the room, showing names and status indicators
- [ ] A state change made in one browser context is visible in a second independent context
- [ ] Whether a user is the host is resolved from the Meeting's host field, with no role column stored on participants
- [ ] The toolbar keeps mute, video, participants, and chat reachable at all times
- [ ] The end-meeting control is visually separated from all other controls
- [ ] The toolbar follows the reference's left / centre / right arrangement, with chevrons on submenu controls
- [ ] Remote participants are visually distinguishable from the real local camera preview, so simulated video is not mistaken for real
