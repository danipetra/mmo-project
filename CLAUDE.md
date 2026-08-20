# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A learning/portfolio project: a lightweight multiplayer game world. It intentionally combines three
stacks the author is building interview-relevant skills in within one codebase — React (game client,
via react-three-fiber), Angular (admin dashboard), and a Node.js backend exposing both REST and
WebSocket APIs. Accounts (Postgres + JWT) now persist; live player state (position) and real gameplay
are still not built — the "MMO" ambition is deliberately being built up incrementally from this
minimal slice rather than attempted all at once.

## Commands

npm workspaces monorepo (root `package.json` — no pnpm/turborepo). All commands below are run from
the repo root unless noted.

```
npm install              # installs all three apps + shared package in one pass
npm run dev               # runs server + game-client + admin-dashboard concurrently (concurrently)
npm run dev:server         # server only  -> http://localhost:3000
npm run dev:client         # game-client only -> http://localhost:5173
npm run dev:dashboard       # admin-dashboard only -> http://localhost:4200
```

Per-workspace commands (`npm run <script> --workspace=<name>`, or `cd apps/<name>` first):

- **server**: `build` (`tsc`, emits to `apps/server/dist`), `start` (runs the built output).
- **game-client**: `build` (`tsc -b && vite build`), `lint` (`oxlint`), `preview`.
- **admin-dashboard**: `build` (`ng build`), `test` (`ng test`, Karma/Jasmine — scaffolded default,
  no tests written yet), `watch` (`ng build --watch`).

No test suite exists for `server` or `game-client` yet.

Native dev (`npm run dev`) still needs Postgres reachable — start just that piece via
`docker compose up -d postgres` first, and copy `apps/server/.env.example` to `apps/server/.env`
(gitignored) if it doesn't already exist. The server won't boot without a working `DATABASE_URL`:
`initDb()` runs (and can throw) before Fastify starts listening.

### Docker

```
docker compose up --build
```

Runs all four services — `postgres` plus server (plain Node), game-client/admin-dashboard (static
builds served by nginx) — on the same ports as local dev. `server` has a `depends_on: postgres`
health-gated condition, so it won't start until Postgres's `pg_isready` healthcheck passes. Each
app's `Dockerfile` **must be built with the repo root as context** (`docker build -f apps/<app>/Dockerfile .`),
not the app's own folder — this is because every app depends on `packages/shared`, and
workspace-relative `COPY`s in the Dockerfiles assume the root is the build context.
`docker-compose.yml` already sets this correctly; only matters if building an image manually.

Node.js **v24.15.0+** is recommended — on lower patch versions the Angular CLI still works but prints
an "unsupported Node version" warning on every `ng` command.

## Architecture

### Monorepo layout and the `shared` package

```
apps/server/           Fastify (REST) + Socket.io (WebSocket), TypeScript, ESM
apps/game-client/      React 19 + Vite + react-three-fiber
apps/admin-dashboard/  Angular 19
packages/shared/       TypeScript-only package: WebSocket event contracts, PlayerState, auth types
```

`packages/shared` has no build step — its `package.json` `main`/`types` point straight at
`src/index.ts`. Both `server` and `game-client` import from it, but **only via `import type`**. This
is deliberate and load-bearing: because the imports are type-only, both `tsc` (server) and Vite/esbuild
(game-client) erase them completely at build time, so neither the compiled server nor the client
bundle ever tries to `require`/resolve `shared` at runtime. This is why the server's production Docker
image can skip copying `packages/shared`'s source into the final runtime stage (it only needs the
symlink to exist during the build stage where `tsc` type-checks against it) — if a real runtime
dependency is ever added to `shared` (e.g. a shared validation function, not just types), this
assumption breaks and the runtime stage will need `packages/shared` copied in too.

`admin-dashboard` does **not** depend on `shared` — it talks to the server over plain REST
(`HttpClient`) with its own local `ServerStats` interface duplicating the shape, since Angular
consuming a TS-source-only workspace package adds friction that wasn't worth it for one interface.
If the dashboard starts consuming WebSocket events too, revisit pulling in `shared` there.

### Server (`apps/server/src/index.ts`, `auth.ts`, `db.ts`)

Fastify + Socket.io, both attached to **the same underlying `http.Server`** (`app.server`) via
`new Server(app.server, {...})`, started with `app.listen(...)`. This matters: an earlier version
created a second `http.Server` with `createServer(app.server)`, which silently does *not* wire up
Fastify's routes (single-arg `createServer()` expects a request-listener *function*; passing a
non-function like `app.server` makes Node treat it as an options object instead, producing a listener-less
server). Socket.io attaches its own request/upgrade handlers to whatever server it's given, so WS
looked fine while every REST route hung forever. If REST requests ever start hanging again with WS
still working, this is the first thing to check.

Live player state (position) is still a plain in-memory `Map<socketId, PlayerState>` — resets on every
reconnect/restart, nothing persisted. REST (`/health`, `/stats`) and WebSocket
(`world:state`, `player:joined`, `player:left`, `player:move`) share this same map, so `/stats`'s
`playersOnline` is always in sync with connected sockets by construction. `player:move` mutates the
map in place and re-broadcasts the full player list rather than diffing — fine at prototype scale,
will need to become delta-based before this could support many concurrent players.

Accounts, unlike player state, **are** persisted: `db.ts` opens a `pg` `Pool` from `DATABASE_URL` and
creates a `users` table (id, username, bcrypt `password_hash`) on boot if missing — there's no
migration framework, just an idempotent `CREATE TABLE IF NOT EXISTS`. `auth.ts` hashes/verifies
passwords with `bcryptjs` and signs/verifies JWTs (`jsonwebtoken`, `JWT_SECRET` env var, 7-day expiry)
carrying `{ sub: userId, username }`. `POST /auth/register` and `POST /auth/login` (Fastify JSON-schema
validated: username 3-32 chars, password ≥8) both return `{ token, username }`. A Socket.io `io.use`
middleware requires a valid JWT in the connection handshake (`socket.handshake.auth.token`) — no token,
expired token, or bad signature all get the connection rejected with `next(new Error("unauthorized"))`
before any player-state code runs. The authenticated `username` is copied onto `socket.data` and into
each connection's `PlayerState`, so `id` (socket id, ephemeral) and `username` (account identity,
persisted) are deliberately different fields.

### Game client (`apps/game-client/src/App.tsx`, `Login.tsx`)

`App` holds auth state only (`AuthResponse | undefined`, persisted to `localStorage` under
`mmo-auth`): no token renders `<Login>` (register/login form, posts to `/auth/register` or
`/auth/login`), a token renders `<Game>`. No router — it's a plain conditional, not routes.

`<Game>` holds the Socket.io connection in a `useRef` and player list in state; connects with
`auth: { token }` in the handshake so the server's `io.use` middleware can authenticate it. On
`connect_error` (e.g. expired/invalid token) it calls `onSignOut`, which clears `localStorage` and
bounces back to `<Login>` — this is the only place token expiry is handled, there's no proactive
refresh. Renders one cube per connected player via react-three-fiber, keyed by socket id (still
ephemeral — a reconnect gets a new cube identity even for the same account), coloring the local player
(matched by `selfId === socket.id`) differently, with the player's `username` as a floating
`drei` `<Html>` label. Movement is arrow-key driven, sends absolute position deltas via `player:move`
and optimistically updates local state before the server's broadcast round-trip confirms it — there is
no reconciliation/interpolation between the optimistic update and the server's next `world:state`
broadcast.

`VITE_SERVER_URL` (typed in `src/vite-env.d.ts`) overrides the server URL; defaults to
`http://localhost:3000`. Set at build time (Vite env var), not runtime — the Docker build passes it as
a build `ARG`.

### Admin dashboard (`apps/admin-dashboard/src/app/app.component.ts`)

Single root component, no routing (the scaffolded `app.routes.ts` is unused). Polls the server's
`/stats` REST endpoint every 2s via RxJS (`interval(2000).pipe(startWith(0), switchMap(...))`) rather
than subscribing to any WebSocket channel — it's read-only monitoring, not part of gameplay state sync.
Server URL is hardcoded as a local constant (`SERVER_URL` in `app.component.ts`), not environment-driven
like the game client — revisit if the dashboard needs to point at different environments.
