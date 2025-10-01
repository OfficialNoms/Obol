// src/commands/audit.ts
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  GuildMember,
  MessageFlags,
} from 'discord.js';
import { resolveGameFlexible, listGames, getGameById } from '../services/game';
import { listTransactions } from '../services/wallet';
import { ok, err } from '../ui/embeds';
import { isBotAdmin, isGameManager } from '../permissions';
import { CONFIG } from '../config';

export const data = new SlashCommandBuilder()
  .setName('audit')
  .setDescription('View recent token transactions (admins/managers)')
  .addStringOption((o) =>
    o
      .setName('game')
      .setDescription('Game name (autocomplete) or ID')
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addUserOption((o) =>
    o.setName('member').setDescription('Filter to a specific member (optional)'),
  )
  .addStringOption((o) =>
    o
      .setName('action')
      .setDescription('Filter action')
      .addChoices(
        { name: 'Any', value: 'any' },
        { name: 'Grant', value: 'grant' },
        { name: 'Remove', value: 'remove' },
        { name: 'Set', value: 'set' },
      ),
  )
  .addIntegerOption((o) =>
    o
      .setName('limit')
      .setDescription('How many entries (1-50, default 10)')
      .setMinValue(1)
      .setMaxValue(50),
  )
  .setDMPermission(false);

export async function autocomplete(interaction: AutocompleteInteraction) {
  if (!interaction.inGuild() || !interaction.guild) return;
  const focused = interaction.options.getFocused().trim().toLowerCase();
  const games = listGames(interaction.guild.id);
  const filtered = focused
    ? games.filter(
        (g) =>
          g.name.toLowerCase().includes(focused) || String(g.id).startsWith(focused),
      )
    : games;
  await interaction.respond(
    filtered.slice(0, 25).map((g) => ({ name: `${g.name} (#${g.id})`, value: String(g.id) })),
  );
}

function trunc(s: string, n = 120) {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'Guild-only command.', flags: MessageFlags.Ephemeral });
    return;
  }

  const gameInput = interaction.options.getString('game', true);
  const game =
    (/^\d+$/.test(gameInput)
      ? getGameById(interaction.guild.id, Number(gameInput))
      : resolveGameFlexible(interaction.guild.id, gameInput)) ?? undefined;

  if (!game) {
    await interaction.reply({ embeds: [err('Game not found')], flags: MessageFlags.Ephemeral });
    return;
  }

  // Permissions: global admin or game manager
  const member: GuildMember =
    interaction.guild.members.resolve(interaction.user.id) ??
    (await interaction.guild.members.fetch(interaction.user.id));
  const allowed =
    isBotAdmin(member, CONFIG.botAdminRoleIds) ||
    isGameManager(member, game, CONFIG.botAdminRoleIds);

  if (!allowed) {
    await interaction.reply({
      embeds: [err('Managers/Admins only')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const target = interaction.options.getUser('member') ?? undefined;
  const actionOpt = interaction.options.getString('action') ?? 'any';
  const action = actionOpt === 'any' ? undefined : (actionOpt as 'grant' | 'remove' | 'set');
  const limit = interaction.options.getInteger('limit') ?? 10;

  const rows = listTransactions({
    guildId: interaction.guild.id,
    gameId: game.id,
    targetUserId: target?.id,
    action,
    limit,
  });

  if (rows.length === 0) {
    await interaction.reply({
      embeds: [ok('Audit', 'No transactions found for the selected filters.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = rows.map((r) => {
    const when = `<t:${r.ts}:R>`;
    const actor = `<@${r.actorUserId}>`;
    const tgt = `<@${r.targetUserId}>`;
    const sign = r.delta >= 0 ? '+' : '';
    const reason = r.reason ? ` — _${trunc(r.reason)}_` : '';
    const actionLabel = r.action === 'set' ? 'set' : r.action === 'grant' ? 'grant' : 'remove';
    return `• ${when} — **${actionLabel}** ${tgt} **${r.amount}** (Δ ${sign}${r.delta}) — ${r.before} → ${r.after} — by ${actor}${reason}`;
  });

  await interaction.reply({
    embeds: [ok(`Audit — ${game.name}`, lines.join('\n'))],
    flags: MessageFlags.Ephemeral,
  });
}
