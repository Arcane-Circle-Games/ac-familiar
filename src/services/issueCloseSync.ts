/**
 * GitHub issue closed → Discord forum post.
 *
 * The reverse of forumReports' Discord → GitHub flow: when a report's GitHub
 * issue is closed, reflect that back onto the forum post it was filed from —
 * reply that it's resolved, apply the "100% Complete" tag, and archive the
 * thread. One-directional (GitHub → Discord). Idempotent: a post already tagged
 * complete is left alone.
 *
 * The thread is found from the `Thread: <url>` line forumReports writes into the
 * issue body, so no local mapping or thread-history scan is needed.
 */
import { Client, ChannelType, ThreadChannel, ForumChannel } from 'discord.js';
import { logInfo, logError } from '../utils/logger';

const COMPLETE_TAG = '100% complete';

export interface ClosedIssue {
  number: number;
  body?: string | null;
  html_url?: string;
  title?: string;
}

export type SyncResult = 'synced' | 'no-thread' | 'not-forum' | 'already' | 'error';

/** Pull the Discord thread id out of an issue body's `Thread: <url>` line. */
export function threadIdFromIssueBody(body: string | null | undefined): string | null {
  if (!body) return null;
  const m = body.match(/discord\.com\/channels\/\d+\/(\d+)/);
  return m?.[1] ?? null;
}

/**
 * Reflect a closed issue onto its Discord forum post. Returns a result code so
 * callers (webhook + manual resync) can report per-issue outcomes.
 */
export async function syncClosedIssueToDiscord(
  client: Client,
  issue: ClosedIssue
): Promise<SyncResult> {
  const threadId = threadIdFromIssueBody(issue.body);
  if (!threadId) return 'no-thread'; // not a forum-filed issue (e.g. /bug or board-migrated)

  try {
    const channel = await client.channels.fetch(threadId).catch(() => null);
    if (!channel || !channel.isThread()) return 'not-forum';
    const thread = channel as ThreadChannel;

    const parent =
      thread.parent && thread.parent.type === ChannelType.GuildForum
        ? (thread.parent as ForumChannel)
        : null;
    const completeTagId = parent
      ? parent.availableTags.find((t) => t.name.toLowerCase() === COMPLETE_TAG)?.id ?? null
      : null;

    // Idempotency: already marked complete → nothing to do (don't re-post).
    if (completeTagId && (thread.appliedTags ?? []).includes(completeTagId)) {
      return 'already';
    }

    // Un-archive if needed so the reply + tag land, then re-archive at the end.
    if (thread.archived) {
      await thread.setArchived(false).catch(() => {});
    }

    await thread
      .send(`Resolved and closed on GitHub — issue **#${issue.number}**. This report is complete.`)
      .catch((e) => logError('issue-sync: could not post resolved reply', e as Error, { thread: thread.id }));

    if (completeTagId) {
      const tags = Array.from(new Set([...(thread.appliedTags ?? []), completeTagId]));
      await thread
        .setAppliedTags(tags)
        .catch((e) => logError('issue-sync: could not apply complete tag', e as Error, { thread: thread.id }));
    }

    await thread
      .setArchived(true)
      .catch((e) => logError('issue-sync: could not archive thread', e as Error, { thread: thread.id }));

    logInfo('Closed issue reflected to Discord', { issue: issue.number, thread: thread.id });
    return 'synced';
  } catch (err) {
    logError('syncClosedIssueToDiscord failed', err as Error, { issue: issue.number });
    return 'error';
  }
}
