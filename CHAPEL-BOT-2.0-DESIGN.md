# Chapel Bot 2.0 — Design Document

## Overview

Chapel is Arcane Circle's Discord bot. Right now it handles game discovery, booking management, and session recording. It works, but it doesn't make anyone's game better while they're playing it.

The platform has grown past the bot. Wiki, character sheets, VTT integration, timelines, relationship maps, interactive maps — none of that is accessible from Discord. A GM running a session has to tab over to the web app for every lookup. A player who wants to check their character's spell list has to leave the conversation.

Chapel 2.0 makes the bot the interface to the platform during play. Not a replacement for the web app — a companion to it. The things you need in the middle of a session, accessible without leaving Discord.

---

## Design Principles

1. **Session-first.** Every feature should answer: "Does this help during an active game session?" If not, it's lower priority.
2. **Reference, not reproduction.** Don't rebuild the web UI in Discord embeds. Surface the data, link to the full view.
3. **GM's right hand.** The GM is the power user. Features should reduce their cognitive load, not add to it.
4. **Ephemeral by design.** The bot stores nothing. The platform stores everything. Bot is a window, not a database.
5. **Progressive disclosure.** Simple commands for common lookups, deeper options for power users.

---

## Current State

### What Chapel Does Today (20 commands)

| Category | Commands | Notes |
|---|---|---|
| Account | `/link`, `/profile`, `/diagnostics` | OAuth linking, profile view |
| Game Discovery | `/games`, `/search-games`, `/game-info` | Browse/search published games |
| Player Actions | `/join-game`, `/leave-game`, `/my-games`, `/next-session`, `/attendance` | Booking management |
| GM Management | `/gm-profile`, `/gm-stats`, `/gm-game`, `/gm-bookings`, `/set-game-channel` | Game CRUD, applications |
| Recording | `/record` | Voice recording with streaming upload |
| Utility | `/ping`, `/help` | Basic diagnostics |

### What's Missing

- **Zero wiki access** — 54 API routes, none surfaced
- **Zero character sheet access** — full system exists with VTT data, approval workflows
- **Zero dice rolling** — the most basic TTRPG bot feature
- **No session flow tools** — can't start/end sessions, no initiative tracking
- **No lore/reference tools** — timelines, maps, relationships all web-only
- **No ambient intelligence** — bot doesn't react to session events or help proactively

---

## Feature Tiers

### Tier 1 — Session Essentials

These are the features that make Chapel worth having open during a game. Ship these first.

#### 1.1 Dice Roller (`/roll`)

The table stakes TTRPG bot feature. But integrated with the platform.

```
/roll 2d6+3
/roll 4d6kh3              # keep highest 3 (stat rolling)
/roll 1d20+5 advantage    # roll twice, take higher
/roll 1d20+5 disadvantage
/roll 8d6 fireball        # label for context
```

**Standard dice notation**: `NdX`, modifiers (`+`, `-`), keep highest/lowest (`kh`, `kl`), exploding (`!`), reroll (`r`), advantage/disadvantage.

**Character-integrated rolls** (if character is linked to campaign):
```
/roll check strength           # pulls modifier from character sheet
/roll save dexterity
/roll skill perception
/roll attack longsword          # pulls attack bonus and damage dice
/roll spell fireball            # pulls save DC, damage dice
```

These hit the `/api/characters/[id]/vtt-data` endpoint, which already returns stats, skills, saves, and abilities formatted for exactly this use case.

**GM rolls**:
```
/roll 1d20+5 --secret    # GM-only result, whispered via DM
/roll 2d6+3 --npc goblin # labeled with NPC name
```

**Implementation notes:**
- Dice parser: use an established library (e.g., `@dice-roller/rpg-dice-roller` or `dice-roller-parser`)
- Character data: cache VTT data per user per session (already have 5-min cache infrastructure)
- Display: embed with roll breakdown, total, and optional label
- System support: D&D 5e and Pathfinder have specific formatters in the character API already

#### 1.2 Wiki Quick Reference (`/wiki`)

The wiki is the campaign's brain. Make it accessible mid-session.

```
/wiki search <query>           # full-text search across campaign wiki
/wiki page <page-name>         # show page summary + link
/wiki npc <name>               # filtered to NPC pages
/wiki location <name>          # filtered to location pages
/wiki item <name>              # filtered to item pages
```

**Search results**: Show title, excerpt, page type, tags. Link to full page on web.

**Page view**: Show excerpt/first ~500 chars of content, key metadata (type, tags, last updated). Link to full page. Respect visibility — if a player runs `/wiki page secret-villain-lair` and it's `gm_only`, they get nothing.

**Secret block handling**: Content filtering already exists in `wiki-content-filter.ts`. Apply the same rules: strip `secret-block` and unrevealed `reveal-block` content based on the requesting user's role.

**Autocomplete**: Use `/api/wiki/[wikiId]/search/suggest` for command autocomplete. Players typing `/wiki page` get suggestions as they type.

**Context awareness**: If the command is run in a channel linked to a campaign (via `/set-game-channel`), auto-scope to that campaign's wiki. Otherwise, prompt for campaign selection.

```
/wiki random                   # random page from campaign wiki (fun for session prep)
/wiki recent                   # recently edited pages
/wiki links <page-name>        # show backlinks and outgoing links
```

**Implementation notes:**
- Wiki service module already exists in bot (`src/services/api/wiki.ts`) but isn't used by any command
- Need campaign-channel association lookup (exists via game's `discordChannelId`)
- Content rendering: strip HTML to plain text for embeds, preserve markdown where Discord supports it
- Pagination for search results using existing button collector pattern

#### 1.3 Character Quick Reference (`/character`)

Players and GMs need character data during play. The platform has it.

```
/character view                 # your character in this campaign
/character view @player         # GM: view a player's character
/character stats                # ability scores, AC, HP, speed
/character skills               # skill list with modifiers
/character spells               # spell list (prepared/known)
/character inventory            # equipment and items
/character features             # class features, racial traits
```

**Data source**: `/api/characters/[id]/vtt-data` returns a pre-formatted payload with stats, skills, saves, abilities. This endpoint was built for exactly this kind of quick-reference consumption.

**Permission model**:
- Players see their own characters
- GMs see all characters in their campaigns
- Shared characters (via `CharacterShare`) visible to share targets
- Respect approval status — draft characters only visible to owner and GM

**Embed format**: Compact stat blocks. D&D 5e example:
```
Thorin Ironforge — Level 5 Fighter
HP: 44/44 | AC: 18 | Speed: 25ft
STR 16(+3) DEX 12(+1) CON 14(+2) INT 10(+0) WIS 13(+1) CHA 8(-1)

Proficient: Athletics, Intimidation, Perception, Survival
```

#### 1.4 Initiative Tracker (`/init`)

No platform API for this — this is a bot-native feature using ephemeral state (which is the intended model).

```
/init start                    # start new encounter
/init add <name> <roll>        # add combatant with initiative
/init roll                     # everyone rolls (pulls DEX mod from character)
/init next                     # advance to next turn
/init remove <name>            # remove combatant
/init list                     # show current order
/init end                      # end encounter
```

**Character integration**: If players have linked characters, `/init roll` can auto-roll using their initiative modifier from VTT data. GM manually adds NPCs/monsters.

**Display**: Persistent embed updated on each `/init next`, showing full order with current turn highlighted. Pin the message for visibility.

**State**: In-memory per channel. Ephemeral. Lost on bot restart. That's fine — encounters don't span bot restarts, and if they do, re-entering initiative is trivial.

**Stretch**: HP tracking for NPCs (`/init damage goblin-1 15`). Keep it optional — some GMs want it, some use physical trackers.

---

### Tier 2 — Session Flow

Features that support the session lifecycle. Read-only where possible — the bot surfaces information and handles recording, but does not modify session status, attendance, or billing.

#### 2.1 Session Commands (`/session`)

The platform handles the real session lifecycle — status, attendance, billing, scheduling. The bot does **not** touch any of that. But the bot has its own concept of "a session is happening" that bundles the things it controls: announcements, recording, reference, and post-session wrap-up.

**Why the bot doesn't change session status:** Marking a session ACTIVE triggers payment flow dependencies (the cron auto-charger may skip already-active sessions). Marking COMPLETED triggers review notifications to all players and the GM, may auto-complete the entire game, and may auto-schedule the next session. These are business-critical side effects that belong in the web UI, not a Discord command.

```
/session start                  # announce session, offer recording, show prep info
/session end                    # stop recording, post digest, offer wiki summary
/session info                   # show current/next session details
/session notes <text>           # append GM notes to session
/session summary                # auto-create wiki page from session
```

**`/session start`** flow (GM-only, no platform status changes):
1. Look up current/next session for this campaign
2. Post announcement embed in channel: "Session 5 is starting. [Session details + link]"
3. Show any GM prep notes for this session
4. Offer to start recording: "React ⏺️ to start recording"
5. Bot enters "session active" state for this channel (ephemeral, in-memory)

**`/session end`** flow (GM-only, no platform status changes):
1. Stop recording if active
2. Post session digest: duration, who was in voice, recording stats
3. Offer wiki summary creation: "React 📝 to create a session summary page"
4. If accepted, call `POST /wiki/{wikiId}/pages/session-summary`
5. Show transcription link when webhook fires (if recorded)
6. Clear bot's "session active" state for this channel

**`/session info`**: Show session number, scheduled time, platform status, player count, and link to session page. If a session is currently ACTIVE on the platform, show that. Otherwise show the next SCHEDULED session.

**`/session notes`**: GM-only. Append text to the session's `gmNotes` field via `PUT /sessions/{id}`. Additive — doesn't overwrite existing notes.

**`/session summary`**: Create a wiki summary page via `POST /wiki/{wikiId}/pages/session-summary`. Links to the session and any recordings. GM can flesh it out on the web later. Can also be triggered from the `/session end` flow.

#### 2.2 Session Reminders (Enhanced Webhooks)

The webhook listener exists but defaults to off. Make it a core feature.

**Pre-session flow** (automated, no command needed):
- 24h before: Post reminder in campaign channel with session details
- 2h before: Post reminder with voice channel link
- 15min before: Final reminder, tag all players

**Post-session flow** (automated):
- When recording transcription completes: post notification with transcript stats and link
- Next day: Post "Session X recap" with summary if wiki page was created

**Implementation**: Webhook listener needs to be enabled by default in production config. The infrastructure exists — just needs the `WEBHOOK_LISTENER_ENABLED=true` default and proper `WEBHOOK_SECRET` configuration on Railway.

#### 2.3 Timeline & Lore (`/lore`)

Surface the campaign's timeline and relationships during play.

```
/lore timeline                  # show recent timeline events
/lore timeline session 5        # events from session 5
/lore event <name>              # search timeline events
/lore relationship <npc-a> <npc-b>  # how are these entities related?
/lore connections <entity>      # who/what is connected to this entity?
/lore calendar                  # show current in-world date (if set)
```

**Use case**: GM says "You've met this NPC before." Player runs `/lore connections lord-varik` and sees he's the faction leader of the Silver Hand, allied with the party's patron, and was present at Session 3.

**Implementation**: Relationship graph API (`/api/wiki/{wikiId}/relationships/graph`) and timeline API already exist. Format for Discord embeds, link to full views.

---

### Tier 3 — GM Power Tools

Features specifically for the GM's workflow. Less about in-session play, more about session prep and campaign management.

#### 3.1 GM Prep (`/prep`)

```
/prep checklist                 # show session prep tasks
/prep notes                     # view/add GM notes for next session
/prep players                   # player status (attendance confirmations, character submissions)
/prep npcs <session>            # NPCs appearing in this session (from wiki tags)
/prep recap                     # last session summary for "previously on..."
```

**`/prep players`** pulls:
- Attendance responses for next session
- Character submission status (APPROVED, SUBMITTED, NEEDS_REVISION, DRAFT)
- Last session attendance (who was there, who wasn't)

**`/prep recap`** pulls the most recent session's wiki summary page, truncated for a "previously on..." style read-aloud.

#### 3.2 Quick Create (`/create`)

Fast content creation from Discord without opening the web app.

```
/create npc <name> [description]       # create NPC wiki page
/create location <name> [description]  # create location wiki page
/create note <title> <content>         # create session notes page
/create event <title> <date>           # add timeline event
```

Uses templates from the wiki template system. Slash command opens a modal for the description (like the existing `/gm-game create` pattern). Creates the page, returns the link.

**Use case**: Mid-session, players go somewhere unexpected. GM runs `/create location The Rusty Anchor`, fills in a quick description, and the location exists in the wiki immediately. Flesh it out later on the web.

#### 3.3 Player Notifications (`/notify`)

```
/notify all <message>           # message all campaign players
/notify player @user <message>  # DM a specific player
/notify channel <message>       # post to campaign channel with @here
```

Enhanced version of existing notification modes. Useful for schedule changes, important announcements, or in-session communications (e.g., passing a secret note to a player).

#### 3.4 Map Reference (`/map`)

```
/map list                       # list campaign maps
/map show <name>                # show map image with pin overlay
/map pins <name>                # list pins on a map
/map pin <name> <pin-label>     # show specific pin details + linked wiki page
```

The interactive map system stores images and pins with coordinates. For Discord, render a simplified view: post the map image and list pins as text. Each pin links to its wiki page if one is set.

Not a full interactive map experience — that's what the web app is for — but enough to say "here's the map, here are the relevant locations."

---

### Tier 4 — Ambient Intelligence

Features that run without being invoked. The bot watches the session and helps proactively.

#### 4.1 Channel-Campaign Binding

When a Discord channel is linked to a campaign via `/set-game-channel`, Chapel becomes contextually aware in that channel:

- All `/wiki`, `/character`, `/roll` commands auto-scope to that campaign
- No need to specify which campaign you mean
- Bot can post session reminders, announcements, and recaps to the right place

**Implementation**: Lookup `discordChannelId` → `Game` → `CampaignWiki`, `Characters`, `Sessions`. Cache the mapping.

#### 4.2 Wiki Link Detection

When someone posts a message containing `[[Page Name]]` wiki-link syntax in a campaign channel, Chapel can optionally resolve it:

> **Player**: Wait, wasn't [[Lord Varik]] the one who betrayed [[The Silver Hand]]?
>
> **Chapel**: 📖 **Lord Varik** — Human noble, leader of the Northern Coalition. [View page →](https://arcanecircle.games/...)
> 📖 **The Silver Hand** — Paladin order, sworn to protect the realm. [View page →](https://arcanecircle.games/...)

**Toggle**: Per-channel setting via `/set-game-channel`. Can be noisy — make it opt-in.

**Implementation**: Message content listener (not a slash command). Regex for `[[...]]`, hit wiki search API, post compact embeds.

#### 4.3 Voice Channel Awareness

When Chapel is in a voice channel (for recording), it can track:

- Who joins/leaves and when (informational logging, no status changes)
- Session duration

**Not** doing:
- Auto-attendance marking (attendance is handled by the platform)
- Real-time transcription (recording pipeline handles this post-session)
- Voice commands (too complex, too unreliable)

#### 4.4 Post-Session Digest

After recording stops, Chapel posts a recap to the campaign channel:
- Recording duration
- Players who were in voice
- Recording stats and transcription link (when ready, via webhook)
- Link to session page on platform
- Prompt to create wiki summary via `/session summary`

Informational only — no session status changes, no attendance updates.

---

## Implementation Architecture

### Command Organization

Reorganize commands into groups:

```
src/commands/
├── account/          # link, profile, diagnostics
├── games/            # games, search-games, game-info, join-game, leave-game
├── gm/               # gm-profile, gm-stats, gm-game, gm-bookings, set-game-channel
├── session/          # session, attendance, record, init
├── wiki/             # wiki, lore
├── character/        # character, roll
├── prep/             # prep, create, notify, map
└── utility/          # ping, help
```

### New Service Modules

Existing but unused:
- `src/services/api/wiki.ts` — needs commands wired up

New:
- `src/services/dice/DiceRoller.ts` — dice parsing and rolling
- `src/services/session/InitiativeTracker.ts` — in-memory initiative state per channel
- `src/services/context/ChannelContext.ts` — channel→campaign binding cache

### Campaign Context Resolution

Most new commands need to know which campaign the user is operating in. Resolution order:

1. **Channel binding**: If the Discord channel is linked to a campaign, use that campaign.
2. **Single campaign**: If user is in exactly one active campaign, use that.
3. **Autocomplete**: If ambiguous, show campaign autocomplete (existing pattern from `/attendance`).

Cache the channel→campaign mapping. Invalidate on `/set-game-channel`.

### Embed Standards

Consistent embed formatting across all commands:

- **Color coding**:
  - Wiki pages: `#3498db` (blue)
  - Character data: `#2ecc71` (green)
  - Dice rolls: `#e74c3c` (red)
  - Session info: `#f39c12` (gold)
  - GM tools: `#9b59b6` (purple)
- **Footer**: Always include "Arcane Circle" + link to relevant web page
- **Timestamps**: Relative where useful ("in 2 hours", "3 days ago")
- **Truncation**: Content over 1024 chars gets "... [Read more →](link)"

---

## Implementation Priority

### Phase 1 — Core Session Tools
*Make Chapel useful during play.*

1. Channel-campaign binding (context resolution) — foundation for everything
2. `/roll` — Dice roller with basic notation
3. `/wiki search` and `/wiki page` — Wiki quick reference
4. `/character stats` and `/character view` — Character lookup
5. `[[Wiki Link]]` detection in messages — high daily value, small surface area once context resolution exists

### Phase 2 — Full Session Experience
*Make Chapel the session companion.*

6. Character-integrated dice rolls (`/roll check`, `/roll save`)
7. `/init` — Initiative tracker
8. `/session start` and `/session end` — Bot-level session orchestration (no platform status changes)
9. Enhanced webhook notifications (auto-reminders)
10. `/wiki npc`, `/wiki location`, `/wiki item` — Typed wiki lookups

### Phase 3 — GM Tools
*Make Chapel the GM's prep assistant.*

11. `/prep` commands — Session prep workflow
12. `/create` commands — Quick wiki content creation
13. `/lore` commands — Timeline and relationship reference
14. `/map` commands — Map reference
15. Post-session digest

### Phase 4 — Ambient Features
*Make Chapel contextually intelligent.*

16. `/notify` — Player communication tools
17. Post-session digest (recording stats, wiki summary link)

---

## Technical Considerations

### Dependencies to Add

- **Dice rolling**: `@dice-roller/rpg-dice-roller` or `dice-roller-parser` — no reason to write a parser from scratch
- No other new dependencies expected. Everything else uses existing platform APIs.

### Platform API Gaps

These features need endpoints that may not exist yet:

| Feature | Needed | Status |
|---|---|---|
| Wiki search | `GET /api/wiki/{id}/search` | Exists |
| Wiki page by slug | `GET /api/wiki/{id}/pages?slug=x` | Verify |
| Character by game + user | `GET /api/characters?gameId=x&userId=y` | Verify |
| VTT data by game + user | Combination of above + `/vtt-data` | Verify |
| Initiative | None — bot-native | N/A |
| Session info | `GET /sessions/{id}` | Exists |
| Session notes update | `PUT /sessions/{id}` | Exists |
| Session summary creation | `POST /wiki/{id}/pages/session-summary` | Exists |
| Timeline events | `GET /api/wiki/{id}/timeline` | Exists |
| Relationships | `GET /api/wiki/{id}/relationships/graph` | Exists |
| Maps + pins | `GET /api/wiki/{id}/maps`, `/maps/{id}/pins` | Exists |

The platform API is comprehensive. Most features are about wiring existing endpoints to Discord commands.

### Performance

- **Caching**: Extend existing 5-minute user cache to include campaign context, character data, and wiki search results
- **Autocomplete latency**: Wiki search suggest endpoint needs to respond in <3 seconds for Discord autocomplete. Test and optimize if needed.
- **Embed size limits**: Discord embeds max at 6000 characters total, 25 fields. Design around these constraints.
- **Rate limiting**: Discord API rate limits are per-channel and per-user. Batch operations (like auto-attendance) need to respect these.

### Recording Pipeline (Unchanged)

The recording system is mature and works. Chapel 2.0 doesn't modify it — `/session record` is a convenience wrapper around the existing `/record` command, not a new recording pipeline.

---

## Success Metrics

Chapel 2.0 is successful when:

1. **GMs don't tab out during sessions.** Wiki lookups, character references, and dice rolls happen in Discord.
2. **Players interact with the platform through the bot.** Character checks, wiki searches, and session info without bookmarking the web app.
3. **Session lifecycle is captured.** Start, attendance, recording, end, summary — all flowing through Chapel.
4. **The bot is always open during play.** Not opened for one command and forgotten — a persistent presence in the session channel.

---

## What Chapel 2.0 Is Not

- **Not a VTT.** It won't replace Foundry, Roll20, or the platform's own VTT. It's a reference and utility layer.
- **Not a character builder.** Character creation and editing happen on the web. The bot surfaces data, doesn't modify it (except quick-create wiki pages for GMs).
- **Not a rules engine.** It rolls dice and pulls character data. It doesn't adjudicate rules, look up spell descriptions from SRD databases, or automate combat resolution.
- **Not a chatbot.** No conversational AI, no "ask Chapel about the lore." Structured commands, structured responses.

---

*Prepared for review. Subject to revision after discussion.*
