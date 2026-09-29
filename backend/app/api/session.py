"""The current visitor's identity, and nothing else.

`GET /api/session` is the seam every later ticket builds on: the frontend calls
it once on load and receives the visitor's Display Name.
"""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from ..deps import current_user
from ..models import User

router = APIRouter(tags=["session"])


class SessionView(BaseModel):
    """What the dashboard needs to greet the visitor by name."""

    id: str
    display_name: str
    is_new: bool


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
