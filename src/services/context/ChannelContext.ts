import { ChatInputCommandInteraction, EmbedBuilder, Message } from 'discord.js';
import { bookingService } from '../api/bookings';
import { logDebug, logInfo, logError } from '../../utils/logger';

export interface CampaignContext {
  gameId: string;
  gameName: string;
  wikiId: string;
  gmId: string;
  discordChannelId: string;
  discordServerId: string;
}

interface CacheEntry {
  context: CampaignContext;
  expiry: number;
}

class ChannelContextService {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  /**
   * Resolve campaign context from a channel ID
   * Checks cache first, then queries API via user's bookings
   */
  public async resolveCampaign(
    channelId: string,
    discordUserId: string
  ): Promise<CampaignContext | null> {
    const now = Date.now();

    // Check cache
    const cached = this.cache.get(channelId);
    if (cached && now < cached.expiry) {
      logDebug('Campaign context resolved from cache', { channelId });
      return cached.context;
    }

    // Cache miss - query API
    try {
      logDebug('Cache miss - fetching user bookings for context', { channelId, discordUserId });

      const bookings = await bookingService.getMyBookings(discordUserId);

      // Find game with matching discordChannelId
      for (const booking of bookings) {
        const game = booking.game as any;
        if (game?.discordChannelId === channelId && game?.wikiId) {
          const context: CampaignContext = {
            gameId: game.id,
            gameName: game.title,
            wikiId: game.wikiId,
            gmId: game.gmId,
            discordChannelId: channelId,
            discordServerId: game.discordServerId || ''
          };

          // Cache it
          this.cache.set(channelId, {
            context,
            expiry: now + this.CACHE_TTL
          });

          logInfo('Campaign context resolved and cached', {
            channelId,
            gameId: context.gameId,
            gameName: context.gameName
          });

          return context;
        }
      }

      // No match found
      logDebug('No campaign context found for channel', { channelId });
      return null;

    } catch (error) {
      logError('Failed to resolve campaign context', error as Error, { channelId, discordUserId });
      return null;
    }
  }

  /**
   * Resolve from interaction
   */
  public async resolveCampaignFromInteraction(
    interaction: ChatInputCommandInteraction
  ): Promise<CampaignContext | null> {
    if (!interaction.channelId) {
      return null;
    }
    return this.resolveCampaign(interaction.channelId, interaction.user.id);
  }

  /**
   * Resolve from message (for wiki link listener)
   * Only checks cache - doesn't query API
   */
  public resolveCampaignFromMessage(message: Message): CampaignContext | null {
    if (!message.channelId) {
      return null;
    }

    const now = Date.now();
    const cached = this.cache.get(message.channelId);
    if (cached && now < cached.expiry) {
      return cached.context;
    }

    return null;
  }

  /**
   * Helper: require campaign context and handle errors
   * Returns context or sends error message and returns null
   */
  public async requireCampaignContext(
    interaction: ChatInputCommandInteraction
  ): Promise<CampaignContext | null> {
    const ctx = await this.resolveCampaignFromInteraction(interaction);

    if (!ctx) {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFFAA00)
          .setTitle('⚠️ Campaign Not Found')
          .setDescription(
            'This channel isn\'t linked to a campaign. ' +
            'Ask your GM to run `/set-game-channel` here.'
          )
        ]
      });
      return null;
    }

    return ctx;
  }

  /**
   * Invalidate cache for a specific channel
   * Called when /set-game-channel succeeds
   */
  public invalidate(channelId: string): void {
    this.cache.delete(channelId);
    logInfo('Campaign context cache invalidated', { channelId });
  }

  /**
   * Clear all cached contexts (useful for debugging)
   */
  public clearCache(): void {
    const size = this.cache.size;
    this.cache.clear();
    logInfo('All campaign context cache cleared', { entriesCleared: size });
  }

  /**
   * Periodic cache cleanup (remove expired entries)
   */
  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      let cleared = 0;

      this.cache.forEach((entry, channelId) => {
        if (now >= entry.expiry) {
          this.cache.delete(channelId);
          cleared++;
        }
      });

      if (cleared > 0) {
        logDebug('Campaign context cache cleanup', { entriesCleared: cleared, remaining: this.cache.size });
      }
    }, 5 * 60 * 1000); // Clean every 5 minutes
  }

  constructor() {
    this.startCacheCleanup();
  }
}

export const channelContext = new ChannelContextService();
