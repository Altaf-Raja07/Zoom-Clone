"""The current visitor's identity, and nothing else.

`GET /api/session` is the seam every later ticket builds on: the frontend calls
it once on load and receives the visitor's Display Name. `PATCH` is the
confirmation step — the name a person is about to be known by, chosen before they
enter a Meeting rather than after someone has already seen it.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_session
from ..deps import current_user
from ..models import User
from ..repository import update_display_name

router = APIRouter(tags=["session"])


class SessionView(BaseModel):
    """What the dashboard needs to greet the visitor by name."""

    id: str
    display_name: str
    is_new: bool


class DisplayNameChange(BaseModel):
    """A name the person has chosen for themselves.

    No length limit is declared here: the column is eighty characters and the
    repository truncates to it, so an over-long name is cut rather than refused.
    A name that is empty once trimmed *is* refused, because a Meeting full of
    blank names is a worse outcome than a complaint.
    """

    display_name: str


@router.get("/session", response_model=SessionView)
def get_session_view(
    request: Request,
    user: User = Depends(current_user),
) -> SessionView:
    """The visitor's identity: minted on first sight, remembered after.

    There is no signup and no login — the cookie is the whole of it.
    """
    return SessionView(
        id=user.id,
        display_name=user.display_name,
        is_new=request.state.is_new_identity,
    )


@router.patch("/session", response_model=SessionView)
def change_display_name(
    change: DisplayNameChange,
    request: Request,
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
) -> SessionView:
    """Confirm the Display Name, returning the stored result.

    The response is the authority on what was stored, not an echo of what was
    sent: the name is trimmed and truncated on the way in, so a browser that
    assumed its own text came back unchanged would show a different name from
    the one everyone else sees.
    """
    if not change.display_name.strip():
        raise HTTPException(status_code=400, detail="A display name cannot be blank.")

    updated = update_display_name(session, user, change.display_name)
    return SessionView(
        id=updated.id,
        display_name=updated.display_name,
        is_new=request.state.is_new_identity,
    )
