"""Shared FastAPI dependencies.

`current_user` is the single definition of "who is calling". It is the only
place a request's cookie is turned into a User, so identity cannot drift
between endpoints.
"""

from collections.abc import Callable

from fastapi import Depends, Request, Response
from sqlalchemy.orm import Session

from . import repository
from .config import COOKIE_NAME, Settings, get_settings
from .db import get_session
from .identity import read_user_id, set_identity_cookie
from .models import User


def current_user(
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> User:
    """The User this request belongs to, minted on a first visit.

    The identity cookie is set here, so an endpoint that depends on this hands
    out a cookie without having to think about it. A cookie naming a row that
    no longer exists (a wiped volume) is a first visit again, not an error.
    """
    user_id = read_user_id(request.cookies.get(COOKIE_NAME), settings.cookie_secret)
    user = repository.get_user(session, user_id)
    if user is not None:
        request.state.is_new_identity = False
        return user

    user = repository.create_user(session)
    set_identity_cookie(
        response, user.id, settings.cookie_secret, secure=settings.cookies_are_secure
    )
    request.state.is_new_identity = True
    return user


def join_code_source(request: Request) -> Callable[[], str]:
    """Where Meeting IDs are drawn from, held by the application.

    A dependency rather than a module-level import, so that the source of
    generated values can be replaced without touching a repository function or a
    test reaching past the HTTP seam to call one. Production never overrides it.
    """
    return request.app.state.join_code_source
