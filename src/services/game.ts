import { db, type GameRow } from '../db';

export type GameSettings = {
  grantRoleIds: string[];
  managerRoleIds: string[];
  logChannelId: string | null;
};

export function createGame(guildId: string, name: string, description?: string): GameRow {
  const stmt = db.prepare(
    `INSERT INTO games (guildId, name, description) VALUES (?, ?, ?) RETURNING *`,
  );
  return stmt.get(guildId, name, description ?? null) as GameRow;
}

export function deleteGame(guildId: string, gameId: number): void {
  db.prepare(`DELETE FROM games WHERE id = ? AND guildId = ?`).run(gameId, guildId);
}

export function listGames(guildId: string): GameRow[] {
  return db.prepare(`SELECT * FROM games WHERE guildId = ? AND isActive = 1 ORDER BY name`).all(
    guildId,
  ) as GameRow[];
}

export function getGameById(guildId: string, id: number): GameRow | undefined {
  return db.prepare(`SELECT * FROM games WHERE id = ? AND guildId = ?`).get(id, guildId) as
    | GameRow
    | undefined;
}

export function getGameByName(guildId: string, name: string): GameRow | undefined {
  return db.prepare(`SELECT * FROM games WHERE guildId = ? AND name = ?`).get(
    guildId,
    name,
  ) as GameRow | undefined;
}

/** Case-insensitive name match or numeric ID */
export function resolveGameFlexible(guildId: string, input: string): GameRow | undefined {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return getGameById(guildId, Number(trimmed));
  }
  const lower = trimmed.toLowerCase();
  const all = listGames(guildId);
  return (
    all.find((g) => g.name.toLowerCase() === lower) ||
    all.find((g) => g.name.toLowerCase().startsWith(lower)) ||
    all.find((g) => g.name.toLowerCase().includes(lower))
  );
}

export function updateSettings(
  guildId: string,
  gameId: number,
  settings: Partial<GameSettings>,
): GameRow | undefined {
  const current = getGameById(guildId, gameId);
  if (!current) return;
  const merged = { ...JSON.parse(current.settingsJson), ...settings };
  const row = db
    .prepare(`UPDATE games SET settingsJson = ? WHERE id = ? AND guildId = ? RETURNING *`)
    .get(JSON.stringify(merged), gameId, guildId) as GameRow | undefined;
  return row;
}
