import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { listUserBalances } from '../services/wallet';
import { ok } from '../ui/embeds';

export const data = new SlashCommandBuilder()
  .setName('balance')
  .setDescription('See your token balances across all games (you only)')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild() || !interaction.guild) {
    return interaction.reply({ content: 'Guild-only command.', ephemeral: true });
  }

  const balances = listUserBalances(interaction.guild.id, interaction.user.id);

  if (balances.length === 0) {
    await interaction.reply({
      embeds: [ok('Your tokens', 'You have no tokens yet.')],
      ephemeral: true,
    });
    return;
  }

  const lines = balances.map((b) => `• **${b.gameName}** - **${b.balance}**`);
  await interaction.reply({
    embeds: [ok('Your tokens', lines.join('\n'))],
    ephemeral: true,
  });
}
