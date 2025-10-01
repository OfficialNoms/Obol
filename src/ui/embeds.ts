// src/ui/embeds.ts
import { APIEmbed, Colors, EmbedBuilder, User } from 'discord.js';

export function ok(title: string, description?: string): EmbedBuilder {
  return base().setTitle(`✅ ${title}`).setColor(Colors.Green).setDescription(description ?? '');
}
export function err(description: string): EmbedBuilder {
  return base().setTitle('⚠️ Error').setColor(Colors.Red).setDescription(description);
}
export function info(title: string, description?: string): EmbedBuilder {
  return base().setTitle(`ℹ️ ${title}`).setColor(Colors.Blurple).setDescription(description ?? '');
}

export function mutationEmbed(opts: {
  action: 'grant' | 'remove' | 'set';
  gameName: string;
  target: User;
  amount: number;
  before: number;
  after: number;
  note?: string;
}): EmbedBuilder {
  const title =
    opts.action === 'set'
      ? `Set balance — ${opts.gameName}`
      : `${opts.action === 'grant' ? 'Granted' : 'Removed'} tokens — ${opts.gameName}`;

  const sign =
    opts.action === 'set'
      ? opts.after - opts.before
      : opts.action === 'grant'
      ? +opts.amount
      : -opts.amount;

  const desc = [
    `Target: <@${opts.target.id}>`,
    `Amount: **${opts.amount}**`,
    `Δ: **${sign >= 0 ? `+${sign}` : sign}**`,
    `Balance: **${opts.before} → ${opts.after}**`,
    opts.note ? `Reason: _${opts.note}_` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return base().setTitle(title).setColor(Colors.Blurple).setDescription(desc);
}

/** Subtle gray footer payload helper for pagination and meta text */
export function grayFooter(text: string): APIEmbed['footer'] {
  return { text };
}

/** Compact embed for log channels */
export function auditLogEmbed(opts: {
  action: 'grant' | 'remove' | 'set';
  gameName: string;
  actorUserId: string;
  targetUserId: string;
  amount: number;
  before: number;
  after: number;
  reason?: string;
}): EmbedBuilder {
  const sign =
    opts.action === 'set'
      ? opts.after - opts.before
      : opts.action === 'grant'
      ? +opts.amount
      : -opts.amount;

  const title =
    opts.action === 'set'
      ? `Set — ${opts.gameName}`
      : `${opts.action === 'grant' ? 'Grant' : 'Remove'} — ${opts.gameName}`;

  const desc = [
    `By: <@${opts.actorUserId}>`,
    `To: <@${opts.targetUserId}>`,
    `Amount: **${opts.amount}**`,
    `Δ: **${sign >= 0 ? `+${sign}` : sign}**`,
    `Balance: **${opts.before} → ${opts.after}**`,
    opts.reason ? `Reason: _${opts.reason}_` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return base().setTitle(title).setColor(Colors.DarkButNotBlack).setDescription(desc);
}

function base(): EmbedBuilder {
  return new EmbedBuilder();
}
