import * as cron from 'node-cron';
import { EmbedBuilder, TextChannel } from 'discord.js';
import { ArcaneBot } from '../../bot';
import { config } from '../../utils/config';
import { logInfo, logError, logDebug } from '../../utils/logger';
import { arcaneAPI } from '../api';
import type { RecentGame } from '../../types/api';

/**
 * GameAnnouncementScheduler handles periodic polling for new games and posting them to Discord
 *
 * Features:
 * - Configurable schedule via environment variables
 * - Discord rate limit compliance (max 5 messages per 5 seconds)
 * - Rich embeds with game details and links
 * - Graceful error handling
 */
export class GameAnnouncementScheduler {
  private bot: ArcaneBot;
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;
  private readonly RATE_LIMIT_DELAY = 1100; // 1.1 seconds between messages (max ~5 per 5 sec)

  constructor(bot: ArcaneBot) {
    this.bot = bot;
    logInfo('GameAnnouncementScheduler: Initialized');
  }

  /**
   * Start the scheduled game announcement job
   */
  public start(): void {
    if (!config.GAME_ANNOUNCEMENT_ENABLED) {
      logInfo('GameAnnouncementScheduler: Disabled by configuration');
      return;
    }

    if (!config.GAME_ANNOUNCEMENT_CHANNEL_ID) {
      logError(
        'GameAnnouncementScheduler: GAME_ANNOUNCEMENT_CHANNEL_ID not configured',
        new Error('Missing channel ID')
      );
      return;
    }

    // Build cron schedule from interval hours (e.g., 3 hours = "0 */3 * * *")
    const cronSchedule = `0 */${config.GAME_ANNOUNCEMENT_INTERVAL_HOURS} * * *`;

    try {
      this.cronJob = cron.schedule(cronSchedule, async () => {
        await this.checkForNewGames();
      });

      logInfo('GameAnnouncementScheduler: Started', {
        schedule: cronSchedule,
        intervalHours: config.GAME_ANNOUNCEMENT_INTERVAL_HOURS,
        channelId: config.GAME_ANNOUNCEMENT_CHANNEL_ID
      });
    } catch (error) {
      logError('GameAnnouncementScheduler: Failed to start', error as Error, {
        schedule: cronSchedule
      });
    }
  }

  /**
   * Stop the scheduled job
   */
  public stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      logInfo('GameAnnouncementScheduler: Stopped');
    }
  }

  /**
   * Cleanup resources (call on bot shutdown)
   */
  public async cleanup(): Promise<void> {
    this.stop();
    logInfo('GameAnnouncementScheduler: Cleaned up');
  }

  /**
   * Main job function: Check for new games and announce them
   * Can also be called manually for testing
   */
  public async checkForNewGames(): Promise<void> {
    if (this.isRunning) {
      logDebug('GameAnnouncementScheduler: Already running, skipping this cycle');
      return;
    }

    this.isRunning = true;

    try {
      logInfo('GameAnnouncementScheduler: Checking for new games');

      // Calculate time window based on interval
      const minutes = config.GAME_ANNOUNCEMENT_INTERVAL_HOURS * 60;

      // Fetch recently published games from API
      const recentGames = await arcaneAPI.games.getRecentGames(minutes);

      // DETAILED DEBUG LOGGING
      console.log('=== SCHEDULER RECEIVED GAMES ===');
      console.log('Minutes requested:', minutes);
      console.log('Games count:', recentGames.length);
      console.log('Games array:', JSON.stringify(recentGames, null, 2));
      console.log('================================');

      logInfo('GameAnnouncementScheduler: Found recent games', {
        count: recentGames.length,
        minutes
      });

      if (recentGames.length === 0) {
        logInfo('GameAnnouncementScheduler: No games to announce');
        return;
      }

      // Announce each game
      let announced = 0;
      let failed = 0;

      for (const game of recentGames) {
        try {
          await this.announceGame(game);
          announced++;

          // Rate limit: Wait between announcements (max 5 per 5 seconds)
          if (announced < recentGames.length) {
            await this.sleep(this.RATE_LIMIT_DELAY);
          }
        } catch (error) {
          failed++;
          logError('GameAnnouncementScheduler: Failed to announce game', error as Error, {
            gameId: game.id,
            gameTitle: game.title
          });
          // Continue with other games even if one fails
        }
      }

      logInfo('GameAnnouncementScheduler: Finished announcing games', {
        announced,
        failed
      });
    } catch (error) {
      logError('GameAnnouncementScheduler: Error in checkForNewGames', error as Error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Announce a single game to the configured Discord channel
   */
  private async announceGame(game: RecentGame): Promise<void> {
    const channelId = config.GAME_ANNOUNCEMENT_CHANNEL_ID!;

    try {
      // Fetch the Discord channel
      const channel = await this.bot.client.channels.fetch(channelId);

      if (!channel) {
        throw new Error(`Channel ${channelId} not found`);
      }

      if (!channel.isTextBased() || !(channel instanceof TextChannel)) {
        throw new Error(`Channel ${channelId} is not a text channel`);
      }

      // Build the announcement embed
      const embed = this.buildGameEmbed(game);

      // Send the announcement
      await channel.send({ embeds: [embed] });

      logInfo('GameAnnouncementScheduler: Announced game', {
        gameId: game.id,
        gameTitle: game.title,
        channelId
      });
    } catch (error) {
      logError('GameAnnouncementScheduler: Failed to announce game', error as Error, {
        gameId: game.id,
        channelId
      });
      throw error;
    }
  }

  /**
   * Build a rich Discord embed for a game announcement
   */
  private buildGameEmbed(game: RecentGame): EmbedBuilder {
    // Convert HTML description to Discord markdown
    const cleanDescription = this.htmlToDiscordMarkdown(game.description);

    const embed = new EmbedBuilder()
      .setColor(0x00d4ff) // Arcane Circle brand color
      .setTitle(`🎮 ${game.title}`)
      .setDescription(this.truncateDescription(cleanDescription, 300))
      .setTimestamp(new Date(game.publishedAt));

    // Game details field
    const gameDetails = [
      `**System:** ${game.system.shortName || game.system.name}`,
      `**Type:** ${this.formatGameType(game.gameType)}`,
      `**GM:** ${game.gm.displayName}${game.gm.profile.verified ? ' ✓' : ''}`
    ];

    if (game.gm.profile.totalRatings > 0) {
      gameDetails.push(`**Rating:** ⭐ ${game.gm.profile.averageRating} (${game.gm.profile.totalRatings} reviews)`);
    }

    embed.addFields({
      name: '📋 Game Details',
      value: gameDetails.join('\n'),
      inline: false
    });

    // Session info field
    const sessionInfo = [
      `**Start Time:** <t:${Math.floor(new Date(game.startTime).getTime() / 1000)}:F>`,
      `**Duration:** ${game.duration} hours`,
      `**Price:** $${game.pricePerSession}/session`
    ];

    embed.addFields({
      name: '📅 Session Info',
      value: sessionInfo.join('\n'),
      inline: false
    });

    // Availability field
    const availabilityText = game.availableSlots > 0
      ? `${game.availableSlots} of ${game.maxPlayers} slots available`
      : 'Game is full';

    embed.addFields({
      name: '👥 Availability',
      value: availabilityText,
      inline: true
    });

    // Link to game page
    embed.addFields({
      name: '🔗 View Game',
      value: `[Open on Arcane Circle](${game.url})`,
      inline: true
    });

    // Join command
    embed.addFields({
      name: '⚡ Quick Join',
      value: `\`/join-game game-id:${game.id}\``,
      inline: true
    });

    // Footer
    const iconURL = this.bot.client.user?.displayAvatarURL();
    if (iconURL) {
      embed.setFooter({
        text: 'Arcane Circle',
        iconURL
      });
    } else {
      embed.setFooter({
        text: 'Arcane Circle'
      });
    }

    return embed;
  }

  /**
   * Format game type for display
   */
  private formatGameType(gameType: string): string {
    const typeMap: Record<string, string> = {
      'CAMPAIGN': 'Campaign',
      'ONE_SHOT': 'One-Shot',
      'MINI_CAMPAIGN': 'Mini Campaign',
      'WEST_MARCHES': 'West Marches'
    };

    return typeMap[gameType] || gameType;
  }

  /**
   * Convert HTML to Discord markdown and strip remaining tags
   */
  private htmlToDiscordMarkdown(html: string): string {
    if (!html) return '';

    let text = html;

    // Convert common HTML tags to Discord markdown
    text = text.replace(/<strong>(.*?)<\/strong>/gi, '**$1**'); // bold
    text = text.replace(/<b>(.*?)<\/b>/gi, '**$1**'); // bold
    text = text.replace(/<em>(.*?)<\/em>/gi, '*$1*'); // italic
    text = text.replace(/<i>(.*?)<\/i>/gi, '*$1*'); // italic
    text = text.replace(/<u>(.*?)<\/u>/gi, '__$1__'); // underline
    text = text.replace(/<code>(.*?)<\/code>/gi, '`$1`'); // inline code

    // Handle line breaks
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<p>/gi, '');

    // Handle lists
    text = text.replace(/<li>(.*?)<\/li>/gi, '• $1\n');
    text = text.replace(/<\/?[uo]l>/gi, '');

    // Strip all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode common HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");

    // Clean up excessive whitespace
    text = text.replace(/\n\n\n+/g, '\n\n'); // max 2 newlines
    text = text.trim();

    return text;
  }

  /**
   * Truncate description to fit Discord embed limits
   */
  private truncateDescription(description: string, maxLength: number): string {
    if (description.length <= maxLength) {
      return description;
    }

    return description.substring(0, maxLength - 3) + '...';
  }

  /**
   * Sleep utility for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
