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

**Status:** ready-for-agent

- [ ] Pre-join shows a live local camera preview
- [ ] Pre-join shows a Display Name field, pre-filled from the guest identity and editable
- [ ] Microphone and camera can each be toggled before entering
- [ ] A prominent Join control enters the Meeting
- [ ] Denied camera permission produces a clear explanation, and the user can still join
- [ ] A machine with no camera device produces a clear explanation, and the user can still join
- [ ] A user who turns their camera off can still join, and enters with video off
- [ ] A user with no microphone can still join
- [ ] The chosen Display Name and device preferences carry through into the room
- [ ] Playwright asserts the denied-permission and no-device paths both reach the room
- [ ] The absence of a reference capture is recorded as a known limitation
