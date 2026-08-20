# mmo-project

Monorepo (npm workspaces) with three apps sharing one backend:

- `apps/server` — Node.js, TypeScript, Fastify (REST) + Socket.io (WebSocket) + Postgres. Accounts and characters (up to 3 per account, experience points) are persisted; live player state — position, HP, and later combat — is deliberately in-memory only, reset every connection.
- `apps/game-client` — React + Vite + react-three-fiber. Login/register → pick or create a character (up to 3) → connects to the server over WebSocket. Each player is a low-poly rigged character (WASD/arrow keys move yours, with idle/walk animations) — see `public/models/CREDITS.md` for the asset source.
- `apps/admin-dashboard` — Angular. Polls the server's REST `/stats` endpoint every 2s and shows players online / uptime.
- `packages/shared` — TypeScript types shared between server and game-client (WebSocket event contracts, `PlayerState`, auth request/response shapes).

## Requirements

- [Node.js](https://nodejs.org) **v24.15.0+** recommended (Angular CLI warns below that on this machine's current v24.14.0 — it still works, just noisy warnings on every `ng` command).
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — used at minimum for Postgres, optionally for the whole stack (see below). Must be running before any `docker compose` command.

## Quick start (first time)

Two ways to run this. Pick one:

- **Native dev** — the three apps run directly with Node/Vite/Angular CLI (fast hot-reload, best while actively coding), only Postgres runs in Docker.
- **Full Docker** — everything in containers (closer to how you'd hand it to someone else / deploy it), no local Node install needed at all.

Both need Docker Desktop running for Postgres regardless, but stick to native dev while actively
writing code: with Full Docker, every code change needs a `docker compose up --build` (tens of
seconds, even cached) to see it, since the app containers don't have hot-reload wired up — only
Postgres benefits from being containerized. Full Docker is for checking the project runs the way
someone else would get it, or for deploying, not for iterating.

**Docker Desktop must be running first** — it does not start itself on boot. Open it (Start menu ->
Docker Desktop) and wait until it says the engine is running before any `docker compose` command below.

### Option A — native dev (recommended while developing)

```
git clone https://github.com/danipetra/mmo-project.git
cd mmo-project
npm install
copy apps\server\.env.example apps\server\.env   # (or `cp` on macOS/Linux) -- only needed once
docker compose up -d postgres
docker compose ps    # confirm postgres shows "healthy" before continuing
npm run dev
```

`apps/server/.env` is gitignored and points `DATABASE_URL` at `localhost:5432`, which is where the
`postgres` container publishes its port — so the native server can reach it without being in Docker
itself. `npm run dev` starts all three apps together (uses `concurrently`); the server creates its
`users` table automatically on first boot.

Then open **http://localhost:5180**, register an account, create a character, and you're in the 3D
scene — move with **WASD or arrow keys** (idle/walk animations swap automatically), try the "Simulate
kill (+10 XP)" and "Take damage (-10 HP)" HUD buttons (placeholders standing in for real gameplay),
then reload the page and re-select the same character: XP/level survive, HP is back to full. Open a
second browser tab and either pick a different character on the same account or register a second
account entirely to see multiplayer — both characters should move independently and show their names.
Check **http://localhost:4200** for the admin dashboard (players online / server uptime).

Stop with `Ctrl+C`; Postgres keeps running in the background afterwards (`docker compose down` to
stop it too — your registered accounts persist in the `postgres-data` volume either way, only
`docker compose down -v` would wipe them).

Run one app at a time instead of all three: `npm run dev:server`, `npm run dev:client`,
`npm run dev:dashboard`.

### Option B — everything in Docker

```
git clone https://github.com/danipetra/mmo-project.git
cd mmo-project
docker compose up --build
```

No `npm install`, no `.env` file, no local Node needed — `docker-compose.yml` sets the server's
`DATABASE_URL`/`JWT_SECRET` directly as container env vars. First run takes a few minutes (builds all
four images); after that Docker caches layers and it's much faster. Same URLs as above
(5173/4200/3000), plus Postgres itself on 5432 if you want to inspect it with a DB client.

`server` won't start until Postgres's healthcheck passes, so don't worry if its logs are quiet for a
few seconds after `postgres` starts.

## Auth and characters

`POST /auth/register` and `POST /auth/login` (`{ username, password }`, password min 8 chars) return
`{ token, username }`. The game-client stores this in `localStorage` and uses it as a `Bearer` token
for `GET/POST/DELETE /characters` (list/create/delete, up to 3 per account, globally unique names) and
in the Socket.io handshake alongside the chosen character (`auth: { token, characterId }`). The
server's `io.use` middleware rejects any WebSocket connection without a valid JWT *and* a character id
that account actually owns. The admin-dashboard doesn't need auth yet — it only reads the public
`/stats` endpoint.

Only experience points (and the character's name) are ever persisted. Position and HP reset every time
you connect — deliberate, not a gap; see `CLAUDE.md`'s server section for the reasoning.

## Troubleshooting

- **Server won't start / crashes immediately** (often `ECONNREFUSED` in the logs): almost always
  Postgres isn't reachable. Most common cause: **Docker Desktop isn't running** (it doesn't
  auto-start after a PC reboot) — open it, wait for the engine, then `docker compose up -d postgres`.
  Otherwise confirm `docker compose ps` shows `postgres` as `healthy`, and that
  `apps/server/.env`'s `DATABASE_URL` matches how you're running things (`localhost:5432` for native
  dev, `postgres:5432` only applies inside `docker-compose.yml`'s own network — don't copy that value
  into `.env`).
- **Dashboard shows "Server unreachable"**: check the server is actually running and reachable at
  `http://localhost:3000/health` in a browser. If REST hangs indefinitely while WebSocket connections
  work fine, see the note in `CLAUDE.md`'s server section — that's a known trap with how Socket.io
  attaches to the underlying HTTP server.
- **Angular CLI prints an "unsupported Node version" warning**: harmless below Node v24.15.0, see
  Requirements above.

## Next steps (not yet done)

- Real gameplay (mobs, combat) to replace the "Simulate kill" / "Take damage" HUD placeholders — the
  persistence foundation (durable exp, ephemeral everything else) is meant to be built on top of, not
  reworked, once this exists.
- Swap the player model's mesh for a properly textured/clothed character sharing the same skeleton —
  the current one is an untextured placeholder body ("Mannequin"), just recolored; see
  `apps/game-client/public/models/CREDITS.md`.
- Environment art (ground, props, lighting) — currently just a flat grid, no scene dressing yet.
- Deploy: server → Render/Fly.io (needs a persistent process for WebSocket, plus a managed Postgres like Supabase/Neon); game-client + admin-dashboard → Vercel/Netlify as static builds, or reuse the same Docker images.

Known, accepted limitation: deleting a character behind a currently-open game connection doesn't
force-disconnect that socket — only the next connect attempt re-validates ownership.
