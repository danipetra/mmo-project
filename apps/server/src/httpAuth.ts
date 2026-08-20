import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyToken } from "./auth.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: number;
  }
}

// Fastify preHandlers stop the chain by sending a reply, not by calling an
// Express-style `next()` -- returning after `reply.send()` is enough,
// Fastify sees the reply has already been sent and never calls the route
// handler.
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    reply.code(401).send({ error: "unauthorized" });
    return;
  }
  request.userId = payload.sub;
}
