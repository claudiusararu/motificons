/**
 * D1 schema (Drizzle, sqlite dialect).
 *
 * Two halves living in one file because they are one database:
 *
 *   1. Better Auth's own tables (user/session/account/verification) - field
 *      names and nullability copied from `@better-auth/core`'s schema
 *      (`db/schema/{user,session,account,verification}.d.mts`), not
 *      generated, because this project hand-rolls the adapter wiring rather
 *      than running the `auth generate` CLI. Column names match the JS field
 *      names exactly (no camelCase/snake_case remapping), which is what lets
 *      `drizzleAdapter` bind to them with zero `fieldName` overrides.
 *
 *   2. The workspace-centric domain schema: every user gets a personal
 *      workspace; collections and API keys hang off the workspace, never the
 *      user, so a solo account and a team account are the same shape from
 *      day one - team-ready by construction.
 *
 * Run `pnpm db:generate` after any change here to emit a migration, then
 * `pnpm db:migrate` to apply it to the local D1.
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/* ---------------------------------------------------------------------- *
 * Better Auth core tables
 * ---------------------------------------------------------------------- */

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /* The id the provider knows this account by (OAuth sub, or the user's own
     id again for the credential/magic-link "provider"). */
  accountId: text("accountId").notNull(),
  /** "google" | "github" | "apple" | "credential" | "magic-link"... */
  providerId: text("providerId").notNull(),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  /** Only set for email+password, which this app does not offer - kept for
      schema completeness since Better Auth's adapter expects the column. */
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  /** The magic-link email, for that plugin's use of this table. */
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

/** Passed to `drizzleAdapter(db, { schema: authSchema, ... })` as-is. */
export const authSchema = { user, session, account, verification };

/* ---------------------------------------------------------------------- *
 * Domain schema - workspace-centric
 * ---------------------------------------------------------------------- */

/**
 * Every user gets exactly one `personal: true` workspace, created in the
 * `user.create.after` database hook (see lib/auth/auth.ts). Shared
 * workspaces (`personal: false`) do not exist yet; the column and the
 * `membership` table below are here so adding them stays additive.
 */
export const workspace = sqliteTable("workspace", {
  id: text("id").primaryKey(),
  personal: integer("personal", { mode: "boolean" }).notNull().default(false),
  name: text("name").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
});

export const membershipRoles = ["owner", "member"] as const;
export type MembershipRole = (typeof membershipRoles)[number];

/** One row per (user, workspace). A personal workspace has exactly one
    membership: its creator, as "owner". */
export const membership = sqliteTable("membership", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  workspaceId: text("workspaceId")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  role: text("role", { enum: membershipRoles }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
});

export const inviteStatuses = ["pending", "accepted", "revoked"] as const;
export type InviteStatus = (typeof inviteStatuses)[number];

/** Email invites into a (necessarily team) workspace. Not exercised by any
    UI yet - the table exists now so the schema is complete and a later
    change never has to migrate existing workspaces. */
export const invite = sqliteTable("invite", {
  id: text("id").primaryKey(),
  workspaceId: text("workspaceId")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  status: text("status", { enum: inviteStatuses }).notNull().default("pending"),
  invitedByUserId: text("invitedByUserId").references(() => user.id),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
});

export const platforms = ["web", "ios", "android"] as const;
export type Platform = (typeof platforms)[number];

/**
 * DEAD, kept for migration safety only. The project/collection split was
 * dropped: collections are now the only user-facing entity, and no app code
 * reads or writes this table or `styleProfile` below. Both tables were
 * empty in every environment when that changed, so the safest migration is
 * additive-only (add
 * `collection.styleSettings` below, touch nothing else) rather than a
 * destructive DROP TABLE against a schema drizzle-kit would otherwise want to
 * emit if these definitions were deleted outright. A later cleanup migration
 * may drop both tables once the additive migration has run in prod at least
 * once.
 */
export const project = sqliteTable("project", {
  id: text("id").primaryKey(),
  workspaceId: text("workspaceId")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  platform: text("platform", { enum: platforms }).notNull().default("web"),
  /** e.g. "svg" | "jsx" | "tsx" | "swiftui" - free text, the export layer
      owns the valid set, not the schema. */
  defaultExportFormat: text("defaultExportFormat").notNull().default("svg"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
});

/**
 * SCHEMA DEVIATION: `projectId` was NOT NULL and `workspaceId` did not
 * exist originally - see git history for that reasoning. It is moot now: the
 * architecture reset removed projects entirely, so `projectId` is DEAD
 * (always null going forward, kept only because dropping it is a
 * non-additive migration - see the `project` table's own comment above) and
 * every collection is a workspace-level, standalone entity (`workspaceId`
 * always set).
 *
 * `styleSettings` (added in the same reset, additive migration 0002): the
 * collection's own normalization target - visual anchor icon (one of the
 * collection's own icons, never a
 * paste field), size, color, stroke width, export format. Shape owned by
 * lib/workspace/collection-style.ts, not this schema file - same "JSON
 * column, typed loosely here, validated at the call site" pattern the old
 * `styleProfile` table used.
 */
export const collection = sqliteTable(
  "collection",
  {
    id: text("id").primaryKey(),
    projectId: text("projectId").references(() => project.id, {
      onDelete: "cascade",
    }),
    workspaceId: text("workspaceId").references(() => workspace.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    styleSettings: text("styleSettings", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  /* listCollections (lib/workspace/collections.ts) and dashboard.astro both
     look up a workspace's collections by this column, so it is indexed.
     Additive-only migration (CREATE INDEX, no table rewrite). */
  (t) => [index("collection_workspaceId_idx").on(t.workspaceId)],
);

export const collectionItem = sqliteTable(
  "collectionItem",
  {
    id: text("id").primaryKey(),
    collectionId: text("collectionId")
      .notNull()
      .references(() => collection.id, { onDelete: "cascade" }),
    /** "{prefix}:{name}", the same id shape used everywhere else in the app. */
    iconId: text("iconId").notNull(),
    sort: integer("sort").notNull().default(0),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    /* Every icon in a collection (collection detail page, export, item
       count) and every "is this icon already saved" check both filter by
       collectionId - the single most common query against this table. */
    index("collectionItem_collectionId_idx").on(t.collectionId),
    /* Non-unique on purpose - covers the
       collectionId+iconId pair lookup (toggle-save's "is this icon already
       in this collection") without asserting a uniqueness constraint the
       schema doesn't otherwise have. */
    index("collectionItem_collection_icon_idx").on(t.collectionId, t.iconId),
    index("collectionItem_iconId_idx").on(t.iconId),
  ],
);

/**
 * DEAD - see the `project` table's comment above. Superseded by
 * `collection.styleSettings`. Kept only so the migration stays additive.
 */
export const styleProfile = sqliteTable("styleProfile", {
  id: text("id").primaryKey(),
  projectId: text("projectId")
    .notNull()
    .unique()
    .references(() => project.id, { onDelete: "cascade" }),
  /** Icon ids ("prefix:name") the profile is derived from - 1 to start, 3-5
      once the UX grows past a single anchor, or a sentinel for
      whole-family mode (shape owned by the style-engine chunk). */
  referenceIcons: text("referenceIcons", { mode: "json" })
    .notNull()
    .$type<string[]>(),
  /** Computed fingerprint: stroke width, optical bounds, palette, etc. Null
      until the style engine (a later chunk) computes it. */
  computedTargets: text("computedTargets", { mode: "json" }).$type<
    Record<string, unknown>
  >(),
  /** User fine-tuning on top of the computed profile. */
  manualOverrides: text("manualOverrides", { mode: "json" }).$type<
    Record<string, unknown>
  >(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

/**
 * MCP API keys. Scoped to one workspace at a time (project-scoped access
 * starts from a workspace-scoped key), never shared across members - each
 * member mints their own. One active (non-revoked) key per user, enforced in
 * lib/workspace/api-keys.ts + the api/keys/* routes, not by a DB constraint -
 * the table shape allows a user's history of revoked keys to stay around for
 * audit, which a unique-per-user index would forbid.
 *
 * `keyPrefix` added in migration 0003 (additive, no backfill needed): the display/
 * identification slice ("mk_" + 8 hex chars) shown next to a key's created
 * date on the dashboard, so a user can recognize which key is active without
 * the plaintext ever being stored anywhere past the moment it is created.
 * Generation/hashing lives in lib/workspace/api-keys.ts.
 */
export const mcpKey = sqliteTable("mcpKey", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  workspaceId: text("workspaceId")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  /** "mk_" + first 8 hex chars of the plaintext - safe to store and display,
      never enough to reconstruct the key. */
  keyPrefix: text("keyPrefix").notNull(),
  /** Only the hash is stored; the raw key is shown once at creation. */
  keyHash: text("keyHash").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  revokedAt: integer("revokedAt", { mode: "timestamp" }),
});
