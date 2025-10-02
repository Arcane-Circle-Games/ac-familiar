# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Discord bot for the Arcane Circle TTRPG marketplace platform. The bot integrates with the platform's API to enable game discovery, account linking, voice recording with transcription, and campaign management directly from Discord.

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

### Database (PostgreSQL + Prisma)
- `npm run db:generate` - Generate Prisma client from schema
- `npm run db:push` - Push schema changes to database
- `npm run db:migrate` - Create and run migrations
- `npm run db:reset` - Reset database (destructive)

### Docker Services
- `npm run docker:up` - Start PostgreSQL, Redis, pgAdmin, Redis Commander
- `npm run docker:down` - Stop all Docker services

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

### Recording System Architecture
**Voice Recording Flow**:
1. **RecordingManager** (`src/services/recording/RecordingManager.ts`) - Orchestrates recording sessions
2. **VoiceConnectionManager** (`src/services/voice/VoiceConnectionManager.ts`) - Manages Discord voice connections
3. **BasicRecordingService** (`src/services/recording/BasicRecordingService.ts`) - Handles audio capture, processing, and storage

**Key Features**:
- Per-user audio stream capture from Discord voice channels
- PCM audio conversion using @discordjs/opus
- Optional transcription via OpenAI Whisper API
- Integration with platform API to store recordings and transcriptions
- Session tracking with UUIDs

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
DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID
PLATFORM_API_URL, PLATFORM_WEB_URL, VERCEL_BYPASS_TOKEN
DATABASE_URL, REDIS_URL
OPENAI_API_KEY (for transcription)
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
- Transcription requires OpenAI API key and credits
