# Deploying to Render

The blueprint in `render.yaml` creates both halves of the app; this file covers
the parts only a person can do, and the two things that will not work on the
free plan. The decisions are in `docs/adr/0002-render-single-instance-deployment.md`.

## Before you start

- The repository has to be pushed to GitHub. Render deploys from a repository.
- You need to decide about the database file, below. It is the one decision that
  changes what the deployment is.

## 1. Apply the blueprint

Render → **New** → **Blueprint** → pick this repository. Render asks for the
two values marked `sync: false`, and neither service's URL exists yet at that
point, so any placeholder will do for now:

| Service | Variable | Now, then |
| --- | --- | --- |
| `meetly-api` | `MEETLY_CORS_ORIGINS` | `https://placeholder.example` |
| `meetly-web` | `NEXT_PUBLIC_API_BASE_URL` | `https://placeholder.example` |

The API will start and serve `/api/health` with these in place. It will refuse
every browser request from the real frontend, which is expected until step 3.

## 2. The database file

**The free plan has no persistent disk.** The SQLite file is written to the
service's ephemeral filesystem, so:

- a **restart** of the same instance keeps the file, and a guest keeps their
  identity and their meetings;
- a **redeploy** — which is what every code push does — replaces the instance
  and the file with it. Everyone becomes a new guest, and every meeting
  disappears.

That is survivable for a demo. `MEETLY_DATABASE_PATH` is set to a path inside
the build directory for exactly this case, and to the disk's mount point once
you have one, so switching is a one-line change to `render.yaml` and no change
to the application at all. To keep data across deploys, uncomment the `disk:`
block, choose the **Starter** plan ($7/month, needs a card), and set
`MEETLY_DATABASE_PATH=/var/data/meetly.sqlite3`.

## 3. Point each service at the other

Once both services have URLs:

- `meetly-api` → `MEETLY_CORS_ORIGINS` = `https://meetly-web.onrender.com`, then
  save. This restarts the API.
- `meetly-web` → `NEXT_PUBLIC_API_BASE_URL` = `https://meetly-api.onrender.com`,
  then save. This value is baked into the browser bundle at build time, so it
  needs a **redeploy** of the frontend, not a restart.

## 4. Check it, in this order

1. `https://meetly-api.onrender.com/api/health` returns `{"status":"ok"}`.
2. Open the frontend. The navbar says **Hi, <something>** — that greeting is
   the whole identity story working: a real `User` row, minted on first visit
   and remembered by a signed cookie.
3. **The cookie is `SameSite=None; Secure` and `HttpOnly`.** In the browser's
   devtools, Application → Cookies. If `Secure` is missing, the frontend origin
   is not in `MEETLY_CORS_ORIGINS` — the setting is derived from that allowlist,
   so a local-only allowlist silently turns the flag off.
4. **Create a meeting** from the dashboard. You should land in the room with an
   eleven-digit ID grouped `123 456 789 01` and an Invite Link ending
   `/join/12345678901`.
5. **Restart the API instance** (Render → the service → Manual Deploy → Restart,
   or `Restart` in the dashboard's lifecycle menu) and reload the frontend. The
   greeting must still be the *same* display name. If it changed, the guest
   identity did not survive, and the file was lost — see step 2.

## 5. What will bite

- **The free tier idles aggressively.** The first visitor after a quiet minute
  absorbs a cold start, and the first request can take a minute. The WebSocket
  heartbeat in a later ticket exists partly to prevent this.
- **One instance, one worker.** `startCommand` runs uvicorn with no `--workers`
  for that reason. Adding `--workers 4` will look like a free speed-up and will
  scatter participants into rooms that cannot see each other.
- **Two web services means two URLs.** The frontend's is the one a reviewer
  should be given; the API's is for you.
