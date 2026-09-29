"""Creating a Meeting, and looking one up.

Four endpoints, and the second exists because the frontend needs to render a
room it was navigated to — so a reload is a `GET`, not a re-create. The third is
the other way in: the Meeting an Invite Link or a typed Meeting ID points at,
which is what makes the two-identifier design worth its cost. The first of the
two creates is the other half of the same row — a Scheduled Meeting is the same
Meeting with a start time, and the API takes the difference as the one field it
requires.

A room is addressed by the Meeting's internal id, not by its Meeting ID. The
public code is for humans sharing it out loud, and making the two
interchangeable would mean a mistyped code returning a 404 that reads as a
server fault. (Both things are called a "meeting id" in Zoom's own UI, which is
why the column here is `join_code` — see ADR-0004.)
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_session
from ..deps import current_user, join_code_source
from ..join_codes import format_join_code, read_join_code
from ..models import Meeting, User
from ..repository import (
    JoinCodeUnavailable,
    create_instant_meeting,
    create_scheduled_meeting,
    get_host,
    get_meeting,
    get_meeting_by_join_code,
    has_ended,
    has_started,
)

router = APIRouter(tags=["meetings"])

# Where the Invite Link points. A path, not an absolute URL: the API does not
# know the address the browser is using, and a stored absolute link would be
# wrong the moment the app moved. The frontend completes it with its own origin.
INVITE_PATH_PREFIX = "/join"

# The longest a Meeting may be booked for. A day, because that is the point at
# which "duration" stops describing a meeting and starts describing an absence
# — and because the column it is stored in is meant to be read by a person, not
# to accept whatever a client thought to send.
MAX_DURATION_MINUTES = 24 * 60


class HostView(BaseModel):
    id: str
    display_name: str


class MeetingView(BaseModel):
    """A Meeting as the browser needs it.

    Both spellings of the public identity are here on purpose: `join_code` is
    the stored form, used for lookup and for building the link, and `meeting_id`
    is the grouped form a host reads aloud. The frontend should not be doing
    that grouping itself — it is a product convention, and a convention the
    frontend invents is a convention the frontend can get wrong.

    `scheduled_start_at` and `duration_minutes` are the whole of what
    distinguishes a Scheduled Meeting from an Instant one, so both are here
    rather than hidden behind a `kind` the API would then have to keep in step
    with the nulls.
    """

    id: str
    meeting_id: str
    join_code: str
    invite_path: str
    title: str | None
    description: str | None
    scheduled_start_at: str | None
    duration_minutes: int | None
    started_at: str | None
    created_at: str
    is_host: bool
    host: HostView


class ScheduledMeetingRequest(BaseModel):
    """What a host books a Meeting with — the fields the assignment requires.

    Title and description are optional because a Meeting is recognisable by its
    Invite Link and its time, and a form that demands words to book a meeting is
    a form that will be filled with placeholder words. The start time is not
    optional: without it there is nothing scheduled, and a caller who meant to
    make an Instant Meeting has the other endpoint for that.
    """

    title: str | None = None
    description: str | None = None
    # Any offset is accepted and stored as the instant it names. A timestamp
    # with no offset is refused below rather than guessed at — the API does not
    # know the host's time zone, and time-zone selection is out of scope.
    scheduled_start_at: datetime
    duration_minutes: int = Field(ge=1, le=MAX_DURATION_MINUTES)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def to_view(meeting: Meeting, session: Session, viewer: User) -> MeetingView:
    host = get_host(session, meeting)
    return MeetingView(
        id=meeting.id,
        meeting_id=format_join_code(meeting.join_code),
        join_code=meeting.join_code,
        invite_path=f"{INVITE_PATH_PREFIX}/{meeting.join_code}",
        title=meeting.title,
        description=meeting.description,
        scheduled_start_at=_iso(meeting.scheduled_start_at),
        duration_minutes=meeting.duration_minutes,
        started_at=_iso(meeting.started_at),
        created_at=meeting.created_at.isoformat(),
        is_host=meeting.host_id == viewer.id,
        host=HostView(
            id=meeting.host_id,
            display_name=host.display_name if host else "Unknown host",
        ),
    )


@router.post("/meetings", response_model=MeetingView, status_code=201)
def create_meeting(
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
    code_source=Depends(join_code_source),
) -> MeetingView:
    """One click on New Meeting: a Meeting that is joinable immediately.

    The caller becomes the Host, recorded as `meetings.host_id` and nowhere
    else — there is no role column that could later disagree with it
    (ADR-0004).
    """
    try:
        meeting = create_instant_meeting(session, user, code_source)
    except JoinCodeUnavailable as exhausted:
        # Ten draws from a hundred billion codes. The right answer is to say the
        # service is busy rather than to hand back a 500 that reads as a crash.
        raise HTTPException(status_code=503, detail=str(exhausted)) from exhausted
    return to_view(meeting, session, user)


@router.post("/meetings/scheduled", response_model=MeetingView, status_code=201)
def schedule_meeting(
    requested: ScheduledMeetingRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
    code_source=Depends(join_code_source),
) -> MeetingView:
    """A Meeting for later, with its Invite Link handed out straight away.

    A second create rather than a body on the first, because the two are not the
    same request wearing different clothes: one is a button with nothing to fill
    in, the other is a form with four fields. Sharing the route would mean the
    Instant case had to carry a body it has no use for, and a caller with an
    empty start time would be accepted into making a Meeting they did not mean
    to schedule.

    The Invite Link exists from this moment, not from the Meeting's — a schedule
    you cannot share is a calendar entry, and the assignment asks for the first.
    """
    if requested.scheduled_start_at.tzinfo is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "That start time is not a moment in time. Send the time with the "
                "time zone it is in, as 2026-10-01T09:00:00+05:30."
            ),
        )

    try:
        meeting = create_scheduled_meeting(
            session,
            user,
            code_source,
            scheduled_start_at=requested.scheduled_start_at,
            duration_minutes=requested.duration_minutes,
            title=requested.title,
            description=requested.description,
        )
    except JoinCodeUnavailable as exhausted:
        raise HTTPException(status_code=503, detail=str(exhausted)) from exhausted
    return to_view(meeting, session, user)


@router.get("/meetings/by-code/{join_code}", response_model=MeetingView)
def read_meeting_by_join_code(
    join_code: str,
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
) -> MeetingView:
    """The Meeting an Invite Link or a typed Meeting ID points at.

    The second way in, and the one that earns the two-identifier design: a link
    and a spoken code resolve here to the same Meeting, and neither of them is
    the primary key.

    This is also the door that admits, so it is where a Meeting's start time is
    enforced. Four different refusals, kept distinct because they mean four
    different things to the person on the other end:

    - malformed (400) — what they typed is not a Meeting ID at all. Checked
      before the lookup, so a stray letter is never reported as a Meeting that
      does not exist.
    - no such Meeting (404) — a well-formed ID that nobody has.
    - not yet started (425) — the Meeting is real, and its time has not come.
      Said as "not yet" rather than as either of its neighbours, because telling
      someone their host is never there — or that the Meeting is over — a minute
      before it begins is the one thing that did not happen.
    - already ended (410) — the Meeting was real, and its host finished it.
      Collapsing this into the 404 would tell someone their host was never there,
      which is the one thing that did not happen.
    """
    bare_code = read_join_code(join_code)
    if bare_code is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "That is not a Meeting ID. A Meeting ID is eleven digits, "
                "grouped like 123 456 789 01."
            ),
        )

    meeting = get_meeting_by_join_code(session, bare_code)
    if meeting is None:
        raise HTTPException(status_code=404, detail="No meeting has that Meeting ID.")
    if not has_started(meeting):
        raise HTTPException(
            status_code=425,
            detail=(
                "That meeting has not started yet. "
                "Try again when it is time to join."
            ),
        )
    if has_ended(meeting):
        raise HTTPException(status_code=410, detail="That meeting has already ended.")
    return to_view(meeting, session, user)


@router.get("/meetings/{meeting_uuid}", response_model=MeetingView)
def read_meeting(
    meeting_uuid: str,
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
) -> MeetingView:
    """A Meeting, for the room screen to render.

    Open to any guest: anyone holding an Invite Link can get here, and there is
    no access control between users in this app (SPEC.md, Out of Scope). A
    meeting that does not exist says so plainly rather than 404-ing opaquely.

    The ended check is here as well as on the by-code route, because this is the
    other door into a Meeting: a reloaded room, a bookmark, a link copied from
    the address bar. Refusing only the join route would leave a stale URL as a
    way back into a finished Meeting, which is the case requirement 28 is about.

    The *start time* is not checked here, and the asymmetry with the check above
    is deliberate. This route renders rather than admits — it is how a host opens
    the Meeting they just scheduled to read its Invite Link, and a Meeting whose
    time has not come is exactly the one they most need to open. The hole the
    check would close does not exist: an Invite Link carries the Meeting ID, and
    this route is addressed by the internal id nobody outside the app is ever
    given.
    """
    meeting = get_meeting(session, meeting_uuid)
    if meeting is None:
        raise HTTPException(status_code=404, detail="No such meeting.")
    if has_ended(meeting):
        raise HTTPException(status_code=410, detail="That meeting has already ended.")
    return to_view(meeting, session, user)
