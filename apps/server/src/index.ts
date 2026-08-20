import cors from "@fastify/cors";
import "dotenv/config";
import Fastify from "fastify";
import { DefaultEventsMap, Server } from "socket.io";
import type {
  AuthCredentials,
  AuthResponse,
  CharacterSummary,
  ClientToServerEvents,
  CreateCharacterRequest,
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
import {
  addExp,
  CharacterNotFoundError,
  CharacterSlotLimitError,
  createCharacter,
  deleteCharacter,
  DuplicateCharacterNameError,
  getOwnedCharacter,
  listCharacters,
} from "./characters.js";
import { initDb } from "./db.js";
import { requireAuth } from "./httpAuth.js";
import { hpAfterLevelUp, levelForExp, maxHpForLevel } from "./leveling.js";

interface SocketData {
  userId: number;
  characterId: number;
  characterName: string;
  exp: number;
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

const characterNameSchema = {
  body: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 3, maxLength: 20, pattern: "^[A-Za-z0-9 _-]+$" },
    },
  },
};

app.get("/characters", { preHandler: requireAuth }, async (request): Promise<CharacterSummary[]> => {
  return listCharacters(request.userId!);
});

app.post<{ Body: CreateCharacterRequest }>(
  "/characters",
  { schema: characterNameSchema, preHandler: requireAuth },
  async (request, reply) => {
    try {
      return await createCharacter(request.userId!, request.body.name);
    } catch (err) {
      if (err instanceof CharacterSlotLimitError) {
        return reply.code(409).send({ error: "you already have the maximum of 3 characters" });
      }
      if (err instanceof DuplicateCharacterNameError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  },
);

app.delete<{ Params: { id: string } }>(
  "/characters/:id",
  { preHandler: requireAuth },
  async (request, reply) => {
    const characterId = Number(request.params.id);
    if (!Number.isInteger(characterId)) {
      return reply.code(400).send({ error: "invalid character id" });
    }
    try {
      await deleteCharacter(request.userId!, characterId);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof CharacterNotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }
  },
);

await app.ready();

const io = new Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>(
  app.server,
  { cors: { origin: "*" } },
);

io.use(async (socket, next) => {
  const { token, characterId } = socket.handshake.auth ?? {};
  const payload = typeof token === "string" ? verifyToken(token) : null;
  if (!payload) {
    next(new Error("unauthorized"));
    return;
  }

  const numericCharacterId = Number(characterId);
  if (!Number.isInteger(numericCharacterId)) {
    next(new Error("character not found"));
    return;
  }

  try {
    const character = await getOwnedCharacter(payload.sub, numericCharacterId);
    if (!character) {
      next(new Error("character not found"));
      return;
    }
    socket.data.userId = payload.sub;
    socket.data.characterId = character.id;
    socket.data.characterName = character.name;
    socket.data.exp = character.exp;
    next();
  } catch {
    next(new Error("server error"));
  }
});

io.on("connection", (socket) => {
  const level = levelForExp(socket.data.exp);
  const maxHp = maxHpForLevel(level);
  const player: PlayerState = {
    id: socket.id,
    characterName: socket.data.characterName,
    exp: socket.data.exp,
    level,
    hp: maxHp,
    maxHp,
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

  // Placeholder for a future real mob-kill calculation. Deliberately a
  // fixed, server-decided amount rather than client-supplied -- exp must
  // always be server-authoritative or it's trivially cheatable once real
  // gameplay exists. Persists via an atomic UPDATE (the durable half of the
  // durable/ephemeral split).
  socket.on("player:gainExp", async () => {
    const current = players.get(socket.id);
    if (!current) return;
    const GAIN_AMOUNT = 10;
    const newExp = await addExp(socket.data.characterId, GAIN_AMOUNT);
    const newLevel = levelForExp(newExp);
    current.exp = newExp;
    if (newLevel > current.level) {
      current.maxHp = maxHpForLevel(newLevel);
      current.hp = hpAfterLevelUp(newLevel);
    }
    current.level = newLevel;
    io.emit("world:state", Array.from(players.values()));
  });

  // Placeholder for future real combat. In-memory only, never written to
  // the DB -- the ephemeral half of the durable/ephemeral split: exp
  // survives a reconnect/restart, HP does not.
  socket.on("player:takeDamage", () => {
    const current = players.get(socket.id);
    if (!current) return;
    const DAMAGE_AMOUNT = 10;
    current.hp = Math.max(0, current.hp - DAMAGE_AMOUNT);
    io.emit("world:state", Array.from(players.values()));
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    io.emit("player:left", socket.id);
  });
});

await app.listen({ port: PORT, host: "0.0.0.0" });
app.log.info(`WebSocket server listening on :${PORT}`);
