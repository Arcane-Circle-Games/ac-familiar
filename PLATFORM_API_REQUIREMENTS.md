# Platform API Requirements for Discord DM Notifications

## Overview
This document outlines what the Arcane Circle platform API needs to implement to enable Discord DM notifications for users. The Discord bot side is complete and ready to receive webhooks.

---

## 1. Environment Variables

Add these to your platform's `.env` file:

```bash
# Discord Bot Webhook Configuration
BOT_WEBHOOK_URL=https://your-bot-domain.com/webhooks/notification
WEBHOOK_SECRET=your-shared-secret-key-here

# Note: Use same WEBHOOK_SECRET on both platform and bot
```

**Important:** The bot webhook listener runs on port 3001 by default. The URL should point to wherever your bot is hosted.

---

## 2. Webhook Dispatcher Service

Create a new service file: `src/services/webhooks/WebhookDispatcher.ts` (or similar location in your platform codebase)

```typescript
import crypto from 'crypto';

interface WebhookPayload {
  event: string;
  userId: string;
  discordId: string;
  notification: {
    type: string;
    title: string;
    message: string;
    actionUrl: string;
    metadata: Record<string, any>;
  };
  timestamp: number;
}

export class WebhookDispatcher {
  private webhookUrl: string;
  private webhookSecret: string;

  constructor() {
    this.webhookUrl = process.env.BOT_WEBHOOK_URL || '';
    this.webhookSecret = process.env.WEBHOOK_SECRET || '';
  }

  /**
   * Send webhook to Discord bot
   */
  async send(payload: WebhookPayload): Promise<boolean> {
    if (!this.webhookUrl) {
      console.warn('BOT_WEBHOOK_URL not configured, skipping webhook');
      return false;
    }

    try {
      // Add timestamp
      payload.timestamp = Date.now();

      // Generate HMAC signature
      const signature = this.generateSignature(payload);

      // Send webhook with retry logic
      const success = await this.sendWithRetry(payload, signature);

      return success;
    } catch (error) {
      console.error('Failed to send webhook:', error);
      return false;
    }
  }

  /**
   * Generate HMAC SHA-256 signature
   */
  private generateSignature(payload: WebhookPayload): string {
    if (!this.webhookSecret) {
      return '';
    }

    const payloadString = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payloadString)
      .digest('hex');

    return `sha256=${signature}`;
  }

  /**
   * Send webhook with exponential backoff retry
   */
  private async sendWithRetry(
    payload: WebhookPayload,
    signature: string,
    maxRetries: number = 3
  ): Promise<boolean> {
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const response = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-Timestamp': payload.timestamp.toString(),
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          console.log('Webhook sent successfully', {
            event: payload.event,
            userId: payload.userId,
          });
          return true;
        }

        // If server returned error, log and retry
        const errorText = await response.text();
        console.error('Webhook failed', {
          status: response.status,
          error: errorText,
          attempt: attempt + 1,
        });
      } catch (error) {
        console.error('Webhook request failed', {
          error: (error as Error).message,
          attempt: attempt + 1,
        });
      }

      // Exponential backoff: 1s, 2s, 4s
      attempt++;
      if (attempt < maxRetries) {
        await this.delay(Math.pow(2, attempt - 1) * 1000);
      }
    }

    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const webhookDispatcher = new WebhookDispatcher();
```

---

## 3. Integration Points

### A. Session Reminders (2 Hours Before)

You need to create a **cron job** that runs every 15 minutes to check for sessions starting in ~2 hours.

**Create:** `src/jobs/sessionReminders.ts` or add to existing cron jobs

```typescript
import { webhookDispatcher } from '../services/webhooks/WebhookDispatcher';
import { prisma } from '../lib/prisma'; // or your DB client

export async function sendSessionReminders() {
  // Find sessions starting in 1:45 to 2:15 (15-minute window)
  const now = new Date();
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const windowStart = new Date(twoHoursFromNow.getTime() - 15 * 60 * 1000);
  const windowEnd = new Date(twoHoursFromNow.getTime() + 15 * 60 * 1000);

  const sessions = await prisma.session.findMany({
    where: {
      scheduledTime: {
        gte: windowStart,
        lte: windowEnd,
      },
      status: 'SCHEDULED',
      reminderSent: { not: true }, // Don't send duplicates
    },
    include: {
      game: {
        include: {
          gm: true,
          bookings: {
            where: { status: 'CONFIRMED' },
            include: { user: true },
          },
        },
      },
    },
  });

  console.log(`Found ${sessions.length} sessions needing reminders`);

  for (const session of sessions) {
    // Send reminder to each confirmed player
    for (const booking of session.game.bookings) {
      const user = booking.user;

      // Skip if user doesn't have Discord linked
      if (!user.discordId) continue;

      // Check user preferences (if you have them)
      // const prefs = await prisma.notificationPreferences.findUnique({ where: { userId: user.id } });
      // if (!prefs.discordDMEnabled || !prefs.sessionReminders) continue;

      await webhookDispatcher.send({
        event: 'notification.session.reminder',
        userId: user.id,
        discordId: user.discordId,
        notification: {
          type: 'SESSION_REMINDER',
          title: 'Session starting in 2 hours!',
          message: `Your session for "${session.game.title}" starts at ${session.scheduledTime.toLocaleString()}`,
          actionUrl: `${process.env.NEXT_PUBLIC_URL}/games/${session.game.id}`,
          metadata: {
            sessionId: session.id,
            sessionNumber: session.sessionNumber,
            gameId: session.game.id,
            gameTitle: session.game.title,
            scheduledTime: session.scheduledTime.toISOString(),
            gmName: session.game.gm.displayName || session.game.gm.username,
          },
        },
        timestamp: Date.now(),
      });
    }

    // Mark reminder as sent
    await prisma.session.update({
      where: { id: session.id },
      data: { reminderSent: true },
    });
  }
}
```

**Setup cron:** Add to your cron scheduler (e.g., node-cron, Vercel Cron, etc.)

```typescript
// Example with node-cron
import cron from 'node-cron';

// Run every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  console.log('Running session reminder job');
  await sendSessionReminders();
});
```

**Database migration needed:** Add `reminderSent` boolean field to `Session` model if it doesn't exist.

---

### B. Booking Confirmations

**Location:** In your booking creation endpoint (e.g., `POST /api/bookings`)

**Add after successful booking creation:**

```typescript
// After: const booking = await prisma.booking.create({ ... });

// Fetch user with discordId
const user = await prisma.user.findUnique({
  where: { id: booking.userId },
});

if (user?.discordId) {
  await webhookDispatcher.send({
    event: 'notification.booking.confirmed',
    userId: user.id,
    discordId: user.discordId,
    notification: {
      type: 'BOOKING_CONFIRMED',
      title: 'Booking confirmed!',
      message: `You're booked for "${game.title}"`,
      actionUrl: `${process.env.NEXT_PUBLIC_URL}/games/${game.id}`,
      metadata: {
        bookingId: booking.id,
        gameId: game.id,
        gameTitle: game.title,
        nextSessionTime: game.nextSessionTime?.toISOString(), // Optional
        gmName: game.gm.displayName || game.gm.username,
        price: booking.totalPrice,
      },
    },
    timestamp: Date.now(),
  });
}
```

---

### C. Application Status Updates

**Location:** In your booking status update endpoint (e.g., `PATCH /api/bookings/{id}`)

**Add when status changes to 'APPROVED' or 'DECLINED':**

```typescript
// After: const booking = await prisma.booking.update({ ... });

// Only send notification if status changed to approved/declined
if (booking.status === 'APPROVED' || booking.status === 'DECLINED') {
  const user = await prisma.user.findUnique({
    where: { id: booking.userId },
  });

  if (user?.discordId) {
    await webhookDispatcher.send({
      event: 'notification.application.status',
      userId: user.id,
      discordId: user.discordId,
      notification: {
        type: 'APPLICATION_STATUS',
        title: booking.status === 'APPROVED' ? 'Application approved!' : 'Application declined',
        message: booking.status === 'APPROVED'
          ? `You've been accepted to "${game.title}"`
          : `Your application to "${game.title}" was declined`,
        actionUrl: `${process.env.NEXT_PUBLIC_URL}/games/${game.id}`,
        metadata: {
          bookingId: booking.id,
          gameId: game.id,
          gameTitle: game.title,
          status: booking.status.toLowerCase(),
          gmName: game.gm.displayName || game.gm.username,
        },
      },
      timestamp: Date.now(),
    });
  }
}
```

---

### D. Session Cancellations

**Location:** In your session update/delete endpoints (e.g., `PATCH /api/sessions/{id}` or `DELETE /api/sessions/{id}`)

**Add when session is cancelled:**

```typescript
// After updating session status to 'CANCELLED' or before deletion

// Get all confirmed bookings for this game
const bookings = await prisma.booking.findMany({
  where: {
    gameId: session.gameId,
    status: 'CONFIRMED',
  },
  include: {
    user: true,
  },
});

// Notify each player
for (const booking of bookings) {
  if (booking.user.discordId) {
    await webhookDispatcher.send({
      event: 'notification.session.cancelled',
      userId: booking.user.id,
      discordId: booking.user.discordId,
      notification: {
        type: 'SESSION_CANCELLED',
        title: 'Session cancelled',
        message: `Session ${session.sessionNumber} for "${game.title}" has been cancelled`,
        actionUrl: `${process.env.NEXT_PUBLIC_URL}/games/${game.id}`,
        metadata: {
          sessionId: session.id,
          sessionNumber: session.sessionNumber,
          gameId: game.id,
          gameTitle: game.title,
          scheduledTime: session.scheduledTime.toISOString(),
          gmName: game.gm.displayName || game.gm.username,
          reason: session.cancellationReason || null, // Optional field
        },
      },
      timestamp: Date.now(),
    });
  }
}
```

---

## 4. Optional: User Notification Preferences

Add Discord DM preferences to your notification settings:

**Database Schema Addition:**

```prisma
model NotificationPreferences {
  id        String   @id @default(cuid())
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id])

  // Existing fields...

  // Add these:
  discordDMEnabled        Boolean @default(true)   // Master toggle
  sessionReminders        Boolean @default(true)   // 2-hour reminders
  bookingNotifications    Boolean @default(true)   // Booking confirmations
  applicationUpdates      Boolean @default(true)   // Application status
  sessionCancellations    Boolean @default(true)   // Session cancelled

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**Check preferences before sending webhooks:**

```typescript
const prefs = await prisma.notificationPreferences.findUnique({
  where: { userId: user.id },
});

if (user.discordId && prefs?.discordDMEnabled && prefs?.sessionReminders) {
  await webhookDispatcher.send({ ... });
}
```

---

## 5. Testing

### A. Manual Test Endpoint (Recommended)

Add an admin endpoint for testing:

```typescript
// POST /api/admin/webhooks/test
// Authorization: Admin only

import { webhookDispatcher } from '../services/webhooks/WebhookDispatcher';

export async function POST(req: Request) {
  // Verify admin auth here

  const { event, userId } = await req.json();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      bookings: {
        include: { game: true },
        take: 1,
      },
    },
  });

  if (!user?.discordId) {
    return Response.json({ error: 'User not found or no Discord ID' }, { status: 404 });
  }

  // Send test notification
  const game = user.bookings[0]?.game;

  await webhookDispatcher.send({
    event: event || 'notification.session.reminder',
    userId: user.id,
    discordId: user.discordId,
    notification: {
      type: 'SESSION_REMINDER',
      title: 'Test notification',
      message: 'This is a test Discord DM from Arcane Circle',
      actionUrl: `${process.env.NEXT_PUBLIC_URL}/games/${game?.id || 'test'}`,
      metadata: {
        sessionId: 'test-session-id',
        sessionNumber: 1,
        gameId: game?.id || 'test-game-id',
        gameTitle: game?.title || 'Test Game',
        scheduledTime: new Date().toISOString(),
        gmName: 'Test GM',
      },
    },
    timestamp: Date.now(),
  });

  return Response.json({ success: true });
}
```

### B. Bot Testing

The bot is ready to receive webhooks at:
- Health check: `GET http://bot-url:3001/health`
- Notifications: `POST http://bot-url:3001/webhooks/notification`

**Test with curl:**

```bash
# Generate signature (replace WEBHOOK_SECRET)
PAYLOAD='{"event":"notification.session.reminder","userId":"test-user","discordId":"YOUR_DISCORD_ID","notification":{"type":"SESSION_REMINDER","title":"Test","message":"Test message","actionUrl":"https://arcanecircle.games","metadata":{"sessionId":"test","sessionNumber":1,"gameId":"test","gameTitle":"Test Game","scheduledTime":"2025-10-30T20:00:00Z","gmName":"Test GM"}},"timestamp":1698765432000}'

SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "YOUR_WEBHOOK_SECRET" | sed 's/SHA2-256(stdin)= /sha256=/')

curl -X POST http://localhost:3001/webhooks/notification \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIGNATURE" \
  -H "X-Webhook-Timestamp: 1698765432000" \
  -d "$PAYLOAD"
```

---

## Summary Checklist

### Required Implementation:
- [ ] Add `BOT_WEBHOOK_URL` and `WEBHOOK_SECRET` environment variables
- [ ] Create `WebhookDispatcher` service
- [ ] Create cron job for 2-hour session reminders
- [ ] Add webhook dispatch to booking creation (`POST /api/bookings`)
- [ ] Add webhook dispatch to booking status update (`PATCH /api/bookings/{id}`)
- [ ] Add webhook dispatch to session cancellation
- [ ] Add `reminderSent` boolean field to Session model

### Optional but Recommended:
- [ ] Add Discord DM preferences to NotificationPreferences model
- [ ] Add preference checks before sending webhooks
- [ ] Create admin test endpoint for manual testing
- [ ] Add webhook delivery logging/monitoring

### Estimated Time:
- Webhook Dispatcher service: **1 hour**
- Session reminder cron: **1-2 hours**
- Integration points (3 locations): **1-2 hours**
- Preferences (optional): **1 hour**
- Testing: **1 hour**

**Total: 4-6 hours** (or 5-7 hours with preferences)

---

## Questions?

If you have any questions about the implementation, check the bot codebase:
- `src/services/webhooks/WebhookListener.ts` - Bot webhook receiver
- `src/services/discord/DMService.ts` - DM sending logic
- `src/types/webhooks.ts` - Payload type definitions
- `src/utils/embeds/notifications.ts` - Discord embed builders
