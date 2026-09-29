# Deploy to Render: single Web Service with a mounted disk

The frontend is a static Next.js build and the backend is a single FastAPI Web
Service with a mounted persistent disk holding the SQLite file. Not Vercel: its
serverless functions cannot hold a long-lived WebSocket connection or a
writable disk, which would break both the realtime hub and cookie-backed
identity. Not Docker Compose on a VPS, because provisioning a box is time we
don't have.

**Why:** Render accepts a single instance by default, which is exactly what an
in-process broadcast hub requires, and a mounted disk means the SQLite file
survives redeploys. Railway was the near-miss; Fly.io with a volume is the
better product but needs a card and is the least documented of the three.

**Consequences:**

- **Never run more than one backend instance, and never more than one worker
  process.** The broadcast hub holds participant state in process memory, so a
  second instance or a second uvicorn worker would put participants in different
  rooms with no way to see each other. This is invisible in the code and looks
  like a free scaling win, so it will be tempting to "fix" later. It is not a
  bug.
- **The database is seeded on startup**, so a lost volume degrades to a
  demo-able state rather than an empty app.
- **The WebSocket carries a ~25s heartbeat** from the client, which keeps the
  free tier from idling the service out from under us and doubles as the
  meeting-still-alive signal.
- **Free tier idles aggressively.** The first visitor after a quiet period
  absorbs a cold start. Accepted for a one-day build; a card would remove it.
