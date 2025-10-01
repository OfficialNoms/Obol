import { db } from '../db';
import type { Statement } from 'better-sqlite3';

export type AuditAction = 'grant' | 'remove' | 'set';

export interface AuditFilters {
  guildId: string;
  gameId?: number;
  targetUserId?: string;
  action?: AuditAction;
}

export interface AuditRow {
  id: number;
  ts: number;
  guildId: string;
  gameId: number;
  actorUserId: string;
  targetUserId: string;
  action: AuditAction;
  amount: number;
  delta: number;
  beforeBalance: number;
  afterBalance: number;
  note: string | null;
}

export interface Page {
  items: AuditRow[];
  hasPrev: boolean;
  hasNext: boolean;
  cursor: { afterId?: number; beforeId?: number } | null;
}

type Dir = 'forward' | 'backward';

/**
 * Pagination model:
 * - We paginate by `id` (autoincrement). Newest have largest id.
 * - First page (no cursors): return newest first (DESC) with limit+1 to detect next.
 * - "Next" moves toward older (smaller ids), using beforeId (lt).
 * - "Prev" moves toward newer (larger ids), using afterId (gt).
 */
export function listTransactionsPaged(
  filters: AuditFilters,
  opts: { limit: number; direction: Dir; beforeId?: number; afterId?: number },
): Page {
  const limit = Math.max(1, Math.min(50, opts.limit));
  const where: string[] = ['guildId = ?'];
  const params: unknown[] = [filters.guildId];

  if (filters.gameId != null) {
    where.push('gameId = ?');
    params.push(filters.gameId);
  }
  if (filters.targetUserId) {
    where.push('targetUserId = ?');
    params.push(filters.targetUserId);
  }
  if (filters.action) {
    where.push('action = ?');
    params.push(filters.action);
  }

  let order = 'id DESC';
  if (opts.direction === 'forward' && opts.beforeId) {
    where.push('id < ?'); // older than beforeId
    params.push(opts.beforeId);
    order = 'id DESC';
  } else if (opts.direction === 'backward' && opts.afterId) {
    where.push('id > ?'); // newer than afterId
    params.push(opts.afterId);
    order = 'id ASC'; // we’ll flip later
  }

  const sql = `
    SELECT id, ts, guildId, gameId, actorUserId, targetUserId, action, amount, delta, beforeBalance, afterBalance, note
    FROM transactions
    WHERE ${where.join(' AND ')}
    ORDER BY ${order}
    LIMIT ?`;
  const stmt: Statement = db.prepare(sql);

  const rows = stmt.all(...params, limit + 1) as AuditRow[];

  let hasNext = false;
  let hasPrev = false;
  let items = rows;

  if (rows.length > limit) {
    hasNext = true;
    items = rows.slice(0, limit);
  }

  // If we loaded backward ASC, flip to DESC for display consistency
  if (opts.direction === 'backward') {
    items = items.reverse();
  }

  // Determine cursors
  const first = items[0];
  const last = items[items.length - 1];

  if (!first || !last) {
    return { items: [], hasPrev: !!opts.afterId, hasNext: !!opts.beforeId, cursor: null };
  }

  // If direction was forward (older), "next" continues older from last.id
  // If direction was backward (newer), "prev" continues newer from first.id
  // Also infer opposite side availability based on provided cursors.
  if (opts.direction === 'forward') {
    hasPrev = !!opts.afterId || !!(items.length && items[0].id < Number.MAX_SAFE_INTEGER); // best-effort
  } else {
    hasNext = !!opts.beforeId || hasNext;
    hasPrev = items.length > 0 ? true : !!opts.afterId;
  }

  const cursor = {
    beforeId: last?.id, // for going forward (older)
    afterId: first?.id, // for going backward (newer)
  };

  return { items, hasPrev, hasNext, cursor };
}
