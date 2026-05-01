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
