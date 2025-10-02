// src/commands/token.ts
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  User,
  AutocompleteInteraction,
  GuildMember,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Interaction,
  MessageFlags,
} from 'discord.js';
import { resolveGameFlexible, listGames, getGameById } from '../services/game.js';
import {
  getBalance,
  ensureWallet,
  topBalances,
  grantTokens,
  removeTokens,
  setTokens,
} from '../services/wallet.js';
import { mutationEmbed, ok, err, auditLogEmbed } from '../ui/embeds.js';
import { CONFIG } from '../config.js';
import { isGameManager, isGranter } from '../permissions.js';
import { postLog } from '../services/logging.js';

// ---- Panel state ----
type PanelState = { gameId?: number; userId?: string };
const panel = new Map<string, PanelState>();

const CUSTOM = {
  gameSelect: 'obol:panel:game',
  userSelect: 'obol:panel:user',
  grantBtn: 'obol:panel:grant',
  removeBtn: 'obol:panel:remove',
  setBtn: 'obol:panel:set',
  grantModal: 'obol:modal:grant',
  removeModal: 'obol:modal:remove',
  setModal: 'obol:modal:set',
};

function gameSelectRow(guildId: string) {
  const games = listGames(guildId).slice(0, 25);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(CUSTOM.gameSelect)
    .setPlaceholder('Select game…')
    .addOptions(games.map((g) => new StringSelectMenuOptionBuilder().setLabel(g.name).setValue(String(g.id))));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}
function userSelectRow() {
  const menu = new UserSelectMenuBuilder().setCustomId(CUSTOM.userSelect).setPlaceholder('Pick member…');
  return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu);
}
function actionButtonsRow() {
  const grant = new ButtonBuilder().setCustomId(CUSTOM.grantBtn).setLabel('Grant').setStyle(ButtonStyle.Success);
  const remove = new ButtonBuilder().setCustomId(CUSTOM.removeBtn).setLabel('Remove').setStyle(ButtonStyle.Danger);
  const set = new ButtonBuilder().setCustomId(CUSTOM.setBtn).setLabel('Set').setStyle(ButtonStyle.Primary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(grant, remove, set);
}

// Modal with context
function amountModal(customId: string, title: string, gameName: string, targetLabel?: string) {
  const fullTitle = targetLabel ? `${title} — ${gameName} → ${targetLabel}` : `${title} — ${gameName}`;
  const modal = new ModalBuilder().setCustomId(customId).setTitle(fullTitle);

  const amount = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel('Amount')
    .setPlaceholder('Enter an integer (e.g. 5)')
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const reason = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason/Notes')
    .setPlaceholder('Why? (optional)')
    .setRequired(false)
    .setStyle(TextInputStyle.Paragraph);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(amount),
    new ActionRowBuilder<TextInputBuilder>().addComponents(reason),
  );
  return modal;
}

// ---- Slash command ----
export const data = new SlashCommandBuilder()
  .setName('token')
  .setDescription('Grant / manage per-game RP tokens')
  .addSubcommand((sc) =>
    sc.setName('panel').setDescription('Open an interactive token panel (dropdowns + modal)'),
  )
  .addSubcommand((sc) =>
    sc
      .setName('grant')
      .setDescription('Grant tokens to a member')
      .addStringOption((o) =>
        o
          .setName('game')
          .setDescription('Game name (autocomplete) or ID')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason/Notes').setRequired(false)),
  )
  .addSubcommand((sc) =>
    sc
      .setName('remove')
      .setDescription('Remove tokens from a member')
      .addStringOption((o) =>
        o
          .setName('game')
          .setDescription('Game name (autocomplete) or ID')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason/Notes').setRequired(false)),
  )
  .addSubcommand((sc) =>
    sc
      .setName('set')
      .setDescription('Set a member balance (manager only)')
      .addStringOption((o) =>
        o
          .setName('game')
          .setDescription('Game name (autocomplete) or ID')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason/Notes').setRequired(false)),
  )
  .addSubcommand((sc) =>
    sc
      .setName('balance')
      .setDescription('View a member balance (restricted)')
      .addStringOption((o) =>
        o
          .setName('game')
          .setDescription('Game name (autocomplete) or ID')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)),
  )
  .addSubcommand((sc) =>
    sc
      .setName('top')
      .setDescription('Top balances (restricted)')
      .addStringOption((o) =>
        o
          .setName('game')
          .setDescription('Game name (autocomplete) or ID')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addIntegerOption((o) =>
        o.setName('limit').setDescription('1-50 (default 10)').setMinValue(1).setMaxValue(50),
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

// ---- Autocomplete ----
export async function autocomplete(interaction: AutocompleteInteraction) {
  if (!interaction.inGuild() || !interaction.guild) return;
  const focused = interaction.options.getFocused().trim();
  const games = listGames(interaction.guild.id);
  const query = focused.toLowerCase();
  let filtered = games;
  if (focused) {
    filtered = games.filter((g) => {
      const name = g.name.toLowerCase();
      return name.startsWith(query) || name.includes(query) || String(g.id).startsWith(query);
    });
  }
  await interaction.respond(
    filtered.slice(0, 25).map((g) => ({ name: `${g.name} (#${g.id})`, value: String(g.id) })),
  );
}

// ---- Slash executor ----
export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ embeds: [err('Guild-only command')], flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'panel') {
    panel.set(interaction.user.id, {});
    await interaction.reply({
      embeds: [ok('Obol — Token Panel', 'Pick a game and a member, then choose an action.')],
      components: [gameSelectRow(interaction.guild.id), userSelectRow(), actionButtonsRow()],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Normal subcommands
  const gameInput = interaction.options.getString('game', true);
  const game =
    (/^\d+$/.test(gameInput)
      ? getGameById(interaction.guild.id, Number(gameInput))
      : resolveGameFlexible(interaction.guild.id, gameInput)) ?? undefined;
  if (!game) {
    await interaction.reply({ embeds: [err('Game not found')], flags: MessageFlags.Ephemeral });
    return;
  }

  const member = interaction.member as GuildMember;
  const manager = isGameManager(member, game, CONFIG.botAdminRoleIds);
  const granter = isGranter(member, game, CONFIG.botAdminRoleIds);

  if (sub === 'grant' || sub === 'remove') {
    if (!granter) {
      await interaction.reply({ embeds: [err('No permission')], flags: MessageFlags.Ephemeral });
      return;
    }
    const user = interaction.options.getUser('member', true) as User;
    const amount = interaction.options.getInteger('amount', true);
    const reason = interaction.options.getString('reason') ?? undefined;

    ensureWallet(interaction.guild.id, game.id, user.id);

    let beforeAfter: { before: number; after: number };
    try {
      if (sub === 'grant') {
        beforeAfter = grantTokens(interaction.guild.id, game.id, interaction.user.id, user.id, amount, reason);
      } else {
        beforeAfter = removeTokens(interaction.guild.id, game.id, interaction.user.id, user.id, amount, reason);
      }
    } catch (e) {
      await interaction.reply({ embeds: [err(`Failed: ${String((e as Error).message)}`)], flags: MessageFlags.Ephemeral });
      return;
    }

    // ephemeral ack
    await interaction.reply({
      embeds: [
        mutationEmbed({
          action: sub,
          gameName: game.name,
          target: user,
          amount,
          before: beforeAfter.before,
          after: beforeAfter.after,
          note: reason,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });

    // async log (best-effort)
    await postLog(
      interaction.guild,
      game,
      auditLogEmbed({
        action: sub,
        gameName: game.name,
        actorUserId: interaction.user.id,
        targetUserId: user.id,
        amount,
        before: beforeAfter.before,
        after: beforeAfter.after,
        reason,
      }),
    );
    return;
  }

  if (sub === 'set') {
    if (!manager) {
      await interaction.reply({ embeds: [err('Managers only')], flags: MessageFlags.Ephemeral });
      return;
    }
    const user = interaction.options.getUser('member', true) as User;
    const amount = interaction.options.getInteger('amount', true);
    const reason = interaction.options.getString('reason') ?? undefined;
    ensureWallet(interaction.guild.id, game.id, user.id);

    let beforeAfter: { before: number; after: number };
    try {
      beforeAfter = setTokens(interaction.guild.id, game.id, interaction.user.id, user.id, amount, reason);
    } catch (e) {
      await interaction.reply({ embeds: [err(`Failed: ${String((e as Error).message)}`)], flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({
      embeds: [
        mutationEmbed({
          action: 'set',
          gameName: game.name,
          target: user,
          amount,
          before: beforeAfter.before,
          after: beforeAfter.after,
          note: reason,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });

    // async log
    await postLog(
      interaction.guild,
      game,
      auditLogEmbed({
        action: 'set',
        gameName: game.name,
        actorUserId: interaction.user.id,
        targetUserId: user.id,
        amount,
        before: beforeAfter.before,
        after: beforeAfter.after,
        reason,
      }),
    );
    return;
  }

  if (sub === 'balance') {
    if (!granter && !manager) {
      await interaction.reply({ embeds: [err('Restricted')], flags: MessageFlags.Ephemeral });
      return;
    }
    const user = interaction.options.getUser('member', true) as User;
    const bal = getBalance(interaction.guild.id, game.id, user.id);
    await interaction.reply({
      embeds: [ok(`${game.name} — Balance`, `<@${user.id}>: **${bal}**`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'top') {
    if (!granter && !manager) {
      await interaction.reply({ embeds: [err('Restricted')], flags: MessageFlags.Ephemeral });
      return;
    }
    const limit = interaction.options.getInteger('limit') ?? 10;
    const rows = topBalances(interaction.guild.id, game.id, limit);
    const body =
      rows.length === 0
        ? '_No balances_'
        : rows.map((r, i) => `**${i + 1}.** <@${r.userId}> — **${r.balance}**`).join('\n');
    await interaction.reply({ embeds: [ok(`${game.name} — Top`, body)], flags: MessageFlags.Ephemeral });
  }
}

// ---- Components / Modals ----
export async function handleComponent(interaction: Interaction): Promise<boolean> {
  if (!interaction.inGuild() || !interaction.guild) return false;

  // Game select
  if (interaction.isStringSelectMenu() && interaction.customId === CUSTOM.gameSelect) {
    const chosen = Number(interaction.values[0]);
    const st = panel.get(interaction.user.id) ?? {};
    st.gameId = chosen;
    panel.set(interaction.user.id, st);
    await interaction.update({
      embeds: [ok('Obol — Token Panel', `Game: **#${chosen}** selected.\nPick a member and choose an action.`)],
      components: [gameSelectRow(interaction.guild.id), userSelectRow(), actionButtonsRow()],
    });
    return true;
  }

  // User select
  if (interaction.isUserSelectMenu() && interaction.customId === CUSTOM.userSelect) {
    const target = interaction.values[0];
    const st = panel.get(interaction.user.id) ?? {};
    st.userId = target;
    panel.set(interaction.user.id, st);
    await interaction.update({
      embeds: [ok('Obol — Token Panel', `Member: <@${target}> selected.\nPick a game and choose an action.`)],
      components: [gameSelectRow(interaction.guild.id), userSelectRow(), actionButtonsRow()],
    });
    return true;
  }

  // Buttons -> show modal
  if (interaction.isButton() && [CUSTOM.grantBtn, CUSTOM.removeBtn, CUSTOM.setBtn].includes(interaction.customId)) {
    const st = panel.get(interaction.user.id);
    if (!st?.gameId || !st?.userId) {
      await interaction.reply({ embeds: [err('Select a game and a member first.')], flags: MessageFlags.Ephemeral });
      return true;
    }

    const game = getGameById(interaction.guild.id, st.gameId);
    const gameName = game?.name ?? `#${st.gameId}`;
    const targetUser = await interaction.client.users.fetch(st.userId).catch(() => null);
    const targetLabel = targetUser ? `@${targetUser.username}` : `<@${st.userId}>`;

    if (interaction.customId === CUSTOM.grantBtn) {
      await interaction.showModal(amountModal(CUSTOM.grantModal, 'Grant Token', gameName, targetLabel));
      return true;
    }
    if (interaction.customId === CUSTOM.removeBtn) {
      await interaction.showModal(amountModal(CUSTOM.removeModal, 'Remove Tokens', gameName, targetLabel));
      return true;
    }
    if (interaction.customId === CUSTOM.setBtn) {
      await interaction.showModal(amountModal(CUSTOM.setModal, 'Set Balance', gameName, targetLabel));
      return true;
    }
  }

  // Modal submit -> perform operation
  if (interaction.isModalSubmit() && [CUSTOM.grantModal, CUSTOM.removeModal, CUSTOM.setModal].includes(interaction.customId)) {
    const st = panel.get(interaction.user.id);
    if (!st?.gameId || !st?.userId) {
      await interaction.reply({ embeds: [err('Session lost. Re-open /token panel.')], flags: MessageFlags.Ephemeral });
      return true;
    }

    const game = getGameById(interaction.guild.id, st.gameId);
    if (!game) {
      await interaction.reply({ embeds: [err('Game not found')], flags: MessageFlags.Ephemeral });
      return true;
    }

    const member = interaction.member as GuildMember;
    const manager = isGameManager(member, game, CONFIG.botAdminRoleIds);
    const granter = isGranter(member, game, CONFIG.botAdminRoleIds);

    const amountStr = interaction.fields.getTextInputValue('amount')?.trim() ?? '0';
    const reason = interaction.fields.getTextInputValue('reason')?.trim() || undefined;
    const amount = Number(amountStr);
    if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
      await interaction.reply({ embeds: [err('Amount must be an integer')], flags: MessageFlags.Ephemeral });
      return true;
    }

    const userId = st.userId;
    const target = await interaction.client.users.fetch(userId);

    try {
      ensureWallet(interaction.guild.id, game.id, userId);

      if (interaction.customId === CUSTOM.grantModal) {
        if (!granter) {
          await interaction.reply({ embeds: [err('No permission')], flags: MessageFlags.Ephemeral });
          return true;
        }
        const { before, after } = grantTokens(interaction.guild.id, game.id, interaction.user.id, userId, amount, reason);
        await interaction.reply({
          embeds: [mutationEmbed({ action: 'grant', gameName: game.name, target, amount, before, after, note: reason })],
          flags: MessageFlags.Ephemeral,
        });
        await postLog(
          interaction.guild,
          game,
          auditLogEmbed({
            action: 'grant',
            gameName: game.name,
            actorUserId: interaction.user.id,
            targetUserId: userId,
            amount,
            before,
            after,
            reason,
          }),
        );
        return true;
      }

      if (interaction.customId === CUSTOM.removeModal) {
        if (!granter) {
          await interaction.reply({ embeds: [err('No permission')], flags: MessageFlags.Ephemeral });
          return true;
        }
        const { before, after } = removeTokens(interaction.guild.id, game.id, interaction.user.id, userId, amount, reason);
        await interaction.reply({
          embeds: [mutationEmbed({ action: 'remove', gameName: game.name, target, amount, before, after, note: reason })],
          flags: MessageFlags.Ephemeral,
        });
        await postLog(
          interaction.guild,
          game,
          auditLogEmbed({
            action: 'remove',
            gameName: game.name,
            actorUserId: interaction.user.id,
            targetUserId: userId,
            amount,
            before,
            after,
            reason,
          }),
        );
        return true;
      }

      if (interaction.customId === CUSTOM.setModal) {
        if (!manager) {
          await interaction.reply({ embeds: [err('Managers only')], flags: MessageFlags.Ephemeral });
          return true;
        }
        const { before, after } = setTokens(interaction.guild.id, game.id, interaction.user.id, userId, amount, reason);
        await interaction.reply({
          embeds: [mutationEmbed({ action: 'set', gameName: game.name, target, amount, before, after, note: reason })],
          flags: MessageFlags.Ephemeral,
        });
        await postLog(
          interaction.guild,
          game,
          auditLogEmbed({
            action: 'set',
            gameName: game.name,
            actorUserId: interaction.user.id,
            targetUserId: userId,
            amount,
            before,
            after,
            reason,
          }),
        );
        return true;
      }
    } catch (e) {
      await interaction.reply({ embeds: [err(`Failed: ${String((e as Error).message)}`)], flags: MessageFlags.Ephemeral });
      return true;
    }
  }

  return false;
}