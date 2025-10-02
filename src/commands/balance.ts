// src/commands/balance.ts
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { listUserBalances } from '../services/wallet.js';
import { ok } from '../ui/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('balance')
  .setDescription('See your token balances across all games (you only)')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'Guild-only command.', flags: MessageFlags.Ephemeral });
    return;
  }

  const balances = listUserBalances(interaction.guild.id, interaction.user.id);

  if (balances.length === 0) {
    await interaction.reply({
      embeds: [ok('Your tokens', 'You have no tokens yet.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = balances.map((b) => `• **${b.gameName}** — **${b.balance}**`);
  await interaction.reply({
    embeds: [ok('Your tokens', lines.join('\n'))],
    flags: MessageFlags.Ephemeral,
  });
}