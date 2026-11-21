import { ChannelType } from 'discord.js';

jest.mock('../../services/github', () => ({
  createBugIssue: jest.fn(),
  closeIssueIfOpen: jest.fn(),
  findIssueByThreadUrl: jest.fn()
}));
jest.mock('../../utils/config', () => ({
  config: { CUSTOMER_FORUM_CHANNEL_ID: 'cust', STAFF_FORUM_CHANNEL_ID: 'staff' }
}));
jest.mock('../../utils/logger', () => ({ logInfo: jest.fn(), logError: jest.fn() }));

import { handleForumReport } from '../forumReports';
import { createBugIssue } from '../../services/github';

function makeThread(parentId: string) {
  const starter = {
    content: 'it broke',
    author: { username: 'tester' },
    react: jest.fn().mockResolvedValue(undefined)
  };
  const thread: any = {
    id: 't1',
    name: 'Broken thing',
    parentId,
    guildId: 'g1',
    ownerId: 'u1',
    appliedTags: [],
    parent: { type: ChannelType.GuildForum, availableTags: [] },
    fetchStarterMessage: jest.fn().mockResolvedValue(starter),
    send: jest.fn().mockResolvedValue(undefined)
  };
  return { thread, starter };
}

describe('handleForumReport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts nothing and adds no reaction when filing to GitHub fails', async () => {
    (createBugIssue as jest.Mock).mockRejectedValue(new Error('GitHub API returned 401'));
    const { thread, starter } = makeThread('staff');
    await handleForumReport(thread);
    expect(createBugIssue).toHaveBeenCalledTimes(1);
    expect(thread.send).not.toHaveBeenCalled();
    expect(starter.react).not.toHaveBeenCalled();
  });

  it('acknowledges in the thread and reacts when filing succeeds', async () => {
    (createBugIssue as jest.Mock).mockResolvedValue({ number: 7, html_url: 'https://x/7' });
    const { thread, starter } = makeThread('staff');
    await handleForumReport(thread);
    expect(thread.send).toHaveBeenCalledTimes(1);
    expect(starter.react).toHaveBeenCalledTimes(1);
  });
});
