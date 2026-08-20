# mmo-project

Monorepo (npm workspaces) with three apps sharing one backend:

- `apps/server` — Node.js, TypeScript, Fastify (REST) + Socket.io (WebSocket) + Postgres. Accounts (register/login, JWT) are persisted; live player positions are still in-memory only.
- `apps/game-client` — React + Vite + react-three-fiber. Login/register screen, then connects to the server over WebSocket (JWT required), renders each connected player as a labeled cube, arrow keys move yours.
- `apps/admin-dashboard` — Angular. Polls the server's REST `/stats` endpoint every 2s and shows players online / uptime.
- `packages/shared` — TypeScript types shared between server and game-client (WebSocket event contracts, `PlayerState`, auth request/response shapes).

## Requirements

- Node.js **v24.15.0+** recommended (Angular CLI warns below that on this machine's current v24.14.0 — it still works, just noisy warnings on every `ng` command).
- Postgres reachable at `DATABASE_URL` — either via Docker (see below) or your own instance.

## Run everything locally

Postgres runs in Docker even for native dev (`docker compose up -d postgres`), while the three apps run natively for fast hot-reload:

```
docker compose up -d postgres
npm install
npm run dev
```

`apps/server/.env` (gitignored, copy from `.env.example`) points `DATABASE_URL` at `localhost:5432` for this native-dev case.

| App | URL |
|---|---|
| server (REST + WS) | http://localhost:3000 |
| game-client | http://localhost:5173 |
| admin-dashboard | http://localhost:4200 |

Or individually: `npm run dev:server`, `npm run dev:client`, `npm run dev:dashboard`.

## Run with Docker

No local Node/Angular CLI/Postgres needed — each app has its own multi-stage `Dockerfile` (server → plain Node runtime; game-client/admin-dashboard → static build served by nginx), orchestrated by the root `docker-compose.yml`, plus a `postgres` service with a named volume.

```
docker compose up --build
```

Same ports as local dev: server on 3000, game-client on 5173, admin-dashboard on 4200, Postgres on 5432. `server` waits on Postgres's healthcheck before starting and creates its `users` table on boot if missing.

Build contexts are the **repo root** (not each app folder), because the workspaces share `packages/shared`'s types — if you ever build an image manually rather than via compose, pass `-f apps/<app>/Dockerfile .` from the repo root.

## Auth

`POST /auth/register` and `POST /auth/login` (`{ username, password }`, password min 8 chars) return `{ token, username }`. The game-client stores this in `localStorage` and sends `token` in the Socket.io handshake (`auth: { token }`); the server's `io.use` middleware rejects any WebSocket connection without a valid, unexpired JWT. The admin-dashboard doesn't need auth yet — it only reads the public `/stats` endpoint.

## Next steps (not yet done)

- Persist player state itself (not just accounts) — currently positions reset to the in-memory map on every reconnect/restart.
- Deploy: server → Render/Fly.io (needs a persistent process for WebSocket, plus a managed Postgres like Supabase/Neon); game-client + admin-dashboard → Vercel/Netlify as static builds, or reuse the same Docker images.
