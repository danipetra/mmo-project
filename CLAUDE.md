# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A learning/portfolio project: a lightweight multiplayer game world. It intentionally combines three
stacks the author is building interview-relevant skills in within one codebase — React (game client,
via react-three-fiber), Angular (admin dashboard), and a Node.js backend exposing both REST and
WebSocket APIs. Accounts and characters (Postgres + JWT) persist; live player state (position, HP)
and real gameplay/combat are still not built — the "MMO" ambition is deliberately being built up
incrementally from this minimal slice rather than attempted all at once. The current foundation is
the **durable/ephemeral persistence split** (see the Server section below): experience points and
character identity are the only things written to Postgres, everything else about a live player is
recomputed fresh every connection.

## Commands

npm workspaces monorepo (root `package.json` — no pnpm/turborepo). All commands below are run from
the repo root unless noted.

```
npm install              # installs all three apps + shared package in one pass
npm run dev               # runs server + game-client + admin-dashboard concurrently (concurrently)
npm run dev:server         # server only  -> http://localhost:3000
npm run dev:client         # game-client only -> http://localhost:5180
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

`game-client`'s dev port is pinned to `5180` with `strictPort: true` in `vite.config.ts` — Vite's
default 5173 (and its auto-picked fallbacks like 5174) kept colliding with stray processes left
running from earlier sessions on this machine. `strictPort` makes a real conflict fail loudly instead
of silently renumbering, which is easier to debug than chasing "which port did it land on this time."

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

Character leveling (`levelForExp`/`maxHpForLevel` in `apps/server/src/leveling.ts`) is server-only for
the same reason: `PlayerState` carries a server-computed `level` field over the wire, so the client
only ever displays `player.level` — it never needs to compute it itself, so there's nothing to share
and nothing to duplicate. If the client ever needs to predict a level client-side (e.g. an XP bar that
animates before the server confirms), *that's* the point where this trade-off should be revisited.

`admin-dashboard` does **not** depend on `shared` — it talks to the server over plain REST
(`HttpClient`) with its own local `ServerStats` interface duplicating the shape, since Angular
consuming a TS-source-only workspace package adds friction that wasn't worth it for one interface.
If the dashboard starts consuming WebSocket events too, revisit pulling in `shared` there.

### Server (`apps/server/src/index.ts`, `auth.ts`, `db.ts`, `characters.ts`, `leveling.ts`, `httpAuth.ts`)

Fastify + Socket.io, both attached to **the same underlying `http.Server`** (`app.server`) via
`new Server(app.server, {...})`, started with `app.listen(...)`. This matters: an earlier version
created a second `http.Server` with `createServer(app.server)`, which silently does *not* wire up
Fastify's routes (single-arg `createServer()` expects a request-listener *function*; passing a
non-function like `app.server` makes Node treat it as an options object instead, producing a listener-less
server). Socket.io attaches its own request/upgrade handlers to whatever server it's given, so WS
looked fine while every REST route hung forever. If REST requests ever start hanging again with WS
still working, this is the first thing to check.

**The durable/ephemeral split, as a rule**: `characters.exp` (and the character's identity — name)
are the *only* live-player data that ever touches Postgres. Position, HP, and (later) all
combat/mob-calculation results live only in the in-memory `Map<socketId, PlayerState>` for the
duration of a connection and are recomputed fresh every time (`level`/`maxHp` derived from `exp`,
`hp` starts full) — never loaded from or written to the DB. This is deliberate, not an omission: it
keeps the hot, high-frequency stuff (position changes constantly; HP will once combat exists) off the
database entirely, while the durable stuff (`exp`) changes rarely enough (discrete events, not a
per-frame stream) that a direct write-through `UPDATE` per change is fine — no batching/snapshot
machinery needed. Any future gameplay system should keep asking "does this need to survive a
reconnect?" before adding a new DB column; if not, it belongs only on the in-memory `PlayerState`.

Accounts and characters are persisted: `db.ts` opens a `pg` `Pool` from `DATABASE_URL` and creates
`users` and `characters` tables on boot if missing — there's no migration framework, just idempotent
`CREATE TABLE IF NOT EXISTS` statements. `auth.ts` hashes/verifies passwords with `bcryptjs` and
signs/verifies JWTs (`jsonwebtoken`, `JWT_SECRET` env var, 7-day expiry) carrying `{ sub: userId,
username }` — **this shape never changed** when characters were added (see below, that was a
deliberate rejection of an alternative design). `POST /auth/register` and `POST /auth/login` (Fastify
JSON-schema validated: username 3-32 chars, password ≥8) both return `{ token, username }`.

**Characters** (`characters.ts`): up to 3 per user, global case-insensitive unique names (`UNIQUE
INDEX ON characters (lower(name))` — MMO-style, server-wide, not per-account). The "max 3" limit
can't be expressed as a simple unique constraint (that only expresses "at most 1"), and a plain
`INSERT ... WHERE (SELECT COUNT(*) ...) < 3` guard is *not* race-free under Postgres's default `READ
COMMITTED` isolation — two concurrent inserts can both read `COUNT = 2` from their own snapshot and
both succeed. `createCharacter` fixes this with `pg_advisory_xact_lock($user_id)` inside a
transaction, serializing concurrent attempts for the same user without needing a row to lock (a
user's first character has none) — verified against a real concurrency race in a throwaway smoke
test (two `Promise.all`'d concurrent creates, exactly one succeeded). Every ownership check in this
feature (delete, socket connect) is a single `WHERE id = $1 AND user_id = $2` query — never "fetch by
id, then compare `user_id` in application code," which is a TOCTOU/copy-paste trap once there are
multiple call sites doing ownership checks. `level` is derived from `exp` on every read
(`leveling.ts`'s `levelForExp`) rather than stored, so there's no denormalized column to drift and a
future rebalance of the curve updates every character for free.

**REST auth** (`httpAuth.ts`): the `requireAuth` Fastify `preHandler` is the *first* JWT-protected
REST route pattern in this codebase — until characters, only the Socket.io `io.use` middleware ever
checked a token. It reads `Authorization: Bearer <token>`, verifies it with the same `verifyToken` the
socket middleware uses, and attaches `request.userId` (typed via a `declare module "fastify"`
augmentation) or replies 401. Fastify preHandlers stop the chain by sending a reply, not by an
Express-style `next()` — don't copy the socket middleware's control-flow shape here.

**Character selection is *not* a new token.** The obvious-looking design — re-sign a new JWT with
`characterId` baked in after `POST /characters/:id/select` — was considered and rejected: the socket
connect handler already has to reload the character fresh from Postgres by id (needed anyway to seed
authoritative `exp` into the in-memory state), and that DB read **is** the ownership check. A second
token shape would add a real footgun (two independent expiry/shape stories to reason about) for zero
benefit. Instead `characterId` travels **unsigned** in the Socket.io handshake
(`socket.handshake.auth = { token, characterId }`); `io.use` verifies the account JWT exactly as
before (`AuthTokenPayload` is unchanged), then authorizes with `getOwnedCharacter(payload.sub,
characterId)`. This also means there's no `POST /characters/:id/select` REST endpoint at all —
`GET /characters` already only returns characters the caller owns, so "selecting" one is purely local
client state. The middleware rejects with a **distinguishable** error message — `"unauthorized"`
(bad/expired account token) vs `"character not found"` (missing/foreign/stale id, or any other
server-side failure) — so the client can tell "log in again" apart from "pick a character again."

Known accepted limitation: deleting the character behind a currently-open socket connection doesn't
force-disconnect that socket — only the *next* connect attempt re-validates ownership. Not built
deliberately (real scope beyond what was asked), not an oversight.

### Game client (`apps/game-client/src/App.tsx`, `Login.tsx`, `CharacterSelect.tsx`, `api.ts`)

`App` is a 3-state machine, each state gated on `localStorage`: no `auth` (`mmo-auth` key,
`AuthResponse`) → `<Login>`; `auth` but no selected character (`mmo-character` key, `{id, name}`) →
`<CharacterSelect>`; both → `<Game>`. No router — it's a plain conditional, not routes. Selecting a
character is purely a local state write (see the server-side note on why there's no
select-endpoint/second-token); `api.ts` is a small `Authorization: Bearer` fetch wrapper used by
`<CharacterSelect>` for `GET/POST/DELETE /characters` — the client's only authenticated REST usage
(the account token otherwise only ever goes into the socket handshake).

`<Game>` holds the Socket.io connection in a `useRef` and player list in state; connects with
`auth: { token, characterId }` in the handshake. On `connect_error` it branches on the server's
message: `"unauthorized"` triggers a full sign-out (clears both `localStorage` keys, back to
`<Login>`); anything else (stale/foreign character id, a transient server error) clears only the
character key and falls back to `<CharacterSelect>` — deliberately *not* a full sign-out, since e.g. a
character deleted from another tab isn't a login problem. "Change character" does the same
character-key-only clear. Renders one cube per connected player via react-three-fiber, keyed by socket
id (still ephemeral — a reconnect gets a new cube identity even for the same character), coloring the
local player (matched by `selfId === socket.id`) differently, with `characterName` + level as a
floating `drei` `<Html>` label, plus an HP bar/exp/level readout in the HUD. Movement is arrow-key
driven, sends absolute position deltas via `player:move` and optimistically updates local state before
the server's broadcast round-trip confirms it — no such optimistic update exists for
`player:gainExp`/`player:takeDamage` (the HUD's "Simulate kill" / "Take damage" buttons — placeholders
for future real mob-kill/combat logic, deliberately server-decided amounts, not client-supplied), so
those broadcast to every socket including the sender (`io.emit`, not `socket.broadcast.emit`) rather
than relying on a local prediction.

`VITE_SERVER_URL` (typed in `src/vite-env.d.ts`) overrides the server URL; defaults to
`http://localhost:3000`. Set at build time (Vite env var), not runtime — the Docker build passes it as
a build `ARG`.

### Admin dashboard (`apps/admin-dashboard/src/app/app.component.ts`)

Single root component, no routing (the scaffolded `app.routes.ts` is unused). Polls the server's
`/stats` REST endpoint every 2s via RxJS (`interval(2000).pipe(startWith(0), switchMap(...))`) rather
than subscribing to any WebSocket channel — it's read-only monitoring, not part of gameplay state sync.
Server URL is hardcoded as a local constant (`SERVER_URL` in `app.component.ts`), not environment-driven
like the game client — revisit if the dashboard needs to point at different environments.
