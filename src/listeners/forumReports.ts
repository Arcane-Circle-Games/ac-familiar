/**
 * Forum report ingestion → GitHub issues.
 *
 * When a user opens a post in one of the configured report forum channels
 * (customer `feedback-and-bug-reports`, staff `staff-bugs-and-requests`), file
 * it as a GitHub issue on GITHUB_BUG_REPO and reply in the thread with the
 * issue link. The automatic counterpart to the manual `/bug` command.
 *
 * Labels: always `discord-report` + a source label (`customer` / `staff`), plus
 * a type label derived from the post's Discord forum TAG (Bug → bug,
 * Request → enhancement, Help → question). Workflow/status tags (Acknowledged,
 * % Complete, Update, Discussion) are not turned into labels but are recorded in
 * the issue body.
 *
 * Phase 1 of the ac-familiar operational spec. One issue per thread.
 */
import { ThreadChannel, ChannelType } from 'discord.js';
import { createBugIssue } from '../services/github';
import { config } from '../utils/config';
import { logInfo, logError } from '../utils/logger';

/** Which report forum a thread belongs to (by parent channel id). */
function forumSource(parentId: string | null): 'customer' | 'staff' | null {
  if (!parentId) return null;
  if (parentId === config.CUSTOMER_FORUM_CHANNEL_ID) return 'customer';
  if (parentId === config.STAFF_FORUM_CHANNEL_ID) return 'staff';
  return null;
}

/** Discord forum TYPE tag → GitHub label. Status/workflow tags are excluded. */
const TAG_LABEL_MAP: Record<string, string> = {
  bug: 'bug',
  request: 'enhancement',
  help: 'question'
};

/**
 * Resolve the post's applied forum tags to their names, and the subset that
 * maps to GitHub labels. Best-effort: returns empty on any uncertainty.
 */
function resolveTags(thread: ThreadChannel): { names: string[]; labels: string[] } {
  try {
    const parent = thread.parent;
    if (!parent || parent.type !== ChannelType.GuildForum) return { names: [], labels: [] };
    const byId = new Map(parent.availableTags.map((t) => [t.id, t.name]));
    const names = (thread.appliedTags ?? [])
      .map((id) => byId.get(id))
      .filter((n): n is string => Boolean(n));
    const labels = names
      .map((n) => TAG_LABEL_MAP[n.toLowerCase()])
      .filter((l): l is string => Boolean(l));
    return { names, labels };
  } catch {
    return { names: [], labels: [] };
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

  try {
    const starter = await fetchStarter(thread);
    const reporter = starter?.author?.username ?? `user ${thread.ownerId ?? 'unknown'}`;
    const description = starter?.content?.trim() || '_(no description provided)_';
    const title = thread.name.slice(0, 120);
    const threadUrl = `https://discord.com/channels/${thread.guildId}/${thread.id}`;
    const { names: tagNames, labels: tagLabels } = resolveTags(thread);

    const labels = Array.from(new Set(['discord-report', source, ...tagLabels]));

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

    await thread.send(
      `Logged as **#${issue.number}** on GitHub — follow it here: ${issue.html_url}`
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
