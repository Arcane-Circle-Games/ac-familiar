#!/usr/bin/env tsx
/**
 * Announce all currently open games (with available slots) to Discord
 *
 * Usage: npx tsx scripts/announce-all-open-games.ts
 */

import { Client, GatewayIntentBits, EmbedBuilder, TextChannel } from 'discord.js';
import { config } from '../src/utils/config';
import { arcaneAPI } from '../src/services/api';
import type { RecentGame } from '../src/types/api';

// Discord client setup
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const RATE_LIMIT_DELAY = 1100; // 1.1 seconds between messages (max ~5 per 5 sec)

/**
 * Convert HTML to Discord markdown
 */
function htmlToDiscordMarkdown(html: string): string {
  if (!html) return '';

  let text = html;

  // Convert common HTML tags to Discord markdown
  text = text.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
  text = text.replace(/<b>(.*?)<\/b>/gi, '**$1**');
  text = text.replace(/<em>(.*?)<\/em>/gi, '*$1*');
  text = text.replace(/<i>(.*?)<\/i>/gi, '*$1*');
  text = text.replace(/<u>(.*?)<\/u>/gi, '__$1__');
  text = text.replace(/<code>(.*?)<\/code>/gi, '`$1`');

  // Handle line breaks
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<p>/gi, '');

  // Handle lists
  text = text.replace(/<li>(.*?)<\/li>/gi, '• $1\n');
  text = text.replace(/<\/?[uo]l>/gi, '');

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Clean up excessive whitespace
  text = text.replace(/\n\n\n+/g, '\n\n');
  text = text.trim();

  return text;
}

/**
 * Truncate description to fit Discord embed limits
 */
function truncateDescription(description: string, maxLength: number): string {
  if (description.length <= maxLength) {
    return description;
  }

  return description.substring(0, maxLength - 3) + '...';
}

/**
 * Format game type for display
 */
function formatGameType(gameType: string): string {
  const typeMap: Record<string, string> = {
    'CAMPAIGN': 'Campaign',
    'ONE_SHOT': 'One-Shot',
    'MINI_CAMPAIGN': 'Mini Campaign',
    'WEST_MARCHES': 'West Marches'
  };

  return typeMap[gameType] || gameType;
}

/**
 * Build a rich Discord embed for a game announcement
 */
function buildGameEmbed(game: RecentGame, botAvatarUrl?: string): EmbedBuilder {
  const cleanDescription = htmlToDiscordMarkdown(game.description);

  const embed = new EmbedBuilder()
    .setColor(0x00d4ff) // Arcane Circle brand color
    .setTitle(`🎮 ${game.title}`)
    .setDescription(truncateDescription(cleanDescription, 300))
    .setTimestamp(new Date(game.publishedAt));

  // Game details field
  const gameDetails = [
    `**System:** ${game.system.shortName || game.system.name}`,
    `**Type:** ${formatGameType(game.gameType)}`,
    `**GM:** ${game.gm.displayName}${game.gm.profile.verified ? ' ✓' : ''}`
  ];

  if (game.gm.profile.totalRatings > 0) {
    gameDetails.push(`**Rating:** ⭐ ${game.gm.profile.averageRating} (${game.gm.profile.totalRatings} reviews)`);
  }

  embed.addFields({
    name: '📋 Game Details',
    value: gameDetails.join('\n'),
    inline: false
  });

  // Session info field
  const sessionInfo = [
    `**Start Time:** <t:${Math.floor(new Date(game.startTime).getTime() / 1000)}:F>`,
    `**Duration:** ${game.duration} hours`,
    `**Price:** $${game.pricePerSession}/session`
  ];

  embed.addFields({
    name: '📅 Session Info',
    value: sessionInfo.join('\n'),
    inline: false
  });

  // Availability field
  const availabilityText = game.availableSlots > 0
    ? `${game.availableSlots} of ${game.maxPlayers} slots available`
    : 'Game is full';

  embed.addFields({
    name: '👥 Availability',
    value: availabilityText,
    inline: true
  });

  // Link to game page
  embed.addFields({
    name: '🔗 View Game',
    value: `[Open on Arcane Circle](${game.url})`,
    inline: true
  });

  // Join command
  embed.addFields({
    name: '⚡ Quick Join',
    value: `\`/join-game game-id:${game.id}\``,
    inline: true
  });

  // Footer
  if (botAvatarUrl) {
    embed.setFooter({
      text: 'Arcane Circle',
      iconURL: botAvatarUrl
    });
  } else {
    embed.setFooter({
      text: 'Arcane Circle'
    });
  }

  return embed;
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main function
 */
async function main() {
  console.log('🔍 Fetching all open games...');

  try {
    // Fetch games with available slots
    // Using a large time window (30 days) to get all currently open games
    const thirtyDaysInMinutes = 30 * 24 * 60;
    const recentGames = await arcaneAPI.games.getRecentGames(thirtyDaysInMinutes);

    if (recentGames.length === 0) {
      console.log('❌ No games found');
      process.exit(0);
    }

    // Filter to only games with available slots
    const openGames = recentGames.filter(game => game.availableSlots > 0);

    if (openGames.length === 0) {
      console.log('❌ No open games with available slots found');
      console.log(`   Total games: ${recentGames.length}`);
      console.log(`   All games are currently full`);
      process.exit(0);
    }

    // Sort by start time (soonest first)
    openGames.sort((a, b) =>
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

    console.log(`✅ Found ${openGames.length} open games with available slots`);
    console.log(`   (out of ${recentGames.length} total games)\n`);

    // Show summary
    openGames.forEach((game, index) => {
      console.log(`${index + 1}. "${game.title}" - ${game.availableSlots}/${game.maxPlayers} slots`);
      console.log(`   GM: ${game.gm.displayName} | System: ${game.system.shortName}`);
      console.log(`   Starts: ${new Date(game.startTime).toLocaleString()}`);
      console.log('');
    });

    if (!config.GAME_ANNOUNCEMENT_CHANNEL_ID) {
      console.log('❌ GAME_ANNOUNCEMENT_CHANNEL_ID not configured');
      process.exit(1);
    }

    // Login to Discord
    console.log('🤖 Connecting to Discord...');
    await client.login(config.DISCORD_TOKEN);

    // Wait for bot to be ready
    await new Promise<void>((resolve) => {
      client.once('ready', () => {
        console.log(`✅ Connected as ${client.user?.tag}`);
        resolve();
      });
    });

    // Fetch the announcement channel
    console.log(`📢 Fetching announcement channel ${config.GAME_ANNOUNCEMENT_CHANNEL_ID}...`);
    const channel = await client.channels.fetch(config.GAME_ANNOUNCEMENT_CHANNEL_ID);

    if (!channel) {
      console.log('❌ Channel not found');
      process.exit(1);
    }

    if (!channel.isTextBased() || !(channel instanceof TextChannel)) {
      console.log('❌ Channel is not a text channel');
      process.exit(1);
    }

    // Get bot avatar for embeds
    const botAvatarUrl = client.user?.displayAvatarURL();

    // Send header
    console.log('\n📤 Sending announcements...\n');
    await channel.send(`# Open Games Looking for Players\n*${openGames.length} games with available slots*`);
    await sleep(RATE_LIMIT_DELAY);

    // Send each game announcement
    let announced = 0;
    let failed = 0;

    for (const game of openGames) {
      try {
        const embed = buildGameEmbed(game, botAvatarUrl);
        await channel.send({ embeds: [embed] });
        announced++;

        console.log(`✅ [${announced}/${openGames.length}] Announced: "${game.title}"`);

        // Rate limit: Wait between announcements
        if (announced < openGames.length) {
          await sleep(RATE_LIMIT_DELAY);
        }
      } catch (error: any) {
        failed++;
        console.error(`❌ Failed to announce "${game.title}":`, error.message);
      }
    }

    console.log('\n✅ Announcement complete!');
    console.log(`   Announced: ${announced}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Channel: ${channel.name} (${channel.id})`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response?.data) {
      console.error('   API Response:', error.response.data);
    }
    process.exit(1);
  } finally {
    // Cleanup
    client.destroy();
    process.exit(0);
  }
}

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
