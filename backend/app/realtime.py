"""The in-process broadcast hub: one room per Meeting, and who is listening.

**The single-instance constraint is load-bearing.** This module holds open
WebSocket connections in process memory, so a second uvicorn worker or a second
deployed instance would put participants into two sets of rooms that cannot see
each other — a second person would join, and the first person would simply never
hear about it. Nothing in the code says so, and two workers looks like free
headroom, so the rule lives here as well as in ADR-0002. It is not a bug to be
fixed later; it is the cost of not running a Redis pub/sub.

**The hub is a fan-out, not a source of truth.** The ticket describes it as
holding "participant state", and that is true of one kind of state: which
sockets are attached to which Meeting. It holds *no* idea of who is in the
room. Presence is answered by `repository.list_present_participants`, the one
function carrying the `left_at IS NULL` filter, and every broadcast payload is
built fresh from that query.

Keeping those two apart is the decision this module exists to make, and the
alternative is worse than it looks. If the hub also cached presence, then a
process that died, or a socket that dropped without a clean close, would leave a
phantom in the list — and the phantom would outlive the meeting, because nothing
would ever correct it. A crash is the *normal* case on a free hosting tier, so
that is a bad thing to make load-bearing. The hub is told who is listening; the
database is asked who is here; the two disagree only for the milliseconds between
a socket dying and its close frame arriving, and the database is right.

So a broadcast is a *notification to re-ask*, carrying the answer as a
convenience for the client. Every state change therefore follows the same shape:
write the change, then re-read presence, then send it to everyone attached.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket

# WebSocket close codes. 1000 and 1008 are from the protocol; 4401 is an
# application code, which the protocol reserves the 4000-4999 range for. It is
# distinguishable from a normal closure so the client can tell "you were refused"
# from "the network went away" — the first is worth a sentence to the person, the
# second is worth a retry.
CLOSE_MEETING_GONE = 4404
CLOSE_NOT_YET_STARTED = 4425
CLOSE_NO_IDENTITY = 4401
CLOSE_MEETING_ENDED = 4410

# Application codes for the same refusals, reused when a socket is closed before
# the handshake completes and there is no way to send an explanation first.
REASON_MEETING_GONE = "No such meeting."
REASON_NO_IDENTITY = "We could not work out who you are."


@dataclass(eq=False)
class HubConnection:
    """One attached socket, and the identity it attached with.

    The identity is held so a refusal can be *explained*, and so a departure can
    be decided correctly: one person with two tabs open has two of these, and
    closing one must not remove them from the room (see
    `MeetingHub.attached_for_user`).

    `eq=False` because these live in a `set`, and the default dataclass
    equality is generated from every field — which would hash a `WebSocket` and
    a display name, and make two connections for the same person compare equal.
    Identity here is the *object*: the same socket attached twice is the same
    connection, and two sockets for one person are two connections.
    """

    websocket: WebSocket
    user_id: str | None = None
    display_name: str = ""


class MeetingHub:
    """Open sockets, grouped by Meeting, for broadcasting within a process.

    One instance per application, held on `app.state` alongside the join-code
    source — the same pattern, for the same reason: a value the process owns,
    which a test may need to see or replace, rather than a module-level global
    reached for from three files.

    Not thread-safe, and does not need to be: every mutation happens inside the
    event loop, from a coroutine, with no `await` between reading and writing the
    dict. `broadcast` is the one method that awaits, and it iterates a *copy* of
    the connection set, so a socket disconnecting mid-send cannot mutate the set
    being walked.
    """

    def __init__(self) -> None:
        self._rooms: dict[str, set[HubConnection]] = {}

    def attach(self, meeting_id: str, connection: HubConnection) -> None:
        """Add a socket to a Meeting's room, creating the room if it is new."""
        self._rooms.setdefault(meeting_id, set()).add(connection)

    def detach(self, meeting_id: str, connection: HubConnection) -> None:
        """Remove a socket, and drop the room entirely once it is empty.

        Removing the empty room is not tidiness: `_rooms` is keyed by Meeting id
        for the lifetime of the process, and an application that ran all day
        would otherwise accumulate a key for every Meeting anyone ever opened.
        """
        room = self._rooms.get(meeting_id)
        if room is None:
            return
        room.discard(connection)
        if not room:
            del self._rooms[meeting_id]

    def attached_count(self, meeting_id: str) -> int:
        """How many sockets are attached to a Meeting.

        **Not** how many people are in it. Presence is a question about the
        database (`list_present_participants`), and this is a question about
        sockets. They differ whenever somebody has two tabs open, which is
        ordinary rather than exotic, and they differ again for the moment after
        a socket dies. Nothing renders this number.
        """
        return len(self._rooms.get(meeting_id, ()))

    def attached_for_user(self, meeting_id: str, user_id: str) -> int:
        """How many sockets one particular person has open on a Meeting.

        This is what makes a departure correct. A person with the room open in
        two tabs has two sockets and is still in the meeting; stamping
        `left_at` because one of them closed would remove them from the
        participant list while they are visibly still in it, and nothing would
        bring the row back until they reloaded.

        The alternative — deciding this in the endpoint from a count of the whole
        room — gets it wrong in the other direction: two people present and one
        leaves looks the same as one person with two tabs and one tab closes.
        Only the count *for this user* distinguishes them, which is why the hub
        tracks the identity on each connection at all.
        """
        return sum(
            1
            for connection in self._rooms.get(meeting_id, ())
            if connection.user_id == user_id
        )

    def attached_to(self, meeting_id: str) -> Iterable[HubConnection]:
        """Every socket on this Meeting, for a caller that wants to send to all."""
        return tuple(self._rooms.get(meeting_id, ()))

    async def broadcast(self, meeting_id: str, message: dict[str, Any]) -> None:
        """Send one message to every socket in a Meeting, including the sender.

        A dead socket is dropped rather than allowed to fail the send. One
        participant's closed laptop must not stop the other participant from
        being told somebody joined — which is the entire purpose of the call.

        Sending to the sender as well as the others is deliberate: it means every
        client renders the same payload from the same code path, so there is no
        "what I do locally" branch to disagree with what arrives over the wire.
        That disagreement is how a participant list ends up showing yourself
        twice, or not at all.
        """
        payload = message
        for connection in self.attached_to(meeting_id):
            try:
                await connection.websocket.send_json(payload)
            except Exception:
                # A socket that has already gone raises here — a closed tab, a
                # laptop that slept, a proxy that gave up. The connection is
                # finished from this hub's point of view either way, and its
                # endpoint's `finally` will `detach` it. Broad except on purpose:
                # the specific exception type varies by transport and by
                # Starlette version, and every one of them means the same thing
                # here, which is "this socket is gone".
                self.detach(meeting_id, connection)
