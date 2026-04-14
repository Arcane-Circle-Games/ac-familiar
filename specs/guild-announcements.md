# Bot Guild Announcements

**Priority:** Medium
**Scope:** ac-familiar — webhook handler + scheduler enhancement
**Branch:** `feature/guild-announcements`
**Depends on:** guild-discord-association (ac-mvp) must ship first
**Repo:** Arcane-Circle-Games/ac-familiar

## Problem

When a guild member publishes a game, it should be announced in the guild's Discord server (in their configured announcement channel) in addition to the AC Discord server's global announcement channel. Currently announcements only go to the single global channel configured via `GAME_ANNOUNCEMENT_CHANNEL_ID`.

## Behavior

Game published by a guild member → announcement posts to:
1. **AC Discord server** announcement channel (existing behavior, unchanged)
2. **Guild's Discord server** announcement channel (new — uses guild's `discordChannelId`)

Non-guild games continue posting to AC Discord only.

The bot is **announcement-only** in external guild servers. No slash commands, no interactive features. Just posts game embeds when member GMs publish.

## Implementation

### 1. Platform webhook enhancement (ac-mvp side)

When a game is published, the existing webhook to ac-familiar already fires `notification.game.published`. Enhance the webhook payload to include guild Discord config when the game has a `guildId`:

```typescript
// In the game publish webhook trigger (ac-mvp)
{
  event: 'notification.game.published',
  gameId: string,
  channelId: string,  // existing — AC global channel
  guildAnnouncement?: {
    discordServerId: string,
    discordChannelId: string
  },
  game: { /* existing game details */ }
}
```

The `guildAnnouncement` field is only present when the game belongs to a guild that has Discord config set. The webhook trigger's Prisma query must include the guild relation:

```prisma
include: {
  guild: {
    select: {
      discordServerId: true,
      discordChannelId: true
    }
  }
}
```

Only populate `guildAnnouncement` when both `guild.discordServerId` and `guild.discordChannelId` are non-null.

### 2. Webhook handler update (ac-familiar)

**File:** `src/services/webhooks/WebhookListener.ts`

In `handleGamePublished()` (~line 546), after posting to the existing `payload.channelId` (AC global channel), check for `payload.guildAnnouncement`. If present:

```typescript
// After existing channel post...
if (payload.guildAnnouncement?.discordChannelId) {
  try {
    const guildChannel = await this.bot.channels.fetch(
      payload.guildAnnouncement.discordChannelId
    )
    if (guildChannel?.isTextBased()) {
      await guildChannel.send({ embeds: [embed] })
    }
  } catch (error) {
    logger.warn(`Failed to post guild announcement to channel ${payload.guildAnnouncement.discordChannelId}:`, error)
    // Don't throw — guild channel failure shouldn't block AC channel post
  }
}
```

Key behaviors:
- Reuse the same embed (`buildGamePublishedEmbed`) — no separate format for guild posts
- No role ping in guild servers (the guild hasn't configured one, and we don't want to ping @everyone in someone else's server)
- Catch errors silently — if the guild channel is deleted or the bot lost permissions, log a warning but don't fail the AC announcement
- No deduplication needed — each game publishes once, posts to two channels

### 3. Scheduler enhancement (optional, lower priority)

**File:** `src/services/scheduled/GameAnnouncementScheduler.ts`

The scheduler currently polls `getRecentGames()` and posts to the single global channel. To support guild announcements via the scheduler (fallback if webhooks miss something):

- Enhance `getRecentGames()` API response to include guild Discord config per game
- After posting to global channel, also post to each game's guild channel (if configured)
- Track which games have been announced to which channels to avoid duplicates

This is lower priority because the webhook path handles the real-time case. The scheduler is a sweep for anything missed. Can ship as a fast-follow.

### 4. Bot behavior scoping in external servers

**File:** `src/bot/client.ts`

Add a `HOME_SERVER_ID` env var for the AC Discord server ID.

**Command suppression:** In the interaction handler, check `interaction.guildId`. If it doesn't match `HOME_SERVER_ID` and the command isn't in an allowlist, respond with:

> "This command is only available in the Arcane Circle Discord server. [Join here](https://discord.gg/arcanecircle)"

Allowlist for external servers (minimal):
- `/ac-info` — new simple command that shows a link to the AC platform and the guild's page

All other commands (`/roll`, `/wiki`, `/character`, `/init`, `/join-game`, `/set-game-channel`, etc.) are suppressed in external servers.

**File:** `.env`

```bash
HOME_SERVER_ID=<AC Discord server ID>
```

### 5. Types update

**File:** `src/types/webhooks.ts`

Add `guildAnnouncement` to the `GamePublishedWebhook` type:

```typescript
interface GamePublishedWebhook {
  event: 'notification.game.published'
  gameId: string
  channelId: string
  guildAnnouncement?: {
    discordServerId: string
    discordChannelId: string
  }
  game: { /* existing */ }
}
```

## What NOT to Change

- Global announcement channel behavior is unchanged — AC Discord still gets all game announcements
- No new slash commands in external servers beyond `/ac-info`
- No guild role pinging — only the AC server's configured role gets pinged
- Bot doesn't leave external servers if guild config is removed — that's a manual step for guild admins

## Verification

1. Guild with Discord config set → member publishes game → embed appears in both AC channel and guild channel
2. Guild without Discord config → member publishes game → embed appears in AC channel only
3. Non-guild game published → embed appears in AC channel only
4. Guild channel deleted/inaccessible → warning logged, AC channel post succeeds
5. Bot in external server → user tries `/roll` → gets redirect message
6. Bot in external server → user tries `/ac-info` → gets platform link
7. Bot in AC server → all commands work normally
