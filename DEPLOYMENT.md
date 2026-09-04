# Deployment Guide — S.K.AUTOTRUCK Backend

> This guide exists because the build environment that produced this code
> **cannot deploy it to a publicly reachable address itself** — see
> `DEPLOYMENT_ATTEMPT_LOG.md` for the evidence. The code below is complete,
> tested (143/148 automated tests passing — see README), and ready to run;
> it just needs to run somewhere your browser can actually reach it.

## What you're deploying

A single Node.js process (`src/server.js`) with a file-based SQLite database
(`data/somkiat.db`). No external database server, no build step, and (by
design — see README "Why no framework") zero npm dependencies to install.

## Option A — Any VPS / your own machine (fastest to verify)

```bash
unzip somkiat-backend.zip && cd somkiat-backend
node --version   # must be >= 22.5.0 for node:sqlite
npm run migrate
npm run seed      # creates staff1/manager1 demo logins — CHANGE THE PASSWORD
PORT=3001 npm start
```
If this machine has a public IP or you're testing from the same network,
point the frontend's "Backend API URL" (in Settings, or on the Login screen)
at `http://<that-machine's-address>:3001`.

## Option B — A Node-friendly hosting platform (Render, Railway, Fly.io, etc.)

These all follow roughly the same shape:
1. Push this code to a Git repository (GitHub/GitLab).
2. Create a new "Web Service" from that repo.
3. Build command: none needed. Start command: `npm run migrate && npm start`
   (or run `npm run seed` once manually afterward, from the platform's shell,
   NOT on every deploy — reseeding on every restart would recreate the demo
   users pointlessly, though it's harmless since `seed.js` checks for
   existing rows first).
4. Set the `PORT` environment variable if the platform requires a specific
   one (most inject `PORT` automatically — `src/config/env.js` already reads
   `process.env.PORT`).
5. **Before any real use**, set real values for `FACEBOOK_APP_SECRET`,
   `FACEBOOK_VERIFY_TOKEN`, `FACEBOOK_PAGE_ACCESS_TOKEN`, and
   `CLAUDE_API_KEY` — the server will refuse to start in
   `NODE_ENV=production` without them (this is intentional, tested
   fail-fast behavior — see Step 31/32 reports).
6. **Persistent disk matters**: `data/somkiat.db` is a real file. Most
   platforms' default filesystem is ephemeral (wiped on every redeploy) —
   you'll want to either mount a persistent volume at `data/`, or point
   `DATABASE_PATH` at one, or migrate to a managed Postgres/MySQL later
   (the code was deliberately written with a thin, swappable `db/connection.js`
   for exactly this reason, but that swap has not been done — this is still
   SQLite today).

### Render — concrete steps (chosen target platform)

A `render.yaml` Blueprint is included in this repo, so most of this is
declarative. **I could not verify this Blueprint against Render's live
service (no network access here) — treat it as a well-reasoned starting
point, not a guarantee.**

1. Push this repo to GitHub (a private repo is fine — Render can be granted
   access to a specific private repo without making it public).
2. In the Render dashboard: **New → Blueprint**, point it at this repo.
   Render will read `render.yaml` and propose: one Web Service
   (`skautotruck-backend`), one persistent Disk (`sqlite-data`, 1GB, mounted
   at `/var/data`), and the list of environment variables below.
3. Render will prompt you to fill in every env var marked `sync: false` in
   `render.yaml` — this is where you paste real values (Render stores these
   securely; they are never in the repo):
   - `ALLOWED_ORIGIN` — the real origin of your public site/dashboard (CORS)
   - `PUBLIC_DEALER_ID` — e.g. `DEALER_SOMKIAT` (required for `/api/public/*`)
   - `FACEBOOK_APP_SECRET`, `FACEBOOK_VERIFY_TOKEN`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `CLAUDE_API_KEY`
     — leave these blank / don't deploy with `NODE_ENV=production` yet if you
     don't have them for real; the server will simply refuse to start until
     they exist (tested, intentional — see Step 31/32).
4. `NODE_ENV=production` and `DATABASE_PATH=/var/data/somkiat.db` are already
   set as literal (non-secret) values in `render.yaml` — the path matches the
   Disk's mount point, so the SQLite file survives redeploys.
5. Deploy. Then confirm `GET https://<your-service>.onrender.com/health`
   returns `{"status":"ok"}` before pointing any frontend at it.
6. `.node-version` in this repo pins the exact Node version
   (`22.22.2`) this codebase was tested on — verify Render's currently
   supported Node versions include it; adjust the file if not.

## After deploying

1. Confirm `GET https://your-deployed-url/health` returns `{"status":"ok"}`.
2. Open `skautotruck-dashboard.jsx`, expand "ตั้งค่า Backend URL" on the login
   screen, and enter your deployed URL.
3. Log in with the seeded credentials, then immediately change the password
   (there is no "change password" UI yet — do it directly via
   `authService.createUser`/a small script, or add that screen next).

## What is still NOT done, even after deployment

Deploying makes the frontend↔backend connection real. It does **not** by
itself make Facebook Messenger or Claude live — those still need real
credentials (see README "Step 31 status") and, for Facebook specifically,
your deployed URL registered as the webhook endpoint in a real Facebook App.
