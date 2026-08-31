/**
 * MCP API keys - the credential the MCP server validates. A key belongs to
 * an account. Key model:
 *
 *   1. Generate a random plaintext key ("mk_" + 64 hex chars).
 *   2. Hash it (SHA-256) - only the hash is ever written to the database.
 *   3. Return the plaintext to the caller exactly once, at creation. Nothing
 *      after that response can recover it - not even this module, which
 *      never stores it anywhere.
 *   4. Keep a short, non-secret "display prefix" ("mk_" + first 8 hex chars)
 *      alongside the hash, so the dashboard can show the user *something*
 *      that identifies their key without touching the secret.
 *
 * Generation/hashing are pure (no I/O), so they are unit-tested directly -
 * see api-keys.test.ts. The DB half below follows the same
 * check-then-write split every other lib/workspace/* module uses: this file
 * does not itself enforce "one active key per user" - the
 * api/keys/* routes check `getActiveApiKey` before calling `createApiKey`,
 * the same way api/collections/index.ts checks `countCollections` before
 * `createCollection`.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/client";
import { mcpKey } from "../../db/schema";

/** Every plaintext key starts with this - doubles as a cheap format sniff
    (e.g. the future MCP server can reject anything not shaped like a key
    before it ever touches the database). */
export const API_KEY_PREFIX = "mk_";

/** Random half of the plaintext key, in bytes before hex encoding - 32
    bytes/64 hex chars, comfortably beyond brute-force range for a bearer
    credential. */
const SECRET_BYTES = 32;

/** How many hex chars of the random half survive into the display prefix
    (task: "a key prefix like 'mk_' + first 8 chars stored separately for
    display/identification"). */
const DISPLAY_CHARS = 8;

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A fresh plaintext API key. Callers show this to the user exactly once and
    then discard it - only `hashApiKey`'s output and `deriveKeyDisplayPrefix`'s
    output get persisted. */
export function generateApiKeyPlaintext(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
  return `${API_KEY_PREFIX}${toHex(bytes)}`;
}

/** The short, storable, non-secret slice used to identify a key without its
    plaintext, e.g. "mk_a1b2c3d4". Deterministic: the same plaintext always
    yields the same prefix, since it is just a substring. */
export function deriveKeyDisplayPrefix(plaintext: string): string {
  return plaintext.slice(0, API_KEY_PREFIX.length + DISPLAY_CHARS);
}

/** SHA-256 of the plaintext, hex-encoded - the only form of the key that
    ever reaches the database (schema.ts's `mcpKey.keyHash`). Same
    digest-then-hex pattern as lib/search/meter-kv.ts's `identityHash`. */
export async function hashApiKey(plaintext: string): Promise<string> {
  const data = new TextEncoder().encode(plaintext);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

export interface ApiKeyDTO {
  id: string;
  keyPrefix: string;
  createdAt: string;
}

function toDTO(row: { id: string; keyPrefix: string; createdAt: Date }): ApiKeyDTO {
  return { id: row.id, keyPrefix: row.keyPrefix, createdAt: row.createdAt.toISOString() };
}

/** The caller's one active (non-revoked) key, or `null` if they have never
    created one or their only key is revoked. Never returns the hash -
    `ApiKeyDTO` has no field for it. `orderBy(desc(createdAt))` is defensive:
    v1 only ever has zero or one active row per user, but this keeps the
    query correct if that invariant is ever relaxed. */
export async function getActiveApiKey(database: Database, userId: string): Promise<ApiKeyDTO | null> {
  const rows = await database
    .select()
    .from(mcpKey)
    .where(and(eq(mcpKey.userId, userId), isNull(mcpKey.revokedAt)))
    .orderBy(desc(mcpKey.createdAt))
    .limit(1);
  const row = rows[0];
  return row ? toDTO(row) : null;
}

/**
 * Creates a new key row and returns both the DTO (safe to send back
 * verbatim, e.g. as JSON) and the one-time plaintext. Does not check for an
 * existing active key - see the module docstring; the "one active key per
 * user" rule is enforced by the caller (api/keys/index.ts's POST checks
 * `getActiveApiKey` first and rejects with 409 rather than silently minting
 * a second one).
 */
export async function createApiKey(
  database: Database,
  userId: string,
  workspaceId: string,
): Promise<{ key: ApiKeyDTO; plaintext: string }> {
  const plaintext = generateApiKeyPlaintext();
  const keyPrefix = deriveKeyDisplayPrefix(plaintext);
  const keyHash = await hashApiKey(plaintext);
  const now = new Date();
  const id = crypto.randomUUID();

  await database.insert(mcpKey).values({ id, userId, workspaceId, keyPrefix, keyHash, createdAt: now });

  return { key: toDTO({ id, keyPrefix, createdAt: now }), plaintext };
}

/** Soft-revokes the caller's own active key (sets `revokedAt`, never
    deletes the row - keeps a history for audit). `false` if they had no
    active key to revoke, which the route reads as 404, the same convention
    `deleteCollection` uses for "nothing to act on". */
export async function revokeApiKey(database: Database, userId: string): Promise<boolean> {
  const rows = await database
    .update(mcpKey)
    .set({ revokedAt: new Date() })
    .where(and(eq(mcpKey.userId, userId), isNull(mcpKey.revokedAt)))
    .returning({ id: mcpKey.id });
  return rows.length > 0;
}
