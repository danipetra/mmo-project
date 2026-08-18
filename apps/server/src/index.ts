import cors from "@fastify/cors";
import Fastify from "fastify";
import { createServer } from "node:http";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  PlayerState,
  ServerStats,
  ServerToClientEvents,
} from "shared";

const PORT = Number(process.env.PORT ?? 3000);
const startedAt = Date.now();

const players = new Map<string, PlayerState>();

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get("/health", async () => ({ status: "ok" }));

app.get("/stats", async (): Promise<ServerStats> => ({
  playersOnline: players.size,
  uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
}));

await app.ready();

const httpServer = createServer(app.server);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  const player: PlayerState = { id: socket.id, x: 0, y: 0, z: 0 };
  players.set(socket.id, player);

  socket.emit("world:state", Array.from(players.values()));
  socket.broadcast.emit("player:joined", player);

  socket.on("player:move", ({ x, y, z }) => {
    const current = players.get(socket.id);
    if (!current) return;
    current.x = x;
    current.y = y;
    current.z = z;
    socket.broadcast.emit("world:state", Array.from(players.values()));
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    io.emit("player:left", socket.id);
  });
});

httpServer.listen(PORT, () => {
  app.log.info(`WebSocket server listening on :${PORT}`);
});
