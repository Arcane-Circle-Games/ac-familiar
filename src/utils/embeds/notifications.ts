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
