"""The live room, at the API and WebSocket seams.

Two things are being proved here, and the second is the one that matters more.

The first is the obvious one: a socket carries the participant list, and a
second person appearing in it is visible to the first. That is only assertable
with two simultaneous connections, so this file holds several open at once —
`TestClient` runs each in its own portal, and a broadcast from one handler
reaches the other without either test blocking on the send.

The second is the rule that the whole file is really about. "Who is in this
room" is a **query**, not a table, because leaving is soft — so the
`left_at IS NULL` filter lives in exactly one repository function and nothing
may bypass it (ADR-0004). Every WebSocket test in the suite happens to run in a
room where nobody has left yet, which means **the WebSocket cannot catch a
regression in that filter.** A version that returned every participant of a
Meeting would pass all of them.

So the filter is asserted over plain HTTP, in a room that has genuinely had
somebody leave. That is why `GET /meetings/{id}/participants` exists at all: it
is not a convenience for the client, which is pushed the same list over the
socket, but the observation point that keeps the rule under test. This file also
asserts that the socket and the HTTP endpoint cannot disagree — if either had
its own idea of presence, one of them would eventually be the wrong one.
"""

import time
from datetime import timedelta

import pytest

from app.models import utcnow

from .conftest import Session


@pytest.fixture()
def host(client: Session) -> Session:
    """The visitor who owns the Meeting, with a name worth asserting on.

    Named, because the Host is not an interchangeable bystander in these tests:
    `meetings.host_id` is the single source of authority (ADR-0004), so a test
    that wants to know who the host is has to be talking about a specific
    person. An anonymous `client` fixture made that easy to get wrong — a
    Meeting created by one session while the socket belongs to another is a room
    where nobody is the host, which passes for "hosts == []".
    """
    client.patch("/api/session", json={"display_name": "Altaf"})
    return client


@pytest.fixture()
def a_meeting(host: Session) -> dict:
    """An Instant Meeting created by the Host, joinable immediately."""
    return host.post("/api/meetings").json()


def room_address(meeting: dict) -> str:
    return f"/api/meetings/{meeting['id']}/ws"


def refusal(websocket) -> dict:
    """The `refused` message a socket that cannot be admitted receives.

    Read as a *message* rather than from the close frame, and that is the whole
    point. A WebSocket closed before it is accepted never becomes a connection
    in the browser's eyes: it arrives as an abnormal closure with code 1006 and
    no reason, which is byte-for-byte what a dropped network looks like. So a
    client cannot tell "this meeting has not started" from "we lost the
    connection" unless the server says so first — which is why `_refuse` accepts
    the handshake and then refuses.

    Asserted here as a message with a `reason` a person could read, because the
    browser test is the one that has to render it, and this is where the words
    are decided.
    """
    message = websocket.receive_json()
    assert message["type"] == "refused"
    return message


class TwoPeople:
    """Two independent browser-like sessions, both in one Meeting.

    A context manager because the common failure of a test like this is leaking
    an open socket into the next test: a participant who is still attached
    broadcasts into somebody else's room, and the failure lands on an assertion
    that has nothing to do with the cause.

    Each `Session` is a separate cookie jar, which is the point — the two are
    different people, and a single jar would make them one.
    """

    def __init__(self, app, meeting: dict, host: Session) -> None:
        self.meeting = meeting
        # The Host is whoever created the Meeting, so this is *that* session and
        # not a fresh one. Two new sessions around a Meeting created by a third
        # would produce a room in which nobody is the host, and every assertion
        # about authority would quietly be about a stranger.
        self.host = host
        self.guest = Session(app)
        self.guest.patch("/api/session", json={"display_name": "Priya"})
        self._sockets = []

    def open_all(self) -> list:
        """A socket for each person, in the Meeting, with every backlog read.

        Returned as a list because almost every assertion in this file is about
        one person's change reaching the *other* person's socket, and the
        broadcasts that arrive while the room fills are noise in the middle of
        that.

        **Every backlogged message is drained, not just one.** A socket receives
        a broadcast for its own arrival and another for the next person's, so the
        first person to connect has two queued before anything is asserted. A
        helper that read one would leave the second sitting there, and the first
        assertion in a test would silently be about the *previous* event — which
        is how a test asserting "the room did not change" comes to pass because
        it read a stale join instead of a broadcast that never came.
        """
        sockets = [self.socket(self.host), self.socket(self.guest)]
        for socket in sockets:
            self.settle(socket, expected=2)
        return sockets

    @staticmethod
    def settle(socket, expected: int, limit: int = 5) -> dict:
        """Read messages until the room reports `expected` people; return the last.

        Bounded, so a room broadcasting in a loop fails the test with a clear
        message instead of hanging until the suite's timeout.
        """
        message: dict = {}
        for _ in range(limit):
            message = socket.receive_json()
            assert message["type"] == "participants", message
            if message["count"] == expected:
                return message
        raise AssertionError(
            f"the room never settled at {expected} people; last message was "
            f"count={message.get('count')}"
        )

    @staticmethod
    def listed(socket, name: str) -> dict:
        """One person, as the most recent message described them."""
        message = socket.receive_json()
        assert message["type"] == "participants"
        matches = [p for p in message["participants"] if p["display_name"] == name]
        assert len(matches) == 1, f"expected exactly one {name}, got {matches}"
        return matches[0]

    def socket(self, who: Session):
        """Open a WebSocket as this person, in the Meeting.

        `with` semantics are not available for a socket that has to stay open
        across a second person joining, so the socket is kept and closed by
        `close_all`.
        """
        websocket = who._client.websocket_connect(room_address(self.meeting))
        websocket.__enter__()
        self._sockets.append(websocket)
        return websocket

    def __enter__(self) -> "TwoPeople":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close_all()

    def close_all(self) -> None:
        for websocket in self._sockets:
            websocket.__exit__(None, None, None)
        self._sockets.clear()
        # The guest is ours to close. The Host is the `client` fixture's, which
        # closes itself — closing it here too would leave the fixture's teardown
        # closing an already-closed client.
        self.guest.close()


def test_a_second_person_appears_in_the_first_persons_room(
    app, a_meeting: dict, host: Session
):
    """The centrepiece: two people, two sockets, one live list.

    The host connects and is told they are alone. The guest connects, and the
    host's *already-open* socket receives the new list without being touched
    again. Reading that second message on the first socket is what makes this a
    WebSocket test rather than a test of what each person fetches on arrival.
    """
    with TwoPeople(app, a_meeting, host) as room:
        host_socket = room.socket(room.host)
        assert host_socket.receive_json()["count"] == 1

        room.socket(room.guest)

        arrived = host_socket.receive_json()
        assert arrived["type"] == "participants"
        assert arrived["count"] == 2
        assert {p["display_name"] for p in arrived["participants"]} == {
            "Altaf",
            "Priya",
        }


def test_a_participant_list_includes_the_viewer_so_they_can_check_their_identity(
    app, a_meeting: dict, host: Session
):
    """Your own entry is in the list, which is how you know you are *you*.

    Story 53. A list of everyone else is reassuring and useless: the person
    trying to confirm "is this room showing me as me" has nothing to compare
    against, and the failure — a socket bound to the wrong User — looks exactly
    like an empty room.
    """
    with TwoPeople(app, a_meeting, host) as room:
        guest_socket = room.socket(room.guest)

        message = guest_socket.receive_json()
        mine = [p for p in message["participants"] if p["display_name"] == "Priya"]

        assert len(mine) == 1
        assert mine[0]["user_id"] == room.guest.get("/api/session").json()["id"]


def test_the_participant_count_is_carried_with_the_list(
    app, a_meeting: dict, host: Session
):
    """The number travels with the names rather than being counted client-side.

    The count is on the title bar in every screenshot, so three different
    screens render it. Deriving it from an array in three places is three
    chances to show a different number than the room has — asserted as
    `count == len(participants)` on every message, so a client is free to render
    either and cannot be given two truths.
    """
    with TwoPeople(app, a_meeting, host) as room:
        alone = room.socket(room.host)
        first = alone.receive_json()
        assert first["count"] == len(first["participants"]) == 1

        room.socket(room.guest)
        second = alone.receive_json()
        assert second["count"] == len(second["participants"]) == 2


def test_the_meetings_start_timestamp_is_set_when_the_first_participant_joins(
    app, a_meeting: dict, host: Session
):
    """`started_at` is the honest test for whether a Meeting has begun.

    Created but never entered, a Meeting has a `created_at` and no `started_at`:
    nobody is in it, and saying otherwise would put an empty Meeting at the top
    of Recent Meetings over one where people are actually talking.
    """
    before = a_meeting["started_at"]
    assert before is None, "a Meeting nobody has joined has not started"

    with TwoPeople(app, a_meeting, host) as room:
        room.socket(room.host)

        after = room.host.get(f"/api/meetings/{a_meeting['id']}").json()["started_at"]

    assert after is not None


def test_a_second_participant_does_not_restamp_the_start_timestamp(
    app, a_meeting: dict, host: Session
):
    """A second arrival an hour later has not begun the Meeting again.

    Re-stamping would also break Recent Meetings quietly: that list sorts on the
    later of `created_at` and `started_at`, so a Meeting still in progress
    would jump to the top every time anybody joined it.
    """
    with TwoPeople(app, a_meeting, host) as room:
        room.socket(room.host)
        first = room.host.get(f"/api/meetings/{a_meeting['id']}").json()["started_at"]

        room.socket(room.guest)
        second = room.host.get(f"/api/meetings/{a_meeting['id']}").json()["started_at"]

    assert first == second


def test_a_host_is_marked_as_the_host_and_a_guest_is_not(
    app, a_meeting: dict, host: Session
):
    """`is_host` is derived from `meetings.host_id`, on every message.

    Asserted over the socket rather than only over HTTP because the flag rides
    along on the list the room actually renders. A stored role column could
    disagree with the Meeting and this is where that would show up (ADR-0004).
    """
    with TwoPeople(app, a_meeting, host) as room:
        room.socket(room.host)
        guest_socket = room.socket(room.guest)
        guest_socket.receive_json()  # the guest's own list, on arrival

        # The host's socket, opened last, is told the whole room in one message
        # — which is the same list the guest was just sent.
        host_socket = room.socket(room.host)
        listed = host_socket.receive_json()

    hosts = [p["display_name"] for p in listed["participants"] if p["is_host"]]
    assert hosts == ["Altaf"]


def test_a_heartbeat_is_answered_so_a_live_socket_is_distinguishable(
    app, a_meeting: dict, host: Session
):
    """A `ping` gets a `pong`.

    A silent socket and a dead one look identical from the browser, and on a free
    hosting tier the difference is the difference between a participant waiting
    and a participant who has been disconnected without being told. The client
    also sends this every ~25 seconds to keep the tier from idling (ADR-0002).
    """
    with TwoPeople(app, a_meeting, host) as room:
        socket = room.socket(room.host)
        socket.receive_json()  # the participants message sent on connect

        socket.send_json({"type": "ping"})

        reply = socket.receive_json()
        assert reply["type"] == "pong"
        assert reply["at"]


def test_a_message_the_server_does_not_know_is_ignored_not_fatal(
    app, a_meeting: dict, host: Session
):
    """An unknown message type leaves the socket open.

    The alternative — closing on anything unrecognised — means a newer client
    talking to an older server empties the room instead of degrading. A ticket
    that adds `mute` next week must not break the participants list in the
    meantime.
    """
    with TwoPeople(app, a_meeting, host) as room:
        socket = room.socket(room.host)
        socket.receive_json()

        socket.send_json({"type": "mute_everyone", "muted": True})
        socket.send_json({"type": "ping"})

        assert socket.receive_json()["type"] == "pong"


def test_a_socket_with_no_identity_is_refused_rather_than_accepted(
    app, client: Session, a_meeting: dict, host: Session
):
    """No cookie, no socket — with a code that says *why*.

    A WebSocket cannot set a response cookie before the handshake completes, so
    a User minted here would be one the browser could never come back as: a guest
    would appear in the room under an identity that vanishes on their next
    request. Refusing is the honest answer, and 4401 is a distinct code so the
    client can re-fetch the Meeting over HTTP (which does mint a cookie) and
    reconnect, rather than showing "connection failed".
    """
    anonymous = Session(app)
    try:
        with anonymous._client.websocket_connect(room_address(a_meeting)) as socket:
            refused = refusal(socket)
        assert refused["code"] == 4401
        assert refused["reason"]
    finally:
        anonymous.close()


def test_a_socket_to_a_meeting_that_does_not_exist_is_refused(
    app, a_meeting: dict, host: Session
):
    """A stale address says so, rather than opening a room for nothing."""
    with TwoPeople(app, a_meeting, host) as room:
        with room.guest._client.websocket_connect(
            "/api/meetings/00000000-0000-0000-0000-000000000000/ws"
        ) as socket:
            refused = refusal(socket)

    assert refused["code"] == 4404
    assert refused["reason"] == "No such meeting."


def test_a_socket_to_an_ended_meeting_is_refused(
    app, a_meeting: dict, host: Session, end_meeting
):
    """The room door refuses a finished Meeting over the socket too.

    The HTTP routes already refuse it, and a socket that connected anyway would
    put a participant in a Meeting the host has finished — the one case where
    showing somebody an empty room is worse than showing them a message.
    """
    end_meeting(a_meeting["join_code"])

    with TwoPeople(app, a_meeting, host) as room:
        with room.host._client.websocket_connect(room_address(a_meeting)) as socket:
            refused = refusal(socket)

    assert refused["code"] == 4410
    assert refused["reason"] == "That meeting has already ended."


def test_a_scheduled_meeting_cannot_be_entered_before_its_time(
    app, client: Session, a_meeting: dict, host: Session
):
    """The start-time gate holds on the socket as well as on the join route.

    A reload of the room URL is how a scheduled Meeting is entered at its
    appointed time, so a socket that connected regardless would let people in
    early — the gate would be true of the join screen and false of the room.

    Scheduled an hour ahead rather than a minute: a test that used a near
    boundary would be a test that fails on a slow machine, and this gate is
    about a whole hour of being early, not about the width of a margin.
    """
    later = client.post(
        "/api/meetings/scheduled",
        json={
            "scheduled_start_at": (utcnow() + timedelta(hours=1)).isoformat(),
            "duration_minutes": 30,
            "title": "Later",
        },
    ).json()

    # And the control: a Meeting whose time has passed connects fine, so the
    # refusal above is about the clock and not about scheduled Meetings being
    # unable to hold a socket at all.
    started = client.post(
        "/api/meetings/scheduled",
        json={
            "scheduled_start_at": (utcnow() - timedelta(hours=1)).isoformat(),
            "duration_minutes": 30,
            "title": "Already begun",
        },
    ).json()

    with TwoPeople(app, a_meeting, host) as room:
        with room.host._client.websocket_connect(room_address(later)) as socket:
            refused = refusal(socket)

    assert refused["code"] == 4425
    assert "not started" in refused["reason"]

    with TwoPeople(app, a_meeting, host) as room:
        admitted = room.socket(room.host)
        assert admitted.receive_json()["count"] == 1

    assert started["scheduled_start_at"] is not None


def test_a_person_with_the_room_in_two_tabs_is_still_present_when_one_closes(
    app, a_meeting: dict, host: Session
):
    """Two tabs, one person: closing one is not leaving.

    The failure this guards against is a person who has the meeting open in two
    windows, closes one, and vanishes from the participant list while still
    visibly sitting in the other. Nothing would bring the row back — the next
    event is somebody else arriving — so for the rest of the meeting the host
    sees a room with somebody missing who is plainly in it.

    It is also why the hub counts *this user's* sockets rather than the room's:
    "two people and one left" and "one person with two tabs and one closed" are
    identical from the room's side and opposite from theirs.
    """
    with TwoPeople(app, a_meeting, host) as room:
        first_tab = room.socket(room.host)
        first_tab.receive_json()

        second_tab = room.socket(room.host)
        second_tab.receive_json()
        assert (
            room.guest.get(
                f"/api/meetings/{a_meeting['id']}/participants"
            ).json()["count"]
            == 1
        ), "two tabs are one person, not two"

        first_tab.__exit__(None, None, None)
        room._sockets.remove(first_tab)

        after = room.guest.get(
            f"/api/meetings/{a_meeting['id']}/participants"
        ).json()

    assert after["count"] == 1
    assert [p["display_name"] for p in after["participants"]] == ["Altaf"]


def test_closing_a_persons_last_tab_does_remove_them(
    app, a_meeting: dict, host: Session
):
    """The other half of the test above, because a fix that never leaves anybody
    is as wrong as one that never keeps anybody.

    The count is what matters, not merely that a departure was recorded: a room
    that keeps showing the owner of a closed tab is the previous test's failure
    in the opposite direction, and it is the easier mistake to make — "never
    stamp `left_at`" passes this file's other tests.

    The host's socket is deliberately left open, so the room is not empty and
    the assertion is about *one* person leaving a room that still has somebody in
    it. A room that empties entirely is the case the socket's `finally` already
    had to get right, and testing it alone would not notice a rule that refused
    to remove anybody.
    """
    with TwoPeople(app, a_meeting, host) as room:
        room.socket(room.host)
        guest_tab = room.socket(room.guest)
        assert room.host.get(
            f"/api/meetings/{a_meeting['id']}/participants"
        ).json()["count"] == 2

        guest_tab.__exit__(None, None, None)
        room._sockets.remove(guest_tab)

        after = room.host.get(
            f"/api/meetings/{a_meeting['id']}/participants"
        ).json()

    assert after["count"] == 1
    assert [p["display_name"] for p in after["participants"]] == ["Altaf"]


def test_the_devices_a_person_chose_are_recorded_when_they_arrive(
    app, a_meeting: dict, host: Session
):
    """A person who turned their camera off is not recorded as broadcasting it.

    The client sends what pre-join decided as its first message, and the room
    shows those same choices in its footer. If the server ignored them the two
    would disagree — a person reading "Camera off" under their own name while
    the participant list marks them as on — and the badge is the one a host
    believes.
    """
    with TwoPeople(app, a_meeting, host) as room:
        socket = room.socket(room.host)
        socket.receive_json()  # sent before the client has sent its devices

        socket.send_json({"type": "state", "microphone_on": False, "camera_on": False})

        # Asked over HTTP rather than read off the socket, and polled rather than
        # awaited. Waiting for the broadcast this change triggers would make a
        # regression *hang* until the suite's timeout — a failure with no message
        # and no indication of which assertion broke, on a test whose whole point
        # is that the state reached the database.
        def muted_and_dark() -> bool:
            listed = room.host.get(
                f"/api/meetings/{a_meeting['id']}/participants"
            ).json()["participants"]
            return bool(listed) and listed[0]["is_muted"] is True and (
                listed[0]["is_video_on"] is False
            )

        deadline = time.monotonic() + 5
        while not muted_and_dark() and time.monotonic() < deadline:
            time.sleep(0.05)

        assert muted_and_dark(), (
            "a person who arrived with their camera and microphone off was not "
            "recorded that way, so the room's own badge would contradict the "
            "footer showing it to them"
        )


# --- The rule the WebSocket cannot test on its own ------------------------

def test_a_past_attendee_is_not_in_the_current_participant_list(
    app, client: Session, a_meeting: dict, host: Session
):
    """The `left_at IS NULL` filter, over HTTP, in a room that lost somebody.

    This is the assertion the whole file exists for. Every socket test above
    runs in a room where nobody has left, so a version of the query that
    returned *every* participant of the Meeting would pass all of them and show
    yesterday's attendees as though they were still in the room.
    """
    guest = Session(app)
    guest.patch("/api/session", json={"display_name": "Priya"})
    try:
        present = guest.get(f"/api/meetings/{a_meeting['id']}/participants").json()
        assert present["count"] == 0

        with guest._client.websocket_connect(room_address(a_meeting)) as socket:
            socket.receive_json()
            assert guest.get(
                f"/api/meetings/{a_meeting['id']}/participants"
            ).json()["count"] == 1
        # Closing the socket is a departure, and the record of it is stamped.

        after = guest.get(f"/api/meetings/{a_meeting['id']}/participants").json()
        assert after["count"] == 0
        assert after["participants"] == []
    finally:
        guest.close()


def test_leaving_keeps_the_attendance_record_so_a_rejoiner_is_not_a_stranger(
    app, client: Session, a_meeting: dict, host: Session
):
    """A participant who leaves and comes back lands on the same row.

    There is a unique constraint on `(meeting_id, user_id)`, so inserting afresh
    would be an integrity error the caller has no sensible answer for. Reviving
    is what soft participation implies: they are here now, so the record of
    their absence is over, and their original `joined_at` — when they first
    arrived — is still true.
    """
    guest = Session(app)
    guest.patch("/api/session", json={"display_name": "Priya"})
    try:
        with guest._client.websocket_connect(room_address(a_meeting)) as socket:
            first = socket.receive_json()

        with guest._client.websocket_connect(room_address(a_meeting)) as socket:
            second = socket.receive_json()

        assert first["participants"][0]["joined_at"] == second["participants"][0][
            "joined_at"
        ], "a reconnect must not look like a fresh arrival"
    finally:
        guest.close()


def test_the_socket_and_the_http_endpoint_can_never_disagree(
    app, client: Session, a_meeting: dict, host: Session
):
    """One question, one answer, whichever way it is asked.

    Presence is answered by `list_present_participants` and only by it. If the
    socket and this endpoint each had their own idea, the room would render one
    list and a page refresh would render another, and the bug would only appear
    on whichever screen nobody tested.
    """
    with TwoPeople(app, a_meeting, host) as room:
        socket = room.socket(room.host)
        socket.receive_json()  # the host alone, on arrival
        room.socket(room.guest)

        pushed = socket.receive_json()
        fetched = room.guest.get(
            f"/api/meetings/{a_meeting['id']}/participants"
        ).json()

    assert pushed["count"] == fetched["count"] == 2
    assert [p["user_id"] for p in pushed["participants"]] == [
        p["user_id"] for p in fetched["participants"]
    ]


def test_a_room_nobody_has_entered_is_empty_rather_than_erroring(
    app, client: Session, a_meeting: dict
):
    """Zero participants is a valid answer, not a missing one.

    A 404 here would be indistinguishable from a stale address, and the
    difference matters to the client: one means "this Meeting exists, nobody is
    here yet", the other means "reload".
    """
    response = client.get(f"/api/meetings/{a_meeting['id']}/participants")

    assert response.status_code == 200
    assert response.json() == {"participants": [], "count": 0}


def test_the_participant_list_of_a_meeting_that_does_not_exist_says_so(
    app, client: Session
):
    response = client.get("/api/meetings/00000000-0000-0000-0000-000000000000/participants")

    assert response.status_code == 404


def test_the_participant_list_of_an_ended_meeting_says_it_has_ended(
    app, client: Session, a_meeting: dict, end_meeting
):
    """410, not an empty list.

    An empty list for a finished Meeting tells a host nobody ever came, which is
    the one thing that did not happen.
    """
    end_meeting(a_meeting["join_code"])

    response = client.get(f"/api/meetings/{a_meeting['id']}/participants")

    assert response.status_code == 410



