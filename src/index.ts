// src/index.ts
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Collection,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  Interaction,
  MessageFlags,
} from 'discord.js';
import { CONFIG } from './config';
import * as gameCmd from './commands/game';
import * as tokenCmd from './commands/token';
import * as balanceCmd from './commands/balance';
import * as auditCmd from './commands/audit';

type Command = {
  data: { name: string; toJSON: () => unknown };
  execute: (i: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (i: AutocompleteInteraction) => Promise<void>;
  handleComponent?: (i: Interaction) => Promise<boolean>;
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = new Collection<string, Command>();
commands.set(gameCmd.data.name, gameCmd as unknown as Command);
commands.set(tokenCmd.data.name, tokenCmd as unknown as Command);
commands.set(balanceCmd.data.name, balanceCmd as unknown as Command);
commands.set(auditCmd.data.name, auditCmd as unknown as Command);

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(CONFIG.token);
  const payload = [
    gameCmd.data.toJSON(),
    tokenCmd.data.toJSON(),
    balanceCmd.data.toJSON(),
    auditCmd.data.toJSON(),
  ];
  if (CONFIG.devGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(client.application?.id ?? '0', CONFIG.devGuildId),
      { body: payload },
    );
    console.log('✓ Registered guild commands (dev)');
  } else {
    await rest.put(Routes.applicationCommands(client.application?.id ?? '0'), { body: payload });
    console.log('✓ Registered global commands');
  }
}

// Use clientReady (ready is deprecated in v15)
client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  // Autocomplete
  if (interaction.isAutocomplete()) {
    const cmd = commands.get(interaction.commandName);
    if (cmd?.autocomplete) {
      try {
        await cmd.autocomplete(interaction);
      } catch (e) {
        console.error(e);
      }
    }
    return;
  }

  // Component / Modal handlers
  if (await (tokenCmd.handleComponent?.(interaction) ?? Promise.resolve(false))) return;
  if (await (gameCmd.handleComponent?.(interaction) ?? Promise.resolve(false))) return;

  // Slash commands
  if (!interaction.isChatInputCommand()) return;
  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction);
  } catch (e) {
    console.error(e);
    const opts = { content: 'Error executing command.', flags: MessageFlags.Ephemeral as number };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(opts);
    } else {
      await interaction.reply(opts);
    }
  }
});

await client.login(CONFIG.token);
