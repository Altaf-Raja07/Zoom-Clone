"""Creating a Meeting, and looking one up.

Three endpoints, and the second exists because the frontend needs to render a
room it was navigated to — so a reload is a `GET`, not a re-create. The third is
the other way in: the Meeting an Invite Link or a typed Meeting ID points at,
which is what makes the two-identifier design worth its cost.

A room is addressed by the Meeting's internal id, not by its Meeting ID. The
public code is for humans sharing it out loud, and making the two
interchangeable would mean a mistyped code returning a 404 that reads as a
server fault. (Both things are called a "meeting id" in Zoom's own UI, which is
why the column here is `join_code` — see ADR-0004.)
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_session
from ..deps import current_user, join_code_source
from ..join_codes import format_join_code, read_join_code
from ..models import Meeting, User
from ..repository import (
    JoinCodeUnavailable,
    create_instant_meeting,
    get_host,
    get_meeting,
    get_meeting_by_join_code,
    has_ended,
)

router = APIRouter(tags=["meetings"])

# Where the Invite Link points. A path, not an absolute URL: the API does not
# know the address the browser is using, and a stored absolute link would be
# wrong the moment the app moved. The frontend completes it with its own origin.
INVITE_PATH_PREFIX = "/join"


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
    """

    id: str
    meeting_id: str
    join_code: str
    invite_path: str
    title: str | None
    scheduled_start_at: str | None
    started_at: str | None
    created_at: str
    is_host: bool
    host: HostView


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
        scheduled_start_at=_iso(meeting.scheduled_start_at),
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

    Three different refusals, kept distinct because they mean three different
    things to the person on the other end:

    - malformed (400) — what they typed is not a Meeting ID at all. Checked
      before the lookup, so a stray letter is never reported as a Meeting that
      does not exist.
    - no such Meeting (404) — a well-formed ID that nobody has.
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
    """
    meeting = get_meeting(session, meeting_uuid)
    if meeting is None:
        raise HTTPException(status_code=404, detail="No such meeting.")
    return to_view(meeting, session, user)
