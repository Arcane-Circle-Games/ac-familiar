# Arcane Circle Discord Bot - Command Reference

**Last Updated:** 2025-10-29

This document lists all available Discord bot commands for the Arcane Circle platform.

---

## Getting Started

Before using most commands, link your Discord account to Arcane Circle:

```
/link
```

This provides instructions to connect your Discord account via the platform's account settings.

---

## Player Commands

### Browse Games
**Command:** `/games`
**Description:** Browse all available published games with pagination.

**Features:**
- View up to 10 games at a time
- Navigate with Previous/Next buttons
- See game title, system, GM, type, price, and player slots
- Direct links to view details and book on the web

---

### Search Games
**Command:** `/search-games`
**Description:** Search for games with specific criteria.

**Parameters:**
- `query` (optional) - Keywords to search in title/description
- `game-system` (optional) - Filter by system (autocomplete enabled)
- `max-price` (optional) - Maximum price per session

**Note:** At least one search criterion required.

---

### Game Details
**Command:** `/game-info`
**Description:** Get detailed information about a specific game.

**Parameters:**
- `id` (required) - The game ID (from `/games` or `/search-games`)

**Shows:**
- Full description and game image
- System, GM, type, schedule
- Player count, experience level, age requirement
- Price, content warnings, tags
- Links to view and book on the platform

---

### Join a Game
**Command:** `/join-game`
**Description:** Book and join a game with payment pre-authorization.

**Parameters:**
- `game-id` (required) - Game ID to join
- `message` (optional) - Message to the GM
- `character` (optional) - Character concept

**Requirements:**
- Linked Discord account
- Payment method on file (for paid games)
- Game must have upcoming sessions

---

### Leave a Game
**Command:** `/leave-game`
**Description:** Cancel your booking for a game.

**Parameters:**
- `game` (required, autocomplete) - Select from your active bookings

**Features:**
- Shows only games you've joined
- Cancels payment pre-authorizations
- Notifies the GM

---

## GM Commands

### Manage Profile
**Command:** `/gm-profile`
**Description:** View or edit your GM profile.

**Usage:**
```
/gm-profile                                    # View profile
/gm-profile field:bio value:"Your bio here"   # Edit a field
```

**Editable Fields:**
- Bio
- Experience level
- Timezone
- Game systems (comma-separated)

---

### Create Game
**Command:** `/gm-game create`
**Description:** Create a new game listing.

**Parameters:**
- `title` - Game name (max 100 chars)
- `system` - Game system (autocomplete)
- `type` - CAMPAIGN or ONE_SHOT
- `max-players` - 1-10 players
- `price` - $0-200 per session
- `timezone` - Your timezone
- `short-description` - Brief description (max 200 chars)
- `content-warnings` - Optional, comma-separated

**Process:**
1. Fill out basic parameters
2. Modal appears for full description (100-2000 chars)
3. Game created as DRAFT
4. Use `/gm-game publish` to make visible

---

### List Your Games
**Command:** `/gm-game list`
**Description:** View all your game listings.

**Parameters:**
- `status` (optional) - Filter by: All, Draft, Published, Full, Completed
- `type` (optional) - Filter by: All, Campaign, One-Shot

---

### Edit Game
**Command:** `/gm-game edit`
**Description:** Update an existing game.

**Parameters:**
- `game` (required, autocomplete) - Select your game
- `field` (required) - What to edit: Title, Description, Max Players, Price, Status, Content Warnings
- `value` (required) - New value

---

### Publish Game
**Command:** `/gm-game publish`
**Description:** Make a game visible to players or hide it.

**Parameters:**
- `game` (required, autocomplete) - Select your game
- `action` (required) - Publish or Unpublish

---

### Delete Game
**Command:** `/gm-game delete`
**Description:** Permanently delete a game listing.

**Parameters:**
- `game` (required, autocomplete) - Select your game

**Note:** Requires confirmation before deletion.

---

### View Applications
**Command:** `/gm-bookings list`
**Description:** View player applications for your game.

**Parameters:**
- `game` (required, autocomplete) - Select your game
- `status` (optional) - Filter by: All, Pending, Confirmed, Rejected, Waitlisted

**Features:**
- Quick-accept/reject buttons for pending applications
- View application details and dates

---

### Accept Application
**Command:** `/gm-bookings accept`
**Description:** Accept a player's application.

**Parameters:**
- `booking-id` (required) - Booking ID from application list
- `message` (optional) - Welcome message to player

---

### Reject Application
**Command:** `/gm-bookings reject`
**Description:** Reject a player's application.

**Parameters:**
- `booking-id` (required) - Booking ID from application list
- `reason` (optional) - Reason for rejection

---

### View GM Stats
**Command:** `/gm-stats`
**Description:** View your statistics and earnings.

**Shows:**
- Total games run
- Active campaigns
- Total players served
- Average rating
- Earnings (this month, total, pending payouts)

---

## Recording Commands

### Start Recording
**Command:** `/record action:start`
**Description:** Start recording the voice channel.

**Requirements:**
- Must be in a voice channel
- Bot will record all participants separately

---

### Stop Recording
**Command:** `/record action:stop`
**Description:** Stop recording and upload to platform.

**Features:**
- Automatically uploads to Vercel Blob Storage
- Platform handles transcription processing
- Provides link to view/manage recording

---

## Utility Commands

### Check Bot Status
**Command:** `/ping`
**Description:** Check bot responsiveness and latency.

**Shows:**
- Bot latency (response time)
- API latency (WebSocket)
- Connection quality indicator

---

### Diagnostics
**Command:** `/diagnostics`
**Description:** Check API connectivity and authentication.

**Shows:**
- API health check status
- Discord authentication status
- Games endpoint test
- User account info if linked

---

## Tips & Best Practices

### For Players
- Link your account first with `/link`
- Browse games with `/games` or search with `/search-games`
- Get full details with `/game-info` before joining
- Ensure payment method is set up on the platform

### For GMs
- Create your GM profile on the platform first
- Games are created as DRAFT - review before publishing
- Use `/gm-bookings list` to manage incoming applications
- Start recording during sessions with `/record action:start`

### During Sessions
- GM starts recording at session start
- Bot records each participant separately
- Stop recording when done - upload is automatic
- Transcripts processed by the platform API

---

## Platform Integration

### How Authentication Works
1. Link Discord account via platform OAuth (use `/link` for instructions)
2. Bot looks up users by Discord ID
3. All authenticated commands use your linked account
4. Payment methods managed on the platform

### Recording & Transcription
- Audio captured per-user from Discord voice
- Files uploaded to Vercel Blob Storage via platform API
- Transcription handled by platform (not locally)
- Sessions tracked by UUID

---

## Support

- **Report Issues:** GitHub repository
- **Technical Docs:** See CLAUDE.md in project root
- **Platform:** https://arcanecircle.games

---

**Document Version:** 2.0
**Reflects:** Actually implemented commands only
