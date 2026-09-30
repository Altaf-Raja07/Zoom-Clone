"""Mute, video, and the participant panel, at the API and WebSocket seams.

The feature is small — two booleans per person, pushed to everyone in the room —
and nearly all of the value is in the parts that are easy to get subtly wrong,
so this file is mostly about those.

**A state change is a *push*, not a fetch.** The assertion throughout is made on
the *other* person's already-open socket, after the change, without anybody being
touched. That is what makes it a realtime test rather than a test of what each
person fetches on arrival.

**Unchanged state must not look like a change.** Toggling mute on and off again,
or re-sending the state already held, has to be visible as a change twice and not
three times. A room that re-broadcasts every message regardless makes every
participant's browser re-render an identical list, and — the real cost —
destroys the distinction between "the room changed" and "somebody said
something", which the next tickets' tests rest on.

**Authority is derived, not stored.** There is no `role` column, so `is_host`
cannot disagree with `meetings.host_id`. The schema test for that absence is
already in `test_schema.py`; what is asserted here is that the flag arriving on
the socket is the derived one, because that is what a future host-only control
would be gated on.
"""

import pytest

from .conftest import Cast

HOST = "Altaf"
GUEST = "Priya"


@pytest.fixture()
def cast(app):
    """Two people in one browser, ready to act.

    The Meeting is created *by* one of them rather than by a separate `client`
    fixture, because "who is the host" is a question about a specific `User` row
    and not about a display name. A Meeting booked by a third user and a room
    populated by these two is a room in which nobody is the host, and every
    assertion about authority would then be quietly about a stranger.
    """
    people = Cast(app, [HOST, GUEST])
    try:
        yield people
    finally:
        people.close()


@pytest.fixture()
def meeting(cast: Cast) -> dict:
    """An Instant Meeting, created by the Host."""
    return cast.as_(HOST).post("/api/meetings").json()


@pytest.fixture()
def room(cast: Cast, meeting: dict):
    """Both people connected, with every backlogged list read.

    One `Cast` rather than two `Session`s, so both sockets live in one event loop
    as they do in production — see `conftest.Cast` for why that is the closer
    shape and not merely a more convenient one.
    """
    cast.meeting = meeting
    cast.sockets = {
        name: cast.as_(name).websocket(f"/api/meetings/{meeting['id']}/ws")
        for name in (HOST, GUEST)
    }
    settle(cast.sockets[HOST], expected=2)
    settle(cast.sockets[GUEST], expected=2)
    return cast


def settle(socket, expected: int, limit: int = 5) -> dict:
    """Read messages until the room reports `expected` people; return the last.

    Bounded, so a room broadcasting in a loop fails with a clear message instead
    of hanging until the suite's timeout.
    """
    message: dict = {}
    for _ in range(limit):
        message = socket.receive_json()
        assert message["type"] == "participants", message
        if message["count"] == expected:
            return message
    raise AssertionError(
        f"the room never settled at {expected} people; last count was "
        f"{message.get('count')}"
    )


def listed(socket, name: str) -> dict:
    """One person, as the most recent message described them."""
    room = snapshot(socket)
    assert name in room, f"no {name} in the room: {sorted(room)}"
    return room[name]


def everyone(socket) -> list[dict]:
    """The whole room, as one broadcast described it.

    **One read, the whole room** — and that is the point, not a convenience. A
    broadcast describes *every* participant at one instant, so a test that reads
    a socket once per person is not reading one moment in time: the second read
    is waiting for a broadcast that may never come, because the change it was
    expecting has already been reported. Asserting on both people from a single
    message is both correct and impossible to get out of order.
    """
    message = socket.receive_json()
    assert message["type"] == "participants", message
    assert message["count"] == len(message["participants"])
    return message["participants"]


def snapshot(socket) -> dict[str, dict]:
    """The room as one broadcast described it, keyed by Display Name."""
    return {p["display_name"]: p for p in everyone(socket)}


def state(socket, *, microphone_on: bool, camera_on: bool) -> None:
    """Say what this person's devices are doing, as the toolbar will.

    **Both booleans, every time**, because the message is a whole state rather
    than a delta. A helper called `mute` that quietly set the camera on would
    make a reader believe the test was about one device, and would quietly change
    the other.
    """
    socket.send_json(
        {"type": "state", "microphone_on": microphone_on, "camera_on": camera_on}
    )


def mute(socket, *, camera_on: bool = True) -> None:
    """Mute, leaving the camera as the test asks."""
    state(socket, microphone_on=False, camera_on=camera_on)


def camera_off(socket, *, microphone_on: bool = True) -> None:
    """Turn the camera off, leaving the microphone as the test asks."""
    state(socket, microphone_on=microphone_on, camera_on=False)


def test_muting_is_visible_to_everybody_else_without_a_refresh(room: Cast):
    """The whole claim of this ticket, in one test.

    Two sockets, one room. The guest mutes. The host's socket — already open,
    never touched, no reload — is handed a new list in which the guest is muted.
    """
    mute(room.sockets[GUEST])

    assert listed(room.sockets[HOST], GUEST)["is_muted"] is True


def test_turning_the_camera_off_is_visible_to_everybody_else(room: Cast):
    """The second boolean, and the same push path.

    Worth its own test because the two travel through one message, so a bug that
    dropped one of them — reading `camera_on` from the wrong place — would leave
    mute working perfectly and camera broken, with the panel cheerfully
    reporting everybody as broadcasting video.
    """
    camera_off(room.sockets[GUEST])

    assert listed(room.sockets[HOST], GUEST)["is_video_on"] is False


def test_a_person_sees_their_own_state_change_too(room: Cast):
    """The person who muted sees themselves muted, without a reload.

    Their own tile and their own row in the panel are both drawn from this list.
    If the sender were excluded from the broadcast to save a round trip, a person
    would press mute, see no change, press it again, and end up unmuted — the
    single most confusing failure this screen could have.
    """
    mute(room.sockets[GUEST])

    assert listed(room.sockets[GUEST], GUEST)["is_muted"] is True


def test_unmuting_is_visible_too_and_not_just_the_first_change(room: Cast):
    """A room that only ever announces people going quiet is not a room.

    The round trip matters because the failure is not symmetric: a check of
    `if is_muted: broadcast` makes the first change work and the second silently
    do nothing, which is exactly what a smoke test misses.
    """
    mute(room.sockets[GUEST])
    assert listed(room.sockets[HOST], GUEST)["is_muted"] is True

    state(room.sockets[GUEST], microphone_on=True, camera_on=True)

    assert listed(room.sockets[HOST], GUEST)["is_muted"] is False


def test_re_sending_an_unchanged_state_announces_nothing(room: Cast):
    """Idempotence, proved by what *does* arrive next.

    A `state` message saying what the server already believes is not news.
    Broadcasting it anyway would re-render every participant's room for nothing
    and — the real cost — would make "the room changed" indistinguishable from
    "somebody spoke", which later tickets' tests rely on.

    **Asserted as "the next message is the real change", not as "nothing
    arrives".** Silence cannot be checked here: this socket's `receive_json` has
    no timeout, so the only way to wait for a message that should never come is
    to wait forever. A test that needed a timeout argument would have raised
    `TypeError` on every call, and — caught by the `except` that was there to
    mean "timed out" — would have passed while asserting nothing at all.

    Sending the unchanged state and then a real one inverts the question: if the
    unchanged state were broadcast, the host's next message would be that stale
    copy and Priya would still read as unmuted. So the assertion cannot pass by
    accident, and it terminates.
    """
    # The guest joined unmuted with her camera on, so this repeats the truth.
    state(room.sockets[GUEST], microphone_on=True, camera_on=True)
    mute(room.sockets[GUEST])

    assert listed(room.sockets[HOST], GUEST)["is_muted"] is True


def test_two_people_changing_state_do_not_overwrite_each_other(room: Cast):
    """Each person's state is their own row.

    A single room-level flag would pass every test above and fail this one: with
    one flag, the host muting would mute the guest too, and a host would see
    their own state change because somebody else's microphone moved.

    One change at a time, and both sockets read after each, because every change
    reaches *everybody*. Reading one socket twice and then the other would compare
    two different points in the room's history rather than one, and the second
    read would describe a moment the first had already moved past.
    """
    mute(room.sockets[HOST])

    # One broadcast describes the whole room, so both people come from the same
    # message — and **both sockets are drained**, because a change reaches
    # everybody. A socket left unread falls a change behind, and the next read
    # from it describes a moment the room has already moved past.
    as_guest_sees = snapshot(room.sockets[GUEST])
    as_host_sees = snapshot(room.sockets[HOST])
    assert as_guest_sees[HOST]["is_muted"] is True
    assert as_guest_sees[GUEST]["is_muted"] is False
    assert as_host_sees[HOST]["is_muted"] is True

    camera_off(room.sockets[GUEST])

    # The guest's camera going off leaves the host's own mute exactly where it
    # was. Two people, two rows, two independent changes.
    as_guest_sees = snapshot(room.sockets[GUEST])
    as_host_sees = snapshot(room.sockets[HOST])
    assert as_guest_sees[GUEST]["is_video_on"] is False
    assert as_host_sees[GUEST]["is_video_on"] is False
    assert as_guest_sees[GUEST]["is_muted"] is False
    assert as_host_sees[HOST]["is_muted"] is True
    assert as_host_sees[HOST]["is_video_on"] is True


def test_the_host_flag_is_the_one_derived_from_the_meeting(room: Cast):
    """`is_host` on the socket is `meetings.host_id`, and only that.

    Ticket 11 gates host-only controls on this flag, enforced at the socket
    handler rather than in the interface. A stored role column could disagree
    with the Meeting, and the symptom would be a non-host appearing to hold host
    rights — invisible until somebody tries to use them (ADR-0004).

    Asserted *across* a state change, because the broadcast is the path that
    re-reads and re-sends every participant: it is where a denormalised flag
    would most plausibly have crept in.
    """
    mute(room.sockets[GUEST])

    # One broadcast, read on the guest's socket, carries the flag for both —
    # which is the point: it is a property of the Meeting, not of a viewer.
    as_guest_sees = snapshot(room.sockets[GUEST])
    assert as_guest_sees[GUEST]["is_host"] is False
    assert as_guest_sees[HOST]["is_host"] is True


def test_a_person_who_arrives_muted_is_muted_from_their_first_appearance(
    app, meeting: dict
):
    """Their pre-join decision is true for everyone, immediately.

    The client sends its device choices as soon as the socket opens. If the first
    list the room broadcast did not reflect them, there would be a window in which
    a person who turned their microphone off on the pre-join screen appears — to
    everybody, including a host deciding whether to interrupt them — as
    broadcasting audio.
    """
    with Cast(app, [GUEST]) as guest:
        socket = guest.websocket(f"/api/meetings/{meeting['id']}/ws")
        socket.receive_json()
        state(socket, microphone_on=False, camera_on=False)

        updated = socket.receive_json()
        person = [p for p in updated["participants"] if p["display_name"] == GUEST][0]

        assert person["is_muted"] is True
        assert person["is_video_on"] is False


def test_rejoining_starts_from_the_devices_they_choose_again(app, meeting: dict):
    """A person who left muted does not come back muted.

    The row is revived rather than duplicated, so whatever state it held comes
    back with them — which is only right because they re-state their devices on
    the way in, as the client does on every open. Otherwise a reconnect would
    silently restore a mute they had turned off in a tab that has since closed,
    and a person who believed they were live would be broadcasting to a room that
    had already decided they were not.

    Read from the arrival broadcast itself rather than from a follow-up message,
    because the arrival broadcast is the moment a reconnecting client would first
    draw itself: if the stale mute is not there, it never appears.
    """
    with Cast(app, [GUEST]) as guest:
        url = f"/api/meetings/{meeting['id']}/ws"

        first = guest.websocket(url)
        first.receive_json()
        state(first, microphone_on=False, camera_on=True)
        listed(first, GUEST)
        # Dropped by hand rather than left to `close()`, so the row is stamped
        # departed *before* the second visit rather than at the end of the test.
        first.__exit__(None, None, None)
        guest.forget(first)

        second = guest.websocket(url)
        on_arrival = second.receive_json()

        person = [p for p in on_arrival["participants"] if p["display_name"] == GUEST][0]
        assert person["is_muted"] is False


def test_a_message_that_is_not_a_state_change_is_ignored_not_mistaken_for_one(
    room: Cast,
):
    """An unknown message must not be read as somebody's devices.

    A `toggle_mute` frame from a newer client must not be interpreted by an older
    server with no such concept as *unmuting*. The alternative is a client that
    works against a new server and silently does nothing against an old one —
    the worst of both — and, worse, one that appears to work while unmuting
    people at random.
    """
    room.sockets[GUEST].send_json({"type": "toggle_mute"})

    # The socket is still alive and still answering, which is the property that
    # matters most: an unknown message is ignored, not fatal.
    room.sockets[GUEST].send_json({"type": "ping"})
    assert room.sockets[GUEST].receive_json()["type"] == "pong"

    # And it was not *acted on* either, which is the part a liveness check alone
    # cannot see. A real change afterwards must still work and must still be the
    # one thing everybody is told about: had the server guessed at `toggle_mute`
    # and unmuted her, this broadcast would say so.
    mute(room.sockets[GUEST])

    assert listed(room.sockets[HOST], GUEST)["is_muted"] is True


def test_the_participant_endpoint_agrees_with_what_the_socket_pushed(room: Cast):
    """The room's list and the API's list cannot tell different stories.

    The panel and the badges are drawn from the socket, but a reload — or a
    second browser on the same Meeting — reads over HTTP. Two answers to "is
    Priya muted" is how a page renders one thing and its refresh another, and
    only one of them is wrong in a way a test would catch.
    """
    mute(room.sockets[GUEST])

    # Read the socket first. A `GET` issued immediately after the mute could
    # otherwise be answered before the server finished handling it, and the
    # comparison would be against a room that had not changed yet — a race that
    # would make this test pass or fail depending on how busy the machine was.
    assert listed(room.sockets[HOST], GUEST)["is_muted"] is True

    response = room.as_(HOST).get(
        f"/api/meetings/{room.meeting['id']}/participants"
    )

    assert response.status_code == 200
    body = response.json()
    assert [p["display_name"] for p in body["participants"]] == [HOST, GUEST]
    assert [p["is_muted"] for p in body["participants"]] == [False, True]
