#!/usr/bin/env bash
# Run the backend against the SQLite file on disk, applying migrations first.
#
# One script, used by a developer starting the app and by the browser tests
# starting it, so the two cannot drift into running different things.
set -euo pipefail

# Resolved absolutely: the test runner invokes this with a relative path from
# the frontend directory, so `dirname` alone is not the script's directory.
here="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
repo="$(dirname "$here")"

# A venv at the repo root is what the README tells you to create; a local one
# in backend/ also works.
if [[ -x "$repo/.venv/bin/python" ]]; then
  python="$repo/.venv/bin/python"
elif [[ -x "$repo/backend/.venv/bin/python" ]]; then
  python="$repo/backend/.venv/bin/python"
else
  python="python3"
fi

cd "$repo/backend"

export MEETLY_DATABASE_PATH="${MEETLY_DATABASE_PATH:-$repo/backend/data/meetly.sqlite3}"
export MEETLY_COOKIE_SECRET="${MEETLY_COOKIE_SECRET:-dev-secret}"
export MEETLY_CORS_ORIGINS="${MEETLY_CORS_ORIGINS:-http://localhost:3000}"

# `upgrade head` is idempotent, so this is safe on every start and means a
# fresh clone needs no manual migration step before it serves.
"$python" -m alembic upgrade head

# Seeded on every start, not on a first run that has to be detected. The seed is
# idempotent, and "did this database ever get seeded?" is not a question worth
# answering when running it again costs nothing.
"$python" -m app.seed

# `--factory`, because `app.main` exports the builder rather than a module-level
# `app`: settings are read when the application is built, so importing the
# module at the top level would capture the environment before the script sets
# it.
#
# `--workers 1` is explicit even though it is the default, because it is the
# single most likely line in this repository to be "improved". The broadcast hub
# holds open WebSocket connections in process memory (`app/realtime.py`), so a
# second worker would put participants into two sets of rooms that cannot see
# each other: the second person joins, and the first person is never told. It
# presents as "somebody's list is stale" rather than as an error, and it scales
# with how busy the app is, so it would be reported as a performance bug. It is
# not a bug and there is no fix — see ADR-0002.
exec "$python" -m uvicorn app.main:create_app --factory --workers 1 \
  --port "${PORT:-8000}" "$@"
