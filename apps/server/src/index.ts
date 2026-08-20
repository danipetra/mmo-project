import cors from "@fastify/cors";
import "dotenv/config";
import Fastify from "fastify";
import { DefaultEventsMap, Server } from "socket.io";
import type {
  AuthCredentials,
  AuthResponse,
  ClientToServerEvents,
  PlayerState,
  ServerStats,
  ServerToClientEvents,
} from "shared";
import {
  DuplicateUsernameError,
  registerUser,
  signToken,
  verifyCredentials,
  verifyToken,
} from "./auth.js";
import { initDb } from "./db.js";

interface SocketData {
  username: string;
}

const PORT = Number(process.env.PORT ?? 3000);
const startedAt = Date.now();

const players = new Map<string, PlayerState>();

await initDb();

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get("/health", async () => ({ status: "ok" }));

app.get("/stats", async (): Promise<ServerStats> => ({
  playersOnline: players.size,
  uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
}));

const credentialsSchema = {
  body: {
    type: "object",
    required: ["username", "password"],
    properties: {
      username: { type: "string", minLength: 3, maxLength: 32 },
      password: { type: "string", minLength: 8 },
    },
  },
};

app.post<{ Body: AuthCredentials }>(
  "/auth/register",
  { schema: credentialsSchema },
  async (request, reply) => {
    const { username, password } = request.body;
    try {
      const user = await registerUser(username, password);
      const response: AuthResponse = { token: signToken(user), username: user.username };
      return response;
    } catch (err) {
      if (err instanceof DuplicateUsernameError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  },
);

app.post<{ Body: AuthCredentials }>(
  "/auth/login",
  { schema: credentialsSchema },
  async (request, reply) => {
    const { username, password } = request.body;
    const user = await verifyCredentials(username, password);
    if (!user) {
      return reply.code(401).send({ error: "invalid username or password" });
    }
    const response: AuthResponse = { token: signToken(user), username: user.username };
    return response;
  },
);

await app.ready();

const io = new Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>(
  app.server,
  { cors: { origin: "*" } },
);

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const payload = typeof token === "string" ? verifyToken(token) : null;
  if (!payload) {
    next(new Error("unauthorized"));
    return;
  }
  socket.data.username = payload.username;
  next();
});

io.on("connection", (socket) => {
  const player: PlayerState = {
    id: socket.id,
    username: socket.data.username,
    x: 0,
    y: 0,
    z: 0,
  };
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

await app.listen({ port: PORT, host: "0.0.0.0" });
app.log.info(`WebSocket server listening on :${PORT}`);
