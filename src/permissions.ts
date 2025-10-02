import { GuildMember, PermissionsBitField, Role } from 'discord.js';
import type { GameRow } from './db';
import { getGuildConfig } from './db';

type Settings = {
  grantRoleIds: string[];
  managerRoleIds: string[];
  logChannelId: string | null;
};

export function parseSettings(json: string): Settings {
  try {
    const obj = JSON.parse(json) as Settings;
    obj.grantRoleIds ??= [];
    obj.managerRoleIds ??= [];
    return obj;
  } catch {
    return { grantRoleIds: [], managerRoleIds: [], logChannelId: null };
  }
}

/** Checks for global bot admins (Manage Guild perm or roles in .env) */
export function isBotAdmin(member: GuildMember, globalAdminRoleIds: string[]): boolean {
  if (member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return true;
  if (!globalAdminRoleIds.length) return false;
  return member.roles.cache.some((r: Role) => globalAdminRoleIds.includes(r.id));
}

/** Checks for per-guild bot managers (roles configured in DB) */
export function isBotManager(member: GuildMember): boolean {
  const config = getGuildConfig(member.guild.id);
  if (!config.managerRoleIds.length) return false;
  return member.roles.cache.some((r) => config.managerRoleIds.includes(r.id));
}

/** Checks if a user can manage a specific game's settings and balances */
export function isGameManager(
  member: GuildMember,
  game: GameRow,
  globalAdminRoleIds: string[],
): boolean {
  if (isBotAdmin(member, globalAdminRoleIds) || isBotManager(member)) return true;
  const s = parseSettings(game.settingsJson);
  return member.roles.cache.some((r) => s.managerRoleIds.includes(r.id));
}

/** Checks if a user can grant/remove tokens for a specific game */
export function isGranter(
  member: GuildMember,
  game: GameRow,
  globalAdminRoleIds: string[],
): boolean {
  if (isGameManager(member, game, globalAdminRoleIds)) return true;
  const s = parseSettings(game.settingsJson);
  return member.roles.cache.some((r) => s.grantRoleIds.includes(r.id));
}