// src/web/server.ts
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';

// Force load the CJS module correctly
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ejsLayouts = require('express-ejs-layouts');

import { initAuth } from './auth';
import { createGame, deleteGame, getGameById, listGames, updateSettings } from '../services/game';
import { CONFIG } from '../config';
import { grantTokens, removeTokens, setTokens } from '../services/wallet';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord.js';
import { parseSettings } from '../permissions';

const app = express();
const PORT = Number(process.env.WEB_PORT ?? 3000);

// view engine
app.set('views', path.join(process.cwd(), 'src', 'web', 'views'));
app.set('view engine', 'ejs');
app.use(ejsLayouts);

// body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// auth + session handling and routes
initAuth(app);

// Middleware to ensure user is authenticated for protected routes
function ensureAuth(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).isAuthed?.()) {
    return res.redirect('/login');
  }
  next();
}

// --- Public Routes ---
app.get('/', (_req, res) => res.render('home'));
app.get('/help', (_req, res) => res.render('help'));

// --- Protected Routes ---

// Guilds list (from OAuth “guilds” scope)
app.get('/guilds', ensureAuth, (req, res) => {
  const user = (req as any).webUser!;
  // show guilds where user has MANAGE_GUILD (0x20) or ADMINISTRATOR (0x8)
  const canManage = (g: any) => (g.permissions & (0x20 | 0x8)) !== 0;
  const guilds = (user.guilds ?? []).filter(canManage);
  res.render('guilds', { guilds });
});

// Per-guild settings + games
app.get('/guild/:id', ensureAuth, async (req, res) => {
  const guildId = req.params.id!;
  // TODO: Add check to ensure user is actually in this guild and can manage it.
  const gamesRaw = listGames(guildId);
  const games = gamesRaw.map((g) => ({ ...g, settings: parseSettings(g.settingsJson) }));
  res.render('guild', { guildId, games, flash: req.query.flash ?? null });
});

// Update logChannelId
app.post('/guild/:id/settings/logChannel', ensureAuth, async (req, res) => {
  const guildId = req.params.id!;
  const { id, value } = req.body as { id: string; value: string };
  const game = getGameById(guildId, Number(id));
  if (!game) return res.status(404).render('error', { message: 'Game not found' });
  // TODO: Perm check
  const val = value?.trim().toLowerCase() === 'null' || value?.trim() === '' ? null : value.trim();
  updateSettings(guildId, game.id, { logChannelId: val });
  return res.redirect(`/guild/${guildId}?flash=Log channel updated!`);
});

// Create game
app.post('/guild/:id/game', ensureAuth, (req, res) => {
  const guildId = req.params.id!;
  const { name, desc } = req.body as { name: string; desc?: string };
  if (!name?.trim()) return res.status(400).render('error', { message: 'Name is required' });
  // TODO: Perm check
  try {
    createGame(guildId, name.trim(), desc?.trim() || undefined);
    res.redirect(`/guild/${guildId}?flash=Game created successfully!`);
  } catch (e: any) {
    res.status(400).render('error', { message: e.message || 'Failed to create game' });
  }
});

// Delete game
app.post('/guild/:id/game/:gameId/delete', ensureAuth, (req, res) => {
  const guildId = req.params.id!;
  const gameId = Number(req.params.gameId!);
  const game = getGameById(guildId, gameId);
  if (!game) return res.status(404).render('error', { message: 'Game not found' });
  // TODO: Perm check
  deleteGame(guildId, gameId);
  res.redirect(`/guild/${guildId}?flash=Game deleted successfully.`);
});

/**
 * Token actions via web:
 * - Validates user’s roles via bot REST (so web matches Discord permission model)
 * - Enforces grant/set/remove using game's configured roles
 */
app.post('/guild/:id/game/:gameId/tokens', ensureAuth, async (req, res) => {
  const guildId = req.params.id!;
  const gameId = Number(req.params.gameId!);
  const { action, userId, amount, reason } = req.body as {
    action: 'grant' | 'remove' | 'set';
    userId: string;
    amount: string;
    reason?: string;
  };

  const game = getGameById(guildId, gameId);
  if (!game) return res.status(404).render('error', { message: 'Game not found' });

  // Get member roles via bot REST
  const rest = new REST({ version: '10' }).setToken(CONFIG.token);
  let member: any;
  try {
    member = await rest.get(Routes.guildMember(guildId, (req as any).webUser.id));
  } catch {
    return res.status(403).render('error', { message: 'Bot cannot read your membership in this guild.' });
  }
  const roleIds: string[] = member.roles ?? [];
  const adminRoleIds = CONFIG.botAdminRoleIds ?? [];

  const settings = parseSettings(game.settingsJson);

  const isAdmin = adminRoleIds.some((r) => roleIds.includes(r));
  const isManager = isAdmin || settings.managerRoleIds.some((r) => roleIds.includes(r));
  const isGranter = isAdmin || isManager || settings.grantRoleIds.some((r) => roleIds.includes(r));

  const amt = Number(amount);
  if (!Number.isInteger(amt)) return res.status(400).render('error', { message: 'Amount must be an integer.' });

  try {
    if (action === 'grant') {
      if (!isGranter) throw new Error('You do not have permission to grant tokens for this game.');
      grantTokens(guildId, gameId, (req as any).webUser.id, userId, amt, reason);
    } else if (action === 'remove') {
      if (!isGranter) throw new Error('You do not have permission to remove tokens for this game.');
      removeTokens(guildId, gameId, (req as any).webUser.id, userId, amt, reason);
    } else if (action === 'set') {
      if (!isManager) throw new Error('Only game managers can set balances.');
      setTokens(guildId, gameId, (req as any).webUser.id, userId, amt, reason);
    } else {
      throw new Error('Unknown action');
    }
  } catch (e: any) {
    return res.status(400).render('error', { message: e.message || 'Failed to mutate tokens' });
  }

  res.redirect(`/guild/${guildId}?flash=Tokens updated successfully!`);
});


// errors
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[web] Unhandled error:', err);
  if (res.headersSent) {
    return;
  }
  res.status(500).render('error', { message: 'An internal error occurred.' });
});

app.listen(PORT, () => {
  console.log(`[web] Listening on http://localhost:${PORT}`);
});