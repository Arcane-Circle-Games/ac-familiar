# Arcane Circle Discord Bot - Command Reference

**Last Updated:** 2025-10-29

This document provides a complete reference for all Discord bot commands, including both currently implemented features and planned functionality.

---

## Legend

- ✅ **Implemented** - Command is live and ready to use
- 🚧 **Planned** - Command is in development or planned for future release

---

## Quick Start

### Getting Started
Before using most commands, you'll need to link your Discord account to your Arcane Circle account.

**Command:** `/link`
**Status:** ✅ Implemented

---

## Game Discovery & Browsing

### Browse Available Games
**Command:** `/games`
**Status:** ✅ Implemented
**Description:** Browse available games with filtering and pagination options.

**Usage:**
```
/games
```

**Features:**
- View published games
- Filter by various criteria
- Paginated results with navigation buttons

---

### Get Game Details
**Command:** `/game-info`
**Status:** ✅ Implemented
**Description:** Get detailed information about a specific game.

**Usage:**
```
/game-info game:[game name]
```

**Features:**
- Autocomplete game search
- Shows GM info, system, schedule, price
- Displays available slots

---

### Browse GMs
**Command:** `/gm`
**Status:** ✅ Implemented
**Description:** Browse Game Masters and their offerings.

**Usage:**
```
/gm
```

---

## Game Management (Player)

### Join a Game
**Command:** `/join-game`
**Status:** ✅ Implemented
**Description:** Book and join a game (requires payment method setup on platform).

**Usage:**
```
/join-game game-id:[id]
```

**Requirements:**
- Linked Discord account
- Valid payment method (if game has a price)

---

### Leave a Game
**Command:** `/leave-game`
**Status:** ✅ Implemented
**Description:** Leave a game you've previously joined.

**Usage:**
```
/leave-game game:[autocomplete]
```

**Features:**
- Shows only your active bookings
- Autocomplete for easy selection

---

### Apply to Join a Game
**Command:** `/join apply`
**Status:** 🚧 Planned
**Description:** Submit an application to join a game with character concept and message to GM.

**Planned Usage:**
```
/join apply game:[game]
```

---

### Check Application Status
**Command:** `/join status`
**Status:** 🚧 Planned
**Description:** View all your game applications and their current status.

**Planned Usage:**
```
/join status
```

---

## Game Management (GM)

### Create a Campaign
**Command:** `/campaign create`
**Status:** 🚧 Planned
**Description:** Create a new game listing.

**Planned Usage:**
```
/campaign create
  title:[name]
  system:[system]
  type:[CAMPAIGN or ONE_SHOT]
  players:[max]
  price:[per session]
```

**Parameters:**
- **title** - Campaign name (max 100 characters)
- **system** - Game system (autocomplete)
- **type** - Campaign or One-shot
- **players** - Maximum players (1-10)
- **price** - Price per session ($0-200)

---

### Edit Campaign
**Command:** `/campaign edit`
**Status:** 🚧 Planned
**Description:** Edit an existing campaign's details.

**Planned Usage:**
```
/campaign edit campaign:[your campaign]
```

---

### List Your Campaigns
**Command:** `/campaign list`
**Status:** 🚧 Planned
**Description:** View all your campaigns with status filtering.

**Planned Usage:**
```
/campaign list status:[all/draft/published/full/completed]
```

---

### View Campaign Details
**Command:** `/campaign view`
**Status:** 🚧 Planned
**Description:** View detailed information about a campaign including players and bookings.

**Planned Usage:**
```
/campaign view campaign:[campaign]
```

---

### Delete Campaign
**Command:** `/campaign delete`
**Status:** 🚧 Planned
**Description:** Permanently delete a campaign.

**Planned Usage:**
```
/campaign delete campaign:[campaign]
```

**Note:** Requires confirmation before deletion.

---

### Publish/Unpublish Campaign
**Command:** `/campaign publish`
**Status:** 🚧 Planned
**Description:** Toggle campaign visibility on the marketplace.

**Planned Usage:**
```
/campaign publish campaign:[campaign] action:[publish/unpublish]
```

---

### Manage Player Applications
**Command:** `/gm applications`
**Status:** 🚧 Planned
**Description:** View and manage player applications to your games.

**Planned Usage:**
```
/gm applications game:[game] status:[pending/all]
```

**Actions:**
- Accept applications
- Reject applications
- Waitlist players

---

### Manage GM Profile
**Command:** `/gm profile`
**Status:** 🚧 Planned
**Description:** View and edit your GM profile.

**Planned Usage:**
```
/gm profile view
/gm profile edit field:[bio/experience/timezone/systems] value:[new value]
```

---

### View GM Statistics
**Command:** `/gm stats`
**Status:** 🚧 Planned
**Description:** View your statistics as a GM.

**Planned Usage:**
```
/gm stats
```

**Shows:**
- Total games run
- Active campaigns
- Total players
- Average rating
- Earnings information

---

## Session Management

### Start Recording
**Command:** `/record start`
**Status:** ✅ Implemented
**Description:** Start recording the current voice channel.

**Usage:**
```
/record action:start
```

**Requirements:**
- Must be in a voice channel
- Must have appropriate permissions

---

### Stop and Save Recording
**Command:** `/record stop-save`
**Status:** ✅ Implemented
**Description:** Stop recording and upload to platform for transcription.

**Usage:**
```
/record action:stop-save
```

**Features:**
- Uploads audio files to Vercel Blob Storage
- Triggers automatic transcription processing via API
- Per-user audio track separation

---

### Download Recording
**Command:** `/download-recording`
**Status:** ✅ Implemented
**Description:** Get download links for session recording files.

**Usage:**
```
/download-recording session-id:[id]
```

---

### Start Session
**Command:** `/session start`
**Status:** 🚧 Planned
**Description:** Start a game session with automatic recording.

**Planned Usage:**
```
/session start campaign:[campaign]
```

**Requirements:**
- Must be in voice channel
- Must be GM of the campaign

---

### End Session
**Command:** `/session end`
**Status:** 🚧 Planned
**Description:** End the current session and process recordings.

**Planned Usage:**
```
/session end notes:[optional quick notes]
```

---

### Add Session Notes
**Command:** `/session notes`
**Status:** 🚧 Planned
**Description:** Add or view notes for a session.

**Planned Usage:**
```
/session notes action:[add/view] session:[session] notes:[text]
```

---

### Mark Attendance
**Command:** `/session attendance`
**Status:** 🚧 Planned
**Description:** Mark attendance for the current session.

**Planned Usage:**
```
/session attendance
```

**Features:**
- Auto-detects users in voice channel
- Marks attendance for campaign tracking

---

### List Sessions
**Command:** `/session list`
**Status:** 🚧 Planned
**Description:** List upcoming sessions.

**Planned Usage:**
```
/session list campaign:[optional filter]
```

---

### Create Session
**Command:** `/session create`
**Status:** 🚧 Planned
**Description:** Schedule a new session for a campaign.

**Planned Usage:**
```
/session create
  campaign:[campaign]
  date:[YYYY-MM-DD]
  time:[HH:MM]
  duration:[hours]
  title:[optional]
```

---

### Cancel Session
**Command:** `/session cancel`
**Status:** 🚧 Planned
**Description:** Cancel a scheduled session.

**Planned Usage:**
```
/session cancel session:[session] reason:[reason] notify:[yes/no]
```

---

## Transcripts

### View Transcript
**Command:** `/transcript view`
**Status:** 🚧 Planned
**Description:** View a session transcript.

**Planned Usage:**
```
/transcript view session:[session] format:[summary/full/timestamps]
```

---

### Export Transcript
**Command:** `/transcript export`
**Status:** 🚧 Planned
**Description:** Export a transcript in various formats.

**Planned Usage:**
```
/transcript export session:[session] format:[pdf/txt/json/markdown]
```

---

## Wiki Management

### Create Wiki Page
**Command:** `/wiki create`
**Status:** 🚧 Planned
**Description:** Create a new wiki page for a campaign.

**Planned Usage:**
```
/wiki create
  campaign:[campaign]
  title:[page title]
  type:[npc/location/item/faction/session_notes/custom]
```

**Page Types:**
- **NPC** - Non-player characters
- **Location** - Places and settings
- **Item** - Magic items, artifacts, equipment
- **Faction** - Organizations and groups
- **Session Notes** - Session summaries and notes
- **Custom** - Other content

**Permission:** GM only by default

---

### View Wiki Page
**Command:** `/wiki view`
**Status:** 🚧 Planned
**Description:** View a wiki page.

**Planned Usage:**
```
/wiki view campaign:[campaign] page:[page name]
```

---

### Search Wiki
**Command:** `/wiki search`
**Status:** 🚧 Planned
**Description:** Search campaign wiki pages.

**Planned Usage:**
```
/wiki search campaign:[campaign] query:[search terms] type:[optional filter]
```

---

### List Wiki Pages
**Command:** `/wiki list`
**Status:** 🚧 Planned
**Description:** List all wiki pages for a campaign.

**Planned Usage:**
```
/wiki list campaign:[campaign] type:[all/npc/location/item/etc]
```

---

### Edit Wiki Page
**Command:** `/wiki edit`
**Status:** 🚧 Planned
**Description:** Edit an existing wiki page.

**Planned Usage:**
```
/wiki edit campaign:[campaign] page:[page]
```

**Permission:** GM only (configurable per page)

---

### Delete Wiki Page
**Command:** `/wiki delete`
**Status:** 🚧 Planned
**Description:** Delete a wiki page.

**Planned Usage:**
```
/wiki delete campaign:[campaign] page:[page]
```

**Note:** Requires confirmation

---

### Share Wiki Page Link
**Command:** `/wiki link`
**Status:** 🚧 Planned
**Description:** Get a shareable link to a wiki page.

**Planned Usage:**
```
/wiki link campaign:[campaign] page:[page]
```

---

## Account & Profile

### Link Discord Account
**Command:** `/link`
**Status:** ✅ Implemented
**Description:** Link your Discord account to Arcane Circle platform.

**Usage:**
```
/link
```

**Process:**
1. Run the command
2. Click the OAuth link provided
3. Authorize on the Arcane Circle platform
4. Return to Discord to use authenticated commands

---

### View Profile
**Command:** `/profile`
**Status:** 🚧 Planned
**Description:** View your Arcane Circle profile.

**Planned Usage:**
```
/profile
```

**Shows:**
- Linked games
- GM status
- Statistics
- Account info

---

### View Statistics
**Command:** `/stats`
**Status:** 🚧 Planned
**Description:** View your player statistics.

**Planned Usage:**
```
/stats
```

**Shows:**
- Games played
- Sessions attended
- Characters created
- Achievements

---

### Manage Notifications
**Command:** `/notifications`
**Status:** 🚧 Planned
**Description:** Manage Discord notification preferences.

**Planned Usage:**
```
/notifications
  type:[session_reminders/application_updates/game_announcements]
  enabled:[on/off]
```

---

## Utility Commands

### Help
**Command:** `/help`
**Status:** 🚧 Planned
**Description:** Display bot command help.

**Planned Usage:**
```
/help category:[gm/player/session/wiki/all]
```

---

### Test API Connection
**Command:** `/test-api`
**Status:** ✅ Implemented
**Description:** Test API connectivity and authentication.

**Usage:**
```
/test-api
```

**Shows:**
- API health status
- Games listing test
- User lookup test
- Authentication status

---

### Test Announcements
**Command:** `/test-announcements`
**Status:** ✅ Implemented
**Description:** Manually trigger game announcement check (Admin only).

**Usage:**
```
/test-announcements
```

**Purpose:** Testing the automated game announcement scheduler

---

### Ping
**Command:** `/ping`
**Status:** ✅ Implemented
**Description:** Check bot responsiveness.

**Usage:**
```
/ping
```

---

## Automated Features

### Game Announcements
**Status:** ✅ Implemented
**Description:** Automatically announces newly published games to a designated Discord channel.

**Configuration:**
- Runs on configurable schedule (default: every 3 hours)
- Posts to single configured channel
- Fetches recent games from platform API
- Rate-limited to respect Discord limits

**Environment Variables:**
```
GAME_ANNOUNCEMENT_ENABLED=true
GAME_ANNOUNCEMENT_CHANNEL_ID=your_channel_id
GAME_ANNOUNCEMENT_INTERVAL_HOURS=3
```

---

## Tips & Best Practices

### For Players
1. Always link your account first with `/link`
2. Use `/games` to browse available games
3. Check game details with `/game-info` before joining
4. Keep track of your applications with `/join status` (when available)

### For GMs
1. Link your account and set up your GM profile
2. Create campaigns through the web interface or `/campaign create` (when available)
3. Use session management commands during live play
4. Record sessions for automatic transcription
5. Use wiki commands to build campaign content players can reference

### During Sessions
1. GM starts session with `/session start` to begin recording
2. Bot automatically records all participants separately
3. Add notes during play with `/session notes`
4. End session with `/session end` to stop recording and trigger transcription
5. Transcripts become available after processing (usually within minutes)

---

## Roadmap

### Phase 1: Core Features ✅
- [x] Account linking
- [x] Game browsing
- [x] Basic game management
- [x] Recording system
- [x] Game announcements

### Phase 2: Enhanced Game Management 🚧
- [ ] Campaign creation via Discord
- [ ] Player applications system
- [ ] Session scheduling
- [ ] GM profile management

### Phase 3: Session Features 🚧
- [ ] Session start/end commands
- [ ] Attendance tracking
- [ ] Session notes
- [ ] Enhanced recording features

### Phase 4: Wiki System 🚧
- [ ] Wiki page creation
- [ ] Wiki search and navigation
- [ ] Page templates
- [ ] Visibility controls

### Phase 5: Transcription Features 🚧
- [ ] Transcript viewing
- [ ] Export capabilities
- [ ] Search within transcripts
- [ ] Speaker identification

---

## Support & Feedback

- **Issues:** Report bugs at [GitHub Issues](https://github.com/anthropics/claude-code/issues)
- **Documentation:** Full technical docs in `CLAUDE.md`
- **API Reference:** See `documentation/api-endpoints.md`

---

## Technical Notes

### Recording System
- Audio is captured per-user in Discord voice channels
- Files are uploaded to Vercel Blob Storage via platform API
- Transcription is handled by the platform API (not locally)
- Sessions are tracked by UUID and linked to platform campaigns

### Authentication
- Users must link Discord accounts via OAuth on web platform
- Bot looks up users via `/users/discord/{discordId}` endpoint
- API client caches user data (5 min TTL) for performance

### Rate Limits
- Commands respect Discord rate limits
- API calls are throttled appropriately
- Recording uploads handle large files efficiently

---

**Document Version:** 1.0
**Bot Version:** See package.json
**Platform:** Arcane Circle TTRPG Marketplace
