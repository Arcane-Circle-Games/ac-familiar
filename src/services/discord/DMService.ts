import { Client, User, EmbedBuilder, TextChannel } from 'discord.js';
import { logInfo, logError, logDebug } from '../../utils/logger';

/**
 * Service for sending Discord DMs to users
 * Handles rate limiting, error handling, and graceful failures
 */
export class DMService {
  private client: Client;
  private dmQueue: Map<string, Date> = new Map(); // Track last DM time per user for rate limiting
  private readonly RATE_LIMIT_MS = 1000; // 1 second between DMs to same user

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Send a DM to a user by their Discord ID
   * @param discordId - Discord user ID
   * @param embed - Discord embed to send
   * @param fallbackChannelId - Optional channel to post to if DM fails
   * @returns Success boolean
   */
  async sendDM(
    discordId: string,
    embed: EmbedBuilder,
    fallbackChannelId?: string
  ): Promise<boolean> {
    try {
      // Check rate limit for this user
      await this.checkRateLimit(discordId);

      // Fetch the Discord user
      const user = await this.fetchUser(discordId);
      if (!user) {
        logError('Failed to send DM: User not found', new Error('User not found'), {
          discordId
        });
        return false;
      }

      // Attempt to send DM
      await user.send({ embeds: [embed] });

      // Update rate limit tracker
      this.dmQueue.set(discordId, new Date());

      logInfo('DM sent successfully', {
        discordId,
        username: user.username
      });

      return true;

    } catch (error) {
      return await this.handleDMError(error, discordId, embed, fallbackChannelId);
    }
  }

  /**
   * Send DMs to multiple users
   * @param recipients - Array of Discord IDs
   * @param embedFactory - Function that creates an embed for each user
   */
  async sendBulkDMs(
    recipients: Array<{ discordId: string; data?: any }>,
    embedFactory: (data?: any) => EmbedBuilder
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const recipient of recipients) {
      const embed = embedFactory(recipient.data);
      const result = await this.sendDM(recipient.discordId, embed);

      if (result) {
        success++;
      } else {
        failed++;
      }

      // Small delay between bulk DMs to respect Discord rate limits
      await this.delay(200);
    }

    logInfo('Bulk DM send completed', {
      total: recipients.length,
      success,
      failed
    });

    return { success, failed };
  }

  /**
   * Fetch a Discord user by ID
   * @param discordId - Discord user ID
   * @returns User object or null if not found
   */
  private async fetchUser(discordId: string): Promise<User | null> {
    try {
      const user = await this.client.users.fetch(discordId);
      return user;
    } catch (error) {
      logDebug('Failed to fetch Discord user', {
        discordId,
        error: (error as Error).message
      });
      return null;
    }
  }

  /**
   * Check rate limit before sending DM
   * @param discordId - Discord user ID
   */
  private async checkRateLimit(discordId: string): Promise<void> {
    const lastDMTime = this.dmQueue.get(discordId);

    if (lastDMTime) {
      const timeSinceLastDM = Date.now() - lastDMTime.getTime();

      if (timeSinceLastDM < this.RATE_LIMIT_MS) {
        const waitTime = this.RATE_LIMIT_MS - timeSinceLastDM;
        logDebug('Rate limiting DM', { discordId, waitTime });
        await this.delay(waitTime);
      }
    }
  }

  /**
   * Handle DM sending errors
   * @param error - Error object
   * @param discordId - Discord user ID
   * @param embed - Embed that failed to send
   * @param fallbackChannelId - Optional channel to post to if DM fails
   */
  private async handleDMError(
    error: unknown,
    discordId: string,
    embed: EmbedBuilder,
    fallbackChannelId?: string
  ): Promise<boolean> {
    const errorMessage = (error as Error).message;
    const errorCode = (error as any).code;

    // Handle specific Discord API errors
    if (errorCode === 50007) {
      // Cannot send messages to this user (DMs disabled or blocked bot)
      logInfo('Cannot send DM to user - DMs disabled or blocked', {
        discordId,
        reason: 'User has DMs disabled or blocked the bot'
      });
    } else if (errorCode === 50013) {
      // Missing permissions
      logError('Cannot send DM to user - Missing permissions', error as Error, {
        discordId
      });
    } else {
      // Other errors
      logError('Failed to send DM', error as Error, {
        discordId,
        errorCode,
        errorMessage
      });
    }

    // Try fallback channel if provided
    if (fallbackChannelId) {
      return await this.sendToFallbackChannel(fallbackChannelId, embed, discordId);
    }

    return false;
  }

  /**
   * Send message to a fallback channel if DM fails
   * @param channelId - Channel ID to post to
   * @param embed - Embed to send
   * @param discordId - User's Discord ID for mention
   */
  private async sendToFallbackChannel(
    channelId: string,
    embed: EmbedBuilder,
    discordId: string
  ): Promise<boolean> {
    try {
      const channel = await this.client.channels.fetch(channelId);

      if (channel && channel.isTextBased()) {
        await (channel as TextChannel).send({
          content: `<@${discordId}> - I couldn't DM you, so here's your notification:`,
          embeds: [embed]
        });

        logInfo('Notification sent to fallback channel', {
          channelId,
          discordId
        });

        return true;
      }

      return false;
    } catch (error) {
      logError('Failed to send to fallback channel', error as Error, {
        channelId,
        discordId
      });
      return false;
    }
  }

  /**
   * Delay helper for rate limiting
   * @param ms - Milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear rate limit tracking (useful for testing)
   */
  clearRateLimitCache(): void {
    this.dmQueue.clear();
    logDebug('DM rate limit cache cleared');
  }
}

export default DMService;
