import { handleForumReport } from '../forumReports';
import { createBugIssue } from '../../services/github';
import { logError } from '../../utils/logger';

jest.mock('../../services/github', () => ({
  createBugIssue: jest.fn(),
  closeIssueIfOpen: jest.fn(),
  findIssueByThreadUrl: jest.fn(),
}));
jest.mock('../../utils/config', () => ({
  config: { CUSTOMER_FORUM_CHANNEL_ID: 'forum1', STAFF_FORUM_CHANNEL_ID: 'forum2' },
}));
jest.mock('../../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
  logInfo: jest.fn(),
  logDebug: jest.fn(),
  logWarning: jest.fn(),
}));

const NOTICED = '⚙️';

const mockCreateBugIssue = createBugIssue as jest.MockedFunction<typeof createBugIssue>;
const mockLogError = logError as jest.MockedFunction<typeof logError>;

/** Minimal forum-post thread double — handleForumReport only touches these fields. */
function makeThread(parentId: string, id = 't1') {
  const starter = {
    react: jest.fn().mockResolvedValue(undefined),
    content: 'body',
    author: { username: 'bob' },
  };
  const thread = {
    id,
    name: 'Bug',
    parentId,
    guildId: 'g1',
    ownerId: 'u1',
    appliedTags: [],
    parent: null,
    guild: undefined,
    send: jest.fn().mockResolvedValue(undefined),
    fetchStarterMessage: jest.fn().mockResolvedValue(starter),
  };
  return { thread, starter };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('handleForumReport', () => {
  it('on filing failure: posts nothing, reacts nothing, logs, and resolves', async () => {
    mockCreateBugIssue.mockRejectedValueOnce(new Error('github down'));
    const { thread, starter } = makeThread('forum1');

    await expect(
      handleForumReport(thread as unknown as Parameters<typeof handleForumReport>[0])
    ).resolves.toBeUndefined();

    expect(thread.send).not.toHaveBeenCalled();
    expect(starter.react).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });

  it('on success (customer forum): reacts ⚙️ once and posts the acknowledgement', async () => {
    mockCreateBugIssue.mockResolvedValueOnce({ number: 7, html_url: 'u' } as never);
    const { thread, starter } = makeThread('forum1');

    await handleForumReport(thread as unknown as Parameters<typeof handleForumReport>[0]);

    expect(starter.react).toHaveBeenCalledTimes(1);
    expect(starter.react).toHaveBeenCalledWith(NOTICED);
    expect(thread.send).toHaveBeenCalledTimes(1);
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('on success (staff forum): posts the acknowledgement with the issue number', async () => {
    mockCreateBugIssue.mockResolvedValueOnce({ number: 7, html_url: 'u' } as never);
    const { thread } = makeThread('forum2');

    await handleForumReport(thread as unknown as Parameters<typeof handleForumReport>[0]);

    expect(thread.send).toHaveBeenCalledTimes(1);
    const text = (thread.send as jest.Mock).mock.calls[0][0] as string;
    expect(text).toContain('#7');
  });
});
