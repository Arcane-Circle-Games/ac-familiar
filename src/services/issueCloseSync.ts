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
import { config } from '../utils/config';

const COMPLETE_TAG = '100% complete';
/** Forum starter reactions: ⚙️ is set by forumReports on file; ✅ on resolution. */
const NOTICED_REACTION = '⚙️';
const RESOLVED_REACTION = '✅';

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

    // Already synced (archived, or complete-tagged) → nothing to do.
    if (thread.archived || (completeTagId && (thread.appliedTags ?? []).includes(completeTagId))) {
      return 'already';
    }

    const me = client.user?.id;

    // Public (customer) forum gets a friendly, non-technical message; the staff
    // forum keeps the GitHub reference for triage.
    const isStaff = parent?.id === config.STAFF_FORUM_CHANNEL_ID;
    const resolvedReply = isStaff
      ? `Resolved and closed on GitHub — issue **#${issue.number}**. This report is complete.`
      : `This has been resolved. Thanks for the report.`;

    // Post the resolved reply once. A prior run may have replied but failed to
    // tag/archive (e.g. before Manage Threads was granted) — don't double-post.
    let alreadyReplied = false;
    try {
      const recent = await thread.messages.fetch({ limit: 20 });
      alreadyReplied = recent.some((m) => m.author.id === me && /resolved/i.test(m.content));
    } catch {
      /* no Read Message History — fall through; at worst a duplicate reply */
    }
    if (!alreadyReplied) {
      await thread
        .send(resolvedReply)
        .catch((e) => logError('issue-sync: could not post resolved reply', e as Error, { thread: thread.id }));
    }

    // Swap the forum starter's reaction: drop our ⚙️ "noticed", add ✅ "done".
    try {
      const starter = await thread.fetchStarterMessage();
      if (starter && me) {
        const gear = starter.reactions.cache.get(NOTICED_REACTION);
        if (gear) await gear.users.remove(me).catch(() => {});
        await starter.react(RESOLVED_REACTION).catch(() => {});
      }
    } catch (e) {
      logError('issue-sync: could not swap reactions', e as Error, { thread: thread.id });
    }

    // Apply the 100% Complete tag (mirrors the Discord→GitHub close).
    if (completeTagId) {
      const tags = Array.from(new Set([...(thread.appliedTags ?? []), completeTagId]));
      await thread
        .setAppliedTags(tags)
        .catch((e) => logError('issue-sync: could not apply complete tag', e as Error, { thread: thread.id }));
    }

    // Archive last — edits/reactions can fail on an already-archived thread.
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
