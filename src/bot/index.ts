import { REST, Routes, ChatInputCommandInteraction } from 'discord.js';
import { ArcaneClient, Command } from './client';
import { config } from '../utils/config';
import { logger, logError, logInfo, logDiscordEvent } from '../utils/logger';
import { pingCommand } from '../commands/ping';
import { testApiCommand } from '../commands/test-api';
import { linkCommand } from '../commands/link';
import { gamesCommand } from '../commands/games';
import { gameInfoCommand, gameInfoCommandData } from '../commands/game-info';
import { gmCommand } from '../commands/gm';
import { recordTestCommand } from '../commands/record-test';

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
      testApiCommand,
      linkCommand,
      gamesCommand,
      gameInfoCommand,
      gmCommand,
      recordTestCommand
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
          return gameInfoCommandData.toJSON();
        }
        
        return {
          name: command.name,
          description: command.description,
          options: command.options || []
        };
      });
      
      if (config.DISCORD_GUILD_ID) {
        // Register commands for a specific guild (faster for development)
        await this.rest.put(
          Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
          { body: commands }
        );
        
        logInfo(`✅ Successfully registered ${commands.length} guild commands`);
      } else {
        // Register commands globally (slower but works in all guilds)
        await this.rest.put(
          Routes.applicationCommands(config.DISCORD_CLIENT_ID),
          { body: commands }
        );
        
        logInfo(`✅ Successfully registered ${commands.length} global commands`);
      }
      
    } catch (error) {
      logError('Failed to register commands', error as Error);
      throw error;
    }
  }
  
  public async start(): Promise<void> {
    try {
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