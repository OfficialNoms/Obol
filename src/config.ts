// src/config.ts
export const CONFIG = {
  // Bot settings
  token: process.env.DISCORD_TOKEN ?? '',
  devGuildId: process.env.DEV_GUILD_ID ?? '',
  databasePath: process.env.DATABASE_PATH ?? './data/obol.db',
  botAdminRoleIds: (process.env.BOT_ADMIN_ROLE_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Web Panel Settings
  webPort: parseInt(process.env.WEB_PORT ?? '3090', 10),
  baseUrl: process.env.BASE_URL ?? 'http://localhost:3090',
  oauthClientId: process.env.OAUTH_CLIENT_ID ?? '',
  oauthClientSecret: process.env.OAUTH_CLIENT_SECRET ?? '',
  oauthCallbackUrl: process.env.OAUTH_CALLBACK_URL ?? 'http://localhost:3090/auth/callback',
  sessionSecret: process.env.SESSION_SECRET ?? '',
};

const required: (keyof typeof CONFIG)[] = [
  'token',
  'sessionSecret',
  'oauthClientId',
  'oauthClientSecret',
];
for (const k of required) {
  if (!CONFIG[k]) {
    throw new Error(`Missing required environment variable: ${k.toUpperCase()}`);
  }
}