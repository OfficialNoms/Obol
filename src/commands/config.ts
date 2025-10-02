// src/commands/config.ts
import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getGuildConfig, setGuildConfig } from '../db';
import { ok, err } from '../ui/embeds';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Configure guild-wide bot settings')
  .addSubcommand((sc) => sc.setName('show').setDescription('Show current guild settings'))
  .addSubcommand((sc) =>
    sc
      .setName('set')
      .setDescription('Set a guild setting')
      .addStringOption((o) =>
        o
          .setName('key')
          .setDescription('Setting to change')
          .setRequired(true)
          .addChoices({ name: 'manager_roles', value: 'manager_roles' }),
      )
      .addStringOption((o) =>
        o.setName('value').setDescription('One or more roles, separated by spaces').setRequired(true),
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'Guild-only command.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const member = interaction.member as GuildMember;
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      embeds: [err('You must have the "Manage Server" permission to use this command.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'show') {
    const config = getGuildConfig(interaction.guild.id);
    const roles = config.managerRoleIds.map((id) => `<@&${id}>`).join(', ') || '_None_';
    await interaction.reply({
      embeds: [ok('Guild Settings', `**Manager Roles**: ${roles}`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'set') {
    const key = interaction.options.getString('key', true);
    const value = interaction.options.getString('value', true);

    if (key === 'manager_roles') {
      const roleIds = value.match(/(\d{17,20})/g) ?? [];
      setGuildConfig(interaction.guild.id, { managerRoleIds: roleIds });
      await interaction.reply({
        embeds: [
          ok(
            'Settings Updated',
            `**Manager Roles** set to: ${roleIds.map((id) => `<@&${id}>`).join(', ') || '_None_'}`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}