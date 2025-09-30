import { db, inTx, type WalletRow } from '../db';

export function ensureWallet(guildId: string, gameId: number, userId: string): WalletRow {
  const existing = db
    .prepare(`SELECT * FROM wallets WHERE guildId = ? AND gameId = ? AND userId = ?`)
    .get(guildId, gameId, userId) as WalletRow | undefined;
  if (existing) return existing;

  const inserted = db
    .prepare(
      `INSERT INTO wallets (guildId, gameId, userId, balance) VALUES (?, ?, ?, 0) RETURNING *`,
    )
    .get(guildId, gameId, userId) as WalletRow;
  return inserted;
}

export function getBalance(guildId: string, gameId: number, userId: string): number {
  const row = db
    .prepare(`SELECT balance FROM wallets WHERE guildId = ? AND gameId = ? AND userId = ?`)
    .get(guildId, gameId, userId) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

export function setBalance(
  guildId: string,
  gameId: number,
  userId: string,
  amount: number,
): { before: number; after: number } {
  if (amount < 0) throw new Error('Balance cannot be negative');
  return inTx(() => {
    const before = getBalance(guildId, gameId, userId);
    db.prepare(
      `INSERT INTO wallets (guildId, gameId, userId, balance) VALUES (?, ?, ?, ?)
       ON CONFLICT(guildId, gameId, userId) DO UPDATE SET balance=excluded.balance`,
    ).run(guildId, gameId, userId, amount);
    return { before, after: amount };
  });
}

export function incrementBalance(
  guildId: string,
  gameId: number,
  userId: string,
  delta: number,
): { before: number; after: number } {
  return inTx(() => {
    const before = getBalance(guildId, gameId, userId);
    const after = before + delta;
    if (after < 0) throw new Error('Operation would result in negative balance');
    db.prepare(
      `INSERT INTO wallets (guildId, gameId, userId, balance) VALUES (?, ?, ?, ?)
       ON CONFLICT(guildId, gameId, userId) DO UPDATE SET balance = balance + ?`,
    ).run(guildId, gameId, userId, Math.max(0, before), delta);
    return { before, after };
  });
}

export function topBalances(guildId: string, gameId: number, limit: number): WalletRow[] {
  return db
    .prepare(
      `SELECT * FROM wallets WHERE guildId = ? AND gameId = ? ORDER BY balance DESC, userId ASC LIMIT ?`,
    )
    .all(guildId, gameId, limit) as WalletRow[];
}
