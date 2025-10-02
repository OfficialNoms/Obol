// src/commands/audit.ts
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  SlashCommandBuilder,
  userMention,
} from 'discord.js';
import { ok, err, grayFooter } from '../ui/embeds.js';
import { isBotAdmin, isBotManager, isGameManager } from '../permissions.js';
import { getGameById } from '../services/game.js';
import { listTransactionsPaged, type AuditFilters, type AuditAction } from '../services/audit.js';
import { CONFIG } from '../config.js';

type State = {
  filters: AuditFilters;
  limit: number;
  // Cursors recorded at render-time
  beforeId?: number; // older than this
  afterId?: number; // newer than this
};
const STATES = new Map<string, { state: State; expiresAt: number }>();
const TTL_MS = 10 * 60 * 1000;

function putState(s: State): string {
  const token = Math.random().toString(36).slice(2, 10);
  STATES.set(token, { state: s, expiresAt: Date.now() + TTL_MS });
  return token;
}

function getState(token: string): State | null {
  const s = STATES.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    STATES.delete(token);
    return null;
  }
  return s.state;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of STATES) if (v.expiresAt < now) STATES.delete(k);
}, 60_000).unref();

export const data = new SlashCommandBuilder()
  .setName('audit')
  .setDescription('View token transaction history (managers/admin only)')
  .addIntegerOption((o) =>
    o.setName('game').setDescription('Game ID (autocomplete)').setAutocomplete(true),
  )
  .addUserOption((o) => o.setName('member').setDescription('Filter by member'))
  .addStringOption((o) =>
    o
      .setName('action')
      .setDescription('Filter by action')
      .addChoices(
        { name: 'grant', value: 'grant' },
        { name: 'remove', value: 'remove' },
        { name: 'set', value: 'set' },
      ),
  )
  .addIntegerOption((o) =>
    o
      .setName('limit')
      .setDescription('Items per page (default 10, max 50)')
      .setMinValue(1)
      .setMaxValue(50),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ embeds: [err('Guild-only command')], flags: MessageFlags.Ephemeral });
    return;
  }
  const member = interaction.member as GuildMember;
  const guildId = interaction.guildId!;
  const limit = interaction.options.getInteger('limit') ?? 10;
  const gameId = interaction.options.getInteger('game') ?? undefined;
  const target = interaction.options.getUser('member') ?? undefined;
  const action = (interaction.options.getString('action') as AuditAction | null) ?? undefined;

  // Permission gate
  let canView = isBotAdmin(member, CONFIG.botAdminRoleIds) || isBotManager(member);
  let gameName = 'All games';
  if (!canView && gameId != null) {
    const game = getGameById(guildId, gameId);
    if (!game)
      return interaction.reply({ embeds: [err('Game not found')], flags: MessageFlags.Ephemeral });
    canView = isGameManager(member, game, CONFIG.botAdminRoleIds);
    gameName = game.name;
  }
  if (!canView)
    return interaction.reply({
      embeds: [err('You must be a Bot Admin/Manager or a Game Manager to view audit logs.')],
      flags: MessageFlags.Ephemeral,
    });

  const filters: AuditFilters = {
    guildId,
    gameId,
    targetUserId: target?.id,
    action,
  };

  const page = listTransactionsPaged(filters, { limit, direction: 'forward' });
  const token = putState({
    filters,
    limit,
    beforeId: page.cursor?.beforeId,
    afterId: page.cursor?.afterId,
  });

  return interaction.reply({
    embeds: [renderAudit(page, gameName, limit, target?.id ?? null, action ?? null)],
    components: [pagerRow(token, page)],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleComponent(inter: ButtonInteraction): Promise<boolean> {
  if (!inter.customId.startsWith('audit:')) return false;
  const [, token, dir] = inter.customId.split(':');
  if (!token) return true; // Safety check

  const state = getState(token);
  if (!state) {
    await inter.update({
      embeds: [err('This view expired. Run /audit again.')],
      components: [],
    });
    return true;
  }

  const { filters, limit, beforeId, afterId } = state;

  let direction: 'forward' | 'backward' = 'forward';
  let opts: { beforeId?: number; afterId?: number } = {};
  if (dir === 'next') {
    direction = 'forward';
    opts.beforeId = beforeId; // go older than current last
  } else if (dir === 'prev') {
    direction = 'backward';
    opts.afterId = afterId; // go newer than current first
  } else {
    // refresh
    direction = 'forward';
  }

  const page = listTransactionsPaged(filters, { limit, direction, ...opts });

  // Update state cursors
  state.beforeId = page.cursor?.beforeId;
  state.afterId = page.cursor?.afterId;

  const gameName =
    filters.gameId != null
      ? getGameById(filters.guildId, filters.gameId)?.name ?? `Game ${filters.gameId}`
      : 'All games';

  await inter.update({
    embeds: [
      renderAudit(page, gameName, limit, filters.targetUserId ?? null, filters.action ?? null),
    ],
    components: [pagerRow(token, page)],
  });

  return true;
}

function pagerRow(token: string, page: ReturnType<typeof listTransactionsPaged>) {
  const row = new ActionRowBuilder<ButtonBuilder>();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`audit:${token}:prev`)
      .setLabel('Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!page.hasPrev),
    new ButtonBuilder()
      .setCustomId(`audit:${token}:next`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!page.hasNext),
    new ButtonBuilder()
      .setCustomId(`audit:${token}:refresh`)
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
  );
  return row;
}

function renderAudit(
  page: ReturnType<typeof listTransactionsPaged>,
  scope: string,
  limit: number,
  targetUserId: string | null,
  action: AuditAction | null,
) {
  const lines =
    page.items.length === 0
      ? ['_No transactions_']
      : page.items.map((t) => {
          const tgt = userMention(t.targetUserId);
          const delta = t.delta >= 0 ? `+${t.delta}` : `${t.delta}`;
          const note = t.reason ? ` — ${t.reason}` : '';
          const when = `<t:${t.ts}:R>`;
          return `#${t.id} • **${t.action} ${t.amount}** (${delta}) → **${t.after}** for ${tgt} ${when}${note}`;
        });

  const filterBits = [
    `Scope: **${scope}**`,
    targetUserId ? `Member: <@${targetUserId}>` : null,
    action ? `Action: \`${action}\`` : null,
    `Page size: ${limit}`,
  ]
    .filter(Boolean)
    .join(' • ');

  return ok('Audit log', lines.join('\n')).setFooter(
    grayFooter(`${filterBits} — showing newest first`),
  );
}