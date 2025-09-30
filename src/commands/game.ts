import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  GuildMember,
} from 'discord.js';
import {
  createGame,
  deleteGame,
  getGameById,
  listGames,
  updateSettings,
} from '../services/game';
import { ok, err } from '../ui/embeds';
import { isBotAdmin } from '../permissions';
import { CONFIG } from '../config';

export const data = new SlashCommandBuilder()
  .setName('game')
  .setDescription('Manage RP token games')
  .addSubcommand((sc) =>
    sc
      .setName('create')
      .setDescription('Create a new game')
      .addStringOption((o) => o.setName('name').setDescription('Game name').setRequired(true))
      .addStringOption((o) => o.setName('desc').setDescription('Description').setRequired(false)),
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
    return interaction.reply({ embeds: [err('Guild-only command')], ephemeral: true });
  }

  // Ensure a real GuildMember (not the APIInteractionGuildMember lightweight type)
  const member: GuildMember =
    interaction.guild.members.resolve(interaction.user.id) ??
    (await interaction.guild.members.fetch(interaction.user.id));

  const admin = isBotAdmin(member, CONFIG.botAdminRoleIds);
  if (!admin) {
    return interaction.reply({ embeds: [err('Admins only')], ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'create') {
    const name = interaction.options.getString('name', true).trim();
    const desc = interaction.options.getString('desc') ?? undefined;
    try {
      const game = createGame(interaction.guild.id, name, desc);
      await interaction.reply({
        embeds: [ok('Game created', `ID: **${game.id}**\nName: **${game.name}**`)],
        ephemeral: true,
      });
    } catch (e) {
      await interaction.reply({
        embeds: [err('Failed to create game', String((e as Error).message))],
        ephemeral: true,
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
    await interaction.reply({ embeds: [ok('Games', body)], ephemeral: true });
    return;
  }

  if (sub === 'delete') {
    const id = interaction.options.getInteger('id', true);
    const game = getGameById(interaction.guild.id, id);
    if (!game) {
      await interaction.reply({ embeds: [err('Game not found')], ephemeral: true });
      return;
    }
    deleteGame(interaction.guild.id, id);
    await interaction.reply({
      embeds: [ok('Game deleted', `**${game.name}** (#${id})`)],
      ephemeral: true,
    });
    return;
  }

  if (sub === 'config') {
    const id = interaction.options.getInteger('id', true);
    const key = interaction.options.getString('key', true);
    const value = interaction.options.getString('value', true);

    const game = getGameById(interaction.guild.id, id);
    if (!game) return interaction.reply({ embeds: [err('Game not found')], ephemeral: true });

    if (key === 'grantRoles' || key === 'managerRoles') {
      const roleIds = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      updateSettings(interaction.guild.id, id, { [key]: roleIds } as any)!;
      await interaction.reply({
        embeds: [ok('Updated roles', `\`${key}\` = ${roleIds.map((r) => `<@&${r}>`).join(', ')}`)],
        ephemeral: true,
      });
      return;
    }

    if (key === 'logChannel') {
      const chId = value === 'null' ? null : value;
      if (chId && !interaction.guild.channels.cache.has(chId)) {
        return interaction.reply({ embeds: [err('Channel not found')], ephemeral: true });
      }
      updateSettings(interaction.guild.id, id, { logChannelId: chId });
      await interaction.reply({
        embeds: [ok('Updated logChannel', `Now: ${chId ? `<#${chId}>` : '`null`'}`)],
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ embeds: [err('Unknown key')], ephemeral: true });
  }
}
