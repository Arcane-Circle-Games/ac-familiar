import { GameAnnouncementScheduler } from '../GameAnnouncementScheduler';
import { ArcaneBot } from '../../../bot';
import { config } from '../../../utils/config';

// Mock dependencies
jest.mock('../../../utils/logger');
jest.mock('../../../utils/config');
jest.mock('../../../services/api');

describe('GameAnnouncementScheduler', () => {
  let scheduler: GameAnnouncementScheduler;
  let mockBot: any;
  let mockChannel: any;
  let mockGuild: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock channel
    mockChannel = {
      id: 'channel-123',
      isTextBased: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue({}),
    };

    // Setup mock guild with roles
    mockGuild = {
      id: 'guild-123',
      roles: {
        cache: new Map([
          ['role-123', { id: 'role-123', name: 'LFG' }],
        ]),
      },
    };

    // Setup mock bot
    mockBot = {
      client: {
        channels: {
          fetch: jest.fn().mockResolvedValue(mockChannel),
        },
        guilds: {
          cache: {
            first: jest.fn().mockReturnValue(mockGuild),
          },
        },
        user: {
          displayAvatarURL: jest.fn().mockReturnValue('https://example.com/avatar.png'),
        },
      },
    } as unknown as ArcaneBot;

    scheduler = new GameAnnouncementScheduler(mockBot);
  });

  describe('sendHeaderMessage with allowedMentions', () => {
    beforeEach(() => {
      // Mock config for enabled state
      (config as any).GAME_ANNOUNCEMENT_ENABLED = true;
      (config as any).GAME_ANNOUNCEMENT_CHANNEL_ID = 'channel-123';
      (config as any).GAME_ANNOUNCEMENT_INTERVAL_HOURS = 3;
    });

    it('should include allowedMentions when role ID is set', async () => {
      (config as any).GAME_ANNOUNCEMENT_ROLE_ID = 'role-123';

      // Access private method via prototype
      await (scheduler as any).sendHeaderMessage();

      expect(mockChannel.send).toHaveBeenCalledWith({
        content: '<@&role-123>\n# New Games Looking for Players',
        allowedMentions: { roles: ['role-123'] },
      });
    });

    it('should not include allowedMentions when role ID is empty', async () => {
      (config as any).GAME_ANNOUNCEMENT_ROLE_ID = '';

      await (scheduler as any).sendHeaderMessage();

      expect(mockChannel.send).toHaveBeenCalledWith({
        content: '# New Games Looking for Players',
      });
    });

    it('should not include allowedMentions when role ID is undefined', async () => {
      (config as any).GAME_ANNOUNCEMENT_ROLE_ID = undefined;

      await (scheduler as any).sendHeaderMessage();

      expect(mockChannel.send).toHaveBeenCalledWith({
        content: '# New Games Looking for Players',
      });
    });
  });

  describe('startup role validation', () => {
    it('should log warning when configured role ID is not found in guild cache', () => {
      const mockLogError = require('../../../utils/logger').logError;

      (config as any).GAME_ANNOUNCEMENT_ENABLED = true;
      (config as any).GAME_ANNOUNCEMENT_CHANNEL_ID = 'channel-123';
      (config as any).GAME_ANNOUNCEMENT_ROLE_ID = 'nonexistent-role';
      (config as any).GAME_ANNOUNCEMENT_INTERVAL_HOURS = 3;

      scheduler.start();

      expect(mockLogError).toHaveBeenCalledWith(
        expect.stringContaining('GAME_ANNOUNCEMENT_ROLE_ID nonexistent-role not found in guild'),
        expect.any(Error)
      );
    });

    it('should log success message when role is found', () => {
      const mockLogInfo = require('../../../utils/logger').logInfo;

      (config as any).GAME_ANNOUNCEMENT_ENABLED = true;
      (config as any).GAME_ANNOUNCEMENT_CHANNEL_ID = 'channel-123';
      (config as any).GAME_ANNOUNCEMENT_ROLE_ID = 'role-123';
      (config as any).GAME_ANNOUNCEMENT_INTERVAL_HOURS = 3;

      scheduler.start();

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.stringContaining('Will ping role "LFG" (role-123)')
      );
    });

    it('should not crash when guild is not available', () => {
      mockBot.client.guilds.cache.first = jest.fn().mockReturnValue(null);

      (config as any).GAME_ANNOUNCEMENT_ENABLED = true;
      (config as any).GAME_ANNOUNCEMENT_CHANNEL_ID = 'channel-123';
      (config as any).GAME_ANNOUNCEMENT_ROLE_ID = 'role-123';
      (config as any).GAME_ANNOUNCEMENT_INTERVAL_HOURS = 3;

      expect(() => scheduler.start()).not.toThrow();
    });
  });
});
