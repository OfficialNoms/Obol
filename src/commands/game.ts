// src/commands/game.ts
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  GuildMember,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  Interaction,
  MessageFlags,
} from 'discord.js';
import { createGame, deleteGame, getGameById, listGames, updateSettings } from '../services/game';
import { ok, err } from '../ui/embeds';
import { isBotAdmin } from '../permissions';
import { CONFIG } from '../config';

const CUSTOM = {
  createGameModal: 'obol:modal:create-game',
};

function createGameModal() {
  const modal = new ModalBuilder().setCustomId(CUSTOM.createGameModal).setTitle('Create game');
  const name = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Game name')
    .setPlaceholder('e.g. Dragonfall')
    .setRequired(true)
    .setStyle(TextInputStyle.Short);
  const desc = new TextInputBuilder()
    .setCustomId('desc')
    .setLabel('Description (optional)')
    .setRequired(false)
    .setStyle(TextInputStyle.Paragraph);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(name),
    new ActionRowBuilder<TextInputBuilder>().addComponents(desc),
  );
  return modal;
}

export const data = new SlashCommandBuilder()
  .setName('game')
  .setDescription('Manage RP token games')
  .addSubcommand((sc) =>
    sc
      .setName('create')
      .setDescription('Create a new game (modal)')
      .addStringOption((o) => o.setName('name').setDescription('Game name (optional)'))
      .addStringOption((o) => o.setName('desc').setDescription('Description (optional)')),
  )
  .addSubcommand((sc) => sc.setName('list').setDescription('List games'))
  .addSubcommand((sc) =>
    sc
      .setName('delete')
      .setDescription('Delete a game')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Game ID (from /game list)').setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('config')
      .setDescription('Configure game settings')
      .addIntegerOption((o) => o.setName('id').setDescription('Game ID').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('key')
          .setDescription('Setting key')
          .addChoices(
            { name: 'grantRoles', value: 'grantRoles' },
            { name: 'managerRoles', value: 'managerRoles' },
            { name: 'logChannel', value: 'logChannel' },
          )
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('value')
          .setDescription('Value (comma-separated role IDs, or channel ID, or "null")')
          .setRequired(true),
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ embeds: [err('Guild-only command')], flags: MessageFlags.Ephemeral });
    return;
  }

  const member: GuildMember =
    interaction.guild.members.resolve(interaction.user.id) ??
    (await interaction.guild.members.fetch(interaction.user.id));

  const admin = isBotAdmin(member, CONFIG.botAdminRoleIds);
  if (!admin) {
    await interaction.reply({ embeds: [err('Admins only')], flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'create') {
    const nameArg = interaction.options.getString('name')?.trim();
    const descArg = interaction.options.getString('desc') ?? undefined;

    if (!nameArg) {
      await interaction.showModal(createGameModal());
      return;
    }

    try {
      const game = createGame(interaction.guild.id, nameArg, descArg);
      await interaction.reply({
        embeds: [ok('Game created', `ID: **${game.id}**\nName: **${game.name}**`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (e) {
      await interaction.reply({
        embeds: [err(`Failed to create game: ${String((e as Error).message)}`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  if (sub === 'list') {
    const games = listGames(interaction.guild.id);
    const body =
      games.length === 0
        ? '_No games yet_'
        : games
            .map((g) => `• **${g.id}** — ${g.name}${g.description ? ` — ${g.description}` : ''}`)
            .join('\n');
    await interaction.reply({ embeds: [ok('Games', body)], flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === 'delete') {
    const id = interaction.options.getInteger('id', true);
    const game = getGameById(interaction.guild.id, id);
    if (!game) {
      await interaction.reply({ embeds: [err('Game not found')], flags: MessageFlags.Ephemeral });
      return;
    }
    deleteGame(interaction.guild.id, id);
    await interaction.reply({
      embeds: [ok('Game deleted', `**${game.name}** (#${id})`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'config') {
    const id = interaction.options.getInteger('id', true);
    const key = interaction.options.getString('key', true);
    const value = interaction.options.getString('value', true);

    const game = getGameById(interaction.guild.id, id);
    if (!game) {
      await interaction.reply({ embeds: [err('Game not found')], flags: MessageFlags.Ephemeral });
      return;
    }

    if (key === 'grantRoles' || key === 'managerRoles') {
      const roleIds = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      updateSettings(interaction.guild.id, id, { [key]: roleIds } as any)!;
      await interaction.reply({
        embeds: [ok('Updated roles', `\`${key}\` = ${roleIds.map((r) => `<@&${r}>`).join(', ')}`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (key === 'logChannel') {
      const chId = value === 'null' ? null : value;
      if (chId && !interaction.guild.channels.cache.has(chId)) {
        await interaction.reply({
          embeds: [err('Channel not found')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      updateSettings(interaction.guild.id, id, { logChannelId: chId });
      await interaction.reply({
        embeds: [ok('Updated logChannel', `Now: ${chId ? `<#${chId}>` : '`null`'}`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({ embeds: [err('Unknown key')], flags: MessageFlags.Ephemeral });
  }
}

export async function handleComponent(interaction: Interaction): Promise<boolean> {
  if (!interaction.inGuild() || !interaction.guild) return false;

  if (interaction.isModalSubmit() && interaction.customId === CUSTOM.createGameModal) {
    const name = interaction.fields.getTextInputValue('name')?.trim();
    const desc = interaction.fields.getTextInputValue('desc')?.trim() || undefined;

    if (!name) {
      await interaction.reply({ embeds: [err('Name is required')], flags: MessageFlags.Ephemeral });
      return true;
    }

    const member: GuildMember =
      interaction.guild.members.resolve(interaction.user.id) ??
      (await interaction.guild.members.fetch(interaction.user.id));
    if (!isBotAdmin(member, CONFIG.botAdminRoleIds)) {
      await interaction.reply({ embeds: [err('Admins only')], flags: MessageFlags.Ephemeral });
      return true;
    }

    try {
      const game = createGame(interaction.guild.id, name, desc);
      await interaction.reply({
        embeds: [ok('Game created', `ID: **${game.id}**\nName: **${game.name}**`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (e) {
      await interaction.reply({
        embeds: [err(`Failed to create game: ${String((e as Error).message)}`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    return true;
  }

  return false;
}