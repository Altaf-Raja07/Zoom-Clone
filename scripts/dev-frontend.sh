#!/usr/bin/env bash
# Run the frontend development server on the port the browser tests expect.
set -euo pipefail

# Resolved absolutely: the test runner invokes this with a relative path from
# the frontend directory, so `dirname` alone is not the script's directory.
here="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
cd "$here/../frontend"

exec env PORT="${PORT:-3100}" npm run dev
