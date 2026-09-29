"""Application configuration.

Cookie attributes and CORS origins are each configured in exactly one place —
here — so that there is a single thing to debug when identity misbehaves
(user story 86).
"""

import os
from dataclasses import dataclass, field
from pathlib import Path

COOKIE_NAME = "meetly_guest"

DEFAULT_DATABASE_PATH = "./data/meetly.sqlite3"

# A placeholder, not a secret. Serving a real origin with it is refused — see
# `Settings.__post_init__`.
DEFAULT_COOKIE_SECRET = "insecure-dev-secret"


@dataclass(frozen=True)
class Settings:
    """Runtime settings, read from the environment.

    `cookie_secret` signs the guest cookie; `cors_origins` is the single
    allowlist every cross-origin decision is derived from.
    """

    database_path: Path
    cookie_secret: str
    cors_origins: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.cookie_secret != DEFAULT_COOKIE_SECRET or not self.cors_origins:
            return
        # A predictable signing key means anyone can mint a cookie naming any
        # user — impersonation, not a theoretical concern. Acceptable only
        # while nothing but a developer's own machine can reach the app, which
        # the origin allowlist is the evidence for.
        if not all(_is_local_origin(origin) for origin in self.cors_origins):
            raise RuntimeError(
                "MEETLY_COOKIE_SECRET must be set to a private value before "
                "serving a non-local origin; the built-in default is public."
            )

    @property
    def cookies_are_secure(self) -> bool:
        """Whether to set `Secure` on the identity cookie.

        `SameSite=None` is only honoured on a cookie the browser considers
        secure, so this must be True for the deployed app to work at all. It is
        relaxed only for local development, where the frontend is served over
        plain http and a Secure cookie would be silently dropped — which would
        look exactly like identity being broken.

        Derived from the CORS allowlist rather than a flag of its own, so there
        is still only one place to configure identity.
        """
        if not self.cors_origins:
            return False
        return not all(_is_local_origin(origin) for origin in self.cors_origins)

    @classmethod
    def from_env(cls) -> "Settings":
        origins = os.environ.get("MEETLY_CORS_ORIGINS", "")
        return cls(
            database_path=Path(
                os.environ.get("MEETLY_DATABASE_PATH", DEFAULT_DATABASE_PATH)
            ),
            cookie_secret=os.environ.get("MEETLY_COOKIE_SECRET", DEFAULT_COOKIE_SECRET),
            cors_origins=[origin.strip() for origin in origins.split(",") if origin.strip()],
        )


def _is_local_origin(origin: str) -> bool:
    """Whether an origin refers to the developer's own machine.

    An origin with no host at all counts as local, because that is what
    `from_env` produces from an unset allowlist — and there is nothing to
    protect in that case anyway, since no cross-origin caller is configured.
    """
    host = origin.split("//", 1)[-1].split("/", 1)[0]
    return host.split(":", 1)[0] in {"", "localhost", "127.0.0.1", "::1", "0.0.0.0"}


_settings: Settings | None = None


def get_settings() -> Settings:
    """The process-wide settings, read from the environment once."""
    global _settings
    if _settings is None:
        _settings = Settings.from_env()
    return _settings


def reset_settings() -> None:
    """Forget the cached settings — used between tests."""
    global _settings
    _settings = None
