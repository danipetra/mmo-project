import type { CharacterSummary } from "shared";
import { pool } from "./db.js";
import { levelForExp } from "./leveling.js";

const MAX_CHARACTERS_PER_USER = 3;

export interface CharacterRow {
  id: number;
  user_id: number;
  name: string;
  exp: number;
}

interface CharacterSummaryRow {
  id: number;
  name: string;
  exp: number;
}

export class CharacterSlotLimitError extends Error {}
export class DuplicateCharacterNameError extends Error {}
export class CharacterNotFoundError extends Error {}

function toCharacterSummary(row: CharacterSummaryRow): CharacterSummary {
  return { id: row.id, name: row.name, exp: row.exp, level: levelForExp(row.exp) };
}

export async function listCharacters(userId: number): Promise<CharacterSummary[]> {
  const result = await pool.query<CharacterSummaryRow>(
    `SELECT id, name, exp FROM characters WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return result.rows.map(toCharacterSummary);
}

// A plain "COUNT(*) < 3" guard on the INSERT is not race-free under
// READ COMMITTED: two concurrent inserts can both see COUNT = 2 from their
// own snapshot and both succeed. pg_advisory_xact_lock serializes concurrent
// attempts for the same user (released automatically on COMMIT/ROLLBACK) --
// there's no natural row to `SELECT ... FOR UPDATE` since a user's *first*
// character has nothing to lock.
export async function createCharacter(userId: number, name: string): Promise<CharacterSummary> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [userId]);

    const result = await client.query<CharacterSummaryRow>(
      `INSERT INTO characters (user_id, name)
       SELECT $1, $2
       WHERE (SELECT COUNT(*) FROM characters WHERE user_id = $1) < $3
       RETURNING id, name, exp`,
      [userId, name, MAX_CHARACTERS_PER_USER],
    );

    if (result.rowCount === 0) {
      throw new CharacterSlotLimitError(
        `user ${userId} already has ${MAX_CHARACTERS_PER_USER} characters`,
      );
    }

    await client.query("COMMIT");
    return toCharacterSummary(result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      throw new DuplicateCharacterNameError(`character name "${name}" is already taken`);
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteCharacter(userId: number, characterId: number): Promise<void> {
  const result = await pool.query(
    `DELETE FROM characters WHERE id = $1 AND user_id = $2 RETURNING id`,
    [characterId, userId],
  );
  if (result.rowCount === 0) {
    throw new CharacterNotFoundError(`character ${characterId} not found for user ${userId}`);
  }
}

// Every ownership check in this feature goes through here: a single
// `WHERE id = $1 AND user_id = $2` query, never "fetch by id, then compare
// user_id in application code" (that shape is a TOCTOU/copy-paste trap once
// there are multiple call sites doing ownership checks).
export async function getOwnedCharacter(
  userId: number,
  characterId: number,
): Promise<CharacterRow | null> {
  const result = await pool.query<CharacterRow>(
    `SELECT id, user_id, name, exp FROM characters WHERE id = $1 AND user_id = $2`,
    [characterId, userId],
  );
  return result.rows[0] ?? null;
}

// Atomic write-through -- no read-modify-write race. Fine as a direct DB
// write per call since exp changes are infrequent, discrete events, not a
// hot path like position.
export async function addExp(characterId: number, amount: number): Promise<number> {
  const result = await pool.query<{ exp: number }>(
    `UPDATE characters SET exp = exp + $1 WHERE id = $2 RETURNING exp`,
    [amount, characterId],
  );
  return result.rows[0].exp;
}
