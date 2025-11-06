#!/usr/bin/env tsx
/**
 * Re-announce the most recently published game to Discord
 *
 * Usage: npx tsx scripts/announce-latest-game.ts
 */

import { Client, GatewayIntentBits, EmbedBuilder, TextChannel } from 'discord.js';
import { config } from '../src/utils/config';
import { arcaneAPI } from '../src/services/api';
import type { RecentGame } from '../src/types/api';

// Discord client setup
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

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
 * Main function
 */
async function main() {
  console.log('🔍 Fetching most recently published game...');

  try {
    // Fetch recent games from the last 7 days
    const sevenDaysInMinutes = 7 * 24 * 60;
    const recentGames = await arcaneAPI.games.getRecentGames(sevenDaysInMinutes);

    if (recentGames.length === 0) {
      console.log('❌ No games found in the last 7 days');
      process.exit(0);
    }

    // Sort by publishedAt descending to ensure we get the most recent
    recentGames.sort((a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );

    const latestGame = recentGames[0];

    console.log(`✅ Found most recent game: "${latestGame.title}"`);
    console.log(`   Published: ${latestGame.publishedAt}`);
    console.log(`   GM: ${latestGame.gm.displayName}`);
    console.log(`   System: ${latestGame.system.name}`);
    console.log('');

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

    // Build the embed
    const botAvatarUrl = client.user?.displayAvatarURL();
    const embed = buildGameEmbed(latestGame, botAvatarUrl);

    // Send header and announcement
    console.log('📤 Sending announcement...');
    let headerMessage = '# New Game Looking for Players';
    if (config.GAME_ANNOUNCEMENT_ROLE_ID) {
      headerMessage = `<@&${config.GAME_ANNOUNCEMENT_ROLE_ID}>\n${headerMessage}`;
      console.log(`   Pinging role: ${config.GAME_ANNOUNCEMENT_ROLE_ID}`);
    }
    await channel.send(headerMessage);
    await channel.send({ embeds: [embed] });

    console.log('✅ Announcement sent successfully!');
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
