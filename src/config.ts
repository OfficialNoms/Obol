import 'dotenv/config';

export const CONFIG = {
  token: process.env.DISCORD_TOKEN ?? '',
  devGuildId: process.env.DEV_GUILD_ID ?? '',
  databasePath: process.env.DATABASE_PATH ?? './data/obol.db',
  botAdminRoleIds: (process.env.BOT_ADMIN_ROLE_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

for (const [k, v] of Object.entries(CONFIG)) {
  if (k === 'token' && !v) {
    throw new Error('DISCORD_TOKEN missing in environment');
  }
}
