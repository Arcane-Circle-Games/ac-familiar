import { Message, EmbedBuilder } from 'discord.js';
import { channelContext } from '../services/context/ChannelContext';
import { wikiService } from '../services/api/wiki';
import { stripHtmlToPlain, truncate } from '../utils/wiki-content';
import { logDebug, logError } from '../utils/logger';
import { config } from '../utils/config';

const WIKI_LINK_REGEX = /\[\[([^\]]{2,100})\]\]/g;
const MAX_LINKS_PER_MESSAGE = 3;
const USER_COOLDOWN_MS = 5000;

// Per-user cooldown map
const userCooldowns = new Map<string, number>();

// Failed lookup cache (term → expiry timestamp)
const failedLookupCache = new Map<string, number>();
const FAILED_LOOKUP_TTL = 2 * 60 * 1000; // 2 minutes

const PAGE_TYPE_EMOJI: Record<string, string> = {
  npc: '👤',
  location: '🗺️',
  item: '🎒',
  faction: '⚔️',
  adventure_arc: '📜',
  session_notes: '📝',
  timeline: '📅',
  custom: '📖'
};

/**
 * Handle [[Wiki Link]] detection in messages
 * Registered as a messageCreate listener
 */
export async function handleWikiLinks(message: Message): Promise<void> {
  try {
    // Skip bot messages and DMs
    if (message.author.bot) return;
    if (!message.guild) return;

    // Check for wiki link patterns
    const matches = [...message.content.matchAll(WIKI_LINK_REGEX)];
    if (matches.length === 0) return;

    // Per-user cooldown
    const lastResponse = userCooldowns.get(message.author.id) ?? 0;
    if (Date.now() - lastResponse < USER_COOLDOWN_MS) return;

    // Set cooldown immediately to prevent spam (even failed lookups count)
    userCooldowns.set(message.author.id, Date.now());

    // Resolve campaign context (cache-only for message listener)
    const ctx = channelContext.resolveCampaignFromMessage(message);
    if (!ctx) return;

    // Deduplicate and cap at 3
    const terms = [...new Set(matches.map(m => m[1]).filter((t): t is string => t !== undefined))].slice(0, MAX_LINKS_PER_MESSAGE);

    const embeds: EmbedBuilder[] = [];
    for (const term of terms) {
      // Check failed lookup cache
      const failedExpiry = failedLookupCache.get(term.toLowerCase());
      if (failedExpiry && Date.now() < failedExpiry) {
        continue;
      }

      const result = await lookupWikiPage(ctx.wikiId, term, message.author.id);
      if (result) {
        embeds.push(buildCompactWikiEmbed(result, ctx.wikiId));
      } else {
        // Cache the failed lookup
        failedLookupCache.set(term.toLowerCase(), Date.now() + FAILED_LOOKUP_TTL);
      }
    }

    if (embeds.length > 0) {
      await message.reply({ embeds, allowedMentions: { repliedUser: false } });
    }
  } catch (err) {
    // Silent failure — ambient feature should never throw errors into chat
    logError('[wiki-links] Error processing wiki link', err as Error);
  }
}

/**
 * Look up a wiki page by term
 */
async function lookupWikiPage(
  wikiId: string,
  term: string,
  discordUserId: string
): Promise<any | null> {
  try {
    // 1. Try exact title match
    const exact = await wikiService.searchPages(wikiId, term, discordUserId, { limit: 1 });
    if (exact.pages.length === 1 && exact.pages[0].title.toLowerCase() === term.toLowerCase()) {
      return exact.pages[0];
    }

    // 2. Fall back to search
    const search = await wikiService.searchPages(wikiId, term, discordUserId, { limit: 3 });
    if (search.pages.length === 1) return search.pages[0];
    if (search.pages.length > 1 && search.pages[0].title.toLowerCase().startsWith(term.toLowerCase())) {
      return search.pages[0];
    }

    // 3. No confident match
    return null;
  } catch (err) {
    logDebug('[wiki-links] Lookup failed', { wikiId, term, error: (err as Error).message });
    return null;
  }
}

/**
 * Build a compact wiki embed for inline references
 */
function buildCompactWikiEmbed(page: any, wikiId: string): EmbedBuilder {
  const emoji = PAGE_TYPE_EMOJI[page.pageType] || '📖';
  const excerpt = truncate(stripHtmlToPlain(page.excerpt || ''), 200);
  const webUrl = `${config.PLATFORM_WEB_URL}/dashboard/wikis/${page.wikiId || wikiId}#${page.slug}`;

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`${emoji} ${page.title}  ·  ${page.pageType || 'page'}`)
    .setDescription(excerpt)
    .setURL(webUrl);
}
