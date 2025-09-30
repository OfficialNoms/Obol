import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  User,
  AutocompleteInteraction,
  GuildMember,
} from 'discord.js';
import { resolveGameFlexible, listGames, getGameById } from '../services/game';
import {
  getBalance,
  ensureWallet,
  incrementBalance,
  setBalance,
  topBalances,
} from '../services/wallet';
import { mutationEmbed, ok, err } from '../ui/embeds';
import { CONFIG } from '../config';
import { isGameManager, isGranter } from '../permissions';

export const data = new SlashCommandBuilder()
  .setName('token')
  .setDescription('Grant / manage per-game RP tokens')
  .addSubcommand((sc) =>
    sc
      .setName('grant')
      .setDescription('Grant tokens to a member')
      .addStringOption((o) =>
        o
          .setName('game')
          .setDescription('Game name (autocomplete) or ID')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true))
      .addStringOption((o) => o.setName('note').setDescription('Note').setRequired(false)),
  )
  .addSubcommand((sc) =>
    sc
      .setName('remove')
      .setDescription('Remove tokens from a member')
      .addStringOption((o) =>
        o
          .setName('game')
          .setDescription('Game name (autocomplete) or ID')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true))
      .addStringOption((o) => o.setName('note').setDescription('Note').setRequired(false)),
  )
  .addSubcommand((sc) =>
    sc
      .setName('set')
      .setDescription('Set a member balance (manager only)')
      .addStringOption((o) =>
        o
          .setName('game')
          .setDescription('Game name (autocomplete) or ID')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true))
      .addStringOption((o) => o.setName('note').setDescription('Note').setRequired(false)),
  )
  .addSubcommand((sc) =>
    sc
      .setName('balance')
      .setDescription('View a member balance (restricted)')
      .addStringOption((o) =>
        o
          .setName('game')
          .setDescription('Game name (autocomplete) or ID')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)),
  )
  .addSubcommand((sc) =>
    sc
      .setName('top')
      .setDescription('Top balances (restricted)')
      .addStringOption((o) =>
        o
          .setName('game')
          .setDescription('Game name (autocomplete) or ID')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addIntegerOption((o) =>
        o.setName('limit').setDescription('1-50 (default 10)').setMinValue(1).setMaxValue(50),
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

export async function autocomplete(interaction: AutocompleteInteraction) {
  if (!interaction.inGuild() || !interaction.guild) return;
  const focused = interaction.options.getFocused().trim();

  const games = listGames(interaction.guild.id);
  const query = focused.toLowerCase();
  let filtered = games;

  if (focused) {
    filtered = games.filter((g) => {
      const name = g.name.toLowerCase();
      return name.startsWith(query) || name.includes(query) || String(g.id).startsWith(query);
    });
  }

  const choices = filtered.slice(0, 25).map((g) => ({
    name: `${g.name} (#${g.id})`,
    value: String(g.id),
  }));

  await interaction.respond(choices);
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild() || !interaction.guild) {
    return interaction.reply({ embeds: [err('Guild-only command')], ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
  const gameInput = interaction.options.getString('game', true);

  const game =
    (/^\d+$/.test(gameInput)
      ? getGameById(interaction.guild.id, Number(gameInput))
      : resolveGameFlexible(interaction.guild.id, gameInput)) ?? undefined;
  if (!game) return interaction.reply({ embeds: [err('Game not found')], ephemeral: true });

  // Ensure a real GuildMember
  const member: GuildMember =
    interaction.guild.members.resolve(interaction.user.id) ??
    (await interaction.guild.members.fetch(interaction.user.id));

  const manager = isGameManager(member, game, CONFIG.botAdminRoleIds);
  const granter = isGranter(member, game, CONFIG.botAdminRoleIds);

  if (sub === 'grant' || sub === 'remove') {
    if (!granter) return interaction.reply({ embeds: [err('No permission')], ephemeral: true });
    const user = interaction.options.getUser('member', true) as User;
    const amount = interaction.options.getInteger('amount', true);
    const note = interaction.options.getString('note') ?? undefined;
    const delta = sub === 'grant' ? amount : -amount;
    try {
      ensureWallet(interaction.guild.id, game.id, user.id);
      const { before, after } = incrementBalance(interaction.guild.id, game.id, user.id, delta);
      await interaction.reply({
        embeds: [
          mutationEmbed({
            action: sub,
            gameName: game.name,
            target: user,
            amount,
            before,
            after,
            note,
          }),
        ],
        ephemeral: true,
      });
    } catch (e) {
      await interaction.reply({
        embeds: [err('Failed', String((e as Error).message))],
        ephemeral: true,
      });
    }
    return;
  }

  if (sub === 'set') {
    if (!manager) return interaction.reply({ embeds: [err('Managers only')], ephemeral: true });
    const user = interaction.options.getUser('member', true) as User;
    const amount = interaction.options.getInteger('amount', true);
    const note = interaction.options.getString('note') ?? undefined;
    try {
      ensureWallet(interaction.guild.id, game.id, user.id);
      const { before, after } = setBalance(interaction.guild.id, game.id, user.id, amount);
      await interaction.reply({
        embeds: [
          mutationEmbed({
            action: 'set',
            gameName: game.name,
            target: user,
            amount,
            before,
            after,
            note,
          }),
        ],
        ephemeral: true,
      });
    } catch (e) {
      await interaction.reply({
        embeds: [err('Failed', String((e as Error).message))],
        ephemeral: true,
      });
    }
    return;
  }

  if (sub === 'balance') {
    if (!granter && !manager)
      return interaction.reply({ embeds: [err('Restricted')], ephemeral: true });
    const user = interaction.options.getUser('member', true) as User;
    const bal = getBalance(interaction.guild.id, game.id, user.id);
    await interaction.reply({
      embeds: [ok(`${game.name} — Balance`, `<@${user.id}>: **${bal}**`)],
      ephemeral: true,
    });
    return;
  }

  if (sub === 'top') {
    if (!granter && !manager)
      return interaction.reply({ embeds: [err('Restricted')], ephemeral: true });
    const limit = interaction.options.getInteger('limit') ?? 10;
    const rows = topBalances(interaction.guild.id, game.id, limit);
    const body =
      rows.length === 0
        ? '_No balances_'
        : rows.map((r, i) => `**${i + 1}.** <@${r.userId}> — **${r.balance}**`).join('\n');
    await interaction.reply({
      embeds: [ok(`${game.name} — Top`, body)],
      ephemeral: true,
    });
  }
}
