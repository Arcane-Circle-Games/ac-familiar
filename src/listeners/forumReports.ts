/**
 * Forum report ingestion → GitHub issues.
 *
 * When a user opens a post in one of the configured report forum channels
 * (customer `feedback-and-bug-reports`, staff `staff-bugs-and-requests`), file it
 * as a GitHub issue on GITHUB_BUG_REPO, react ⚙️ on the post to show it was
 * noticed, and reply in the thread with the issue link. The automatic
 * counterpart to the manual `/bug`.
 *
 * Every post in those forums is filed regardless of tag — Help, Update,
 * Discussion, status-only, and untagged posts included.
 *
 * Labels: `discord-report` + source (`customer`/`staff`) + type when the post
 * carries a recognised tag (Bug→bug, Request→enhancement). All applied forum
 * tags are recorded in the issue body.
 */
import { ThreadChannel, ChannelType, ForumChannel } from 'discord.js';
import { createBugIssue, closeIssueIfOpen, findIssueByThreadUrl } from '../services/github';
import { config } from '../utils/config';
import { logInfo, logError } from '../utils/logger';

const NOTICED_REACTION = '⚙️';

/** Forum tag (lowercased) that closes the linked GitHub issue when applied. */
const COMPLETE_TAG = '100% complete';

/**
 * Thread id → filed issue number, populated when the listener files an issue.
 * Lets closure find the issue without reading thread history (which needs Read
 * Message History). Lost on restart — falls back to scanning the thread then.
 */
const filedIssues = new Map<string, number>();

/** Forum tag (lowercased) → GitHub type label. Absent tags just add no label. */
const TAG_LABEL_MAP: Record<string, string> = {
  bug: 'bug',
  request: 'enhancement'
};

/** Which report forum a thread belongs to (by parent channel id). */
function forumSource(parentId: string | null): 'customer' | 'staff' | null {
  if (!parentId) return null;
  if (parentId === config.CUSTOMER_FORUM_CHANNEL_ID) return 'customer';
  if (parentId === config.STAFF_FORUM_CHANNEL_ID) return 'staff';
  return null;
}

/**
 * Resolve the post's applied forum tag names. Best-effort: fetches the parent
 * forum if it isn't cached, returns [] on any uncertainty.
 */
async function resolveTagNames(thread: ThreadChannel): Promise<string[]> {
  try {
    let parent = thread.parent;
    if ((!parent || parent.type !== ChannelType.GuildForum) && thread.parentId) {
      const fetched = await thread.guild?.channels
        .fetch(thread.parentId)
        .catch(() => null);
      if (fetched && fetched.type === ChannelType.GuildForum) parent = fetched;
    }
    if (!parent || parent.type !== ChannelType.GuildForum) return [];
    const byId = new Map(parent.availableTags.map((t) => [t.id, t.name]));
    return (thread.appliedTags ?? [])
      .map((id) => byId.get(id))
      .filter((n): n is string => Boolean(n));
  } catch {
    return [];
  }
}

/** Starter message can lag threadCreate; retry briefly before filing title-only. */
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
  const source = forumSource(thread.parentId);
  if (!source) return;

  const tagNames = await resolveTagNames(thread);
  const lowered = tagNames.map((n) => n.toLowerCase());

  try {
    const starter = await fetchStarter(thread);

    // Mark as noticed before filing (best-effort — needs Add Reactions).
    if (starter) {
      try {
        await starter.react(NOTICED_REACTION);
      } catch {
        /* no Add Reactions perm — non-fatal */
      }
    }

    const reporter = starter?.author?.username ?? `user ${thread.ownerId ?? 'unknown'}`;
    const description = starter?.content?.trim() || '_(no description provided)_';
    const title = thread.name.slice(0, 120);
    const threadUrl = `https://discord.com/channels/${thread.guildId}/${thread.id}`;

    const typeLabels = lowered
      .map((t) => TAG_LABEL_MAP[t])
      .filter((l): l is string => Boolean(l));
    const labels = Array.from(new Set(['discord-report', source, ...typeLabels]));

    const body = [
      description,
      '',
      '---',
      `*Filed automatically from a **${source}** Discord forum post by **${reporter}**.*`,
      tagNames.length ? `Forum tags: ${tagNames.join(', ')}` : null,
      `Thread: ${threadUrl}`
    ]
      .filter((line): line is string => line !== null)
      .join('\n');

    const issue = await createBugIssue({ title, body, labels });
    filedIssues.set(thread.id, issue.number);

    // Public (customer) forum gets a friendly, non-technical acknowledgement;
    // the staff forum keeps the GitHub link for triage.
    await thread.send(
      source === 'staff'
        ? `Logged as **#${issue.number}** on GitHub — follow it here: ${issue.html_url}`
        : `Thanks for the report — we've logged this and the team is on it. We'll update this post when it's resolved.`
    );
    logInfo('Forum report filed as GitHub issue', {
      thread: thread.id,
      issue: issue.number,
      source,
      labels
    });
  } catch (err) {
    logError('Failed to file forum report as GitHub issue', err as Error, {
      thread: thread.id
    });
    try {
      await thread.send(
        'Could not auto-file this to GitHub — a developer will pick it up manually.'
      );
    } catch {
      /* ignore secondary failure */
    }
  }
}

/** Resolve a thread's parent forum channel, fetching it if not cached. */
async function getParentForum(thread: ThreadChannel): Promise<ForumChannel | null> {
  let parent = thread.parent;
  if ((!parent || parent.type !== ChannelType.GuildForum) && thread.parentId) {
    const fetched = await thread.guild?.channels.fetch(thread.parentId).catch(() => null);
    if (fetched && fetched.type === ChannelType.GuildForum) parent = fetched;
  }
  return parent && parent.type === ChannelType.GuildForum ? (parent as ForumChannel) : null;
}

/** The forum's "100% Complete" tag id, or null. */
async function getCompleteTagId(thread: ThreadChannel): Promise<string | null> {
  const forum = await getParentForum(thread);
  if (!forum) return null;
  const tag = forum.availableTags.find((t) => t.name.toLowerCase() === COMPLETE_TAG);
  return tag?.id ?? null;
}

/**
 * Find the GitHub issue this thread was filed as, by scanning for the issue URL
 * the bot left in its "Logged as #N" reply. null if the thread was never filed
 * (e.g. a pre-listener post, or one whose filing errored).
 */
async function findLinkedIssue(thread: ThreadChannel): Promise<number | null> {
  const cached = filedIssues.get(thread.id);
  if (cached) return cached;
  try {
    const msgs = await thread.messages.fetch({ limit: 50 });
    for (const m of msgs.values()) {
      const match = m.content.match(/\/issues\/(\d+)/);
      if (match && match[1]) return parseInt(match[1], 10);
    }
  } catch (err) {
    logError('findLinkedIssue: could not read thread history', err as Error, {
      thread: thread.id
    });
  }
  // Fallback: customer replies no longer embed the issue link, so find the
  // issue by the thread URL its body always carries.
  const threadUrl = `https://discord.com/channels/${thread.guildId}/${thread.id}`;
  return findIssueByThreadUrl(threadUrl);
}

/**
 * Close the linked GitHub issue when a report post is marked **100% Complete**
 * in Discord. One-directional (Discord → GitHub only). Fires on the tag
 * transition, finds the issue from the bot's own reply, and closes it if open.
 */
export async function handleForumClosure(
  _oldThread: ThreadChannel,
  newThread: ThreadChannel
): Promise<void> {
  if (!forumSource(newThread.parentId)) return;

  const completeId = await getCompleteTagId(newThread);
  if (!completeId) {
    logInfo('closure: no 100% Complete tag in forum', { thread: newThread.id });
    return;
  }

  // Act whenever the post currently carries the tag — no fragile old/new diff.
  // closeIssueIfOpen is idempotent, so re-fires on later updates are no-ops.
  if (!(newThread.appliedTags ?? []).includes(completeId)) return;

  const issueNumber = await findLinkedIssue(newThread);
  if (!issueNumber) {
    logInfo('closure: 100% Complete but no linked issue found', { thread: newThread.id });
    return; // never filed by the listener — nothing to close
  }

  try {
    const threadUrl = `https://discord.com/channels/${newThread.guildId}/${newThread.id}`;
    const result = await closeIssueIfOpen(
      issueNumber,
      `Closed from Discord — the forum post was marked **100% Complete**.\nThread: ${threadUrl}`
    );
    if (result === 'closed') {
      await newThread
        .send(`Closed issue **#${issueNumber}** — marked 100% Complete.`)
        .catch(() => {});
    }
    logInfo('100% Complete tag → issue close', {
      thread: newThread.id,
      issue: issueNumber,
      result
    });
  } catch (err) {
    logError('Failed to close issue from 100% Complete tag', err as Error, {
      thread: newThread.id,
      issue: issueNumber
    });
  }
}
