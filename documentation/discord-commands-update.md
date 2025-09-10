# Discord Commands Implementation Specification
## For Arcane Familiar Bot - Complete Command Reference

## Overview
This document specifies all Discord slash commands to be implemented for the Arcane Familiar bot, including their parameters, API endpoints, and implementation details.

---

## 🎮 GM Commands

### `/gm profile`
**Description**: View or edit your GM profile
**Subcommands**:

#### `/gm profile view`
- **API Endpoint**: `GET /api/gms/:id`
- **Parameters**: None (uses authenticated user)
- **Response Fields**: 
  - displayName, bio, experience, systems[], timezone, rating

#### `/gm profile edit`
- **API Endpoint**: `PUT /api/gms/:id`
- **Parameters**:
  - `field` (STRING, required, choices): ["bio", "experience", "timezone", "systems"]
  - `value` (STRING, required): New value for the field
- **Implementation Note**: For systems, accept comma-separated values

---

### `/gm create`
**Description**: Create a new game listing
- **API Endpoint**: `POST /api/games`
- **Parameters**:
  - `title` (STRING, required, max: 100): Game title
  - `system` (STRING, required, autocomplete): Game system (D&D 5e, Pathfinder, etc.)
  - `type` (STRING, required, choices): ["CAMPAIGN", "ONE_SHOT"]
  - `max_players` (INTEGER, required, min: 1, max: 10): Maximum players
  - `price` (NUMBER, required, min: 0, max: 200): Price per session in USD
  - `timezone` (STRING, required, choices): Common timezones
  - `content_warnings` (STRING, optional): Comma-separated warnings
  - `short_description` (STRING, required, max: 200): Brief description
- **Implementation**:
  ```typescript
  // After basic params collected, show modal for full description
  const modal = new ModalBuilder()
    .addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Full Description')
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(100)
        .setMaxLength(2000)
    );
  ```

---

### `/gm edit`
**Description**: Edit an existing game
- **API Endpoint**: `PUT /api/games/:id`
- **Parameters**:
  - `game` (STRING, required, autocomplete): Game ID to edit
  - `field` (STRING, required, choices): ["title", "description", "max_players", "price", "status", "content_warnings"]
  - `value` (STRING, required): New value
- **Autocomplete**: Fetch user's games from `GET /api/games?gmId={userId}`

---

### `/gm list`
**Description**: List your games
- **API Endpoint**: `GET /api/games?gmId={userId}`
- **Parameters**:
  - `status` (STRING, optional, choices): ["all", "DRAFT", "PUBLISHED", "FULL", "COMPLETED"]
  - `type` (STRING, optional, choices): ["all", "CAMPAIGN", "ONE_SHOT"]
- **Response Format**: Embed with game cards showing title, status, players, next session

---

### `/gm applications`
**Description**: View and manage player applications
- **API Endpoint**: `GET /api/games/:id/bookings`
- **Parameters**:
  - `game` (STRING, required, autocomplete): Game ID
  - `status` (STRING, optional, choices): ["PENDING", "CONFIRMED", "REJECTED", "WAITLISTED", "all"]
- **Response**: Interactive embed with buttons for each application:
  - Accept button → `PUT /api/bookings/:id/status` {status: "CONFIRMED"}
  - Reject button → `PUT /api/bookings/:id/status` {status: "REJECTED"}
  - Waitlist button → `PUT /api/bookings/:id/status` {status: "WAITLISTED"}

---

### `/gm accept`
**Description**: Accept a player application
- **API Endpoint**: `PUT /api/bookings/:id/status`
- **Parameters**:
  - `booking_id` (STRING, required): Booking ID
  - `message` (STRING, optional): Message to player
- **Body**: `{ status: "CONFIRMED", message?: string }`

---

### `/gm reject`
**Description**: Reject a player application
- **API Endpoint**: `PUT /api/bookings/:id/status`
- **Parameters**:
  - `booking_id` (STRING, required): Booking ID
  - `reason` (STRING, optional): Rejection reason
- **Body**: `{ status: "REJECTED", reason?: string }`

---

### `/gm publish`
**Description**: Publish or unpublish a game
- **API Endpoint**: `PUT /api/games/:id/status`
- **Parameters**:
  - `game` (STRING, required, autocomplete): Game ID
  - `action` (STRING, required, choices): ["publish", "unpublish"]
- **Body**: `{ status: "PUBLISHED" | "DRAFT" }`

---

### `/gm delete`
**Description**: Delete a game listing
- **API Endpoint**: `DELETE /api/games/:id`
- **Parameters**:
  - `game` (STRING, required, autocomplete): Game ID
- **Implementation**: Show confirmation button before deletion

---

### `/gm stats`
**Description**: View your GM statistics
- **API Endpoints**: 
  - `GET /api/gms/:id/stats`
  - `GET /api/gms/:id/earnings`
- **Parameters**: None
- **Response Fields**: 
  - Total games run, active campaigns, total players, average rating
  - Earnings this month, total earnings, pending payouts

---

## 🎲 Player Commands

### `/browse`
**Description**: Browse available games
- **API Endpoint**: `GET /api/games/search`
- **Parameters**:
  - `system` (STRING, optional, autocomplete): Filter by system
  - `type` (STRING, optional, choices): ["all", "CAMPAIGN", "ONE_SHOT"]
  - `max_price` (NUMBER, optional, min: 0): Maximum price per session
  - `timezone` (STRING, optional, choices): Preferred timezone
  - `day` (STRING, optional, choices): ["weekday", "weekend", "monday", "tuesday", etc.]
  - `time` (STRING, optional, choices): ["morning", "afternoon", "evening", "late_night"]
- **Response**: Paginated embeds with game cards, navigation buttons

---

### `/apply`
**Description**: Apply to join a game
- **API Endpoint**: `POST /api/bookings`
- **Parameters**:
  - `game` (STRING, required, autocomplete): Game ID
- **Implementation**: Shows modal for application
  ```typescript
  const modal = new ModalBuilder()
    .addComponents(
      new TextInputBuilder()
        .setCustomId('experience')
        .setLabel('Your TTRPG Experience')
        .setRequired(true),
      new TextInputBuilder()
        .setCustomId('character_concept')
        .setLabel('Character Concept (if any)')
        .setRequired(false),
      new TextInputBuilder()
        .setCustomId('message')
        .setLabel('Message to GM')
        .setRequired(true)
    );
  ```

---

### `/applications`
**Description**: View your game applications
- **API Endpoint**: `GET /api/users/:id/bookings`
- **Parameters**:
  - `status` (STRING, optional, choices): ["all", "PENDING", "CONFIRMED", "REJECTED", "WAITLISTED"]
- **Response**: Embed showing all applications with status

---

### `/leave`
**Description**: Leave a game you've joined
- **API Endpoint**: `DELETE /api/bookings/:id`
- **Parameters**:
  - `game` (STRING, required, autocomplete): Game ID (only shows games you're in)
  - `reason` (STRING, optional): Why you're leaving
- **Implementation**: Confirmation required

---

### `/games`
**Description**: View games you're playing in
- **API Endpoint**: `GET /api/users/:id/games`
- **Parameters**:
  - `type` (STRING, optional, choices): ["active", "upcoming", "past", "all"]
- **Response**: List of games with next session times

---

## 📅 Session Commands

### `/session create`
**Description**: Schedule a new session
- **API Endpoint**: `POST /api/games/:id/sessions`
- **Parameters**:
  - `game` (STRING, required, autocomplete): Game ID
  - `date` (STRING, required): Date (YYYY-MM-DD)
  - `time` (STRING, required): Time (HH:MM)
  - `duration` (INTEGER, required, min: 1, max: 8): Hours
  - `title` (STRING, optional): Session title
  - `description` (STRING, optional): Session description

---

### `/session list`
**Description**: List upcoming sessions
- **API Endpoint**: `GET /api/sessions`
- **Parameters**:
  - `game` (STRING, optional, autocomplete): Filter by game
  - `timeframe` (STRING, optional, choices): ["today", "this_week", "this_month", "all"]
- **Response**: Chronological list of sessions

---

### `/session start`
**Description**: Start a session (with recording)
- **API Endpoints**: 
  - `PUT /api/sessions/:id/status` {status: "IN_PROGRESS"}
  - Internal recording start
- **Parameters**:
  - `session` (STRING, required, autocomplete): Session ID
- **Requirements**: User must be in voice channel

---

### `/session end`
**Description**: End current session
- **API Endpoint**: `PUT /api/sessions/:id/status` {status: "COMPLETED"}
- **Parameters**:
  - `notes` (STRING, optional): Quick session notes
- **Also**: Stops recording, triggers transcription

---

### `/session cancel`
**Description**: Cancel a scheduled session
- **API Endpoint**: `PUT /api/sessions/:id/status` {status: "CANCELLED"}
- **Parameters**:
  - `session` (STRING, required, autocomplete): Session ID
  - `reason` (STRING, required): Cancellation reason
  - `notify` (BOOLEAN, optional, default: true): Notify players

---

### `/session attendance`
**Description**: Mark attendance for a session
- **API Endpoint**: `POST /api/sessions/:id/attendance`
- **Parameters**:
  - `session` (STRING, required, autocomplete): Session ID
- **Implementation**: Auto-detect from voice channel or show player list

---

### `/session notes`
**Description**: Add or view session notes
- **API Endpoint**: `PUT /api/sessions/:id/notes`
- **Parameters**:
  - `session` (STRING, required, autocomplete): Session ID
  - `action` (STRING, required, choices): ["add", "view"]
  - `notes` (STRING, optional if viewing): Notes content

---

## 📖 Wiki Commands

### `/wiki create`
**Description**: Create a wiki page
- **API Endpoint**: `POST /api/wikis/:wikiId/pages`
- **Parameters**:
  - `game` (STRING, required, autocomplete): Game ID
  - `title` (STRING, required): Page title
  - `type` (STRING, required, choices): ["npc", "location", "item", "lore", "rules", "session_notes", "other"]
  - `visibility` (STRING, optional, choices): ["public", "players_only", "gm_only"]
- **Implementation**: Shows modal for content

---

### `/wiki view`
**Description**: View a wiki page
- **API Endpoint**: `GET /api/wikis/:wikiId/pages/:pageId`
- **Parameters**:
  - `game` (STRING, required, autocomplete): Game ID
  - `page` (STRING, required, autocomplete): Page title or ID
- **Autocomplete**: Search pages via `GET /api/wikis/:wikiId/pages/search?q={query}`

---

### `/wiki search`
**Description**: Search wiki pages
- **API Endpoint**: `GET /api/wikis/:wikiId/pages/search`
- **Parameters**:
  - `game` (STRING, required, autocomplete): Game ID
  - `query` (STRING, required): Search terms
  - `type` (STRING, optional, choices): Page type filter

---

### `/wiki edit`
**Description**: Edit a wiki page
- **API Endpoint**: `PUT /api/wikis/:wikiId/pages/:pageId`
- **Parameters**:
  - `game` (STRING, required, autocomplete): Game ID
  - `page` (STRING, required, autocomplete): Page to edit
- **Implementation**: Shows modal with current content

---

### `/wiki delete`
**Description**: Delete a wiki page
- **API Endpoint**: `DELETE /api/wikis/:wikiId/pages/:pageId`
- **Parameters**:
  - `game` (STRING, required, autocomplete): Game ID
  - `page` (STRING, required, autocomplete): Page to delete
- **Implementation**: Requires confirmation

---

## 🔧 Utility Commands

### `/link`
**Description**: Link Discord account to Arcane Circle
- **Implementation**: Direct to OAuth login
- **No API call needed if OAuth is set up**
- **Response**: Button linking to `{PLATFORM_URL}/login`

---

### `/profile`
**Description**: View your Arcane Circle profile
- **API Endpoint**: `GET /api/users/:id`
- **Parameters**: None
- **Response**: Embed with user stats, linked games, GM status

---

### `/help`
**Description**: Show help for bot commands
- **Parameters**:
  - `category` (STRING, optional, choices): ["gm", "player", "session", "wiki", "all"]
- **Implementation**: Static embeds with command lists

---

### `/stats`
**Description**: View your statistics
- **API Endpoints**: 
  - `GET /api/users/:id/stats`
  - `GET /api/gms/:id/stats` (if GM)
- **Response**: Games played, sessions attended, characters created, GM rating

---

### `/notifications`
**Description**: Manage notification preferences
- **API Endpoint**: `PUT /api/users/:id/preferences`
- **Parameters**:
  - `type` (STRING, required, choices): ["session_reminders", "application_updates", "game_announcements"]
  - `enabled` (BOOLEAN, required): On/off

---

## 🎙️ Recording Commands

### `/record start`
**Description**: Start recording current voice channel
- **Internal Implementation**: No API call
- **Parameters**: None
- **Requirements**: Must be in voice channel, must be GM of active game

---

### `/record stop`
**Description**: Stop recording and process
- **Internal Implementation**: Triggers transcription
- **Parameters**: None

---

### `/transcript view`
**Description**: View a session transcript
- **API Endpoint**: `GET /api/transcripts/:id`
- **Parameters**:
  - `session` (STRING, required, autocomplete): Session ID
  - `format` (STRING, optional, choices): ["summary", "full", "timestamps"]

---

### `/transcript export`
**Description**: Export a transcript
- **API Endpoint**: `GET /api/transcripts/:id/export`
- **Parameters**:
  - `session` (STRING, required, autocomplete): Session ID
  - `format` (STRING, required, choices): ["pdf", "txt", "json", "markdown"]

---

## Implementation Notes

### Autocomplete Handlers
All autocomplete fields should implement handlers that:
1. Query the appropriate API endpoint
2. Return max 25 results
3. Filter based on user input
4. Handle errors gracefully

```typescript
async autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);
  
  if (focused.name === 'game') {
    const games = await arcaneAPI.getUserGames(interaction.user.id);
    const filtered = games
      .filter(g => g.title.toLowerCase().includes(focused.value.toLowerCase()))
      .slice(0, 25)
      .map(g => ({ name: g.title, value: g.id }));
    
    await interaction.respond(filtered);
  }
}
```

### Error Handling
All commands should:
1. Check user is linked before API calls
2. Handle API errors with user-friendly messages
3. Use ephemeral replies for errors
4. Log errors for debugging

### Permission Checks
- GM commands: Verify user is GM of the specified game
- Player commands: Verify user is player in the game
- Wiki edits: Check user has edit permissions
- Session commands: Verify user is participant

### Rate Limiting
Implement rate limiting for:
- Game creation: 5 per hour
- Applications: 10 per hour  
- Wiki edits: 20 per hour
- API calls: 100 per minute overall

---

## Testing Checklist

### Phase 1: Basic Commands
- [ ] `/link` - Links account
- [ ] `/profile` - Shows user profile
- [ ] `/help` - Shows command list

### Phase 2: GM Commands
- [ ] `/gm create` - Creates game
- [ ] `/gm list` - Lists GM's games
- [ ] `/gm edit` - Edits game
- [ ] `/gm applications` - Shows applications
- [ ] `/gm accept` - Accepts player
- [ ] `/gm reject` - Rejects player

### Phase 3: Player Commands
- [ ] `/browse` - Shows available games
- [ ] `/apply` - Submit application
- [ ] `/applications` - View applications
- [ ] `/games` - Shows joined games

### Phase 4: Session Commands
- [ ] `/session create` - Schedules session
- [ ] `/session list` - Shows sessions
- [ ] `/session start` - Starts with recording
- [ ] `/session end` - Ends and saves

### Phase 5: Wiki Commands
- [ ] `/wiki create` - Creates page
- [ ] `/wiki view` - Shows page
- [ ] `/wiki search` - Searches wiki
- [ ] `/wiki edit` - Edits page