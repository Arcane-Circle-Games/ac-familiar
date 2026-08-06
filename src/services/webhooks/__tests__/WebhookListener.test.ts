import { WebhookListener } from '../WebhookListener';
import { config } from '../../../utils/config';
import { logger } from '../../../utils/logger';
import type { GamePublishedWebhook } from '../../../types/webhooks';

// Factories, not automocks: `utils/config` parses process.env through zod at
// import time and throws without a Discord token, and jest's automocker has to
// execute the real module to derive its shape.
jest.mock('../../../utils/config', () => ({ config: {} }));
jest.mock('../../../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
  logInfo: jest.fn(),
  logDebug: jest.fn(),
  logWarning: jest.fn(),
  logDiscordEvent: jest.fn(),
  logAPICall: jest.fn(),
  logRecordingEvent: jest.fn(),
  sanitizeAxiosError: jest.fn((e: unknown) => e),
}));
jest.mock('../../../utils/embeds/notifications');
jest.mock('../../../services/discord/DMService');

const LFG_CHANNEL_ID = 'lfg-channel-123';
const GUILD_CHANNEL_ID = 'paired-guild-channel-456';
const ROLE_ID = 'role-123';

/** Minimal text channel double — `handleGamePublished` only needs these three. */
function makeChannel(id: string) {
  return {
    id,
    isTextBased: jest.fn().mockReturnValue(true),
    send: jest.fn().mockResolvedValue({}),
  };
}

function makePayload(
  overrides: Partial<GamePublishedWebhook> = {}
): GamePublishedWebhook {
  return {
    event: 'notification.game.published',
    timestamp: 1754000000000,
    gameId: 'game-123',
    channelId: LFG_CHANNEL_ID,
    game: {
      id: 'game-123',
      title: 'Test Game',
      description: 'Test description',
      system: { name: 'D&D 5e', shortName: 'D&D' },
      gameType: 'ONE_SHOT',
      startTime: '2026-08-10T18:00:00.000Z',
      duration: 4,
      pricePerSession: 10,
      maxPlayers: 5,
      availableSlots: 3,
      url: 'https://example.com/game/123',
      publishedAt: '2026-08-03T18:00:00.000Z',
      gm: {
        displayName: 'Test GM',
        profile: { verified: true, averageRating: 4.5, totalRatings: 10 },
      },
    },
    ...overrides,
  } as GamePublishedWebhook;
}

describe('WebhookListener.handleGamePublished', () => {
  let webhookListener: WebhookListener;
  let lfgChannel: ReturnType<typeof makeChannel>;
  let guildChannel: ReturnType<typeof makeChannel>;
  let mockBot: any;

  /** Invoke the private handler the webhook route dispatches to. */
  const handle = (payload: GamePublishedWebhook) =>
    (webhookListener as any).handleGamePublished(payload);

  beforeEach(() => {
    jest.clearAllMocks();

    lfgChannel = makeChannel(LFG_CHANNEL_ID);
    guildChannel = makeChannel(GUILD_CHANNEL_ID);

    mockBot = {
      client: {
        channels: {
          fetch: jest.fn(async (id: string) => {
            if (id === LFG_CHANNEL_ID) return lfgChannel;
            if (id === GUILD_CHANNEL_ID) return guildChannel;
            return null;
          }),
        },
      },
    };

    const { buildGamePublishedEmbed } = require('../../../utils/embeds/notifications');
    buildGamePublishedEmbed.mockReturnValue({ title: 'Test Embed' });

    (config as any).GAME_ANNOUNCEMENT_ENABLED = true;
    (config as any).GAME_ANNOUNCEMENT_CHANNEL_ID = LFG_CHANNEL_ID;
    (config as any).GAME_ANNOUNCEMENT_ROLE_ID = ROLE_ID;

    webhookListener = new WebhookListener();
    webhookListener.setBot(mockBot);
  });

  describe('GAME_ANNOUNCEMENT_ENABLED guard', () => {
    it('returns early and touches no channel when disabled', async () => {
      (config as any).GAME_ANNOUNCEMENT_ENABLED = false;

      await handle(makePayload());

      expect(logger.debug).toHaveBeenCalledWith(
        'Game announcement disabled, skipping webhook-triggered post'
      );
      expect(mockBot.client.channels.fetch).not.toHaveBeenCalled();
      expect(lfgChannel.send).not.toHaveBeenCalled();
    });

    it('posts to the payload channel when enabled', async () => {
      await handle(makePayload());

      expect(mockBot.client.channels.fetch).toHaveBeenCalledWith(LFG_CHANNEL_ID);
      expect(lfgChannel.send).toHaveBeenCalled();
    });
  });

  describe('role ping is gated on the destination being the LFG channel', () => {
    it('pings the role when the payload channel IS the configured LFG channel', async () => {
      await handle(makePayload());

      expect(lfgChannel.send).toHaveBeenCalledWith({
        content: `<@&${ROLE_ID}>\n# 🎮 New Game Available!`,
        embeds: [{ title: 'Test Embed' }],
        allowedMentions: { roles: [ROLE_ID] },
      });
    });

    // The f76ef01 regression. ac-mvp PR #151 reuses this event to fan a game
    // out to a paired guild's own Discord channel. That server has no LFG role,
    // so a prepended `<@&ROLE_ID>` renders there as raw unresolved text.
    it('does NOT ping when the payload channel is a paired guild channel', async () => {
      await handle(makePayload({ channelId: GUILD_CHANNEL_ID }));

      expect(guildChannel.send).toHaveBeenCalledWith({
        content: '# 🎮 New Game Available!',
        embeds: [{ title: 'Test Embed' }],
      });
      const [sent] = guildChannel.send.mock.calls[0];
      expect(sent).not.toHaveProperty('allowedMentions');
      expect(sent.content).not.toContain(ROLE_ID);
    });

    it('does NOT ping when GAME_ANNOUNCEMENT_CHANNEL_ID is unconfigured', async () => {
      (config as any).GAME_ANNOUNCEMENT_CHANNEL_ID = '';

      await handle(makePayload());

      expect(lfgChannel.send).toHaveBeenCalledWith({
        content: '# 🎮 New Game Available!',
        embeds: [{ title: 'Test Embed' }],
      });
    });

    it.each([
      ['empty', ''],
      ['undefined', undefined],
    ])('does NOT ping when the role ID is %s', async (_label, roleId) => {
      (config as any).GAME_ANNOUNCEMENT_ROLE_ID = roleId;

      await handle(makePayload());

      expect(lfgChannel.send).toHaveBeenCalledWith({
        content: '# 🎮 New Game Available!',
        embeds: [{ title: 'Test Embed' }],
      });
    });
  });

  describe('paired guild announcement fan-out', () => {
    const withGuildAnnouncement = () =>
      makePayload({
        guildAnnouncement: {
          discordChannelId: GUILD_CHANNEL_ID,
          discordServerId: 'paired-guild-789',
        },
      } as Partial<GamePublishedWebhook>);

    it('posts to the guild channel with no role mention even while the LFG post pings', async () => {
      await handle(withGuildAnnouncement());

      // LFG channel still gets the ping...
      expect(lfgChannel.send).toHaveBeenCalledWith({
        content: `<@&${ROLE_ID}>\n# 🎮 New Game Available!`,
        embeds: [{ title: 'Test Embed' }],
        allowedMentions: { roles: [ROLE_ID] },
      });

      // ...the paired guild channel must not.
      expect(guildChannel.send).toHaveBeenCalledWith({
        content: '# 🎮 New Game Available!',
        embeds: [{ title: 'Test Embed' }],
      });
      const [sent] = guildChannel.send.mock.calls[0];
      expect(sent).not.toHaveProperty('allowedMentions');
      expect(sent.content).not.toContain(ROLE_ID);
    });

    it('a failing guild post does not block the LFG post', async () => {
      guildChannel.send.mockRejectedValueOnce(new Error('missing permissions'));

      await expect(handle(withGuildAnnouncement())).resolves.toBeUndefined();

      expect(lfgChannel.send).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        `Failed to post guild announcement to channel ${GUILD_CHANNEL_ID}`,
        expect.any(Error)
      );
    });

    it('skips the fan-out entirely when no guildAnnouncement is present', async () => {
      await handle(makePayload());

      expect(mockBot.client.channels.fetch).toHaveBeenCalledTimes(1);
      expect(guildChannel.send).not.toHaveBeenCalled();
    });
  });
});
