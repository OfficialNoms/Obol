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

// legacy helpers (still used elsewhere)
export function setBalance(
  guildId: string,
  gameId: number,
  userId: string,
  amount: number,
): { before: number; after: number } {
  if (amount < 0) throw new Error('Balance cannot be negative');
  return inTx(() => {
    ensureWallet(guildId, gameId, userId);
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
    ensureWallet(guildId, gameId, userId);
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

// NEW: list a user's balances only where balance > 0
export type UserGameBalance = { gameId: number; gameName: string; balance: number };
export function listUserBalances(guildId: string, userId: string): UserGameBalance[] {
  return db
    .prepare(
      `
      SELECT w.gameId as gameId, g.name as gameName, w.balance as balance
      FROM wallets w
      JOIN games g ON g.id = w.gameId
      WHERE w.guildId = ? AND w.userId = ? AND w.balance > 0 AND g.isActive = 1
      ORDER BY g.name
      `,
    )
    .all(guildId, userId) as UserGameBalance[];
}

/* ------------------------------
 * Atomic mutations + audit log
 * ------------------------------ */

type TxAction = 'grant' | 'remove' | 'set';

function insertTx(args: {
  guildId: string;
  gameId: number;
  actorUserId: string;
  targetUserId: string;
  action: TxAction;
  amount: number;
  delta: number;
  before: number;
  after: number;
  reason?: string;
}) {
  db.prepare(
    `INSERT INTO transactions
     (guildId, gameId, actorUserId, targetUserId, action, amount, delta, before, after, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    args.guildId,
    args.gameId,
    args.actorUserId,
    args.targetUserId,
    args.action,
    args.amount,
    args.delta,
    args.before,
    args.after,
    args.reason ?? null,
  );
}

export function grantTokens(
  guildId: string,
  gameId: number,
  actorUserId: string,
  targetUserId: string,
  amount: number,
  reason?: string,
): { before: number; after: number } {
  if (amount < 0) throw new Error('Amount must be >= 0');
  return inTx(() => {
    ensureWallet(guildId, gameId, targetUserId);
    const before = getBalance(guildId, gameId, targetUserId);
    const after = before + amount;
    db.prepare(
      `INSERT INTO wallets (guildId, gameId, userId, balance) VALUES (?, ?, ?, ?)
       ON CONFLICT(guildId, gameId, userId) DO UPDATE SET balance = balance + ?`,
    ).run(guildId, gameId, targetUserId, Math.max(0, before), amount);
    insertTx({ guildId, gameId, actorUserId, targetUserId, action: 'grant', amount, delta: amount, before, after, reason });
    return { before, after };
  });
}

export function removeTokens(
  guildId: string,
  gameId: number,
  actorUserId: string,
  targetUserId: string,
  amount: number,
  reason?: string,
): { before: number; after: number } {
  if (amount < 0) throw new Error('Amount must be >= 0');
  return inTx(() => {
    ensureWallet(guildId, gameId, targetUserId);
    const before = getBalance(guildId, gameId, targetUserId);
    const after = before - amount;
    if (after < 0) throw new Error('Operation would result in negative balance');
    db.prepare(
      `INSERT INTO wallets (guildId, gameId, userId, balance) VALUES (?, ?, ?, ?)
       ON CONFLICT(guildId, gameId, userId) DO UPDATE SET balance = balance - ?`,
    ).run(guildId, gameId, targetUserId, Math.max(0, before), amount);
    insertTx({ guildId, gameId, actorUserId, targetUserId, action: 'remove', amount, delta: -amount, before, after, reason });
    return { before, after };
  });
}

export function setTokens(
  guildId: string,
  gameId: number,
  actorUserId: string,
  targetUserId: string,
  newAmount: number,
  reason?: string,
): { before: number; after: number } {
  if (newAmount < 0) throw new Error('Balance cannot be negative');
  return inTx(() => {
    ensureWallet(guildId, gameId, targetUserId);
    const before = getBalance(guildId, gameId, targetUserId);
    db.prepare(
      `INSERT INTO wallets (guildId, gameId, userId, balance) VALUES (?, ?, ?, ?)
       ON CONFLICT(guildId, gameId, userId) DO UPDATE SET balance=excluded.balance`,
    ).run(guildId, gameId, targetUserId, newAmount);
    const after = newAmount;
    const delta = after - before;
    insertTx({ guildId, gameId, actorUserId, targetUserId, action: 'set', amount: newAmount, delta, before, after, reason });
    return { before, after };
  });
}
