# Discord Channel Notifications for Games - Implementation Guide

## Overview
Allow GMs to configure a Discord server channel to receive game notifications (session reminders, cancellations, etc.) instead of just DMs. This is perfect for GMs running games in dedicated Discord servers.

---

## User Flow

1. **GM runs bot command in their Discord server:**
   ```
   /set-game-channel game:[autocomplete: their GM games]
   ```

2. **Bot prompts for channel selection:**
   - Dropdown shows all text channels in the server
   - GM selects the channel for notifications

3. **Bot saves configuration to platform API:**
   - Associates game with Discord server ID + channel ID
   - Sets notification mode (CHANNEL_ONLY or BOTH)

4. **When notifications are triggered:**
   - Session reminders → Posted to configured channel
   - Booking confirmations → Still DM (player-specific)
   - Application status → Still DM (player-specific)
   - Session cancellations → Posted to channel (affects all players)

---

## Architecture

### Notification Routing Logic

```
Platform triggers notification webhook
  ↓
Check if game has discordChannelId configured
  ↓
IF SESSION_REMINDER or SESSION_CANCELLED:
  - Post to channel (mention all players)
  - Optionally also send DMs (if notificationMode = 'BOTH')

IF BOOKING_CONFIRMED or APPLICATION_STATUS:
  - Send DM only (player-specific, not relevant to channel)
```

---

## Platform Side Implementation

### 1. Database Schema Changes

Add to `Game` model in Prisma schema:

```prisma
model Game {
  id          String   @id @default(cuid())
  title       String
  // ... existing fields ...

  // NEW: Discord channel notifications
  discordServerId   String?  @db.VarChar(255)  // Discord server (guild) ID
  discordChannelId  String?  @db.VarChar(255)  // Discord channel ID
  notificationMode  String?  @default("DM_ONLY")  // "DM_ONLY" | "CHANNEL_ONLY" | "BOTH"

  // ... rest of model ...
}
```

**Migration needed:**
```bash
npx prisma migrate dev --name add_discord_channel_notifications
```

### 2. API Endpoint - Save Channel Configuration

**Endpoint:** `PATCH /api/games/{gameId}/discord-channel`

**Authentication:** GM must own the game

**Request Body:**
```typescript
{
  discordServerId: string,     // Discord server ID
  discordChannelId: string,    // Discord channel ID
  notificationMode: 'DM_ONLY' | 'CHANNEL_ONLY' | 'BOTH'
}
```

**Response:**
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

**Example Implementation:**

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

### 3. Webhook Payload Changes

**Update webhook dispatcher** to include channel info for session-related notifications:

```typescript
// In your session reminder cron job
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

  notification: { ... }
});
```

**Updated webhook payload type:**

```typescript
interface NotificationWebhook {
  event: string;
  userId: string;
  discordId: string;

  // NEW: Optional channel routing
  channelId?: string;
  serverId?: string;
  notificationMode?: 'DM_ONLY' | 'CHANNEL_ONLY' | 'BOTH';

  notification: { ... };
  timestamp: number;
}
```

---

## Bot Side Implementation

### 1. Create `/set-game-channel` Command

**File:** `src/commands/set-game-channel.ts`

**Features:**
- Autocomplete for GM's games
- Dropdown to select channel from server
- Saves configuration to platform API
- Confirms success with embed

**Command Structure:**

```typescript
export const setGameChannelCommand: Command = {
  name: 'set-game-channel',
  description: 'Configure Discord channel for game notifications',
  options: [
    {
      name: 'game',
      description: 'Select one of your games',
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true
    },
    {
      name: 'channel',
      description: 'Channel to receive notifications',
      type: ApplicationCommandOptionType.Channel,
      required: true,
      channelTypes: [ChannelType.GuildText] // Only text channels
    },
    {
      name: 'mode',
      description: 'Notification mode',
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: 'Channel only', value: 'CHANNEL_ONLY' },
        { name: 'Channel + DMs', value: 'BOTH' }
      ]
    }
  ],

  async autocomplete(interaction: AutocompleteInteraction) {
    // Show only games where user is GM
    const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
    if (!user) {
      return interaction.respond([
        { name: 'Link your Discord account first (/link)', value: 'not_linked' }
      ]);
    }

    const games = await arcaneAPI.games.listGames({
      gmId: user.id,
      status: 'PUBLISHED'
    });

    const choices = games
      .map(game => ({
        name: game.title.substring(0, 100),
        value: game.id
      }))
      .slice(0, 25);

    return interaction.respond(choices);
  },

  async execute(interaction: ChatInputCommandInteraction) {
    // Verify in guild
    if (!interaction.guild) {
      await interaction.reply({
        content: '❌ This command must be used in a server',
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const gameId = interaction.options.getString('game', true);
    const channel = interaction.options.getChannel('channel', true);
    const mode = interaction.options.getString('mode') || 'CHANNEL_ONLY';

    // Verify user is GM
    const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
    if (!user) {
      await interaction.editReply({
        content: '❌ You need to link your Discord account first. Use `/link`'
      });
      return;
    }

    // Save configuration via API
    try {
      await arcaneAPI.games.setDiscordChannel(gameId, {
        discordServerId: interaction.guild.id,
        discordChannelId: channel.id,
        notificationMode: mode
      });

      const embed = new EmbedBuilder()
        .setColor(0x00D4AA)
        .setTitle('✅ Channel Configured')
        .setDescription('Game notifications will be posted to the selected channel')
        .addFields([
          {
            name: '📢 Channel',
            value: `<#${channel.id}>`,
            inline: true
          },
          {
            name: '📋 Mode',
            value: mode === 'BOTH' ? 'Channel + DMs' : 'Channel only',
            inline: true
          }
        ])
        .setFooter({ text: 'Arcane Circle • Notification Settings' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logError('Failed to set game channel', error as Error, {
        gameId,
        channelId: channel.id
      });

      await interaction.editReply({
        content: '❌ Failed to configure channel. Make sure you\'re the GM of this game.'
      });
    }
  }
};
```

### 2. Add API Method

**File:** `src/services/api/games.ts`

Add method to GameService:

```typescript
/**
 * Set Discord channel for game notifications
 */
public async setDiscordChannel(
  gameId: string,
  config: {
    discordServerId: string;
    discordChannelId: string;
    notificationMode: 'DM_ONLY' | 'CHANNEL_ONLY' | 'BOTH';
  },
  discordUserId: string
): Promise<ApiResponse<any>> {
  try {
    logInfo('Setting Discord channel for game', {
      gameId,
      channelId: config.discordChannelId,
      discordUserId
    });

    await apiClient.authenticateWithDiscord(discordUserId);

    return await apiClient.patch(`/games/${gameId}/discord-channel`, config);
  } catch (error) {
    logError('Failed to set Discord channel', error as Error, {
      gameId,
      config
    });
    throw error;
  }
}
```

### 3. Update Webhook Handlers

**File:** `src/services/webhooks/WebhookListener.ts`

Update notification handlers to support channel posting:

```typescript
/**
 * Handle session reminder notification
 */
private async handleSessionReminder(payload: SessionReminderWebhook): Promise<void> {
  logger.info('Processing session reminder', {
    sessionId: payload.notification.metadata.sessionId,
    gameTitle: payload.notification.metadata.gameTitle,
    discordId: payload.discordId,
    channelId: payload.channelId,
    notificationMode: payload.notificationMode
  });

  if (!this.dmService) {
    logger.warn('DM service not initialized, cannot send notification');
    return;
  }

  try {
    const embed = buildSessionReminderEmbed(payload);

    // Check if should post to channel
    if (payload.channelId && payload.notificationMode !== 'DM_ONLY') {
      await this.sendToChannel(payload.channelId, embed, payload.discordId);
    }

    // Send DM if mode is DM_ONLY or BOTH
    if (!payload.channelId || payload.notificationMode === 'DM_ONLY' || payload.notificationMode === 'BOTH') {
      await this.dmService.sendDM(payload.discordId, embed);
    }

    logger.info('Session reminder notification sent', {
      discordId: payload.discordId,
      sentToChannel: !!payload.channelId,
      sentToDM: !payload.channelId || payload.notificationMode !== 'CHANNEL_ONLY'
    });
  } catch (error) {
    logger.error('Error sending session reminder', error as Error, {
      discordId: payload.discordId,
      sessionId: payload.notification.metadata.sessionId
    });
  }
}

/**
 * Send notification to Discord channel
 */
private async sendToChannel(
  channelId: string,
  embed: EmbedBuilder,
  mentionUserId?: string
): Promise<void> {
  if (!this.bot) {
    logger.warn('Bot not initialized, cannot send to channel');
    return;
  }

  try {
    const channel = await this.bot.client.channels.fetch(channelId);

    if (!channel || !channel.isTextBased()) {
      logger.warn('Channel not found or not text-based', { channelId });
      return;
    }

    const content = mentionUserId ? `<@${mentionUserId}>` : undefined;

    await (channel as TextChannel).send({
      content,
      embeds: [embed]
    });

    logger.info('Notification posted to channel', { channelId });
  } catch (error) {
    logger.error('Failed to post to channel', error as Error, { channelId });
  }
}
```

### 4. Update Webhook Types

**File:** `src/types/webhooks.ts`

Add optional channel fields:

```typescript
export interface BaseNotificationWebhook extends WebhookPayload {
  event: NotificationEventType;
  userId: string;
  discordId: string;

  // NEW: Optional channel routing
  channelId?: string;
  serverId?: string;
  notificationMode?: 'DM_ONLY' | 'CHANNEL_ONLY' | 'BOTH';

  notification: {
    type: string;
    title: string;
    message: string;
    actionUrl: string;
    metadata: Record<string, any>;
  };
}
```

### 5. Register Command

**File:** `src/bot/index.ts`

Import and add to commands array:

```typescript
import { setGameChannelCommand } from '../commands/set-game-channel';

// In loadCommands():
const commands: Command[] = [
  // ... existing commands ...
  setGameChannelCommand
];
```

---

## Testing

### 1. Test Channel Configuration

```bash
# In Discord server:
1. Run: /set-game-channel
2. Select your game from autocomplete
3. Select a text channel
4. Choose mode (Channel only or Channel + DMs)
5. Verify success embed appears
```

### 2. Test Session Reminder to Channel

```bash
# Send test webhook to bot
curl -X POST https://ac-familiar-production.up.railway.app/webhooks/notification \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: <generated-signature>" \
  -H "X-Webhook-Timestamp: <timestamp>" \
  -d '{
    "event": "notification.session.reminder",
    "userId": "user-id",
    "discordId": "discord-user-id",
    "channelId": "discord-channel-id",
    "notificationMode": "CHANNEL_ONLY",
    "notification": {
      "type": "SESSION_REMINDER",
      "title": "Session starting in 2 hours!",
      "message": "Test message",
      "actionUrl": "https://arcanecircle.games/games/test",
      "metadata": {
        "sessionId": "test",
        "sessionNumber": 1,
        "gameId": "test",
        "gameTitle": "Test Game",
        "scheduledTime": "2025-10-31T20:00:00Z",
        "gmName": "Test GM"
      }
    },
    "timestamp": 1698765432000
  }'
```

### 3. Verify Modes

- **CHANNEL_ONLY**: Should post to channel only (no DM)
- **BOTH**: Should post to channel AND send DM
- **DM_ONLY** (default): Should send DM only (no channel post)

---

## Configuration Summary

### Platform Environment (No changes needed)
- Same webhook URL and secret as before

### Database Migration
```bash
npx prisma migrate dev --name add_discord_channel_notifications
```

### New API Endpoint
- `PATCH /api/games/{gameId}/discord-channel`
- `GET /api/games/{gameId}/discord-channel` (optional)

### Bot Command
- `/set-game-channel` - Configure channel for game notifications

---

## Implementation Checklist

### Platform Side:
- [ ] Add `discordServerId`, `discordChannelId`, `notificationMode` to Game model
- [ ] Run Prisma migration
- [ ] Create `PATCH /api/games/{id}/discord-channel` endpoint
- [ ] Update webhook dispatcher to include channel info in payloads

### Bot Side:
- [ ] Create `set-game-channel.ts` command
- [ ] Add `setDiscordChannel()` method to games API service
- [ ] Update webhook handlers to support channel posting
- [ ] Add `sendToChannel()` helper method
- [ ] Update webhook type definitions
- [ ] Register command in bot

### Testing:
- [ ] Test command in Discord server
- [ ] Verify API saves configuration correctly
- [ ] Test CHANNEL_ONLY mode
- [ ] Test BOTH mode
- [ ] Test DM_ONLY mode (default)
- [ ] Test with actual session reminder

---

## Estimates

**Platform Side:** 2 hours
- Database migration: 15 min
- API endpoint: 1 hour
- Webhook dispatcher updates: 45 min

**Bot Side:** 3 hours
- Command creation: 1.5 hours
- Webhook handler updates: 1 hour
- Testing: 30 min

**Total: 5 hours**

---

## Future Enhancements (Optional)

1. **Web UI Configuration:**
   - Add channel selector to game settings page
   - Show preview of Discord server/channel names
   - Allow changing mode without using bot command

2. **Channel Mentions:**
   - Mention specific players in channel posts
   - Create role for "game players" and mention the role

3. **Per-Notification Type Settings:**
   - Configure different channels for different notification types
   - E.g., reminders to one channel, cancellations to another

4. **Bulk Configuration:**
   - Set channel for all games at once
   - Copy settings from one game to another

---

## Notes

- Bot must have permission to post in the configured channel
- Bot must be in the server to post to channel
- If channel is deleted, notifications will fall back to DMs
- GMs can reconfigure or disable channel notifications anytime
- Booking/application notifications remain DM-only (player-specific)
