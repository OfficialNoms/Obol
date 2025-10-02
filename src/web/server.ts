// src/web/server.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client, GuildMember } from 'discord.js';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import cookieParser from 'cookie-parser';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import passport from 'passport';
import { Strategy as DiscordStrategy, type Profile } from 'passport-discord';
import rateLimit from 'express-rate-limit';
import csrf from 'tiny-csrf';

import { CONFIG } from '../config';
import { createGame, deleteGame, getGameById, listGames, updateSettings } from '../services/game';
import {
  grantTokens,
  removeTokens,
  setTokens,
  listAllWalletsForGuild,
} from '../services/wallet';
import { isBotAdmin, isBotManager, isGameManager, isGranter } from '../permissions';
import { postLog } from '../services/logging';
import { auditLogEmbed } from '../ui/embeds';
import { getGuildConfig, setGuildConfig } from '../db';
import pkg from '../../package.json' with { type: 'json' };

// --- Types ---
type OAuthUser = {
  id: string;
  username: string;
  avatar?: string | null;
  guilds: { id: string; name: string; icon: string | null; permissions: number }[];
};

declare global {
  namespace Express {
    interface User extends OAuthUser {}
  }
}

// --- Middleware ---
function canManageGuild(permBits: number): boolean {
  return (
    (BigInt(permBits) & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator ||
    (BigInt(permBits) & PermissionFlagsBits.ManageGuild) === PermissionFlagsBits.ManageGuild
  );
}

function ensureAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.isAuthenticated()) return next();
  res.redirect('/');
}

// --- Main Server Function ---
export function startWebServer(client: Client) {
  const app = express();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  // --- Passport & Session Setup ---
  passport.serializeUser((user, done) => done(null, user as any));
  passport.deserializeUser((user: any, done) => done(null, user));
  passport.use(
    new DiscordStrategy(
      {
        clientID: CONFIG.oauthClientId,
        clientSecret: CONFIG.oauthClientSecret,
        callbackURL: CONFIG.oauthCallbackUrl,
        scope: ['identify', 'guilds'],
      },
      (_accessToken, _refreshToken, profile: Profile, done) => {
        const user: OAuthUser = {
          id: profile.id,
          username: profile.username,
          avatar: profile.avatar,
          guilds:
            (profile.guilds || []).map((g) => ({
              id: g.id,
              name: g.name,
              icon: g.icon,
              permissions: Number(g.permissions || 0),
            })) ?? [],
        };
        return done(null, user);
      },
    ),
  );

  // --- Express App Setup ---
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          'img-src': ["'self'", 'https://cdn.discordapp.com'],
        },
      },
    }),
  );
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'web', 'views'));
  app.set('trust proxy', 1);
  app.use(express.static(path.resolve(process.cwd(), 'public')));
  app.use(
    session({
      secret: CONFIG.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: CONFIG.baseUrl.startsWith('https://'),
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser(CONFIG.sessionSecret));
  app.use(csrf(CONFIG.sessionSecret, ['POST']));
  app.use(passport.initialize());
  app.use(passport.session());

  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
  app.use(limiter);

  // Middleware to pass global variables to all views
  app.use((req: any, res, next) => {
    res.locals.user = req.user || null;
    res.locals.pkg = pkg;
    next();
  });

  // --- Routes ---
  app.get('/', (req, res) => {
    if (req.isAuthenticated()) return res.redirect('/dashboard');
    res.render('landing');
  });

  app.get('/privacy', (req, res) => res.render('privacy'));
  app.get('/terms', (req, res) => res.render('terms'));
  app.get('/help', (req, res) => res.render('help'));

  app.get('/login', passport.authenticate('discord'));
  app.get(
    new URL(CONFIG.oauthCallbackUrl).pathname,
    passport.authenticate('discord', { failureRedirect: '/' }),
    (_req, res) => res.redirect('/dashboard'),
  );
  app.get('/logout', (req, res) => req.logout(() => res.redirect('/')));

  app.get('/invite-setup', ensureAuth, (req, res) => {
    const permissions = (
      PermissionFlagsBits.SendMessages |
      PermissionFlagsBits.EmbedLinks |
      PermissionFlagsBits.ViewChannel |
      PermissionFlagsBits.UseApplicationCommands
    ).toString();
    res.render('invite-setup', { clientId: CONFIG.oauthClientId, permissions });
  });

  app.get('/dashboard', ensureAuth, (req, res) => {
    const u = req.user as OAuthUser;
    const manageable = (u.guilds || [])
      .filter((g) => canManageGuild(g.permissions))
      .filter((g) => client.guilds.cache.has(g.id));
    res.render('dashboard', { guilds: manageable });
  });

  app.get('/guild/:guildId', ensureAuth, async (req, res) => {
    const { guildId } = req.params;
    if (!guildId) return res.status(400).render('error', { error: 'Guild ID is missing.' });

    const u = req.user as OAuthUser;

    if (!client.guilds.cache.has(guildId)) {
      return res.status(403).render('error', { error: 'Access Denied. The bot is not in this server.' });
    }

    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(u.id).catch(() => null);

    if (!member) {
      return res.status(403).render('error', { error: 'Could not verify your membership in this server.' });
    }
    
    const gAuth = u.guilds.find((g) => g.id === guildId);
    const hasGuildAdminPerms = gAuth ? canManageGuild(gAuth.permissions) : false;
    const isManager = isBotManager(member);

    if (!hasGuildAdminPerms && !isManager) {
      return res
        .status(403)
        .render('error', {
          error:
            'Access Denied. You must have "Manage Server" permissions or a configured Bot Manager role to access this page.',
        });
    }
    
    const roles = (await guild.roles.fetch()).map((r) => ({ id: r.id, name: r.name }));
    const channels = (await guild.channels.fetch())
      .filter((c) => c?.type === ChannelType.GuildText)
      .map((c) => ({ id: c!.id, name: c!.name }));
    const guildConfig = getGuildConfig(guildId);
    const games = listGames(guildId);

    const allWallets = listAllWalletsForGuild(guildId);
    const userIds = [...new Set(allWallets.map((w) => w.userId))];
    const members = userIds.length > 0 ? await guild.members.fetch({ user: userIds }) : new Map();
    
    const memberMap = new Map(Array.from(members.values()).map((m: GuildMember) => [m.id, m.displayName]));

    const walletsByGame = allWallets.reduce(
      (acc, wallet) => {
        const gameName = wallet.gameName;
        if (!acc[gameName]) {
          acc[gameName] = [];
        }
        acc[gameName].push({
          ...wallet,
          userName: memberMap.get(wallet.userId) ?? 'Unknown User',
        });
        return acc;
      },
      {} as Record<string, { userId: string; userName: string; balance: number }[]>,
    );

    res.render('guild', {
      guild,
      games,
      roles,
      channels,
      guildConfig,
      walletsByGame,
      hasGuildAdminPerms,
      csrfToken: req.csrfToken(),
    });
  });

  // --- Form Actions ---
  app.post('/guild/:guildId/config', ensureAuth, async (req, res) => {
    const { guildId } = req.params;
    if (!guildId) return res.status(400).render('error', { error: 'Guild ID is missing.' });
    
    const member = await client.guilds.fetch(guildId).then((g) => g.members.fetch(req.user!.id));
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return res.status(403).render('error', { error: 'You must have "Manage Server" permissions.' });
    }

    const { manager_role_ids } = req.body;
    setGuildConfig(guildId, {
      managerRoleIds: Array.isArray(manager_role_ids)
        ? manager_role_ids
        : manager_role_ids
        ? [manager_role_ids]
        : [],
    });
    res.redirect(`/guild/${guildId}`);
  });

  app.post('/guild/:guildId/games/create', ensureAuth, async (req, res) => {
    const { guildId } = req.params;
    if (!guildId) return res.status(400).render('error', { error: 'Guild ID is missing.' });
    
    const member = await client.guilds.fetch(guildId).then((g) => g.members.fetch(req.user!.id));
    if (!isBotAdmin(member, CONFIG.botAdminRoleIds) && !isBotManager(member)) {
        return res.status(403).render('error', { error: 'You must be a Bot Admin or Manager to create games.' });
    }

    const { name, description } = req.body;
    if (name) createGame(guildId, name, description);
    res.redirect(`/guild/${guildId}`);
  });
  
  app.post('/guild/:guildId/games/:gameId/delete', ensureAuth, async (req, res) => {
    const { guildId, gameId } = req.params;
    if (!guildId) return res.status(400).render('error', { error: 'Guild ID is missing.' });

    const member = await client.guilds.fetch(guildId).then((g) => g.members.fetch(req.user!.id));
    if (!isBotAdmin(member, CONFIG.botAdminRoleIds) && !isBotManager(member)) {
        return res
        .status(403)
        .render('error', { error: 'You must be a Bot Admin or Manager to delete games.' });
    }
    deleteGame(guildId, Number(gameId));
    res.redirect(`/guild/${guildId}`);
  });

  app.post('/guild/:guildId/games/:gameId/settings', ensureAuth, async (req, res) => {
    const { guildId, gameId } = req.params;
    if (!guildId) return res.status(400).render('error', { error: 'Guild ID is missing.' });

    const game = getGameById(guildId, Number(gameId));
    const member = await client.guilds.fetch(guildId).then((g) => g.members.fetch(req.user!.id));
    if (!game || (!isBotAdmin(member, CONFIG.botAdminRoleIds) && !isBotManager(member))) {
        return res.status(403).render('error', { error: 'Access Denied.' });
    }

    const { managerRoleIds, grantRoleIds, logChannelId } = req.body;
    updateSettings(guildId, Number(gameId), {
      managerRoleIds: Array.isArray(managerRoleIds)
        ? managerRoleIds
        : managerRoleIds
        ? [managerRoleIds]
        : [],
      grantRoleIds: Array.isArray(grantRoleIds) ? grantRoleIds : grantRoleIds ? [grantRoleIds] : [],
      logChannelId: logChannelId || null,
    });
    res.redirect(`/guild/${guildId}`);
  });

  app.post('/guild/:guildId/tokens/mutate', ensureAuth, async (req, res) => {
    const { guildId } = req.params;
    if (!guildId) return res.status(400).render('error', { error: 'Guild ID is missing.' });
    
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(req.user!.id);
    const { gameId, action, userId, amount, reason } = req.body;
    const numAmount = Number(amount);

    if (!gameId || !action || !userId || !Number.isInteger(numAmount)) {
        return res.status(400).render('error', { error: 'Invalid input for token action.' });
    }

    const game = getGameById(guildId, Number(gameId));
    if (!game) {
      return res.status(404).render('error', { error: 'Game not found.' });
    }

    const canManage = isGameManager(member, game, CONFIG.botAdminRoleIds);
    const canGrant = isGranter(member, game, CONFIG.botAdminRoleIds);
    
    if (action === 'set' && !canManage) {
      return res.status(403).render('error', { error: 'You must be a Game Manager to set balances.' });
    }
    if ((action === 'grant' || action === 'remove') && !canGrant) {
      return res
        .status(403)
        .render('error', { error: 'You do not have permission to grant or remove tokens for this game.' });
    }
    
    let beforeAfter;
    try {
        if (action === 'grant') {
            beforeAfter = grantTokens(guildId, Number(gameId), req.user!.id, userId, numAmount, reason);
        } else if (action === 'remove') {
            beforeAfter = removeTokens(guildId, Number(gameId), req.user!.id, userId, numAmount, reason);
        } else if (action === 'set') {
            beforeAfter = setTokens(guildId, Number(gameId), req.user!.id, userId, numAmount, reason);
        } else {
            throw new Error('Invalid action.');
        }

        await postLog(
          guild,
          game,
          auditLogEmbed({
            action,
            gameName: game.name,
            actorUserId: req.user!.id,
            targetUserId: userId,
            amount: numAmount,
            before: beforeAfter.before,
            after: beforeAfter.after,
            reason,
          }),
        );
    } catch (e: any) {
        return res.status(500).render('error', { error: `Action failed: ${e.message}` });
    }

    res.redirect(`/guild/${guildId}`);
  });

  app.listen(CONFIG.webPort, () => {
    console.log(`[web] Obol web panel listening on ${CONFIG.baseUrl}`);
  });
}