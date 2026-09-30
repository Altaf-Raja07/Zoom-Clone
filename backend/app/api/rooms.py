"""The live room: a WebSocket per participant, and who is in it right now.

Two endpoints, and the split between them is the reason both exist.

**`GET /api/meetings/{uuid}/participants`** answers "who is in this room" over
plain HTTP. It is not a convenience for the WebSocket client — the socket is
already pushed every change — it is the seam that keeps the single-guard rule
under test. The `left_at IS NULL` filter lives in exactly one repository
function (ADR-0004), and a rule nothing can observe is a rule that quietly stops
being true. This endpoint is the only way a test can look at the filter without
also opening a socket, so it is what holds the constraint in place.

**`WS /api/meetings/{uuid}/ws`** is the realtime path. One socket per client,
scoped to one Meeting, fanned out by the in-process hub. It carries the
participant list and the chat, and it carries nothing else yet — mute and video
are ticket 08's controls, and they arrive as *more* message types on this socket
rather than as new sockets, which is why the protocol below is shaped as tagged
messages rather than a bespoke payload.

## The protocol

Server to client, always JSON, always with a `type`:

- `participants` — the whole room, after every change. Sent on connect and
  after every join or leave. **The full list rather than a delta**, so a client
  cannot drift out of step through a dropped message, and so a reconnecting
  client is identical to a connecting one.
- `chat` — one message, as the server accepted it. Carries the sender's id and
  Display Name, which the **server** decided; see `_broadcast_chat`.
- `pong` — the answer to a `ping`. Exists so a client can tell a live socket
  from a half-open one, which on a free hosting tier is the single most useful
  thing a participant can be told.

Client to server:

- `ping` — sent every ~25 seconds. Keeps the free tier from idling the service
  out from under a live meeting, and doubles as the meeting-is-still-alive
  signal (ADR-0002).
- `chat` — `{"type": "chat", "text": "..."}`. The *only* field read is `text`.

Three message types on one connection rather than one connection per concern.
The alternative — a socket for presence and a socket for chat — would double the
places a reconnect has to succeed, and the reconnect is the part that is already
the most fragile thing here.

## Chat, and why there is no table for it

Chat is relayed and forgotten: the server builds the payload, broadcasts it, and
writes nothing. `GET /meetings/{id}/participants` has an HTTP twin for presence
for a stated reason (it is the only way to observe the `left_at IS NULL` filter);
chat has **no** such endpoint, and that absence is the point — a chat that could
be fetched after the fact would be a chat that is stored, and storing it is a
different feature with a different set of obligations (retention, deletion on
request, access control, and a schema). ADR-0005 records the decision and what
it costs.

The consequence for a participant is real and is stated in the README: a message
exists for the connection that received it and is gone when the Meeting ends.
"""

from dataclasses import dataclass
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import COOKIE_NAME, get_settings
from ..db import get_session
from ..identity import read_user_id
from ..models import Meeting, Participant, User, utcnow
from ..realtime import (
    CLOSE_MEETING_ENDED,
    CLOSE_MEETING_GONE,
    CLOSE_NO_IDENTITY,
    CLOSE_NOT_YET_STARTED,
    REASON_MEETING_GONE,
    REASON_NO_IDENTITY,
    HubConnection,
    MeetingHub,
)
from ..repository import (
    get_meeting,
    get_user,
    has_ended,
    has_started,
    join_meeting,
    leave_meeting,
    list_present_participants,
    set_device_state,
)

router = APIRouter(tags=["rooms"])

# The longest message the room will relay. A WebSocket frame has none of the
# validation an HTTP body gets, so this bound is what stops one participant
# sending a megabyte of text that the server then fans out to everybody else.
# It matches `maxlength` on the composer, so in practice a person hits the
# composer's own limit first and never sees a message cut off.
MAX_CHAT_MESSAGE_LENGTH = 1000


class ParticipantView(BaseModel):
    """One person in the room, as the browser needs them.

    `user_id` rather than the participant row's own `id` because the row is an
    implementation detail of soft participation — a client that keyed itself on
    it would be asserting about the schema. `joined_at` is the row's, and is the
    *first* arrival after a reconnect, so "joined at 3:01" stays true for
    somebody who reloaded at 3:40.

    `is_host` is derived per viewer rather than stored, in the same way as
    `MeetingView.is_host`: there is no role column, and a stored one could
    disagree with `meetings.host_id` (ADR-0004).
    """

    user_id: str
    display_name: str
    is_host: bool
    joined_at: str
    is_muted: bool
    is_video_on: bool


class ChatMessageView(BaseModel):
    """One chat message, as the room needs it.

    `user_id` and `display_name` are the **server's** answers, filled from the
    socket's admitted identity. A client is free to put anything it likes in the
    frame it sends, and if attribution were taken from there then every message
    would be as trustworthy as the least careful participant in the room — which
    is to say, not trustworthy at all. So the sender is never read off the wire.

    `id` is minted here rather than by the client, and for the same reason
    plus one more: the client needs a stable key to render a list by, and a
    client-supplied key would collide the moment two people sent the same text.

    `sent_at` is the server's clock, so two clients agree on the order of what
    arrived rather than each rendering its own idea of the time.
    """

    id: str
    user_id: str
    display_name: str
    text: str
    sent_at: str


class RoomParticipantsView(BaseModel):
    """Who is in this room, and how many that is.

    A named list plus a count, rather than a bare array: the count is on the
    Meeting's title bar in the reference, so it is rendered on every screen, and
    deriving it from an array in three places is three chances to render a
    different number.
    """

    participants: list[ParticipantView]
    count: int


@dataclass(frozen=True)
class ConnectedViewer:
    """The identity a socket resolved to, and how it got there.

    Carries the User rather than the id so a `participants` message can be
    built without re-reading the row for every participant on every broadcast.
    """

    user: User
    is_new_identity: bool


def _viewer_for(
    session: Session, cookies: dict[str, str]
) -> ConnectedViewer | None:
    """The User a request's cookie names, or None if it names nobody.

    Reads the same cookie and through the same signing function as the HTTP
    dependency `current_user`, deliberately duplicated rather than shared. A
    WebSocket cannot set a response cookie — there is no response to set one on
    before the handshake completes — so the shared dependency is genuinely not
    available here, and the *identity decision* is what is duplicated, not the
    rule. Both sides call `read_user_id`; a change to cookie format or signing
    would have to be made in one of two places, and that is called out here and
    in `deps.current_user` rather than left to be discovered.

    None is returned rather than minting a User because there is nowhere to put
    the cookie: a User created here would be unreachable on the next request, and
    a brand-new guest would appear in the room under an identity the browser
    cannot remember. The socket is refused instead, with a code the client can
    explain (CLOSE_NO_IDENTITY).

    In practice the frontend always has a cookie by this point — it fetched the
    Meeting over HTTP first, and that request minted one. This is the branch
    that keeps a hand-written socket from a bare HTTP client honest.
    """
    settings = get_settings()
    user_id = read_user_id(cookies.get(COOKIE_NAME), settings.cookie_secret)
    user = get_user(session, user_id)
    if user is None:
        return None
    return ConnectedViewer(user=user, is_new_identity=False)


def _to_view(
    participation: Participant, user: User | None, meeting: Meeting
) -> ParticipantView:
    """One row of `list_present_participants` as the browser needs it.

    A missing User row is shown under a name rather than dropped. A participant
    whose User has been deleted should still be *counted* — the person is in the
    room — and hiding the row would understate the room, which is the one number
    a host is reading to decide whether anybody is really there.
    """
    return ParticipantView(
        user_id=participation.user_id,
        display_name=user.display_name if user is not None else "Unknown participant",
        is_host=participation.user_id == meeting.host_id,
        joined_at=participation.joined_at.isoformat(),
        is_muted=participation.is_muted,
        is_video_on=participation.is_video_on,
    )


def _room_view(
    session: Session, meeting: Meeting, rows: list[Participant]
) -> RoomParticipantsView:
    return RoomParticipantsView(
        participants=[
            _to_view(row, get_user(session, row.user_id), meeting) for row in rows
        ],
        count=len(rows),
    )


@router.get(
    "/meetings/{meeting_uuid}/participants", response_model=RoomParticipantsView
)
def read_present_participants(
    meeting_uuid: str,
    session: Session = Depends(get_session),
) -> RoomParticipantsView:
    """Who is in this room, right now.

    Open to any guest, like the room itself: anyone with the Meeting's address
    may look, and there is no access control between users in this app
    (SPEC.md, Out of Scope). A Meeting that does not exist says so, so a stale
    socket URL fails the same way a stale room URL does.

    **This endpoint is the only observation point for the `left_at IS NULL`
    filter**, and that is the reason it exists rather than the client reading
    whatever the socket last sent. The filter is a *rule* about presence
    (ADR-0004), and a rule with no way to be checked decays: the first "just
    filter on meeting_id" shortcut would still pass every WebSocket test, because
    a socket test only ever sees a room in which nobody has left yet. The
    regression this guards against is silent — a past attendee reappearing as
    though they were still in the meeting — so it is asserted here, over HTTP,
    where a test can set up a room that has already had somebody leave.
    """
    meeting = get_meeting(session, meeting_uuid)
    if meeting is None:
        raise HTTPException(status_code=404, detail="No such meeting.")
    if has_ended(meeting):
        raise HTTPException(status_code=410, detail="That meeting has already ended.")

    return _room_view(session, meeting, list_present_participants(session, meeting.id))


@router.websocket("/meetings/{meeting_uuid}/ws")
async def join_room(
    websocket: WebSocket,
    meeting_uuid: str,
    session: Session = Depends(get_session),
) -> None:
    """Hold a participant's connection to one Meeting, for as long as they are in it.

    The whole of the realtime layer. A connection does three things, in order:
    refuse if the Meeting cannot be entered, record the arrival, and then relay
    changes until the socket closes.

    **Refusals are distinct and explained**, because they mean four different
    things to the person on the other end, and a browser reports all of them as
    "connection failed" unless the code says otherwise:

    - no identity (4401) — the socket carried no cookie naming a User. The client
      re-fetches the Meeting over HTTP, which mints one, and reconnects.
    - no such Meeting (4404) — a stale address.
    - not started yet (4425) — real Meeting, wrong time. Said as "not yet" rather
      than as either neighbour, because telling someone their host is never there
      a minute before the Meeting begins is the one thing that did not happen.
    - already ended (4410) — the host finished it.

    The start-time check is here even though the socket is only reachable from a
    room the client already rendered, because a *reload* of that room is how a
    scheduled Meeting is entered at its appointed time, and a socket that
    connected anyway would put a participant in a Meeting nobody else can enter.

    The `finally` is the load-bearing part. It stamps `left_at` and re-broadcasts
    on **every** exit — explicit close, dropped connection, server error — because
    a participant left listed is a person the room believes is still there. A
    socket that dies without a close frame (a laptop lid, a free-tier idle
    timeout) is the common case on this hosting tier, not the exotic one, so the
    crash path is the path that had to be right.
    """
    meeting = get_meeting(session, meeting_uuid)
    refusal = _refusal_for(meeting)
    if refusal is not None:
        await _refuse(websocket, *refusal)
        return

    viewer = _viewer_for(session, websocket.cookies)
    if viewer is None:
        await _refuse(websocket, CLOSE_NO_IDENTITY, REASON_NO_IDENTITY)
        return

    await websocket.accept()

    hub: MeetingHub = websocket.app.state.hub
    participation = join_meeting(session, meeting, viewer.user)
    connection = HubConnection(
        websocket=websocket, user_id=viewer.user.id, display_name=viewer.user.display_name
    )
    hub.attach(meeting.id, connection)

    try:
        await _broadcast_participants(hub, session, meeting)
        while True:
            message = await websocket.receive_json()
            if not isinstance(message, dict):
                continue
            if message.get("type") == "ping":
                # Answered rather than ignored, because a silent socket and a
                # dead one look identical from the client. The reply is what lets
                # the client say "reconnecting" instead of leaving a participant
                # list frozen with no explanation.
                await websocket.send_json({"type": "pong", "at": utcnow().isoformat()})
            elif message.get("type") == "chat":
                # Relayed, never written. The broadcast includes the sender, for
                # the reason `MeetingHub.broadcast` gives: one code path renders
                # every message, so there is no local-echo branch to disagree
                # with what arrives over the wire.
                await _broadcast_chat(hub, meeting, viewer.user, message)
            elif message.get("type") == "state":
                # The devices this person chose on the pre-join screen, applied
                # to the row so the record agrees with what the room shows.
                # Written once on arrival rather than on every message, because
                # the *controls* that change it are ticket 08's; this only
                # records the decision that was already made.
                if set_device_state(
                    session,
                    participation,
                    microphone_on=message.get("microphone_on") is True,
                    camera_on=message.get("camera_on") is True,
                ):
                    await _broadcast_participants(hub, session, meeting)
    except WebSocketDisconnect:
        pass
    finally:
        hub.detach(meeting.id, connection)
        # A departure is this *person's* last socket going, not the room's. A
        # person with the meeting open in two tabs is still in it, and stamping
        # `left_at` because one tab closed would remove them from the list while
        # they are visibly still there.
        if hub.attached_for_user(meeting.id, viewer.user.id) == 0:
            leave_meeting(session, participation)
        # Only worth broadcasting to a room that still has anybody in it. A
        # `detach` on an empty room has already dropped the key, so this is a
        # cheap no-op in the common case of somebody closing the last tab.
        if hub.attached_count(meeting.id):
            await _broadcast_participants(hub, session, meeting)


def _refusal_for(meeting: Meeting | None) -> tuple[int, str] | None:
    """The close code and the sentence for a Meeting that cannot be entered.

    `None` means it can. Four refusals kept distinct because they mean four
    different things to the person on the other end, and because a browser
    reports every one of them as "connection failed" unless told otherwise.

    Order matters and matches the join route: a Meeting that does not exist is
    reported as missing rather than as unstarted, and one that has both passed
    its time and been ended is reported as ended — the later fact is the one
    that explains why nobody is there.
    """
    if meeting is None:
        return CLOSE_MEETING_GONE, REASON_MEETING_GONE
    if not has_started(meeting):
        return (
            CLOSE_NOT_YET_STARTED,
            "That meeting has not started yet. Try again when it is time to join.",
        )
    if has_ended(meeting):
        return CLOSE_MEETING_ENDED, "That meeting has already ended."
    return None


async def _refuse(websocket: WebSocket, code: int, reason: str) -> None:
    """Turn somebody away, and tell them why in a way they can actually receive.

    **The handshake is accepted before the refusal is sent, and that is the whole
    point of this function.** A WebSocket closed before it is accepted never
    becomes a connection in the browser's eyes: the socket is reported as an
    abnormal closure with code 1006 and no reason, whatever the server put in
    the close frame. A client cannot tell "this meeting has not started" from
    "the network went away" — it sees the same 1006 for both — so a person is
    told their connection is broken when in fact their meeting has not begun.

    That is not a hypothetical. It is what this ticket's own browser test found:
    the room rendered "We could not reach the meeting" over a Meeting that
    existed and was simply early.

    So the socket is accepted, a `refused` message carries the sentence, and the
    close code is sent after it. The code is kept for a client that only ever
    looks at the code — the 4401 reconnect path does — and the message is what
    the room renders. Two channels for one fact, because they answer for two
    different kinds of client.
    """
    await websocket.accept()
    await websocket.send_json({"type": "refused", "reason": reason, "code": code})
    await websocket.close(code=code, reason=reason)


async def _broadcast_participants(
    hub: MeetingHub, session: Session, meeting: Meeting
) -> None:
    """Tell everyone attached to this Meeting who is in it.

    The payload is built by re-reading presence, not by adding the joiner to a
    cached list — see `realtime.MeetingHub` for why the hub holds connections
    rather than participants. One query, then one send per socket, is also
    cheaper than tracking a delta and being wrong when one is dropped.

    The view is serialised from the same `RoomParticipantsView` the HTTP endpoint
    returns, which is the reason that model exists as a model. Hand-writing the
    same six fields a second time here would be a second place to add a field
    and forget, and the two would then disagree in a way nothing tests: the room
    would show a participant with no display name while the API showed them
    perfectly well.
    """
    room = _room_view(session, meeting, list_present_participants(session, meeting.id))
    await hub.broadcast(
        meeting.id,
        {
            "type": "participants",
            **room.model_dump(mode="json"),
        },
    )


async def _broadcast_chat(
    hub: MeetingHub, meeting: Meeting, sender: User, message: dict
) -> None:
    """Relay one chat message to everybody in the Meeting, and store nothing.

    **The sender is an argument, not something read off the frame.** Whoever
    sent it is whoever this socket was admitted as, which is the whole reason
    attribution can be trusted: a client that put someone else's name in the
    frame it sent would see their own words relabelled, and there is no version
    of this where a message's author is a claim by its author.

    A message that is not text, or is empty once trimmed, is dropped rather than
    relayed. An empty bubble in the transcript reads as something a person said
    and then lost, and "the send button did nothing" is a worse answer than a
    composer that simply refuses to send whitespace.

    Over-long text is truncated rather than refused, and the truncation is not
    reported to anyone. Refusing means the sender's words vanish with no
    explanation on a surface that has no error channel back to the composer, and
    the client already limits the field to `MAX_CHAT_MESSAGE_LENGTH` — so this
    bound is reached by a hand-written socket, not by a person typing.

    **Nothing here touches the database.** That is the decision, not an omission
    (ADR-0005): the message exists for the connections currently attached, and
    the cost is that it is gone when the Meeting ends.
    """
    text = message.get("text")
    if not isinstance(text, str):
        return
    text = text.strip()
    if not text:
        return

    chat = ChatMessageView(
        id=str(uuid4()),
        user_id=sender.id,
        display_name=sender.display_name,
        text=text[:MAX_CHAT_MESSAGE_LENGTH],
        sent_at=utcnow().isoformat(),
    )
    await hub.broadcast(
        meeting.id, {"type": "chat", **chat.model_dump(mode="json")}
    )
