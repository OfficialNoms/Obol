import { APIEmbed, Colors, User } from 'discord.js';

export function ok(title: string, description?: string): APIEmbed {
  return { title, description, color: Colors.Blurple, timestamp: new Date().toISOString() };
}

export function err(title: string, description?: string): APIEmbed {
  return { title, description, color: Colors.Red, timestamp: new Date().toISOString() };
}

export function mutationEmbed(params: {
  action: 'grant' | 'remove' | 'set';
  gameName: string;
  target: User;
  amount: number;
  before: number;
  after: number;
  note?: string;
}): APIEmbed {
  const delta = params.after - params.before;
  const sign = delta >= 0 ? '+' : '';
  return {
    title: `/${params.action} • ${params.gameName}`,
    color: delta >= 0 ? Colors.Green : Colors.Red,
    fields: [
      { name: 'Member', value: `<@${params.target.id}>`, inline: true },
      { name: 'Amount', value: `${params.amount}`, inline: true },
      { name: 'Before → After', value: `${params.before} → ${params.after}`, inline: true },
      { name: 'Δ', value: `${sign}${delta}`, inline: true }
    ],
    description: params.note ? `**Note:** ${params.note}` : undefined,
    timestamp: new Date().toISOString(),
  };
}
