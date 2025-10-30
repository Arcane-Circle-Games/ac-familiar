import { REST, Routes, ChatInputCommandInteraction } from 'discord.js';
import { ArcaneClient, Command } from './client';
import { config } from '../utils/config';
import { logError, logInfo, logDiscordEvent } from '../utils/logger';
import {
  isCommandTierExempt,
  hasAuthorizedTier,
  getUnauthorizedAccessMessage,
  getUnlinkedAccountMessage
} from '../utils/tier-auth';
import { arcaneAPI } from '../services/api';
import { pingCommand } from '../commands/ping';
import { diagnosticsCommand } from '../commands/diagnostics';
import { linkCommand } from '../commands/link';
import { gamesCommand } from '../commands/games';
import { searchGamesCommand } from '../commands/search-games';
import { joinGameCommand } from '../commands/join-game';
import { gameInfoCommand, gameInfoCommandData } from '../commands/game-info';
import { gmProfileCommand } from '../commands/gm-profile';
import { gmGameCommand } from '../commands/gm-game';
import { gmBookingsCommand } from '../commands/gm-bookings';
import { gmStatsCommand } from '../commands/gm-stats';
import { recordCommand, recordingManager } from '../commands/record';
import { leaveGameCommand } from '../commands/leave-game';
import { myGamesCommand } from '../commands/my-games';
import { nextSessionCommand } from '../commands/next-session';
import { profileCommand } from '../commands/profile';
import { attendanceCommand } from '../commands/attendance';

export class ArcaneBot {
  public client: ArcaneClient;
  private rest: REST;
  
  constructor() {
    this.client = new ArcaneClient();
    this.rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
    
    this.setupInteractionHandlers();
    this.loadCommands();
  }
  
  private setupInteractionHandlers() {
    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isChatInputCommand()) {
        const command = this.client.getCommand(interaction.commandName);

        if (!command) {
          logError(`Unknown command: ${interaction.commandName}`);
          return;
        }

        try {
          logDiscordEvent('commandExecuted', {
            commandName: interaction.commandName,
            userId: interaction.user.id,
            username: interaction.user.username,
            guildId: interaction.guildId
          });

          // Check if command is tier-exempt (link, ping)
          if (!isCommandTierExempt(interaction.commandName)) {
            // Command requires tier authorization - check user's tier
            try {
              const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);

              if (!user) {
                // User not linked
                await interaction.reply({
                  content: getUnlinkedAccountMessage(),
                  ephemeral: true
                });
                return;
              }

              if (!hasAuthorizedTier(user)) {
                // User linked but doesn't have authorized tier
                await interaction.reply({
                  content: getUnauthorizedAccessMessage(),
                  ephemeral: true
                });
                return;
              }

              // User has authorized tier - proceed with command execution
            } catch (error) {
              // User lookup failed - treat as unlinked
              logError('User lookup failed during tier check', error as Error, {
                userId: interaction.user.id,
                commandName: interaction.commandName
              });

              await interaction.reply({
                content: getUnlinkedAccountMessage(),
                ephemeral: true
              });
              return;
            }
          }

          // Execute the command (either tier-exempt or tier-authorized)
          await command.execute(interaction as ChatInputCommandInteraction);

        } catch (error) {
          logError(`Error executing command: ${interaction.commandName}`, error as Error, {
            userId: interaction.user.id,
            guildId: interaction.guildId
          });

          const errorMessage = 'There was an error while executing this command!';

          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
              await interaction.reply({ content: errorMessage, ephemeral: true });
            }
          } catch (replyError) {
            logError('Failed to send error message to user', replyError as Error);
          }
        }
      } else if (interaction.isAutocomplete()) {
        const command = this.client.getCommand(interaction.commandName);

        if (!command || !command.autocomplete) {
          return;
        }

        try {
          await command.autocomplete(interaction);
        } catch (error) {
          logError(`Error handling autocomplete for ${interaction.commandName}`, error as Error);
        }
      }
    });
  }
  
  private loadCommands() {
    const commands: Command[] = [
      pingCommand,
      diagnosticsCommand,
      linkCommand,
      gamesCommand,
      searchGamesCommand,
      joinGameCommand,
      gameInfoCommand,
      gmProfileCommand,
      gmGameCommand,
      gmBookingsCommand,
      gmStatsCommand,
      recordCommand,
      leaveGameCommand,
      myGamesCommand,
      nextSessionCommand,
      profileCommand,
      attendanceCommand
    ];
    
    commands.forEach(command => {
      this.client.addCommand(command);
    });
    
    logInfo(`Loaded ${commands.length} commands`);
  }
  
  private async registerCommands() {
    try {
      logInfo('🔄 Registering slash commands...');
      
      const commands = this.client.getAllCommands().map(command => {
        // Handle special commands with custom data
        if (command.name === 'game-info') {
          const commandData = gameInfoCommandData.toJSON();
          return {
            ...commandData,
            dm_permission: true
          };
        }

        // Define which commands are guild-only (voice/recording commands)
        const guildOnlyCommands = ['record'];

        return {
          name: command.name,
          description: command.description,
          options: command.options || [],
          dm_permission: !guildOnlyCommands.includes(command.name)
        };
      });
      
      // Always register globally for DM support
      await this.rest.put(
        Routes.applicationCommands(config.DISCORD_CLIENT_ID),
        { body: commands }
      );

      logInfo(`✅ Successfully registered ${commands.length} global commands`);

      // Also register to specific guild for instant updates during development
      if (config.DISCORD_GUILD_ID) {
        await this.rest.put(
          Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
          { body: commands }
        );

        logInfo(`✅ Also registered ${commands.length} guild commands for fast testing`);
      }
      
    } catch (error) {
      logError('Failed to register commands', error as Error);
      throw error;
    }
  }
  
  public async start(): Promise<void> {
    try {
      // Clean up orphaned PCM files from previous crashed sessions
      logInfo('🧹 Cleaning up orphaned PCM files...');
      await recordingManager.cleanupOrphanedPCMFiles('./recordings');

      // Start the Discord client
      await this.client.start();

      // Wait for the client to be ready
      await new Promise<void>((resolve) => {
        this.client.once('ready', () => resolve());
      });

      // Register slash commands
      await this.registerCommands();

      logInfo('🎉 Arcane Circle Discord Bot is online!');

    } catch (error) {
      logError('Failed to start bot', error as Error);
      throw error;
    }
  }
  
  public async stop(): Promise<void> {
    try {
      logInfo('🛑 Shutting down bot...');
      this.client.destroy();
      logInfo('✅ Bot shut down successfully');
    } catch (error) {
      logError('Error during bot shutdown', error as Error);
    }
  }
  
  public getClient(): ArcaneClient {
    return this.client;
  }
}