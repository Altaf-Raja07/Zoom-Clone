"""What the dashboard shows: the sections, and the Demo Identity's data.

Three endpoints, and the third is the one worth arguing about.

The first two are the two sections the assignment names, and both are filtered
on `host_id` — one query each, no union, no deduplication, no way for one list
to disagree with the other about whose meetings these are (ADR-0004).

The third is what the first run is *for*. The seed populates Upcoming so a
reviewer sees a working dashboard on arrival, but every production guest gets
their own User and is never handed the Demo Identity — so a guest who is not
offered a way in would see two empty sections and conclude the feature is
broken. This endpoint reads the Demo Identity's Meetings **without** touching
the reviewer's own cookie or their own two lists: nothing about who they are
changes, so nothing they created can be affected. It is the alternative to
widening Upcoming to every Meeting in the app, which would have put a
stranger's booking on a stranger's dashboard.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_session
from ..deps import current_user
from ..models import User
from ..repository import list_recent_meetings, list_upcoming_meetings
from ..seed import demo_identity
from .meetings import MeetingView, to_view

router = APIRouter(tags=["dashboard"])


class UpcomingMeetingsView(BaseModel):
    upcoming: list[MeetingView]


class RecentMeetingsView(BaseModel):
    recent: list[MeetingView]


class DemoDashboardView(BaseModel):
    """The Demo Identity's own two sections, for a reviewer to look at.

    Two separate lists rather than one merged one, because the point is to show
    that the *same* two sections populate with real data once someone has real
    Meetings — the same shape, the same code path, different User.
    """

    display_name: str
    upcoming: list[MeetingView]
    recent: list[MeetingView]


@router.get("/dashboard/upcoming", response_model=UpcomingMeetingsView)
def read_upcoming_meetings(
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
) -> UpcomingMeetingsView:
    """The viewer's Scheduled Meetings that have not arrived yet, soonest first.

    Empty rather than fabricated when there are none — story 12 in the other
    direction, and the same promise: a blank area must never be mistaken for a
    Meeting the host forgot about, or invented to fill the space.
    """
    return UpcomingMeetingsView(
        upcoming=[
            to_view(meeting, session, user)
            for meeting in list_upcoming_meetings(session, user.id)
        ]
    )


@router.get("/dashboard/recent", response_model=RecentMeetingsView)
def read_recent_meetings(
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
) -> RecentMeetingsView:
    """The Meetings the viewer hosted, most recently active first.

    An Instant Meeting appears here the moment it is created, because creating
    one stamps `created_at` — which is why recency is read as the later of
    `created_at` and `started_at` rather than as either alone.
    """
    return RecentMeetingsView(
        recent=[
            to_view(meeting, session, user)
            for meeting in list_recent_meetings(session, user.id)
        ]
    )


@router.get("/dashboard/demo", response_model=DemoDashboardView)
def read_demo_dashboard(
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
) -> DemoDashboardView:
    """The Demo Identity's sections, for the reviewer who wants to see them.

    Reads only. The reviewer's cookie, their own User, and their own two lists
    are untouched — this is a look at somebody else's rows, not a way of
    becoming them, because becoming them would silently move a reviewer's real
    Meetings onto a shared identity.

    404 rather than an empty pair of lists when this database was never seeded,
    which is the honest answer: there is no Demo Identity here to look at, and
    two empty sections would read as "the demo identity has no meetings" — a
    claim about a user who does not exist.

    That 404 is also how the dashboard decides whether to *offer* this at all,
    which is what "only offered where explicitly initialised" means in practice
    (GLOSSARY.md). A control that renders unconditionally and then fails is
    offered everywhere; a section the frontend hides when this answers 404 is a
    thing this deployment has rather than a thing the app always pretends to.
    """
    demo = demo_identity(session)
    if demo is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "There is no Demo Identity in this database. Seed it to see a "
                "populated dashboard."
            ),
        )

    # Rendered with the Demo Identity as the viewer, so `is_host` is true on
    # their own Meetings and the copy on them is a host's copy.
    return DemoDashboardView(
        display_name=demo.display_name,
        upcoming=[
            to_view(meeting, session, demo)
            for meeting in list_upcoming_meetings(session, demo.id)
        ],
        recent=[
            to_view(meeting, session, demo)
            for meeting in list_recent_meetings(session, demo.id)
        ],
    )
