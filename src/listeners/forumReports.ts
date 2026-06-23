/**
 * Forum report ingestion → GitHub issues.
 *
 * When a user opens a post in one of the configured report forum channels
 * (bug reports or feedback/feature requests), file it as a GitHub issue on
 * GITHUB_BUG_REPO and reply in the thread with the issue link. This is the
 * automatic counterpart to the manual `/bug` command — no linked-account gate,
 * because forum access is already controlled by Discord permissions.
 *
 * Phase 1 of the ac-familiar operational spec (forum → GitHub). One issue per
 * thread: threadCreate fires once per post, so there is no dedup loop to manage.
 */
import { ThreadChannel } from 'discord.js';
import { createBugIssue } from '../services/github';
import { config } from '../utils/config';
import { logInfo, logError } from '../utils/logger';

/** Maps a forum channel id to the label its posts are filed under. */
function channelLabel(parentId: string | null): string | null {
  if (!parentId) return null;
  if (parentId === config.BUG_FORUM_CHANNEL_ID) return 'bug';
  if (parentId === config.FEEDBACK_FORUM_CHANNEL_ID) return 'enhancement';
  return null;
}

/**
 * The starter message can lag the threadCreate event by a moment, so retry a
 * few times before giving up and filing with just the title.
 */
async function fetchStarter(thread: ThreadChannel) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const msg = await thread.fetchStarterMessage();
      if (msg) return msg;
    } catch {
      /* not ready yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}

export async function handleForumReport(thread: ThreadChannel): Promise<void> {
  // Gate purely on the parent forum channel id — that is what marks a thread as
  // one of our report channels. (Avoids depending on parent being cached.)
  const label = channelLabel(thread.parentId);
  if (!label) return;

  try {
    const starter = await fetchStarter(thread);
    const reporter = starter?.author?.username ?? `user ${thread.ownerId ?? 'unknown'}`;
    const description = starter?.content?.trim() || '_(no description provided)_';
    const title = thread.name.slice(0, 120);
    const threadUrl = `https://discord.com/channels/${thread.guildId}/${thread.id}`;

    const body = [
      description,
      '',
      '---',
      `*Filed automatically from a Discord forum post by **${reporter}**.*`,
      `Thread: ${threadUrl}`
    ].join('\n');

    const issue = await createBugIssue({
      title,
      body,
      labels: [label, 'discord-report']
    });

    await thread.send(
      `Logged as **#${issue.number}** on GitHub — follow it here: ${issue.html_url}`
    );
    logInfo('Forum report filed as GitHub issue', {
      thread: thread.id,
      issue: issue.number,
      label
    });
  } catch (err) {
    logError('Failed to file forum report as GitHub issue', err as Error, {
      thread: thread.id
    });
    // Best-effort: tell the reporter it didn't auto-file so it isn't silently lost.
    try {
      await thread.send(
        'Could not auto-file this to GitHub — a developer will pick it up manually.'
      );
    } catch {
      /* ignore secondary failure */
    }
  }
}
