"""Guest identity: a signed cookie that references a real User row.

There is no authentication here — no password, no login step. What the cookie
buys is a genuine `User` row, so ownership and attendance are real
relationships rather than a string in a cookie (ADR-0004).
"""

import secrets

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .config import COOKIE_NAME

# A week is long enough that a returning visitor is not asked to reintroduce
# themselves every day, and short enough that a stale cookie is not a
# permanent identity.
COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

_ADJECTIVES = (
    "Brave", "Calm", "Eager", "Gentle", "Keen", "Lucid", "Merry", "Nimble",
    "Quiet", "Swift", "Warm", "Zesty",
)
_NOUNS = (
    "Badger", "Cedar", "Dolphin", "Ember", "Falcon", "Heron", "Ibis", "Lynx",
    "Marten", "Otter", "Puffin", "Wren",
)


def new_display_name() -> str:
    """A recognisable default, rather than the anonymous "Guest 4"."""
    return f"{secrets.choice(_ADJECTIVES)} {secrets.choice(_NOUNS)}"


def sign_user_id(user_id: str, secret: str) -> str:
    return URLSafeTimedSerializer(secret).dumps(user_id)


def read_user_id(signed_value: str | None, secret: str) -> str | None:
    """The User id carried by a cookie, or None if it is absent, forged or stale.

    A bad cookie is not an error: the visitor simply gets a new identity.
    """
    if not signed_value:
        return None
    try:
        user_id = URLSafeTimedSerializer(secret).loads(
            signed_value, max_age=COOKIE_MAX_AGE_SECONDS
        )
    except (BadSignature, SignatureExpired):
        return None
    return user_id if isinstance(user_id, str) else None


def cookie_kwargs(secure: bool) -> dict:
    """The cookie's attributes, in the one place they are defined.

    The two settings are coupled, and getting the pairing wrong is silent: a
    browser rejects a `SameSite=None` cookie that is not also `Secure` and
    drops it without complaint, which looks exactly like identity being broken.
    So `None` is used only where `Secure` is — the deployed app, where the
    frontend is a different site from the API. Local development serves both
    over plain http on the same site, where `Lax` is both honoured and enough.
    """
    return {
        "key": COOKIE_NAME,
        "max_age": COOKIE_MAX_AGE_SECONDS,
        "httponly": True,
        "samesite": "none" if secure else "lax",
        "secure": secure,
        "path": "/",
    }


def set_identity_cookie(response, user_id: str, secret: str, secure: bool) -> None:
    response.set_cookie(value=sign_user_id(user_id, secret), **cookie_kwargs(secure))
