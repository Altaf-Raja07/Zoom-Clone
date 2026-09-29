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
exec "$python" -m uvicorn app.main:create_app --factory --port "${PORT:-8000}" "$@"
