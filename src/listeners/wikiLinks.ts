import { Message, EmbedBuilder } from 'discord.js';
import { channelContext } from '../services/context/ChannelContext';
import { wikiService } from '../services/api/wiki';
import { stripHtmlToPlain, truncate } from '../utils/wiki-content';
import { config } from '../utils/config';
import { logDebug, logError } from '../utils/logger';

const WIKI_LINK_REGEX = /\[\[([^\]]{2,100})\]\]/g;

// Rate limiting
const userCooldowns = new Map<string, number>(); // userId → last response timestamp
const COOLDOWN_MS = 5000; // 5 seconds per user

// Failed lookup cache (avoid re-querying unknown terms)
const failedLookups = new Map<string, number>(); // term → expiry timestamp
const FAILED_LOOKUP_TTL = 2 * 60 * 1000; // 2 minutes

/**
 * Handle wiki link detection in messages
 */
export async function handleWikiLinks(message: Message): Promise<void> {
  // Skip bot messages and DMs
  if (message.author.bot) return;
  if (!message.guild) return;

  // Check for wiki link patterns
  const matches = [...message.content.matchAll(WIKI_LINK_REGEX)];
  if (matches.length === 0) return;

  // Rate limit check
  const lastResponse = userCooldowns.get(message.author.id) || 0;
  if (Date.now() - lastResponse < COOLDOWN_MS) {
    logDebug('Wiki link rate limited', { userId: message.author.id });
    return;
  }

  try {
    // Resolve campaign context from channel (cache-only)
    const ctx = channelContext.resolveCampaignFromMessage(message);
    if (!ctx) {
      // Channel not bound - silently ignore
      return;
    }

    // Extract unique terms (max 3)
    const terms = [...new Set(matches.map(m => m[1]).slice(0, 3))];

    const embeds: EmbedBuilder[] = [];
    for (const term of terms) {
      const result = await lookupWikiPage(ctx.wikiId, term, message.author.id);
      if (result) {
        embeds.push(buildCompactWikiEmbed(result, ctx.wikiId));
      }
    }

    if (embeds.length > 0) {
      await message.reply({ embeds, allowedMentions: { repliedUser: false } });
      userCooldowns.set(message.author.id, Date.now());
    }

  } catch (error) {
    // Silent fail - don't post errors for ambient features
    logError('[wiki-links] Error processing wiki link', error as Error, {
      channelId: message.channelId,
      userId: message.author.id
    });
  }
}

/**
 * Look up a wiki page by term
 * Returns page if found, null otherwise
 */
async function lookupWikiPage(
  wikiId: string,
  term: string,
  discordUserId: string
): Promise<any | null> {
  const now = Date.now();

  // Check failed lookup cache
  const failedExpiry = failedLookups.get(term);
  if (failedExpiry && now < failedExpiry) {
    logDebug('Wiki link lookup skipped (cached failure)', { term });
    return null;
  }

  try {
    // Search for the term
    const searchResults = await wikiService.searchPages(wikiId, term, discordUserId, { limit: 3 });

    if (searchResults.pages.length === 0) {
      // No results - cache the failure
      failedLookups.set(term, now + FAILED_LOOKUP_TTL);
      return null;
    }

    // If exactly one result, return it
    if (searchResults.pages.length === 1) {
      return searchResults.pages[0];
    }

    // Multiple results - check if first result is a strong match
    const firstPage = searchResults.pages[0];
    if (firstPage.title.toLowerCase() === term.toLowerCase()) {
      // Exact title match - use it
      return firstPage;
    }

    if (firstPage.title.toLowerCase().startsWith(term.toLowerCase())) {
      // Prefix match - likely the right one
      return firstPage;
    }

    // Ambiguous results - don't show anything
    logDebug('Wiki link lookup ambiguous', { term, resultCount: searchResults.pages.length });
    return null;

  } catch (error) {
    logError('Failed to lookup wiki page', error as Error, { term, wikiId });
    return null;
  }
}

/**
 * Build compact embed for wiki link
 */
function buildCompactWikiEmbed(page: any, wikiId: string): EmbedBuilder {
  const excerpt = truncate(stripHtmlToPlain(page.excerpt || page.content || ''), 200);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📖 ${page.title} · ${page.pageType}`)
    .setDescription(excerpt || 'No description available.')
    .setURL(`${config.PLATFORM_WEB_URL}/dashboard/wikis/${wikiId}#${page.slug}`);

  return embed;
}

/**
 * Cleanup expired entries periodically
 */
setInterval(() => {
  const now = Date.now();
  let cleared = 0;

  // Clear expired failed lookups
  failedLookups.forEach((expiry, term) => {
    if (now >= expiry) {
      failedLookups.delete(term);
      cleared++;
    }
  });

  // Clear old cooldowns (keep last hour only)
  const hourAgo = now - 60 * 60 * 1000;
  userCooldowns.forEach((timestamp, userId) => {
    if (timestamp < hourAgo) {
      userCooldowns.delete(userId);
    }
  });

  if (cleared > 0) {
    logDebug('Wiki link cache cleanup', { failedLookupsCleared: cleared });
  }
}, 5 * 60 * 1000); // Clean every 5 minutes
