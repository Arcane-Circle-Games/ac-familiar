import { Client, GatewayIntentBits, Collection, ClientOptions } from 'discord.js';
import { logger, logDiscordEvent, logError } from '../utils/logger';
import { config } from '../utils/config';

export interface Command {
  name: string;
  description: string;
  options?: any[];
  execute: (interaction: any) => Promise<void>;
  autocomplete?: (interaction: any) => Promise<void>;
}

export class ArcaneClient extends Client {
  public commands: Collection<string, Command> = new Collection();
  
  constructor() {
    const options: ClientOptions = {
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
      ]
    };
    
    super(options);
    
    this.setupEventListeners();
  }
  
  private setupEventListeners() {
    this.once('ready', () => {
      logDiscordEvent('ready', {
        user: this.user?.tag,
        id: this.user?.id,
        guilds: this.guilds.cache.size
      });
    });
    
    this.on('error', (error) => {
      logError('Discord client error', error);
    });
    
    this.on('warn', (warning) => {
      logger.warn(`Discord client warning: ${warning}`);
    });
    
    this.on('debug', (info) => {
      logger.debug(`Discord client debug: ${info}`);
    });
    
    this.on('guildCreate', (guild) => {
      logDiscordEvent('guildCreate', {
        guildId: guild.id,
        guildName: guild.name,
        memberCount: guild.memberCount
      });
    });
    
    this.on('guildDelete', (guild) => {
      logDiscordEvent('guildDelete', {
        guildId: guild.id,
        guildName: guild.name
      });
    });
    
    this.on('voiceStateUpdate', (oldState, newState) => {
      logDiscordEvent('voiceStateUpdate', {
        userId: newState.member?.id,
        username: newState.member?.user.username,
        oldChannelId: oldState.channelId,
        newChannelId: newState.channelId,
        guildId: newState.guild.id
      });
    });
  }
  
  public async start(): Promise<void> {
    try {
      await this.login(config.DISCORD_TOKEN);
    } catch (error) {
      logError('Failed to login to Discord', error as Error);
      throw error;
    }
  }
  
  public addCommand(command: Command): void {
    this.commands.set(command.name, command);
    logger.info(`Loaded command: ${command.name}`);
  }
  
  public getCommand(name: string): Command | undefined {
    return this.commands.get(name);
  }
  
  public getAllCommands(): Command[] {
    return Array.from(this.commands.values());
  }
}