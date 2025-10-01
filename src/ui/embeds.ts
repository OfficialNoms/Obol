import { APIEmbed, Colors, EmbedBuilder } from 'discord.js';

export function ok(title: string, description?: string): EmbedBuilder {
  return base()
    .setTitle(`✅ ${title}`)
    .setColor(Colors.Green)
    .setDescription(description ?? '');
}
export function err(description: string): EmbedBuilder {
  return base().setTitle('⚠️ Error').setColor(Colors.Red).setDescription(description);
}
export function info(title: string, description?: string): EmbedBuilder {
  return base()
    .setTitle(`ℹ️ ${title}`)
    .setColor(Colors.Blurple)
    .setDescription(description ?? '');
}

export function mutationEmbed(
  title: string,
  fields: { name: string; value: string; inline?: boolean }[],
): EmbedBuilder {
  return base().setTitle(title).setColor(Colors.Blurple).setFields(fields);
}

export function grayFooter(text: string): APIEmbed['footer'] {
  return { text };
}

function base(): EmbedBuilder {
  return new EmbedBuilder();
}
