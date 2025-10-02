// src/commands/about.ts
import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CONFIG } from '../config';

export const data = new SlashCommandBuilder().setName('about').setDescription('Shows information about Obol.');

export async function execute(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setTitle('About Obol')
    .setDescription('A lightweight bot for managing per-game RP tokens.')
    .setColor('#d8ac57')
    .addFields(
      { name: 'Version', value: `v${process.env.npm_package_version || '0.1.0'}`, inline: true },
      { name: 'Author', value: '@noms', inline: true },
      { name: 'Dashboard', value: `[Admin Panel](${CONFIG.baseUrl})`, inline: true },
    )
    .setFooter({ text: 'Thank you for using Obol!' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}