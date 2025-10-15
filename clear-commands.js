/**
 * Clear all slash commands (both guild and global)
 * Run this script if you see duplicate commands
 *
 * Usage:
 *   node clear-commands.js
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error('❌ Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env file');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function clearCommands() {
  try {
    console.log('🔄 Starting to clear slash commands...\n');

    // Clear guild commands if DISCORD_GUILD_ID is set
    if (guildId) {
      console.log(`📍 Clearing guild commands for guild: ${guildId}`);
      const guildCommands = await rest.get(
        Routes.applicationGuildCommands(clientId, guildId)
      );
      console.log(`   Found ${guildCommands.length} guild command(s)`);

      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: [] }
      );
      console.log('✅ Guild commands cleared\n');
    } else {
      console.log('⚠️  No DISCORD_GUILD_ID set, skipping guild commands\n');
    }

    // Clear global commands
    console.log('🌐 Clearing global commands...');
    const globalCommands = await rest.get(
      Routes.applicationCommands(clientId)
    );
    console.log(`   Found ${globalCommands.length} global command(s)`);

    await rest.put(
      Routes.applicationCommands(clientId),
      { body: [] }
    );
    console.log('✅ Global commands cleared\n');

    console.log('✨ All commands have been cleared!');
    console.log('💡 Restart your bot to re-register commands.');

  } catch (error) {
    console.error('❌ Error clearing commands:', error);
    process.exit(1);
  }
}

clearCommands();
