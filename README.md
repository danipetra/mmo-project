# mmo-project

Monorepo (npm workspaces) with three apps sharing one backend:

- `apps/server` — Node.js, TypeScript, Fastify (REST) + Socket.io (WebSocket). In-memory player state.
- `apps/game-client` — React + Vite + react-three-fiber. Connects to the server over WebSocket, renders each connected player as a cube, arrow keys move yours.
- `apps/admin-dashboard` — Angular. Polls the server's REST `/stats` endpoint every 2s and shows players online / uptime.
- `packages/shared` — TypeScript types shared between server and game-client (WebSocket event contracts, `PlayerState`).

## Requirements

- Node.js **v24.15.0+** recommended (Angular CLI warns below that on this machine's current v24.14.0 — it still works, just noisy warnings on every `ng` command).

## Run everything locally

```
npm install
npm run dev
```

Starts all three together:

| App | URL |
|---|---|
| server (REST + WS) | http://localhost:3000 |
| game-client | http://localhost:5173 |
| admin-dashboard | http://localhost:4200 |

Or individually: `npm run dev:server`, `npm run dev:client`, `npm run dev:dashboard`.

## Next steps (not yet done)

- Persistence (DB) for anything beyond in-memory player state.
- Dockerfile + docker-compose for one-command run without installing Node/Angular CLI locally.
- Deploy: server → Render/Fly.io (needs a persistent process for WebSocket); game-client + admin-dashboard → Vercel/Netlify as static builds.
