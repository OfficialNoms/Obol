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
  // support both legacy and new names so all modules work
  autocomplete?: (i: AutocompleteInteraction) => Promise<void>;
  autocomplete2?: (i: AutocompleteInteraction) => Promise<void>;
  handleComponent?: (i: Interaction) => Promise<boolean>;
  handleComponent2?: (i: Interaction) => Promise<boolean>;
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = new Collection<string, Command>();
commands.set(gameCmd.data.name, gameCmd as unknown as Command);
commands.set(tokenCmd.data.name, tokenCmd as unknown as Command);
commands.set(balanceCmd.data.name, balanceCmd as unknown as Command);
commands.set(auditCmd.data.name, auditCmd as unknown as Command);

async function registerCommands() {
  // Resolve the application ID from the logged-in client
  const appId = client.application?.id ?? client.user?.id;
  if (!appId) throw new Error('Unable to resolve application ID from client');

  const rest = new REST({ version: '10' }).setToken(CONFIG.token);
  const payload = [
    gameCmd.data.toJSON(),
    tokenCmd.data.toJSON(),
    balanceCmd.data.toJSON(),
    auditCmd.data.toJSON(),
  ];

  if (CONFIG.devGuildId) {
    await rest.put(Routes.applicationGuildCommands(appId, CONFIG.devGuildId), { body: payload });
    console.log('✓ Registered guild commands (dev)');
  } else {
    await rest.put(Routes.applicationCommands(appId), { body: payload });
    console.log('✓ Registered global commands');
  }
}

// Use clientReady (future-proof for djs v15)
client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  try {
    await registerCommands();
  } catch (e) {
    console.error('Failed to register commands:', e);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd?.autocomplete) await cmd.autocomplete(interaction);
      else if (cmd?.autocomplete2) await cmd.autocomplete2(interaction);
      return;
    }

    // Component / modal handlers — try each module, stop when one returns true
    if (
      interaction.isRepliable() &&
      (interaction.isButton() || interaction.isModalSubmit() || interaction.isAnySelectMenu?.())
    ) {
      for (const cmd of commands.values()) {
        if (cmd.handleComponent && (await cmd.handleComponent(interaction))) return;
        if (cmd.handleComponent2 && (await cmd.handleComponent2(interaction))) return;
      }
    }

    // Slash commands
    if (!interaction.isChatInputCommand()) return;
    const cmd = commands.get(interaction.commandName);
    if (!cmd) return;
    await cmd.execute(interaction);
  } catch (e) {
    console.error(e);
    const opts = { content: 'Error executing command.', flags: MessageFlags.Ephemeral as number };
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied)
        await interaction.followUp(opts).catch(() => {});
      else await interaction.reply(opts).catch(() => {});
    }
  }
});

await client.login(CONFIG.token);
