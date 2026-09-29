# 03: Join a Meeting by ID or Invite Link

**What to build:** A person who has been sent a link opens it and is in the
meeting. A person who has only been told the number types it into the Join
screen and is in the meeting. Before entering, they confirm the Display Name
they will be known by. If the Meeting does not exist, or has already ended, they
are told so plainly rather than being left on a blank screen.

This is the second entry point the assignment requires, and it is the one that
proves the two-identifier design earns its keep: the link and the typed code
resolve to the same Meeting without either identifier being the primary key.

**Blocked by:** 02 (Create an Instant Meeting).

**Status:** ready-for-agent

- [ ] A Meeting can be joined by opening an Invite Link
- [ ] A Meeting can be joined by typing its Meeting ID
- [ ] A non-numeric or malformed ID is rejected before any lookup
- [ ] An ID that matches no Meeting reports that the Meeting does not exist, and does not enter a room
- [ ] A Meeting that has ended reports that it has ended, and does not enter a room
- [ ] The Display Name is confirmed before entering and is the name other participants will see
- [ ] The join control is disabled until the entered value is valid
- [ ] A guest can join a Meeting they did not host, with no login step
- [ ] API tests cover the link path, the typed-ID path, the unknown-ID case, and the ended case
