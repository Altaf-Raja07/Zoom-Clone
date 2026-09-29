"""The FastAPI application: CORS, routers, and health.

The browser talks to FastAPI directly rather than through a Next.js proxy,
because the WebSocket must connect directly anyway and one CORS configuration
is easier to reason about than a cookie story on one path and none on the
other (SPEC.md, Network topology).

The schema is owned by Alembic and nothing here creates it. `create_all` on
startup would be a second, silently divergent source of truth for the tables
the assignment says will be evaluated, so migrations are the only way the
schema comes into being — including in the tests, which run them for real.
"""

from collections.abc import Callable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import dashboard, meetings, rooms, session
from .config import get_settings
from .join_codes import generate_join_code
from .realtime import MeetingHub

__all__ = ["create_app"]


def create_app(join_code_source: Callable[[], str] = generate_join_code) -> FastAPI:
    settings = get_settings()

    app = FastAPI(title="Meetly", version="0.1.0")

    # Read through `app.state` by a dependency, so the source of Meeting IDs can
    # be replaced in tests without any of them reaching below the HTTP seam.
    app.state.join_code_source = join_code_source

    # The broadcast hub, for the same reason and with the same caveat. It is
    # per-application rather than module-level so that two applications in one
    # process — which is exactly what the test suite builds — cannot see each
    # other's participants, and so a test can assert on an empty room without
    # arranging for one to be empty.
    #
    # **One instance, one worker, forever.** The hub holds open sockets in
    # process memory, so a second worker would scatter participants into rooms
    # that cannot see each other. It looks like free headroom and is not. See
    # `realtime.MeetingHub` and ADR-0002.
    app.state.hub = MeetingHub()

    # CORS is configured from a single env-var origin allowlist, and only here.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(session.router, prefix="/api")
    app.include_router(meetings.router, prefix="/api")
    app.include_router(dashboard.router, prefix="/api")
    app.include_router(rooms.router, prefix="/api")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        """Whether the app is up. A monitor and a test runner both want this,
        and a reviewer waiting on a public URL wants it more than either."""
        return {"status": "ok"}

    return app
