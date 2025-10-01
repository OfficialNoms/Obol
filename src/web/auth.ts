// src/web/auth.ts
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy, Profile as DiscordProfile } from 'passport-discord';
import type { Express } from 'express';
import { VerifyCallback } from 'passport-oauth2';

export type WebUser = {
  id: string;
  username: string;
  avatar?: string | null;
  guilds: DiscordGuild[];
};

type DiscordGuild = {
  id: string;
  name: string;
  icon?: string | null;
  owner: boolean;
  permissions: number; // bitset
};

export function initAuth(app: Express) {
  const {
    OAUTH_CLIENT_ID,
    OAUTH_CLIENT_SECRET,
    OAUTH_CALLBACK_URL,
    SESSION_SECRET = 'change-me-in-production',
  } = process.env as Record<string, string | undefined>;

  // Middleware to set up response locals.
  app.use((req, res, next) => {
    res.locals.title = 'Obol';
    res.locals.baseUrl = process.env.BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT ?? 3000)}`;
    next();
  });

  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET || !OAUTH_CALLBACK_URL) {
    console.warn('[web] OAuth environment variables are missing. Web login will be disabled.');

    app.use((req, res, next) => {
      (req as any).isAuthed = () => false;
      (req as any).webUser = undefined;
      res.locals.user = undefined;
      next();
    });

    const authDisabledHandler = (_req: any, res: any) => {
      res.status(503).render('error', {
        message: 'Web login is not configured by the bot operator.',
      });
    };
    app.get('/login', authDisabledHandler);
    app.get('/auth/callback', authDisabledHandler);
    app.get('/logout', (req, res) => res.redirect('/'));

    return;
  }

  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    }),
  );

  passport.serializeUser((user: any, done) => done(null, user));
  passport.deserializeUser((obj: any, done) => done(null, obj));

  passport.use(
    new DiscordStrategy(
      {
        clientID: OAUTH_CLIENT_ID,
        clientSecret: OAUTH_CLIENT_SECRET,
        callbackURL: OAUTH_CALLBACK_URL,
        scope: ['identify', 'guilds'],
        // @ts-ignore - The 'prompt' property is valid for Discord's OAuth2, but is missing from the type definitions
        prompt: 'none',
      },
      (
        accessToken: string,
        _refreshToken: string,
        profile: DiscordProfile,
        done: VerifyCallback,
      ) => {
        const user: WebUser = {
          id: profile.id,
          username: profile.username,
          avatar: profile.avatar ?? null,
          guilds: (profile as any).guilds ?? [],
        };
        return done(null, { ...user, accessToken });
      },
    ),
  );

  app.use(passport.initialize());
  app.use(passport.session());

  app.use((req, res, next) => {
    (req as any).isAuthed = () => !!req.user;
    (req as any).webUser = req.user as (WebUser & { accessToken: string }) | undefined;
    res.locals.user = (req as any).webUser;
    next();
  });

  app.get('/login', passport.authenticate('discord'));

  app.get(
    '/auth/callback',
    passport.authenticate('discord', { failureRedirect: '/?auth=failure' }),
    (_req, res) => res.redirect('/guilds'),
  );

  app.get('/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) {
        return next(err);
      }
      res.redirect('/');
    });
  });
}