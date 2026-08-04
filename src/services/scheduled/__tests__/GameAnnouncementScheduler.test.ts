import { TextChannel } from 'discord.js';
import { GameAnnouncementScheduler } from '../GameAnnouncementScheduler';
import { config } from '../../../utils/config';
import { logError } from '../../../utils/logger';

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
}));
jest.mock('../../api', () => ({ arcaneAPI: { getRecentGames: jest.fn() } }));
// Keep cron out of it — start() would otherwise register a live timer per test.
jest.mock('node-cron', () => ({
  schedule: jest.fn(() => ({ stop: jest.fn() })),
}));

const CHANNEL_ID = 'channel-123';
const ROLE_ID = 'role-123';

/**
 * `sendHeaderMessage` narrows with `channel instanceof TextChannel`, so a plain
 * object double falls into the catch block and the send is never attempted.
 * Build the double on the real prototype and override the two members used.
 */
function makeTextChannel(id: string) {
  // `isTextBased` is a type predicate on the real class, so it cannot take a
  // bare jest.Mock without a cast through any.
  const channel = Object.create(TextChannel.prototype) as any;
  Object.defineProperty(channel, 'id', { value: id, configurable: true });
  channel.isTextBased = jest.fn().mockReturnValue(true);
  channel.send = jest.fn().mockResolvedValue({});
  return channel as TextChannel & { send: jest.Mock; isTextBased: jest.Mock };
}

describe('GameAnnouncementScheduler.sendHeaderMessage', () => {
  let scheduler: GameAnnouncementScheduler;
  let mockChannel: ReturnType<typeof makeTextChannel>;
  let mockBot: any;

  const sendHeader = () => (scheduler as any).sendHeaderMessage();

  beforeEach(() => {
    jest.clearAllMocks();

    mockChannel = makeTextChannel(CHANNEL_ID);
    mockBot = {
      client: {
        channels: { fetch: jest.fn().mockResolvedValue(mockChannel) },
      },
    };

    (config as any).GAME_ANNOUNCEMENT_ENABLED = true;
    (config as any).GAME_ANNOUNCEMENT_CHANNEL_ID = CHANNEL_ID;
    (config as any).GAME_ANNOUNCEMENT_INTERVAL_HOURS = 3;

    scheduler = new GameAnnouncementScheduler(mockBot);
  });

  it('includes the ping and an explicit allowedMentions when a role is configured', async () => {
    (config as any).GAME_ANNOUNCEMENT_ROLE_ID = ROLE_ID;

    await sendHeader();

    expect(mockChannel.send).toHaveBeenCalledWith({
      content: `<@&${ROLE_ID}>\n# New Games Looking for Players`,
      allowedMentions: { roles: [ROLE_ID] },
    });
  });

  it.each([
    ['empty', ''],
    ['undefined', undefined],
  ])('omits the ping and allowedMentions when the role ID is %s', async (_label, roleId) => {
    (config as any).GAME_ANNOUNCEMENT_ROLE_ID = roleId;

    await sendHeader();

    expect(mockChannel.send).toHaveBeenCalledWith({
      content: '# New Games Looking for Players',
    });
    const [sent] = mockChannel.send.mock.calls[0];
    expect(sent).not.toHaveProperty('allowedMentions');
  });

  // Header failure is deliberately swallowed so the game announcements that
  // follow it still go out.
  it('logs and swallows a send failure rather than throwing', async () => {
    (config as any).GAME_ANNOUNCEMENT_ROLE_ID = ROLE_ID;
    mockChannel.send.mockRejectedValueOnce(new Error('missing permissions'));

    await expect(sendHeader()).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith(
      'GameAnnouncementScheduler: Failed to send header message',
      expect.any(Error),
      { channelId: CHANNEL_ID }
    );
  });

  it('logs and swallows a missing announcement channel', async () => {
    (config as any).GAME_ANNOUNCEMENT_ROLE_ID = ROLE_ID;
    mockBot.client.channels.fetch.mockResolvedValueOnce(null);

    await expect(sendHeader()).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith(
      'GameAnnouncementScheduler: Failed to send header message',
      expect.any(Error),
      { channelId: CHANNEL_ID }
    );
  });
});
