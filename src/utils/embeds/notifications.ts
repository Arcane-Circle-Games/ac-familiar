import { EmbedBuilder } from 'discord.js';
import {
  SessionReminderWebhook,
  BookingConfirmedWebhook,
  ApplicationStatusWebhook,
  SessionCancelledWebhook
} from '../../types/webhooks';

/**
 * Build Discord embed for session reminder notification
 */
export function buildSessionReminderEmbed(webhook: SessionReminderWebhook): EmbedBuilder {
  const { metadata } = webhook.notification;
  const scheduledTime = new Date(metadata.scheduledTime);
  const timestamp = Math.floor(scheduledTime.getTime() / 1000);

  return new EmbedBuilder()
    .setColor(0xFFD700) // Gold color for reminders
    .setTitle('⏰ Session Starting Soon!')
    .setDescription(
      `Your session for **${metadata.gameTitle}** starts in 2 hours!`
    )
    .addFields([
      {
        name: '🎮 Game',
        value: metadata.gameTitle,
        inline: true
      },
      {
        name: '📅 Session',
        value: `Session ${metadata.sessionNumber}`,
        inline: true
      },
      {
        name: '🎲 Game Master',
        value: metadata.gmName,
        inline: true
      },
      {
        name: '🕐 Start Time',
        value: `<t:${timestamp}:F>\n<t:${timestamp}:R>`,
        inline: false
      }
    ])
    .setFooter({ text: 'Arcane Circle • Session Reminder' })
    .setTimestamp()
    .setURL(webhook.notification.actionUrl);
}

/**
 * Build Discord embed for booking confirmation
 */
export function buildBookingConfirmedEmbed(webhook: BookingConfirmedWebhook): EmbedBuilder {
  const { metadata } = webhook.notification;

  const embed = new EmbedBuilder()
    .setColor(0x00D4AA) // Arcane Circle mint color
    .setTitle('✅ Booking Confirmed!')
    .setDescription(
      `You're all set for **${metadata.gameTitle}**!`
    )
    .addFields([
      {
        name: '🎮 Game',
        value: metadata.gameTitle,
        inline: false
      },
      {
        name: '🎲 Game Master',
        value: metadata.gmName,
        inline: true
      }
    ])
    .setFooter({ text: 'Arcane Circle • Booking Confirmation' })
    .setTimestamp()
    .setURL(webhook.notification.actionUrl);

  // Add next session time if available
  if (metadata.nextSessionTime) {
    const nextSession = new Date(metadata.nextSessionTime);
    const timestamp = Math.floor(nextSession.getTime() / 1000);

    embed.addFields({
      name: '📅 Next Session',
      value: `<t:${timestamp}:F>\n<t:${timestamp}:R>`,
      inline: false
    });
  }

  // Add price if available
  if (metadata.price) {
    embed.addFields({
      name: '💰 Price',
      value: `$${metadata.price.toFixed(2)}`,
      inline: true
    });
  }

  return embed;
}

/**
 * Build Discord embed for application status update
 */
export function buildApplicationStatusEmbed(webhook: ApplicationStatusWebhook): EmbedBuilder {
  const { metadata } = webhook.notification;
  const isApproved = metadata.status === 'approved';

  return new EmbedBuilder()
    .setColor(isApproved ? 0x00FF00 : 0xFF6B6B) // Green for approved, red for declined
    .setTitle(isApproved ? '✅ Application Approved!' : '❌ Application Declined')
    .setDescription(
      isApproved
        ? `Your application to join **${metadata.gameTitle}** has been approved!`
        : `Your application to join **${metadata.gameTitle}** was not accepted this time.`
    )
    .addFields([
      {
        name: '🎮 Game',
        value: metadata.gameTitle,
        inline: false
      },
      {
        name: '🎲 Game Master',
        value: metadata.gmName,
        inline: true
      },
      {
        name: '📋 Status',
        value: isApproved ? 'Approved' : 'Declined',
        inline: true
      }
    ])
    .setFooter({ text: 'Arcane Circle • Application Update' })
    .setTimestamp()
    .setURL(webhook.notification.actionUrl);
}

/**
 * Build Discord embed for session cancellation
 */
export function buildSessionCancelledEmbed(webhook: SessionCancelledWebhook): EmbedBuilder {
  const { metadata } = webhook.notification;
  const scheduledTime = new Date(metadata.scheduledTime);
  const timestamp = Math.floor(scheduledTime.getTime() / 1000);

  const embed = new EmbedBuilder()
    .setColor(0xFF0000) // Red for cancellations
    .setTitle('❌ Session Cancelled')
    .setDescription(
      `Session ${metadata.sessionNumber} for **${metadata.gameTitle}** has been cancelled.`
    )
    .addFields([
      {
        name: '🎮 Game',
        value: metadata.gameTitle,
        inline: false
      },
      {
        name: '📅 Was Scheduled For',
        value: `<t:${timestamp}:F>`,
        inline: false
      },
      {
        name: '🎲 Game Master',
        value: metadata.gmName,
        inline: true
      },
      {
        name: '📋 Session',
        value: `Session ${metadata.sessionNumber}`,
        inline: true
      }
    ])
    .setFooter({ text: 'Arcane Circle • Session Update' })
    .setTimestamp()
    .setURL(webhook.notification.actionUrl);

  // Add cancellation reason if provided
  if (metadata.reason) {
    embed.addFields({
      name: '📝 Reason',
      value: metadata.reason,
      inline: false
    });
  }

  return embed;
}
