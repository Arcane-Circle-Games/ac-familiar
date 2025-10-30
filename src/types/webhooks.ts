/**
 * Webhook payload types for Arcane Circle platform webhooks
 */

// Base webhook payload structure
export interface WebhookPayload {
  event: string;
  timestamp: number;
}

// Recording webhook payloads (existing)
export interface RecordingWebhookPayload extends WebhookPayload {
  event: 'recording.transcription.completed' | 'recording.transcription.failed';
  recordingId: string;
  sessionId?: string;
  gameId?: string;
  channelId: string;
  error?: string;
}

// Notification webhook payloads (new)
export type NotificationEventType =
  | 'notification.session.reminder'
  | 'notification.booking.confirmed'
  | 'notification.application.status'
  | 'notification.session.cancelled';

export interface BaseNotificationWebhook extends WebhookPayload {
  event: NotificationEventType;
  userId: string;
  discordId: string;
  notification: {
    type: string;
    title: string;
    message: string;
    actionUrl: string;
    metadata: Record<string, any>;
  };
}

// Session Reminder
export interface SessionReminderWebhook extends BaseNotificationWebhook {
  event: 'notification.session.reminder';
  notification: {
    type: 'SESSION_REMINDER';
    title: string;
    message: string;
    actionUrl: string;
    metadata: {
      sessionId: string;
      sessionNumber: number;
      gameId: string;
      gameTitle: string;
      scheduledTime: string; // ISO 8601 timestamp
      gmName: string;
    };
  };
}

// Booking Confirmation
export interface BookingConfirmedWebhook extends BaseNotificationWebhook {
  event: 'notification.booking.confirmed';
  notification: {
    type: 'BOOKING_CONFIRMED';
    title: string;
    message: string;
    actionUrl: string;
    metadata: {
      bookingId: string;
      gameId: string;
      gameTitle: string;
      nextSessionTime?: string; // ISO 8601 timestamp
      gmName: string;
      price?: number;
    };
  };
}

// Application Status Update
export interface ApplicationStatusWebhook extends BaseNotificationWebhook {
  event: 'notification.application.status';
  notification: {
    type: 'APPLICATION_STATUS';
    title: string;
    message: string;
    actionUrl: string;
    metadata: {
      bookingId: string;
      gameId: string;
      gameTitle: string;
      status: 'approved' | 'declined';
      gmName: string;
    };
  };
}

// Session Cancelled
export interface SessionCancelledWebhook extends BaseNotificationWebhook {
  event: 'notification.session.cancelled';
  notification: {
    type: 'SESSION_CANCELLED';
    title: string;
    message: string;
    actionUrl: string;
    metadata: {
      sessionId: string;
      sessionNumber: number;
      gameId: string;
      gameTitle: string;
      scheduledTime: string; // ISO 8601 timestamp
      gmName: string;
      reason?: string;
    };
  };
}

// Union type for all notification webhooks
export type NotificationWebhook =
  | SessionReminderWebhook
  | BookingConfirmedWebhook
  | ApplicationStatusWebhook
  | SessionCancelledWebhook;

// Union type for all webhook payloads
export type ArcaneWebhookPayload =
  | RecordingWebhookPayload
  | NotificationWebhook;
