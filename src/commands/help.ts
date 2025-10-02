// src/commands/help.ts
import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CONFIG } from '../config';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('How to use Obol and available commands.');

export async function execute(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setTitle('📖 Obol — Help')
    .setDescription('Quick guide to token management and commands.')
    .setColor('#d8ac57')
    .addFields(
      {
        name: 'For Users',
        value: '• **Check your balance:** Use `/balance` to see all your tokens in this server.',
      },
      {
        name: 'For Staff & Admins',
        value:
          `• **Manage Everything:** The easiest way to manage games and tokens is via the **[Web Panel](${CONFIG.baseUrl})**.\n` +
          '• **Manage Games:** Use `/game create`, `/game delete`, and `/game config` to manage game settings.\n' +
          '• **Manage Tokens:** Use `/token grant`, `/token remove`, and `/token set` to adjust user balances.\n' +
          '• **Check Balances:** Use `/token balance` and `/token top` to view balances.\n' +
          '• **Audit:** Use `/audit` to view a log of all token transactions.',
      },
    )
    .setFooter({ text: 'Obol Token Manager' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}