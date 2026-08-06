import { TextChannel } from 'discord.js';
import { GameAnnouncementScheduler } from '../GameAnnouncementScheduler';
import { config } from '../../../utils/config';
import { logError, logInfo } from '../../../utils/logger';

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

const CHANNEL_ID = 'lfg-channel-123';
const ROLE_ID = 'role-123';

type RoleDouble = { id: string; name: string; mentionable: boolean };

/**
 * The validator narrows with `channel instanceof TextChannel`, so a plain
 * object double is rejected before it reaches the guild. Build on the real
 * prototype and attach the two members the validator reads.
 */
function makeChannelInGuild(
  guildId: string,
  guildName: string,
  roles: RoleDouble[]
) {
  const guild = {
    id: guildId,
    name: guildName,
    roles: {
      fetch: jest.fn(async (id: string) => roles.find(r => r.id === id) ?? null),
      cache: new Map(roles.map(r => [r.id, r])),
    },
  };

  const channel = Object.create(TextChannel.prototype) as any;
  Object.defineProperty(channel, 'id', { value: CHANNEL_ID, configurable: true });
  Object.defineProperty(channel, 'guild', { value: guild, configurable: true });
  channel.isTextBased = jest.fn().mockReturnValue(true);
  channel.send = jest.fn().mockResolvedValue({});

  return { channel: channel as TextChannel, guild };
}

describe('GameAnnouncementScheduler.validateAnnouncementRole', () => {
  let scheduler: GameAnnouncementScheduler;
  let mockBot: any;

  const validate = () => (scheduler as any).validateAnnouncementRole();

  const build = (fetchImpl: jest.Mock) => {
    mockBot = { client: { channels: { fetch: fetchImpl }, guilds: { cache: new Map() } } };
    scheduler = new GameAnnouncementScheduler(mockBot);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (config as any).GAME_ANNOUNCEMENT_ENABLED = true;
    (config as any).GAME_ANNOUNCEMENT_CHANNEL_ID = CHANNEL_ID;
    (config as any).GAME_ANNOUNCEMENT_ROLE_ID = ROLE_ID;
    (config as any).GAME_ANNOUNCEMENT_INTERVAL_HOURS = 3;
  });

  it('accepts a mentionable role in the guild that owns the announcement channel', async () => {
    const built = makeChannelInGuild('guild-ac', 'Arcane Circle', [
      { id: ROLE_ID, name: 'LFG', mentionable: true },
    ]);
    build(jest.fn().mockResolvedValue(built.channel));

    await validate();

    expect(built.guild.roles.fetch).toHaveBeenCalledWith(ROLE_ID);
    expect(logInfo).toHaveBeenCalledWith(
      expect.stringContaining('Will ping role "LFG" (role-123)')
    );
    expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('Arcane Circle'));
    expect(logError).not.toHaveBeenCalled();
  });

  // The regression this replaced. `guilds.cache.first()` returned an arbitrary
  // entry from a Map the bot now fills with 13 guilds, so boot logged
  // "Role not found" for a role that was present and working the whole time.
  it('ignores an unrelated cached guild that happens to be first', async () => {
    const built = makeChannelInGuild('guild-ac', 'Arcane Circle', [
      { id: ROLE_ID, name: 'LFG', mentionable: true },
    ]);
    build(jest.fn().mockResolvedValue(built.channel));

    // A different server, cached first, with no LFG role at all.
    const unrelated = {
      id: 'guild-other',
      name: 'Some Other Server',
      roles: { cache: new Map(), fetch: jest.fn().mockResolvedValue(null) },
    };
    mockBot.client.guilds.cache = {
      first: jest.fn().mockReturnValue(unrelated),
    };

    await validate();

    expect(unrelated.roles.fetch).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith(
      expect.stringContaining('Will ping role "LFG" (role-123)')
    );
  });

  it('reports a role that is absent from the channel-owning guild, and names that guild', async () => {
    const built = makeChannelInGuild('guild-ac', 'Arcane Circle', []);
    build(jest.fn().mockResolvedValue(built.channel));

    await validate();

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining(`GAME_ANNOUNCEMENT_ROLE_ID ${ROLE_ID} not found in guild "Arcane Circle" (guild-ac)`),
      expect.any(Error)
    );
    expect(logInfo).not.toHaveBeenCalledWith(expect.stringContaining('Will ping role'));
  });

  it('reports a role that exists but is not mentionable', async () => {
    const built = makeChannelInGuild('guild-ac', 'Arcane Circle', [
      { id: ROLE_ID, name: 'LFG', mentionable: false },
    ]);
    build(jest.fn().mockResolvedValue(built.channel));

    await validate();

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('is not mentionable'),
      expect.any(Error)
    );
    expect(logInfo).not.toHaveBeenCalledWith(expect.stringContaining('Will ping role'));
  });

  it.each([
    ['a missing channel', null],
    ['a non-text channel', { id: CHANNEL_ID, isTextBased: () => false }],
  ])('reports %s without touching any guild', async (_label, resolved) => {
    build(jest.fn().mockResolvedValue(resolved));

    await validate();

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining(
        `cannot validate role ${ROLE_ID} — announcement channel ${CHANNEL_ID} is missing or not a text channel`
      ),
      expect.any(Error)
    );
  });

  it('swallows a fetch rejection rather than escaping into start()', async () => {
    build(jest.fn().mockRejectedValue(new Error('discord unavailable')));

    await expect(validate()).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith(
      'GameAnnouncementScheduler: Failed to validate role',
      expect.any(Error)
    );
  });
});

describe('GameAnnouncementScheduler.start role-validation wiring', () => {
  let scheduler: GameAnnouncementScheduler;
  let mockBot: any;
  let channelsFetch: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (config as any).GAME_ANNOUNCEMENT_ENABLED = true;
    (config as any).GAME_ANNOUNCEMENT_CHANNEL_ID = CHANNEL_ID;
    (config as any).GAME_ANNOUNCEMENT_INTERVAL_HOURS = 3;

    channelsFetch = jest.fn();
    mockBot = { client: { channels: { fetch: channelsFetch }, guilds: { cache: new Map() } } };
    scheduler = new GameAnnouncementScheduler(mockBot);
  });

  it('registers the cron job without waiting on the Discord round-trip', () => {
    (config as any).GAME_ANNOUNCEMENT_ROLE_ID = ROLE_ID;
    // A promise that never settles — start() must not be gated on it.
    channelsFetch.mockReturnValue(new Promise(() => {}));

    scheduler.start();

    const cron = require('node-cron');
    expect(cron.schedule).toHaveBeenCalledWith('0 */3 * * *', expect.any(Function));
    expect(channelsFetch).toHaveBeenCalledWith(CHANNEL_ID);
  });

  it('does not validate at all when no role is configured', () => {
    (config as any).GAME_ANNOUNCEMENT_ROLE_ID = '';

    scheduler.start();

    expect(channelsFetch).not.toHaveBeenCalled();
    expect(require('node-cron').schedule).toHaveBeenCalled();
  });
});
