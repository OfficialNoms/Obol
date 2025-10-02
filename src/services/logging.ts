// src/services/logging.ts
import type { Guild, TextChannel, EmbedBuilder } from 'discord.js';
import type { GameRow } from '../db';
import { parseSettings } from '../permissions';

/** Posts a log embed to the game's configured log channel (if any) */
export async function postLog(guild: Guild, game: GameRow, embed: EmbedBuilder) {
  const settings = parseSettings(game.settingsJson);
  const chId = settings.logChannelId;
  if (!chId) return;

  try {
    const ch = guild.channels.cache.get(chId) ?? await guild.channels.fetch(chId);
    if (!ch || !ch.isTextBased()) return;
    
    await (ch as TextChannel).send({ embeds: [embed] });
  } catch (e) {
    console.warn(`[Logging] Failed to send log for game ${game.id} in guild ${guild.id}:`, e);
  }
}