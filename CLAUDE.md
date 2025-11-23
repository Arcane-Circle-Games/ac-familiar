# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Discord bot for the Arcane Circle TTRPG marketplace platform. The bot integrates with the platform's API to enable game discovery, account linking, voice recording, and campaign management directly from Discord. Audio transcription is handled by the cloud API after upload.

**Stack**: TypeScript, Discord.js v14, Node.js 18+, Axios (API client)

## Development Commands

### Build & Run
- `npm run build` - Compile TypeScript to dist/
- `npm start` - Run compiled bot (requires build first)
- `npm run dev` - Run bot in development mode with tsx (hot reload disabled)
- `npm run watch` - Run bot with auto-reload on file changes

### Testing & Quality
- `npm test` - Run Jest tests
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Check TypeScript code with ESLint
- `npm run lint:fix` - Auto-fix linting issues
- `npm run format` - Format code with Prettier

## Architecture

### Bot Initialization Flow
1. **src/index.ts** - Entry point, validates config, starts bot
2. **src/bot/index.ts** - ArcaneBot class, loads commands, registers slash commands
3. **src/bot/client.ts** - ArcaneClient extends Discord.js Client, manages command collection

### API Integration Pattern
The bot communicates with the Arcane Circle platform API (Next.js backend) using a singleton API client.

**Key Pattern**: User authentication uses Discord ID lookup:
- User links Discord account via OAuth on web platform
- Bot looks up users via `/users/discord/{discordId}` endpoint
- API client caches user data (5 min TTL) and negative lookups (30 sec TTL)
- All authenticated requests include user context from cache

**API Client** (`src/services/api/client.ts`):
- Singleton instance exported as `apiClient`
- Axios-based with request/response interceptors
- Automatic Vercel bypass token injection
- User caching system for authentication
- Comprehensive error handling and logging

**Service Layer** (`src/services/api/`):
- `games.ts` - Game listings, details, sessions
- `users.ts` - User lookup by Discord ID, GM profiles
- `bookings.ts` - Booking management
- `campaigns.ts`, `sessions.ts`, `recordings.ts` - Domain services
- `index.ts` - Unified `arcaneAPI` export

**Important**: The API base URL is `/api`, but axios client is configured with `baseURL: config.PLATFORM_API_URL` which already includes `/api`. Service methods should NOT prefix endpoints with `/api/` to avoid double `/api/api/` in URLs.

### Command Structure
Commands live in `src/commands/` and export a Command object:
```typescript
export const myCommand: Command = {
  name: 'mycommand',
  description: 'Description here',
  options: [], // Slash command options
  execute: async (interaction: ChatInputCommandInteraction) => {
    // Command logic
  },
  autocomplete?: async (interaction) => { /* optional */ }
}
```

Commands are registered in `src/bot/index.ts` in the `loadCommands()` method.

**Special Case**: Commands with complex builders (like `game-info`) export both the command object and a `SlashCommandBuilder` instance (e.g., `gameInfoCommandData`).

### Recording System (Bot's Role)
The bot records voice channel audio and uploads it to the platform. **Transcription is handled entirely by the platform API** after upload.

**User Commands**:
- `/record action:start [game] [session]` - Start recording current voice channel
- `/record action:stop` - Stop recording and upload to platform

**Architecture Components** (`src/services/`):
- `RecordingManager` - Session orchestration, upload coordination
- `BasicRecordingService` - Audio capture, segmentation, streaming uploads
- `VoiceConnectionManager` - Discord voice connection lifecycle
- `RecordingUploadService` - File uploads to Vercel Blob Storage

**Recording Flow**:

1. **Start** (`/record start`):
   - Bot joins voice channel via `@discordjs/voice`
   - Creates session with UUID
   - Initializes live recording via platform API → gets `recordingId`
   - Subscribes to each user's Opus audio stream (continuous, per-user)

2. **During Recording**:
   - **Decode**: Opus packets → PCM audio (48kHz stereo) via `@discordjs/opus`
   - **Segment**: Split audio on silence gaps (configurable threshold)
   - **Stream Upload**: As each segment completes:
     - Convert PCM buffers → WAV file (in `/tmp`)
     - Upload to Vercel Blob via platform API
     - Delete local file immediately
   - **Memory Management**: Buffers freed after WAV conversion to prevent memory leaks

3. **Stop** (`/record stop`):
   - Finalize all active segments
   - Upload any remaining segments
   - Call platform API to finalize recording
   - Bot leaves voice channel
   - Returns URL to view/manage recording

**Key Implementation Details**:
- **Segmentation**: Configurable via `RECORDING_SILENCE_THRESHOLD` (default: 500ms gap)
- **Min Segment Duration**: `RECORDING_MIN_SEGMENT_DURATION` (default: 500ms)
- **Max Segment Size**: `RECORDING_MAX_SEGMENT_SIZE_MB` (forces split if exceeded)
- **Upload Strategy**: Streaming (live) preferred, batch fallback if API unavailable
- **Crash Recovery**: Bot detects orphaned recordings on startup and resumes them
- **File Storage**: Temporary files in `/tmp/recordings/{sessionId}/` (deleted after upload)

**Important Files**:
- Commands: `src/commands/record.ts:91-386`
- Session Logic: `src/services/recording/RecordingManager.ts:22-492`
- Audio Processing: `src/services/recording/BasicRecordingService.ts:106-1051`
- Upload: `src/services/upload/RecordingUploadService.ts`

**Platform Integration**:
Bot's responsibility ends at upload. The platform API handles:
- Recording metadata storage (database)
- Transcription processing (WebAssembly/cloud)
- Playback URL generation
- Recording management UI

### Game Announcement Scheduler
The bot includes an automated system for announcing newly published games to a designated Discord channel.

**How It Works**:
1. **Cron Job** - Runs on configurable schedule (default: every 3 hours)
2. **API Polling** - Fetches recently published games from `/api/games/recent?minutes={interval}`
3. **Discord Posting** - Posts rich embeds to configured channel with game details
4. **Rate Limiting** - Respects Discord's 5 messages per 5 seconds limit

**Architecture** (`src/services/scheduled/`):
- `GameAnnouncementScheduler.ts` - Main scheduler using node-cron
- Runs automatically on bot startup if `GAME_ANNOUNCEMENT_ENABLED=true`
- Single global instance (no duplicate announcements across servers)

**Configuration** (`.env`):
```
GAME_ANNOUNCEMENT_ENABLED=true|false
GAME_ANNOUNCEMENT_CHANNEL_ID=your_channel_id
GAME_ANNOUNCEMENT_INTERVAL_HOURS=3  # 1-24 hours
```

**Testing**:
- Use `/test-announcements` command to manually trigger a check
- No duplicate prevention (relies on API time-window filtering)
- Announcements include: title, system, GM, price, schedule, availability, link

**Note**: The scheduler runs once globally regardless of how many Discord servers the bot is in. Only one channel receives announcements (configured via channel ID).

### Type System
- `src/types/api.ts` - API request/response interfaces matching platform schema
- `src/types/discord.ts` - Discord-specific extensions
- `src/types/index.ts` - Unified exports

TypeScript paths are configured with `@/` aliases:
- `@/bot/*` → `src/bot/*`
- `@/commands/*` → `src/commands/*`
- `@/services/*` → `src/services/*`
- etc.

### Environment Configuration
Configuration uses Zod for validation (`src/utils/config.ts`). Required variables:

```
DISCORD_TOKEN, DISCORD_CLIENT_ID
PLATFORM_API_URL, PLATFORM_WEB_URL, VERCEL_BYPASS_TOKEN, BOT_API_KEY
NODE_ENV, LOG_LEVEL
```

See `.env.example` for complete list.

### Logging
Winston-based logging system (`src/utils/logger.ts`):
- `logInfo()`, `logError()`, `logDebug()` - General logging
- `logDiscordEvent()` - Discord-specific events
- `logAPICall()` - API request/response tracking with timing
- Logs include structured metadata for debugging

## Implementation Guidelines

### Adding New Commands
1. Create command file in `src/commands/`
2. Import and add to commands array in `src/bot/index.ts:loadCommands()`
3. If using SlashCommandBuilder, handle registration in `registerCommands()`

### Adding API Endpoints
1. Add TypeScript types to `src/types/api.ts`
2. Create or extend service in `src/services/api/`
3. Export methods via `src/services/api/index.ts` (arcaneAPI object)
4. Use `arcaneAPI.methodName()` in commands

### Error Handling Pattern
- API errors are caught and converted to `ApiError` type
- Commands should try/catch and reply with user-friendly ephemeral messages
- Use `logError()` for errors that need investigation
- Avoid exposing internal error details to Discord users

### Platform Integration Notes
- Users must link Discord accounts via OAuth on web platform (not via bot command)
- `/link` command guides users to the linking flow
- Bot verifies linking status via `/users/discord/{discordId}` lookup
- Use `PLATFORM_WEB_URL` for constructing web platform links in Discord embeds

### Recording Session Notes
- Recording requires bot to join voice channel
- Recordings are stored in Vercel Blob Storage
- Transcriptions are asynchronous (queue-based with Bull/Redis)
- Sessions are tracked by UUID, associated with platform campaign/session entities

## API Reference

Primary API endpoint documentation: `api-endpoints.md` (69 endpoints across 9 functional areas)

Key endpoints used by bot:
- `GET /api/games` - List games with filters
- `GET /api/games/{id}` - Game details
- `GET /api/users/discord/{discordId}` - User lookup by Discord ID
- `GET /api/gms/{gmId}` - GM profile
- Campaign, session, recording, booking management endpoints (see api-endpoints.md)

## Testing Strategy

Use `/test-api` command to verify:
- API connectivity
- Health check endpoint
- Games listing
- User lookup functionality
- Vercel bypass token validity

For development, set `DISCORD_GUILD_ID` to register commands instantly to a test guild (vs. global registration which takes ~1 hour).

## Bot Commands Reference

**Game Discovery:**
- `/games` - Browse available games with filtering/pagination
- `/game-info game:{name}` - Get detailed info about a specific game
- `/gm` - Browse GMs and their offerings

**Game Management:**
- `/join-game game-id:{id}` - Book and join a game (requires payment method)
- `/leave-game game:{autocomplete}` - Leave a game you've joined (shows your active bookings)

**Account Management:**
- `/link` - Get link to connect Discord account via OAuth
- `/test-api` - Test API connectivity and authentication

**Recording:**
- `/record action:start` - Start recording voice channel
- `/record action:stop-save` - Stop and save recording (uploads to platform API)
- `/download-recording session-id:{id}` - Get download links for recording files

**Note**: Transcription is handled automatically by the platform API after upload.

**Admin/Testing:**
- `/test-announcements` - Manually trigger game announcement check
- `/ping` - Check bot responsiveness

## Common Patterns

**Authenticated Command Pattern**:
```typescript
// Verify user is linked
const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
if (!user) {
  return interaction.reply({
    content: 'Account not linked. Use /link first.',
    ephemeral: true
  });
}
```

**Paginated Response Pattern**:
Use Discord ActionRows with ButtonBuilders for navigation (see `/games` command implementation).

**Rich Embeds Pattern**:
Use EmbedBuilder for formatted responses with game/campaign information (see `/game-info` command).

## Known Limitations

- Account linking requires OAuth via web platform (405 on `/users/link-discord` endpoint)
- `/systems` endpoint may not exist on platform API
- Recording system requires voice intents and opus dependencies
- Transcription is handled by the platform API (not locally)
- as a rule, if you get back an unexpected api response, just console log the entire response to see the structure better