import { WebhookListener } from '../WebhookListener';
import { config } from '../../../utils/config';
import { logger } from '../../../utils/logger';
import type { GamePublishedWebhook } from '../../../types/webhooks';

// Mock dependencies
jest.mock('../../../utils/logger');
jest.mock('../../../utils/config');
jest.mock('../../../utils/embeds/notifications');
jest.mock('../../../services/discord/DMService');

describe('WebhookListener', () => {
  let webhookListener: WebhookListener;
  let mockBot: any;
  let mockChannel: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock channel
    mockChannel = {
      id: 'channel-123',
      isTextBased: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue({}),
    };

    // Setup mock bot
    mockBot = {
      client: {
        channels: {
          fetch: jest.fn().mockResolvedValue(mockChannel),
        },
      },
    };

    webhookListener = new WebhookListener();
    webhookListener.setBot(mockBot);
  });

  describe('handleGamePublished feature flag guard', () => {
    const mockPayload: GamePublishedWebhook = {
      event: 'notification.game.published',
      timestamp: Date.now(),
      gameId: 'game-123',
      channelId: 'channel-123',
      game: {
        id: 'game-123',
        title: 'Test Game',
        description: 'Test description',
        system: { name: 'D&D 5e', shortName: 'D&D' },
        gameType: 'ONE_SHOT',
        startTime: new Date().toISOString(),
        duration: 4,
        pricePerSession: 10,
        maxPlayers: 5,
        availableSlots: 3,
        url: 'https://example.com/game/123',
        publishedAt: new Date().toISOString(),
        gm: {
          displayName: 'Test GM',
          profile: {
            verified: true,
            averageRating: 4.5,
            totalRatings: 10,
          },
        },
      },
    };

    it('should return early when GAME_ANNOUNCEMENT_ENABLED is false', async () => {
      (config as any).GAME_ANNOUNCEMENT_ENABLED = false;

      await (webhookListener as any).handleGamePublished(mockPayload);

      expect(logger.debug).toHaveBeenCalledWith('Game announcement disabled, skipping webhook-triggered post');
      expect(mockBot.client.channels.fetch).not.toHaveBeenCalled();
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it('should process webhook when GAME_ANNOUNCEMENT_ENABLED is true', async () => {
      (config as any).GAME_ANNOUNCEMENT_ENABLED = true;
      (config as any).GAME_ANNOUNCEMENT_ROLE_ID = '';

      const { buildGamePublishedEmbed } = require('../../../utils/embeds/notifications');
      buildGamePublishedEmbed.mockReturnValue({ title: 'Test Embed' });

      await (webhookListener as any).handleGamePublished(mockPayload);

      expect(mockBot.client.channels.fetch).toHaveBeenCalledWith('channel-123');
      expect(mockChannel.send).toHaveBeenCalled();
    });
  });

  describe('handleGamePublished with role ping', () => {
    const mockPayload: GamePublishedWebhook = {
      event: 'notification.game.published',
      timestamp: Date.now(),
      gameId: 'game-123',
      channelId: 'channel-123',
      game: {
        id: 'game-123',
        title: 'Test Game',
        description: 'Test description',
        system: { name: 'D&D 5e', shortName: 'D&D' },
        gameType: 'ONE_SHOT',
        startTime: new Date().toISOString(),
        duration: 4,
        pricePerSession: 10,
        maxPlayers: 5,
        availableSlots: 3,
        url: 'https://example.com/game/123',
        publishedAt: new Date().toISOString(),
        gm: {
          displayName: 'Test GM',
          profile: {
            verified: true,
            averageRating: 4.5,
            totalRatings: 10,
          },
        },
      },
    };

    beforeEach(() => {
      (config as any).GAME_ANNOUNCEMENT_ENABLED = true;
      const { buildGamePublishedEmbed } = require('../../../utils/embeds/notifications');
      buildGamePublishedEmbed.mockReturnValue({ title: 'Test Embed' });
    });

    it('should include role ping and allowedMentions when role ID is set', async () => {
      (config as any).GAME_ANNOUNCEMENT_ROLE_ID = 'role-123';

      await (webhookListener as any).handleGamePublished(mockPayload);

      expect(mockChannel.send).toHaveBeenCalledWith({
        content: '<@&role-123>\n# 🎮 New Game Available!',
        embeds: [{ title: 'Test Embed' }],
        allowedMentions: { roles: ['role-123'] },
      });
    });

    it('should not include role ping or allowedMentions when role ID is empty', async () => {
      (config as any).GAME_ANNOUNCEMENT_ROLE_ID = '';

      await (webhookListener as any).handleGamePublished(mockPayload);

      expect(mockChannel.send).toHaveBeenCalledWith({
        content: '# 🎮 New Game Available!',
        embeds: [{ title: 'Test Embed' }],
      });
    });

    it('should not include role ping or allowedMentions when role ID is undefined', async () => {
      (config as any).GAME_ANNOUNCEMENT_ROLE_ID = undefined;

      await (webhookListener as any).handleGamePublished(mockPayload);

      expect(mockChannel.send).toHaveBeenCalledWith({
        content: '# 🎮 New Game Available!',
        embeds: [{ title: 'Test Embed' }],
      });
    });
  });
});
