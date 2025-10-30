# Platform-Side Implementation for Discord Channel Notifications

## Overview

This document outlines the platform-side changes needed to support Discord channel notifications. The bot-side implementation is complete and ready to receive webhook payloads with channel routing information.

**Status**: Bot implementation ✅ Complete | Platform implementation ⏳ Pending

---

## What Was Implemented (Bot-Side)

### ✅ Completed Features

1. **`/set-game-channel` Command**
   - Location: `src/commands/set-game-channel.ts`
   - Autocomplete for GM's published games
   - Channel selection (text channels only)
   - Mode selection (CHANNEL_ONLY or BOTH)
   - Calls `PATCH /api/games/{gameId}/discord-channel` endpoint

2. **API Service Method**
   - Location: `src/services/api/games.ts:323-353`
   - `GameService.setDiscordChannel()` method
   - Authenticates with Discord user ID
   - Makes PATCH request to platform API

3. **Webhook Type Updates**
   - Location: `src/types/webhooks.ts:28-45`
   - Added optional fields to `BaseNotificationWebhook`:
     - `channelId?: string`
     - `serverId?: string`
     - `notificationMode?: 'DM_ONLY' | 'CHANNEL_ONLY' | 'BOTH'`

4. **Webhook Channel Posting**
   - Location: `src/services/webhooks/WebhookListener.ts`
   - New `sendToChannel()` method (lines 316-349)
   - Updated `handleSessionReminder()` for channel routing (lines 354-404)
   - Updated `handleSessionCancelled()` for channel routing (lines 477-522)
   - Booking/application handlers remain DM-only (as intended)

5. **Command Registration**
   - Location: `src/bot/index.ts`
   - Command imported and added to commands array

---

## What You Need to Implement (Platform-Side)

### 1. Database Schema Changes

**File**: `prisma/schema.prisma`

Add the following fields to the `Game` model:

```prisma
model Game {
  id          String   @id @default(cuid())
  title       String
  // ... existing fields ...

  // Discord channel notifications
  discordServerId   String?  @db.VarChar(255)
  discordChannelId  String?  @db.VarChar(255)
  notificationMode  String?  @default("DM_ONLY")  // "DM_ONLY" | "CHANNEL_ONLY" | "BOTH"

  // ... rest of model ...
}
```

**Migration Command**:
```bash
npx prisma migrate dev --name add_discord_channel_notifications
```

---

### 2. API Endpoint - Save Channel Configuration

**File**: `src/app/api/games/[id]/discord-channel/route.ts` (new file)

**Endpoint**: `PATCH /api/games/{gameId}/discord-channel`

**Request Body**:
```typescript
{
  discordServerId: string,     // Discord server (guild) ID
  discordChannelId: string,    // Discord channel ID
  notificationMode: 'DM_ONLY' | 'CHANNEL_ONLY' | 'BOTH'
}
```

**Response**:
```typescript
{
  success: true,
  game: {
    id: string,
    discordServerId: string,
    discordChannelId: string,
    notificationMode: string
  }
}
```

**Implementation**:

```typescript
// app/api/games/[id]/discord-channel/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const gameId = params.id;
    const body = await req.json();
    const { discordServerId, discordChannelId, notificationMode } = body;

    // Verify user is the GM
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: { gmId: true }
    });

    if (!game || game.gmId !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Update game with Discord channel config
    const updatedGame = await prisma.game.update({
      where: { id: gameId },
      data: {
        discordServerId,
        discordChannelId,
        notificationMode: notificationMode || 'CHANNEL_ONLY'
      },
      select: {
        id: true,
        title: true,
        discordServerId: true,
        discordChannelId: true,
        notificationMode: true
      }
    });

    return NextResponse.json({ success: true, game: updatedGame });
  } catch (error) {
    console.error('Failed to update Discord channel config:', error);
    return NextResponse.json(
      { error: 'Failed to update configuration' },
      { status: 500 }
    );
  }
}

// Optional: GET endpoint to retrieve current configuration
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const gameId = params.id;

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: {
        id: true,
        gmId: true,
        discordServerId: true,
        discordChannelId: true,
        notificationMode: true
      }
    });

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    if (game.gmId !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    return NextResponse.json({
      discordServerId: game.discordServerId,
      discordChannelId: game.discordChannelId,
      notificationMode: game.notificationMode || 'DM_ONLY'
    });
  } catch (error) {
    console.error('Failed to get Discord channel config:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve configuration' },
      { status: 500 }
    );
  }
}
```

---

### 3. Update Webhook Dispatcher

**Files**: Session reminder and cancellation job files (wherever you trigger these webhooks)

**Changes Needed**:

For **session reminder** and **session cancellation** webhooks:

1. Fetch the game's Discord channel configuration from the database
2. Include channel info in the webhook payload

**Example**:

```typescript
// In your session reminder cron job or webhook trigger
const game = await prisma.game.findUnique({
  where: { id: session.gameId },
  select: {
    discordServerId: true,
    discordChannelId: true,
    notificationMode: true
  }
});

// Add to webhook payload
await webhookDispatcher.send({
  event: 'notification.session.reminder',
  userId: user.id,
  discordId: user.discordId,

  // NEW: Include channel info if configured
  channelId: game.discordChannelId || undefined,
  serverId: game.discordServerId || undefined,
  notificationMode: game.notificationMode || 'DM_ONLY',

  notification: {
    type: 'SESSION_REMINDER',
    title: 'Session starting soon!',
    message: `Your session for "${session.game.title}" starts in 2 hours`,
    actionUrl: `${config.PLATFORM_WEB_URL}/games/${session.gameId}`,
    metadata: {
      sessionId: session.id,
      sessionNumber: session.sessionNumber,
      gameId: session.gameId,
      gameTitle: session.game.title,
      scheduledTime: session.scheduledStart.toISOString(),
      gmName: session.game.gm.displayName
    }
  },
  timestamp: Date.now()
});
```

**Important Notes**:
- Only add channel fields to **SESSION_REMINDER** and **SESSION_CANCELLED** events
- Do NOT add to BOOKING_CONFIRMED or APPLICATION_STATUS (these remain DM-only)
- If `notificationMode` is null/undefined, it defaults to 'DM_ONLY' on the bot side

---

## Webhook Payload Type Reference

The bot expects webhooks with this structure:

```typescript
interface SessionReminderWebhook {
  event: 'notification.session.reminder';
  userId: string;
  discordId: string;

  // Optional channel routing (NEW)
  channelId?: string;              // Discord channel ID
  serverId?: string;               // Discord server (guild) ID
  notificationMode?: 'DM_ONLY' | 'CHANNEL_ONLY' | 'BOTH';

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
      scheduledTime: string;        // ISO 8601
      gmName: string;
    };
  };
  timestamp: number;
}
```

---

## Notification Routing Logic (Bot Behavior)

The bot routes notifications based on `notificationMode`:

### DM_ONLY (default)
- ✅ Send DM to user
- ❌ Do NOT post to channel

### CHANNEL_ONLY
- ❌ Do NOT send DM
- ✅ Post to configured channel (with user mention)

### BOTH
- ✅ Send DM to user
- ✅ Post to configured channel (with user mention)

### No channel configured (`channelId` is null/undefined)
- ✅ Send DM to user
- ❌ Do NOT post to channel (falls back to DM)

---

## Testing Checklist

After implementing platform changes:

### 1. Test Command in Discord
- [ ] Run `/set-game-channel` in a Discord server
- [ ] Verify autocomplete shows only GM's games
- [ ] Select a game and channel
- [ ] Choose notification mode
- [ ] Confirm success message appears

### 2. Test API Endpoint
- [ ] Verify PATCH endpoint saves configuration correctly
- [ ] Check database for updated fields
- [ ] Test GET endpoint returns saved config
- [ ] Verify GM authorization (non-GM gets 403)

### 3. Test Webhook Delivery
- [ ] Create a test session reminder with CHANNEL_ONLY mode
- [ ] Verify notification posts to channel (no DM sent)
- [ ] Test with BOTH mode (should post to channel AND send DM)
- [ ] Test with DM_ONLY mode (should only send DM)

### 4. Test Error Cases
- [ ] What happens if channel is deleted? (bot gracefully handles, no error)
- [ ] What happens if bot lacks permission to post? (bot logs error, continues)
- [ ] What happens if user has DMs disabled? (existing DM fallback logic handles)

---

## Configuration Summary

### Platform Environment Variables
No new environment variables needed - uses existing webhook system.

### Database Migration
```bash
npx prisma migrate dev --name add_discord_channel_notifications
```

### New API Endpoints
- `PATCH /api/games/{gameId}/discord-channel` - Save channel config
- `GET /api/games/{gameId}/discord-channel` - Get channel config (optional)

---

## Implementation Order

1. **Database Schema** (5 min)
   - Add fields to Game model
   - Run migration

2. **API Endpoint** (1 hour)
   - Create route file
   - Implement PATCH handler with GM authorization
   - Implement GET handler (optional)

3. **Webhook Updates** (45 min)
   - Find session reminder trigger code
   - Add game channel lookup
   - Include channel fields in payload
   - Repeat for session cancellation

4. **Testing** (30 min)
   - Test command flow
   - Test webhook delivery
   - Test all modes
   - Test error cases

**Total Estimated Time: ~2.5 hours**

---

## Support & Questions

If you have questions about the bot-side implementation or need clarification:
- Bot code is in `ac-familiar` repository
- Key files to reference:
  - `/set-game-channel` command: `src/commands/set-game-channel.ts`
  - Webhook handler: `src/services/webhooks/WebhookListener.ts`
  - Type definitions: `src/types/webhooks.ts`

The bot is ready to receive and process channel-routed notifications as soon as the platform starts sending them! 🚀
