// src/index.ts
import 'dotenv/config';

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
  Events,
} from 'discord.js';
import { CONFIG } from './config.js';
import * as gameCmd from './commands/game.js';
import * as tokenCmd from './commands/token.js';
import * as balanceCmd from './commands/balance.js';
import * as auditCmd from './commands/audit.js';
import * as configCmd from './commands/config.js';
import * as aboutCmd from './commands/about.js';
import * as helpCmd from './commands/help.js';
import { startWebServer } from './web/server.js';

type Command = {
  data: { name: string; toJSON: () => unknown };
  execute: (i: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (i: AutocompleteInteraction) => Promise<void>;
  handleComponent?: (i: Interaction) => Promise<boolean>;
};

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const commands = new Collection<string, Command>();
commands.set(gameCmd.data.name, gameCmd as unknown as Command);
commands.set(tokenCmd.data.name, tokenCmd as unknown as Command);
commands.set(balanceCmd.data.name, balanceCmd as unknown as Command);
commands.set(auditCmd.data.name, auditCmd as unknown as Command);
commands.set(configCmd.data.name, configCmd as unknown as Command);
commands.set(aboutCmd.data.name, aboutCmd as unknown as Command);
commands.set(helpCmd.data.name, helpCmd as unknown as Command);

async function registerCommands() {
  const appId = client.application?.id ?? client.user?.id;
  if (!appId) throw new Error('Unable to resolve application ID from client');

  const rest = new REST({ version: '10' }).setToken(CONFIG.token);
  const payload = commands.map((cmd) => cmd.data.toJSON());

  if (CONFIG.devGuildId) {
    await rest.put(Routes.applicationGuildCommands(appId, CONFIG.devGuildId), { body: payload });
    console.log('✓ Registered guild commands (dev)');
  } else {
    await rest.put(Routes.applicationCommands(appId), { body: payload });
    console.log('✓ Registered global commands');
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  try {
    await registerCommands();
    startWebServer(client);
  } catch (e) {
    console.error('Failed during startup:', e);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd?.autocomplete) await cmd.autocomplete(interaction);
      return;
    }

    if (
      interaction.isRepliable() &&
      (interaction.isButton() ||
        interaction.isModalSubmit() ||
        (interaction as any).isAnySelectMenu?.())
    ) {
      for (const cmd of commands.values()) {
        if (cmd.handleComponent && (await cmd.handleComponent(interaction))) return;
      }
    }

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