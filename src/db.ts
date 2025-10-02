// src/db.ts
import Database from 'better-sqlite3';
import { CONFIG } from './config';
import fs from 'node:fs';
import path from 'node:path';

export type GameRow = {
  id: number;
  guildId: string;
  name: string;
  description: string | null;
  settingsJson: string;
  isActive: number;
};

export type WalletRow = {
  id: number;
  guildId: string;
  gameId: number;
  userId: string;
  balance: number;
};

export type GuildConfigRow = {
  guildId: string;
  manager_role_ids: string; // JSON array
};

const dbDir = path.dirname(CONFIG.databasePath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

export const db = new Database(CONFIG.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY,
    guildId TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    settingsJson TEXT NOT NULL DEFAULT '{"grantRoleIds":[],"managerRoleIds":[],"logChannelId":null}',
    isActive INTEGER NOT NULL DEFAULT 1,
    UNIQUE (guildId, name)
  );

  CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY,
    guildId TEXT NOT NULL,
    gameId INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    userId TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    UNIQUE (guildId, gameId, userId)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    guildId TEXT NOT NULL,
    gameId INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    actorUserId TEXT NOT NULL,
    targetUserId TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('grant','remove','set')),
    amount INTEGER NOT NULL,
    delta  INTEGER NOT NULL,
    before INTEGER NOT NULL,
    after  INTEGER NOT NULL,
    reason TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tx_game_ts   ON transactions (guildId, gameId, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_tx_target_ts ON transactions (guildId, targetUserId, ts DESC);

  CREATE TABLE IF NOT EXISTS guild_config (
    guildId TEXT PRIMARY KEY,
    manager_role_ids TEXT NOT NULL DEFAULT '[]'
  );
`);

export function inTx<T>(fn: () => T): T {
  const tx = db.transaction(fn);
  return tx();
}

// --- Guild Config Helpers ---
export function getGuildConfig(guildId: string): { managerRoleIds: string[] } {
  const row = db.prepare(`SELECT manager_role_ids FROM guild_config WHERE guildId = ?`).get(guildId) as { manager_role_ids: string } | undefined;
  if (!row) return { managerRoleIds: [] };
  try {
    return { managerRoleIds: JSON.parse(row.manager_role_ids) };
  } catch {
    return { managerRoleIds: [] };
  }
}

export function setGuildConfig(guildId: string, settings: { managerRoleIds: string[] }): void {
  db.prepare(
    `INSERT INTO guild_config (guildId, manager_role_ids) VALUES (?, ?)
     ON CONFLICT(guildId) DO UPDATE SET manager_role_ids = excluded.manager_role_ids`
  ).run(guildId, JSON.stringify(settings.managerRoleIds));
}