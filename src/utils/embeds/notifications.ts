import { EmbedBuilder } from 'discord.js';
import {
  SessionReminderWebhook,
  BookingConfirmedWebhook,
  ApplicationStatusWebhook,
  SessionCancelledWebhook,
  GamePublishedWebhook
} from '../../types/webhooks';

/**
 * Build Discord embed for session reminder notification
 */
export function buildSessionReminderEmbed(webhook: SessionReminderWebhook): EmbedBuilder {
  const { metadata } = webhook.notification;

  // Handle missing or incomplete metadata gracefully
  const gameTitle = metadata?.gameTitle || 'Unknown Game';
  const sessionNumber = metadata?.sessionNumber || 0;
  const gmName = metadata?.gmName || 'Unknown GM';
  const scheduledTime = metadata?.scheduledTime ? new Date(metadata.scheduledTime) : null;

  const embed = new EmbedBuilder()
    .setColor(0xFFD700) // Gold color for reminders
    .setTitle('⏰ Session Starting Soon!')
    .setDescription(
      webhook.notification.message || `Your session for **${gameTitle}** starts soon!`
    )
    .setFooter({ text: 'Arcane Circle • Session Reminder' })
    .setTimestamp();

  // Build fields array dynamically
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  // Add game title
  if (gameTitle) {
    fields.push({
      name: '🎮 Game',
      value: gameTitle,
      inline: true
    });
  }

  // Add session number
  if (sessionNumber > 0) {
    fields.push({
      name: '📅 Session',
      value: `Session ${sessionNumber}`,
      inline: true
    });
  }

  // Add GM name
  if (gmName && gmName !== 'Unknown GM') {
    fields.push({
      name: '🎲 Game Master',
      value: gmName,
      inline: true
    });
  }

  // Add start time if available
  if (scheduledTime && !isNaN(scheduledTime.getTime())) {
    const timestamp = Math.floor(scheduledTime.getTime() / 1000);
    fields.push({
      name: '🕐 Start Time',
      value: `<t:${timestamp}:F>\n<t:${timestamp}:R>`,
      inline: false
    });
  }

  // Only add fields if we have any
  if (fields.length > 0) {
    embed.addFields(fields);
  }

  // Add action URL if available
  if (webhook.notification.actionUrl) {
    embed.setURL(webhook.notification.actionUrl);
  }

  return embed;
}

/**
 * Build Discord embed for booking confirmation
 */
export function buildBookingConfirmedEmbed(webhook: BookingConfirmedWebhook): EmbedBuilder {
  const { metadata } = webhook.notification;

  // Handle missing or incomplete metadata gracefully
  const gameTitle = metadata?.gameTitle || 'Unknown Game';
  const gmName = metadata?.gmName || 'Unknown GM';

  const embed = new EmbedBuilder()
    .setColor(0x00D4AA) // Arcane Circle mint color
    .setTitle('✅ Booking Confirmed!')
    .setDescription(
      webhook.notification.message || `You're all set for **${gameTitle}**!`
    )
    .setFooter({ text: 'Arcane Circle • Booking Confirmation' })
    .setTimestamp();

  // Build fields array dynamically
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  // Add game title
  if (gameTitle) {
    fields.push({
      name: '🎮 Game',
      value: gameTitle,
      inline: false
    });
  }

  // Add GM name
  if (gmName && gmName !== 'Unknown GM') {
    fields.push({
      name: '🎲 Game Master',
      value: gmName,
      inline: true
    });
  }

  // Add next session time if available
  if (metadata?.nextSessionTime) {
    const nextSession = new Date(metadata.nextSessionTime);
    if (!isNaN(nextSession.getTime())) {
      const timestamp = Math.floor(nextSession.getTime() / 1000);
      fields.push({
        name: '📅 Next Session',
        value: `<t:${timestamp}:F>\n<t:${timestamp}:R>`,
        inline: false
      });
    }
  }

  // Add price if available
  if (metadata?.price && typeof metadata.price === 'number') {
    fields.push({
      name: '💰 Price',
      value: `$${metadata.price.toFixed(2)}`,
      inline: true
    });
  }

  // Only add fields if we have any
  if (fields.length > 0) {
    embed.addFields(fields);
  }

  // Add action URL if available
  if (webhook.notification.actionUrl) {
    embed.setURL(webhook.notification.actionUrl);
  }

  return embed;
}

/**
 * Build Discord embed for application status update
 */
export function buildApplicationStatusEmbed(webhook: ApplicationStatusWebhook): EmbedBuilder {
  const { metadata } = webhook.notification;

  // Handle missing or incomplete metadata gracefully
  const isApproved = metadata?.status === 'approved';
  const gameTitle = metadata?.gameTitle || 'Unknown Game';
  const gmName = metadata?.gmName || 'Unknown GM';

  const embed = new EmbedBuilder()
    .setColor(isApproved ? 0x00FF00 : 0xFF6B6B) // Green for approved, red for declined
    .setTitle(isApproved ? '✅ Application Approved!' : '❌ Application Declined')
    .setDescription(
      webhook.notification.message ||
      (isApproved
        ? `Your application to join **${gameTitle}** has been approved!`
        : `Your application to join **${gameTitle}** was not accepted this time.`)
    )
    .setFooter({ text: 'Arcane Circle • Application Update' })
    .setTimestamp();

  // Build fields array dynamically
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  // Add game title
  if (gameTitle) {
    fields.push({
      name: '🎮 Game',
      value: gameTitle,
      inline: false
    });
  }

  // Add GM name
  if (gmName && gmName !== 'Unknown GM') {
    fields.push({
      name: '🎲 Game Master',
      value: gmName,
      inline: true
    });
  }

  // Add status
  fields.push({
    name: '📋 Status',
    value: isApproved ? 'Approved' : 'Declined',
    inline: true
  });

  // Only add fields if we have any
  if (fields.length > 0) {
    embed.addFields(fields);
  }

  // Add action URL if available
  if (webhook.notification.actionUrl) {
    embed.setURL(webhook.notification.actionUrl);
  }

  return embed;
}

/**
 * Build Discord embed for session cancellation
 */
export function buildSessionCancelledEmbed(webhook: SessionCancelledWebhook): EmbedBuilder {
  const { metadata } = webhook.notification;

  // Handle missing or incomplete metadata gracefully
  const gameTitle = metadata?.gameTitle || 'Unknown Game';
  const sessionNumber = metadata?.sessionNumber || 0;
  const gmName = metadata?.gmName || 'Unknown GM';
  const scheduledTime = metadata?.scheduledTime ? new Date(metadata.scheduledTime) : null;

  const embed = new EmbedBuilder()
    .setColor(0xFF0000) // Red for cancellations
    .setTitle('❌ Session Cancelled')
    .setDescription(
      webhook.notification.message ||
      `Session ${sessionNumber > 0 ? sessionNumber : ''} for **${gameTitle}** has been cancelled.`
    )
    .setFooter({ text: 'Arcane Circle • Session Update' })
    .setTimestamp();

  // Build fields array dynamically
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  // Add game title
  if (gameTitle) {
    fields.push({
      name: '🎮 Game',
      value: gameTitle,
      inline: false
    });
  }

  // Add scheduled time if available
  if (scheduledTime && !isNaN(scheduledTime.getTime())) {
    const timestamp = Math.floor(scheduledTime.getTime() / 1000);
    fields.push({
      name: '📅 Was Scheduled For',
      value: `<t:${timestamp}:F>`,
      inline: false
    });
  }

  // Add GM name
  if (gmName && gmName !== 'Unknown GM') {
    fields.push({
      name: '🎲 Game Master',
      value: gmName,
      inline: true
    });
  }

  // Add session number
  if (sessionNumber > 0) {
    fields.push({
      name: '📋 Session',
      value: `Session ${sessionNumber}`,
      inline: true
    });
  }

  // Add cancellation reason if provided
  if (metadata?.reason) {
    fields.push({
      name: '📝 Reason',
      value: metadata.reason,
      inline: false
    });
  }

  // Only add fields if we have any
  if (fields.length > 0) {
    embed.addFields(fields);
  }

  // Add action URL if available
  if (webhook.notification.actionUrl) {
    embed.setURL(webhook.notification.actionUrl);
  }

  return embed;
}

/**
 * Build Discord embed for game published notification
 */
export function buildGamePublishedEmbed(webhook: GamePublishedWebhook): EmbedBuilder {
  const { game } = webhook;

  // Convert HTML description to plain text and truncate
  const cleanDescription = htmlToMarkdown(game.description);

  const embed = new EmbedBuilder()
    .setColor(0x00d4ff) // Arcane Circle brand color
    .setTitle(`🎮 ${game.title}`)
    .setDescription(truncateText(cleanDescription, 300))
    .setURL(game.url)
    .setTimestamp(new Date(game.publishedAt))
    .setFooter({ text: 'Arcane Circle • New Game' });

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
  const startTime = new Date(game.startTime);
  const timestamp = Math.floor(startTime.getTime() / 1000);
  const sessionInfo = [
    `**Start Time:** <t:${timestamp}:F>`,
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

  // Quick join command
  embed.addFields({
    name: '⚡ Quick Join',
    value: `\`/join-game game-id:${game.id}\``,
    inline: true
  });

  return embed;
}

/**
 * Convert HTML to Discord markdown and strip remaining tags
 */
function htmlToMarkdown(html: string): string {
  if (!html) return '';

  let text = html;

  // Convert common HTML tags to Discord markdown
  text = text.replace(/<strong>(.*?)<\/strong>/gi, '**$1**'); // bold
  text = text.replace(/<b>(.*?)<\/b>/gi, '**$1**'); // bold
  text = text.replace(/<em>(.*?)<\/em>/gi, '*$1*'); // italic
  text = text.replace(/<i>(.*?)<\/i>/gi, '*$1*'); // italic
  text = text.replace(/<u>(.*?)<\/u>/gi, '__$1__'); // underline
  text = text.replace(/<code>(.*?)<\/code>/gi, '`$1`'); // inline code

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
  text = text.replace(/\n\n\n+/g, '\n\n'); // max 2 newlines
  text = text.trim();

  return text;
}

/**
 * Truncate text to fit Discord embed limits
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return text.substring(0, maxLength - 3) + '...';
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
