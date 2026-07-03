/**
 * Minimal GitHub REST API client for filing issues from the bot.
 *
 * Uses native fetch (Node 18+). Auth via PAT or fine-grained token in
 * config.GITHUB_TOKEN with `issues: write` permission on config.GITHUB_BUG_REPO.
 */

import { config } from '../utils/config';
import { logError, logInfo } from '../utils/logger';

export interface CreateIssueParams {
  title: string;
  body: string;
  labels?: string[];
}

export interface GitHubIssue {
  number: number;
  html_url: string;
}

export async function createBugIssue(
  params: CreateIssueParams
): Promise<GitHubIssue> {
  if (!config.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is not configured');
  }
  if (!config.GITHUB_BUG_REPO || !config.GITHUB_BUG_REPO.includes('/')) {
    throw new Error(
      `GITHUB_BUG_REPO must be in 'owner/repo' form, got: ${config.GITHUB_BUG_REPO}`
    );
  }

  const url = `https://api.github.com/repos/${config.GITHUB_BUG_REPO}/issues`;

  logInfo('Creating GitHub issue', {
    repo: config.GITHUB_BUG_REPO,
    title: params.title,
    labels: params.labels
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'arcane-circle-discord-bot',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: params.title,
      body: params.body,
      labels: params.labels ?? []
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '<no body>');
    logError(
      'GitHub issue creation failed',
      new Error(`status=${response.status} body=${text}`),
      { repo: config.GITHUB_BUG_REPO }
    );
    throw new Error(
      `GitHub API returned ${response.status}: ${text.slice(0, 200)}`
    );
  }

  const issue = (await response.json()) as {
    number: number;
    html_url: string;
  };
  return { number: issue.number, html_url: issue.html_url };
}

function ghHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'arcane-circle-discord-bot',
    'Content-Type': 'application/json'
  };
}

/**
 * Close a GitHub issue if it is currently open. Idempotent: a no-op (no comment,
 * no state change) if the issue is already closed or missing. Returns the action
 * taken so the caller can decide whether to confirm in Discord.
 */
export async function closeIssueIfOpen(
  issueNumber: number,
  comment?: string
): Promise<'closed' | 'already-closed' | 'not-found'> {
  if (!config.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not configured');
  const base = `https://api.github.com/repos/${config.GITHUB_BUG_REPO}/issues/${issueNumber}`;

  const getRes = await fetch(base, { headers: ghHeaders() });
  if (getRes.status === 404) return 'not-found';
  if (!getRes.ok) {
    throw new Error(`GitHub GET issue ${issueNumber} returned ${getRes.status}`);
  }
  const issue = (await getRes.json()) as { state: string };
  if (issue.state === 'closed') return 'already-closed';

  if (comment) {
    await fetch(`${base}/comments`, {
      method: 'POST',
      headers: ghHeaders(),
      body: JSON.stringify({ body: comment })
    }).catch((e) =>
      logError('Failed to comment before closing issue', e as Error, { issueNumber })
    );
  }

  const patch = await fetch(base, {
    method: 'PATCH',
    headers: ghHeaders(),
    body: JSON.stringify({ state: 'closed' })
  });
  if (!patch.ok) {
    const text = await patch.text().catch(() => '<no body>');
    throw new Error(
      `GitHub close issue ${issueNumber} returned ${patch.status}: ${text.slice(0, 150)}`
    );
  }
  logInfo('Closed GitHub issue from Discord', { issueNumber });
  return 'closed';
}

/** Find the issue whose body carries this Discord thread URL. null if none. */
export async function findIssueByThreadUrl(threadUrl: string): Promise<number | null> {
  if (!config.GITHUB_TOKEN) return null;
  const q = encodeURIComponent(`repo:${config.GITHUB_BUG_REPO} in:body "${threadUrl}"`);
  const url = `https://api.github.com/search/issues?q=${q}&per_page=1`;
  try {
    const res = await fetch(url, { headers: ghHeaders() });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: Array<{ number: number }> };
    return data.items?.[0]?.number ?? null;
  } catch {
    return null;
  }
}

export interface FullIssue {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  state: string;
}

/** Fetch a single issue (number, body, state) from the bug repo; null if 404. */
export async function getIssue(issueNumber: number): Promise<FullIssue | null> {
  if (!config.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not configured');
  const url = `https://api.github.com/repos/${config.GITHUB_BUG_REPO}/issues/${issueNumber}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET issue ${issueNumber} returned ${res.status}`);
  const i = (await res.json()) as {
    number: number;
    html_url: string;
    title: string;
    body: string | null;
    state: string;
  };
  return { number: i.number, html_url: i.html_url, title: i.title, body: i.body ?? null, state: i.state };
}
