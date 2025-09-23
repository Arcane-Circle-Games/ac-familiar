# D&D Session Recording Implementation Progress

## Overview
Building a system to record 3+ hour D&D sessions with per-speaker separation, transcribe them using Deepgram API, and consolidate into chronological transcripts.

## Architecture Plan (5 Phases)

### Phase 1: ✅ COMPLETED - Basic Discord Voice Recording Infrastructure
**Goal**: Capture per-speaker audio streams from Discord voice channels and store in memory

**What was built:**
- `src/services/voice/VoiceConnectionManager.ts` - Discord voice connection management
- `src/services/recording/BasicRecordingService.ts` - Per-speaker audio capture with in-memory storage
- `src/services/recording/RecordingManager.ts` - High-level recording orchestration
- `src/commands/record-test.ts` - Test command (`/record-test start|stop|status`)

**Key Features Delivered:**
- ✅ Per-speaker audio separation (each Discord user gets own stream)
- ✅ Session lifecycle management (start/stop/cleanup)
- ✅ Real-time monitoring (segments, participants, memory usage)
- ✅ Discord slash command integration
- ✅ Error handling with emergency cleanup

**Testing Status:**
- ✅ Code compiles successfully
- ✅ Bot starts without errors
- 🚧 Ready for live testing (need Discord credentials in `.env`)

### Phase 2: 🚧 PENDING - Vercel Blob Storage Integration
**Goal**: Replace in-memory storage with Vercel Blob for persistence

**Planned changes:**
- Modify `BasicRecordingService` to upload audio segments to Vercel Blob
- Add blob cleanup after transcription
- Update session metadata storage

**Dependencies to install:**
```bash
npm install @vercel/blob
```

**Environment variables needed:**
```
BLOB_READ_WRITE_TOKEN=vercel_blob_token_here
```

### Phase 3: 🚧 PENDING - Deepgram Transcription Service (Abstract)
**Goal**: Build transcription service with provider abstraction

**Planned structure:**
```typescript
interface TranscriptionProvider {
  transcribe(audioBuffer: Buffer): Promise<TranscriptResult>;
}

class DeepgramProvider implements TranscriptionProvider {
  // Deepgram-specific implementation
}
```

**Dependencies to install:**
```bash
npm install @deepgram/sdk
```

**Environment variables needed:**
```
DEEPGRAM_API_KEY=your_deepgram_key
```

### Phase 4: 🚧 PENDING - Chronological Transcript Consolidation
**Goal**: Merge per-speaker transcripts into single chronological document

**Algorithm:**
1. Create timeline of all words with absolute timestamps
2. Sort chronologically across all speakers
3. Group into speaker blocks for readability
4. Generate markdown output

### Phase 5: 🚧 PENDING - Integration Testing & Production Commands
**Goal**: End-to-end testing and production-ready commands

**Plans:**
- Replace `/record-test` with production `/record` command
- Add database persistence for sessions
- Error handling and retry logic
- Performance optimization for long sessions

## Current Implementation Details

### File Structure
```
src/
├── services/
│   ├── voice/
│   │   ├── VoiceConnectionManager.ts ✅
│   │   └── index.ts ✅
│   └── recording/
│       ├── BasicRecordingService.ts ✅
│       ├── RecordingManager.ts ✅
│       └── index.ts ✅
├── commands/
│   └── record-test.ts ✅
└── bot/
    └── index.ts (updated with new command) ✅
```

### Testing Commands
- `/record-test start` - Begin recording in current voice channel
- `/record-test stop` - Stop recording and show statistics
- `/record-test status` - View current recording status

### Key Classes

**VoiceConnectionManager**
- Manages Discord voice connections
- Handles join/leave/cleanup lifecycle
- Connection state monitoring

**BasicRecordingService**
- Captures per-user audio streams via `VoiceReceiver`
- Stores segments with timestamps in memory
- Tracks participant statistics

**RecordingManager**
- Orchestrates voice connection + recording
- Session tracking by channel
- Memory usage monitoring
- Emergency cleanup capabilities

## Setup Instructions

### Prerequisites
1. Discord bot token and client ID
2. Vercel PostgreSQL database
3. Environment configuration

### Environment Setup
1. Copy example: `cp .env.example .env`
2. Fill in required values:
   ```
   DISCORD_TOKEN=your_discord_bot_token
   DISCORD_CLIENT_ID=your_discord_client_id
   DATABASE_URL=your_vercel_postgres_url
   ```

### Running
```bash
npm run dev
```

## Next Steps (Tomorrow)

1. **Test Phase 1**: Verify recording works with real Discord bot
2. **Begin Phase 2**: Implement Vercel Blob storage
3. **Set up Deepgram**: Get API key for Phase 3

## Architecture Notes

### Per-Speaker Separation
Uses Discord's `VoiceReceiver` to subscribe to individual user audio streams. Each user gets a separate `AudioSegment` with their own buffer chunks and timestamps.

### Memory Management
Currently stores all audio in memory. Phase 2 will stream directly to Vercel Blob to handle 3+ hour sessions without memory issues.

### Transcript Reconstruction
Will use word-level timestamps from Deepgram to create a chronological timeline across all speakers, then group into readable speaker blocks.

### Error Handling
Comprehensive error handling with graceful degradation and emergency cleanup to prevent memory leaks or stuck connections.

## Reference Implementation
The original plan document is in `documentation/post-process-transcription-vercel.md` - this progress doc reflects the phased implementation of that architecture.