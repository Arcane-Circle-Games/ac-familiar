import { logger } from '@/utils/logger';
import { prisma } from '@/lib/db';
import { config } from '@/utils/config';
import { getClient } from '@/bot';

export class WebhookListener {
  private bot: any;

  constructor(bot: any) {
    this.bot = bot;
  }

  async handleGamePublished(payload: any) {
    try {
      const { content, embed } = this.buildGameAnnouncement(payload);

      // Post to AC channel (existing)
      const channel = await this.bot.client.channels.fetch(config.GAME_ANNOUNCEMENT_CHANNEL_ID);
      if (channel?.isTextBased()) {
        const roleId = config.GAME_ANNOUNCEMENT_ROLE_ID;
        let acContent = content;
        if (roleId) {
          acContent = `<@&${roleId}>\n${content}`;
        }
        await channel.send({
          content: acContent,
          embeds: [embed],
          allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
        });
      }

      // Post to guild channel (new)
      if (payload.guildAnnouncement?.discordChannelId) {
        try {
          const guildChannel = await this.bot.client.channels.fetch(
            payload.guildAnnouncement.discordChannelId
          );
          if (guildChannel?.isTextBased()) {
            await guildChannel.send({
              embeds: [embed]
            });
          }
        } catch (error) {
          logger.warn(
            `Failed to post guild announcement to channel ${payload.guildAnnouncement.discordChannelId}:`,
            error
          );
        }
      }
    } catch (error) {
      logger.error('Failed to handle game published webhook:', error);
      throw error;
    }
  }

  private buildGameAnnouncement(payload: any) {
    const { game } = payload;
    // ... build announcement content and embed
    return { content: '🎮 New Game Available!', embed: {} };
  }
}
