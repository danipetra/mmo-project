import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
const TOKEN_EXPIRY = "7d";

export interface AuthUser {
  id: number;
  username: string;
}

export interface AuthTokenPayload {
  sub: number;
  username: string;
}

export class DuplicateUsernameError extends Error {}

export async function registerUser(username: string, password: string): Promise<AuthUser> {
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const result = await pool.query<{ id: number; username: string }>(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username`,
      [username, passwordHash],
    );
    return result.rows[0];
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      throw new DuplicateUsernameError(`username "${username}" is already taken`);
    }
    throw err;
  }
}

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<AuthUser | null> {
  const result = await pool.query<{ id: number; username: string; password_hash: string }>(
    `SELECT id, username, password_hash FROM users WHERE username = $1`,
    [username],
  );
  const user = result.rows[0];
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.password_hash);
  return valid ? { id: user.id, username: user.username } : null;
}

export function signToken(user: AuthUser): string {
  const payload: AuthTokenPayload = { sub: user.id, username: user.username };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as unknown as AuthTokenPayload;
  } catch {
    return null;
  }
}
