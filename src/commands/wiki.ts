import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ApplicationCommandOptionType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from 'discord.js';
import { Command } from '../bot/client';
import { channelContext } from '../services/context/ChannelContext';
import { wikiService } from '../services/api/wiki';
import { arcaneAPI } from '../services/api';
import { filterWikiContent, stripHtmlToPlain, truncate } from '../utils/wiki-content';
import { logInfo, logError } from '../utils/logger';
import { config } from '../utils/config';

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

const RESULTS_PER_PAGE = 5;

export const wikiCommand: Command = {
  name: 'wiki',
  description: 'Look up campaign wiki pages',
  options: [
    {
      name: 'search',
      description: 'Search the campaign wiki',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'query',
          description: 'Search terms',
          type: ApplicationCommandOptionType.String,
          required: true
        }
      ]
    },
    {
      name: 'page',
      description: 'View a specific wiki page',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'name',
          description: 'Page name or slug',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        }
      ]
    },
    {
      name: 'npc',
      description: 'Look up an NPC',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'name',
          description: 'NPC name',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        }
      ]
    },
    {
      name: 'location',
      description: 'Look up a location',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'name',
          description: 'Location name',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        }
      ]
    },
    {
      name: 'item',
      description: 'Look up an item',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'name',
          description: 'Item name',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        }
      ]
    },
    {
      name: 'recent',
      description: 'Show recently edited pages',
      type: ApplicationCommandOptionType.Subcommand
    }
  ],

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      const subcommand = interaction.options.getSubcommand();

      logInfo('Wiki command executed', {
        userId: interaction.user.id,
        subcommand
      });

      const ctx = await channelContext.requireCampaignContext(interaction);
      if (!ctx) return;

      switch (subcommand) {
        case 'search':
          await handleSearch(interaction, ctx.wikiId, ctx.gmId);
          break;
        case 'page':
          await handlePageView(interaction, ctx.wikiId, ctx.gmId);
          break;
        case 'npc':
          await handleTypedSearch(interaction, ctx.wikiId, ctx.gmId, 'npc');
          break;
        case 'location':
          await handleTypedSearch(interaction, ctx.wikiId, ctx.gmId, 'location');
          break;
        case 'item':
          await handleTypedSearch(interaction, ctx.wikiId, ctx.gmId, 'item');
          break;
        case 'recent':
          await handleRecent(interaction, ctx.wikiId, ctx.gmId);
          break;
      }
    } catch (error) {
      logError('Error executing wiki command', error as Error, {
        userId: interaction.user.id
      });

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Wiki Error')
          .setDescription('An error occurred while looking up the wiki.')
        ]
      });
    }
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    try {
      const ctx = await channelContext.resolveCampaign(
        interaction.channelId,
        interaction.user.id
      );
      if (!ctx) return interaction.respond([]);

      const focused = interaction.options.getFocused(true);
      if (!focused.value || focused.value.length < 1) {
        return interaction.respond([]);
      }

      const suggestions = await wikiService.searchSuggest(
        ctx.wikiId,
        focused.value,
        interaction.user.id
      );

      const choices = (suggestions as any[])
        .slice(0, 25)
        .map((page: any) => ({
          name: `${page.title} (${page.pageType || 'page'})`.substring(0, 100),
          value: page.id
        }));

      return interaction.respond(choices);
    } catch {
      return interaction.respond([]);
    }
  }
};

/**
 * /wiki search — full-text search with pagination
 */
async function handleSearch(
  interaction: ChatInputCommandInteraction,
  wikiId: string,
  gmId: string
): Promise<void> {
  const query = interaction.options.getString('query', true);

  const results = await wikiService.searchPages(
    wikiId,
    query,
    interaction.user.id
  );

  // Defense-in-depth: filter by visibility (platform API should handle this, but check client-side)
  const isGM = await checkIsGM(interaction.user.id, gmId);
  const visiblePages = results.pages.filter((page: any) =>
    canUserSeePage(page.visibility || 'players', isGM)
  );

  if (visiblePages.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('📖 No Results')
        .setDescription(`No pages found matching "${query}". Try different search terms.`)
      ]
    });
    return;
  }

  const pages = visiblePages;
  let currentPage = 0;
  const totalPages = Math.ceil(pages.length / RESULTS_PER_PAGE);

  const generateEmbed = (page: number) => {
    const start = page * RESULTS_PER_PAGE;
    const slice = pages.slice(start, start + RESULTS_PER_PAGE);

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`📖 Wiki Search: "${query}"`)
      .setDescription(`Found ${results.total} results`)
      .setFooter({
        text: totalPages > 1
          ? `Page ${page + 1} of ${totalPages} • Arcane Circle`
          : 'Arcane Circle'
      });

    for (const result of slice) {
      const emoji = PAGE_TYPE_EMOJI[result.pageType] || '📖';
      const tags = result.tags?.length > 0
        ? ' · ' + result.tags.map((t: string) => `#${t}`).join(' ')
        : '';
      const excerpt = truncate(stripHtmlToPlain(result.excerpt || ''), 200);
      const webUrl = getPageUrl(wikiId, result.slug);

      embed.addFields({
        name: `${emoji} ${result.title}  ·  ${result.pageType}${tags}`,
        value: `${excerpt}\n[🔗 View on Arcane Circle](${webUrl})`,
        inline: false
      });
    }

    return embed;
  };

  const generateButtons = (page: number) => {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('wiki_prev')
        .setLabel('◀️ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('wiki_next')
        .setLabel('Next ▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === totalPages - 1)
    );
  };

  const response = await interaction.editReply({
    embeds: [generateEmbed(currentPage)],
    components: totalPages > 1 ? [generateButtons(currentPage)] : []
  });

  if (totalPages > 1) {
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 300000
    });

    collector.on('collect', async (btn) => {
      if (btn.user.id !== interaction.user.id) {
        await btn.reply({ content: 'You can only control your own search.', ephemeral: true });
        return;
      }

      if (btn.customId === 'wiki_prev') {
        currentPage = Math.max(0, currentPage - 1);
      } else if (btn.customId === 'wiki_next') {
        currentPage = Math.min(totalPages - 1, currentPage + 1);
      }

      await btn.update({
        embeds: [generateEmbed(currentPage)],
        components: [generateButtons(currentPage)]
      });
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch {
        // Message may have been deleted
      }
    });
  }
}

/**
 * /wiki page — view a specific wiki page
 */
async function handlePageView(
  interaction: ChatInputCommandInteraction,
  wikiId: string,
  gmId: string
): Promise<void> {
  const nameOrId = interaction.options.getString('name', true);

  // Try fetching by ID first (autocomplete gives us IDs)
  let pageData = await wikiService.getPage(wikiId, nameOrId);

  // If not found by ID, search by title
  if (!pageData) {
    const search = await wikiService.searchPages(wikiId, nameOrId, interaction.user.id, { limit: 1 });
    if (search.pages.length > 0) {
      pageData = await wikiService.getPage(wikiId, search.pages[0].id);
    }
  }

  if (!pageData) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ Page Not Found')
        .setDescription(`No page found matching "${nameOrId}".`)
      ]
    });
    return;
  }

  await sendPageEmbed(interaction, wikiId, gmId, pageData);
}

/**
 * /wiki npc, /wiki location, /wiki item — typed search
 */
async function handleTypedSearch(
  interaction: ChatInputCommandInteraction,
  wikiId: string,
  gmId: string,
  pageType: string
): Promise<void> {
  const nameOrId = interaction.options.getString('name', true);

  // Check if it's an autocomplete ID
  if (nameOrId.length > 20) {
    const pageData = await wikiService.getPage(wikiId, nameOrId);
    if (pageData) {
      await sendPageEmbed(interaction, wikiId, gmId, pageData);
      return;
    }
  }

  const results = await wikiService.searchPages(
    wikiId,
    nameOrId,
    interaction.user.id,
    { pageType }
  );

  // Defense-in-depth: filter by visibility
  const isGM = await checkIsGM(interaction.user.id, gmId);
  const visiblePages = results.pages.filter((page: any) =>
    canUserSeePage(page.visibility || 'players', isGM)
  );

  if (visiblePages.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle(`⚠️ No ${capitalize(pageType)} Found`)
        .setDescription(`No ${pageType} found matching "${nameOrId}".`)
      ]
    });
    return;
  }

  // If exactly one result, show full page
  if (visiblePages.length === 1) {
    const fullPage = await wikiService.getPage(wikiId, visiblePages[0].id);
    if (fullPage) {
      await sendPageEmbed(interaction, wikiId, gmId, fullPage);
      return;
    }
  }

  // Multiple results
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📖 ${capitalize(pageType)} Search: "${nameOrId}"`)
    .setDescription(`Found ${visiblePages.length} results`)
    .setFooter({ text: 'Arcane Circle' });

  const displayed = visiblePages.slice(0, RESULTS_PER_PAGE);
  for (const result of displayed) {
    const emoji = PAGE_TYPE_EMOJI[result.pageType] || '📖';
    const tags = result.tags?.length > 0
      ? ' · ' + result.tags.map((t: string) => `#${t}`).join(' ')
      : '';
    const excerpt = truncate(stripHtmlToPlain(result.excerpt || ''), 200);
    const webUrl = getPageUrl(wikiId, result.slug);

    embed.addFields({
      name: `${emoji} ${result.title}${tags}`,
      value: `${excerpt}\n[🔗 View on Arcane Circle](${webUrl})`,
      inline: false
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

/**
 * /wiki recent — recently edited pages
 */
async function handleRecent(
  interaction: ChatInputCommandInteraction,
  wikiId: string,
  gmId: string
): Promise<void> {
  const recentPages = await wikiService.getRecentPages(
    wikiId,
    interaction.user.id,
    10
  );

  // Defense-in-depth: filter by visibility
  const isGM = await checkIsGM(interaction.user.id, gmId);
  const visiblePages = recentPages?.filter((entry: any) => {
    const page = entry.page || entry;
    return canUserSeePage(page.visibility || 'players', isGM);
  }) || [];

  if (visiblePages.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('📖 No Recent Pages')
        .setDescription('No recently viewed or edited pages found.')
      ]
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📖 Recent Wiki Pages')
    .setFooter({ text: 'Arcane Circle' });

  let description = '';
  for (const entry of visiblePages) {
    const page = entry.page || entry;
    const title = page.title || 'Untitled';
    const pType = page.pageType || 'page';
    const emoji = PAGE_TYPE_EMOJI[pType] || '📖';
    const viewedAt = entry.viewedAt || entry.updatedAt;
    const ago = viewedAt ? getTimeAgo(new Date(viewedAt)) : '';

    description += `${emoji} **${title}**  ·  ${pType}${ago ? `  ·  ${ago}` : ''}\n`;
  }

  embed.setDescription(description.trim());
  await interaction.editReply({ embeds: [embed] });
}

// ── Shared page embed builder ──────────────────────────────

async function sendPageEmbed(
  interaction: ChatInputCommandInteraction,
  wikiId: string,
  gmId: string,
  pageData: any
): Promise<void> {
  const page = pageData.page || pageData;
  const isGM = await checkIsGM(interaction.user.id, gmId);

  let platformUserId = '';
  try {
    const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
    if (user) platformUserId = user.id;
  } catch (error) {
    logError('Failed to get platform user for wiki filtering', error as Error, { discordId: interaction.user.id });
  }

  // Validate platformUserId before filtering
  if (!platformUserId || platformUserId.trim() === '') {
    if (!isGM) {
      // Non-GM without valid platform user ID - fail closed
      logError('No valid platform user ID for non-GM wiki access - suppressing content', new Error('Missing platform user ID'), { discordId: interaction.user.id });
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Account Not Linked')
          .setDescription('You must link your Discord account to view wiki pages. Use `/link` to connect your account.')
        ]
      });
      return;
    }
    // GMs can proceed without user ID (they see all content)
  }

  let content = page.content || '';
  try {
    if (content && platformUserId) {
      content = filterWikiContent(content, platformUserId, isGM);
    }
    content = stripHtmlToPlain(content);
  } catch (error) {
    // Fail closed on any filtering error
    logError('Wiki content filtering failed - suppressing content', error as Error);
    content = '';
  }
  content = truncate(content, 500);

  const title = page.title || 'Unknown Page';
  const pType = page.pageType || 'custom';
  const tags = page.tags || [];
  const slug = page.slug || '';
  const updatedAt = page.updatedAt;

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📖 ${title}`)
    .setDescription(content || '*No content*');

  const fields: { name: string; value: string; inline: boolean }[] = [];
  fields.push({ name: 'Type', value: pType, inline: true });
  if (tags.length > 0) {
    fields.push({ name: 'Tags', value: tags.map((t: string) => `#${t}`).join(' '), inline: true });
  }
  if (updatedAt) {
    fields.push({ name: 'Last edited', value: getTimeAgo(new Date(updatedAt)), inline: true });
  }
  if (fields.length > 0) embed.addFields(fields);

  const webUrl = getPageUrl(wikiId, slug);
  embed.setURL(webUrl);
  embed.setFooter({ text: 'Arcane Circle' });

  await interaction.editReply({ embeds: [embed] });
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Defense-in-depth visibility check
 * Platform API should enforce this, but we check client-side as a safety net
 */
function canUserSeePage(visibility: string, isGM: boolean): boolean {
  switch (visibility) {
    case 'public':
      return true;
    case 'players':
      return true; // User is authenticated (they have a platform account)
    case 'gm_only':
      return isGM;
    case 'private':
      return false;
    default:
      return false; // Unknown visibility - fail closed
  }
}

function getPageUrl(wikiId: string, slug: string): string {
  return `${config.PLATFORM_WEB_URL}/dashboard/wikis/${wikiId}#${slug}`;
}

async function checkIsGM(discordUserId: string, gmId: string): Promise<boolean> {
  try {
    const user = await arcaneAPI.getUserByDiscordId(discordUserId);
    return user?.id === gmId;
  } catch {
    return false;
  }
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
