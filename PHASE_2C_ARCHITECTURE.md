# Phase 2C: Cloud Storage & Distribution - Architecture Plan

**Status:** 📋 Planning Complete - Ready for Implementation
**Date:** October 2, 2025
**Approach:** Hybrid (Option 3) - Bot uploads, API processes

---

## Overview

Phase 2C moves recording storage and transcription processing from local disk to the cloud. The bot focuses on recording and uploading, while the platform API handles storage, transcription, and distribution.

### Key Goals
1. ✅ Bot uploads audio immediately after recording
2. ✅ API stores audio in Vercel Blob storage
3. ✅ API processes transcription asynchronously with job queue
4. ✅ Users get download URLs for audio and transcripts
5. ✅ Recordings linked to campaigns/sessions in platform database

---

## Architecture Decision: Hybrid Approach (Option 3)

### Why Not Local Processing?
**Option 1 (Bot does everything):**
- ❌ Bot needs OpenAI key (security risk)
- ❌ Bot uses CPU/memory during transcription
- ❌ Multiple Discord servers = multiple transcription costs
- ❌ Can't retry failed transcriptions easily

**Option 2 (API does everything immediately):**
- ❌ Synchronous processing blocks upload response
- ❌ Timeouts on large files
- ❌ No retry mechanism

### ✅ Why Hybrid?
**Bot responsibilities:**
- Record voice audio
- Export to WAV files
- Upload to API
- Show status to users

**API responsibilities:**
- Store audio in Vercel Blob
- Queue transcription jobs
- Process with OpenAI Whisper
- Store transcripts in database
- Generate download URLs
- Send completion notifications

**Benefits:**
- Separation of concerns
- Bot stays lightweight and focused
- Scalable (one API, many bots)
- Async processing with retries
- OpenAI key stays secure on server
- Can add alternative transcription services later

---

## System Flow

### Recording Flow
```
1. User: /record-test action:start
   └─> Bot joins voice channel

2. [Users speak in voice]
   └─> Bot records continuously per user

3. User: /record-test action:stop-save
   └─> Bot stops recording
   └─> Bot exports to WAV files locally
   └─> Bot uploads to API: POST /api/recordings
   └─> API stores in Vercel Blob
   └─> API creates database record
   └─> API queues transcription job
   └─> API returns: { recordingId, downloadUrls, status: "processing" }
   └─> Bot replies: "✅ Uploaded! Transcription queued..."
   └─> Bot deletes local files

4. [API transcription worker]
   └─> Job processor fetches from queue
   └─> Downloads audio from Blob
   └─> Calls OpenAI Whisper API
   └─> Stores transcript in database
   └─> Updates recording status: "completed"
   └─> Sends webhook to bot (optional)

5. Bot receives webhook (or user checks status)
   └─> Bot sends Discord message: "📝 Transcription complete! View: [URL]"
```

---

## Component Architecture

### Bot Side (ac-familiar)

#### New Services
1. **RecordingUploadService** (`src/services/upload/RecordingUploadService.ts`)
   - Upload audio files to API
   - Handle multipart file uploads
   - Track upload progress
   - Retry failed uploads

2. **WebhookListener** (`src/services/webhooks/WebhookListener.ts`)
   - Express endpoint to receive webhooks
   - Verify webhook signatures
   - Handle transcription completion events
   - Send Discord notifications

#### Modified Services
1. **RecordingManager**
   - After `stopAndExport()`, call upload service
   - Store recording ID from API response
   - Remove local files after successful upload

2. **record-test command**
   - Show cloud URLs instead of local paths
   - Add `check-status` action to poll API
   - Link to web platform for viewing

---

### API Side (Platform - Vercel/Next.js)

See `PHASE_2C_API_SPECIFICATION.md` for complete API documentation.

#### New Endpoints
1. `POST /api/recordings` - Upload recording
2. `GET /api/recordings/:id` - Get recording details
3. `GET /api/recordings/:id/download` - Download audio
4. `GET /api/recordings/:id/transcript` - Get transcript
5. `POST /api/recordings/:id/retranscribe` - Re-run transcription
6. `GET /api/recordings` - List recordings (filtered)

#### New Services
1. **RecordingStorageService**
   - Upload to Vercel Blob
   - Generate download URLs
   - Manage blob lifecycle

2. **TranscriptionWorker** (Bull job processor)
   - Fetch audio from Blob
   - Call OpenAI Whisper
   - Store transcript in PostgreSQL
   - Update recording status
   - Send webhooks

3. **WebhookDispatcher**
   - Send transcription completion webhooks
   - Retry failed webhooks
   - Track delivery status

#### Database Schema
```prisma
model Recording {
  id              String   @id @default(uuid())
  sessionId       String   @unique
  discordGuildId  String
  discordChannelId String
  guildName       String

  // Storage
  blobUrls        Json     // { audio: [...], transcript: "..." }
  status          RecordingStatus // uploading, processing, completed, failed

  // Metadata
  duration        Int      // milliseconds
  participantCount Int
  participants    Json     // [{ userId, username, audioUrl }]

  // Transcription
  transcriptText  String?  @db.Text
  transcriptJson  Json?
  wordCount       Int?
  confidence      Float?

  // Timestamps
  recordedAt      DateTime
  uploadedAt      DateTime?
  processedAt     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Relations
  campaignId      String?
  campaign        Campaign? @relation(fields: [campaignId], references: [id])
  sessionId       String?
  session         Session? @relation(fields: [sessionId], references: [id])

  @@index([discordGuildId])
  @@index([campaignId])
  @@index([status])
}

enum RecordingStatus {
  uploading
  processing
  completed
  failed
}
```

---

## Data Flow Details

### Upload Request (Bot → API)
```typescript
POST /api/recordings
Content-Type: multipart/form-data

// Form fields
metadata: {
  sessionId: string
  guildId: string
  guildName: string
  channelId: string
  duration: number
  participants: Array<{
    userId: string
    username: string
  }>
  recordedAt: string (ISO)
}

// Files (multiple)
files[0]: MyServer_10-02-25_User1.wav
files[1]: MyServer_10-02-25_User2.wav
```

### Upload Response (API → Bot)
```typescript
{
  success: true,
  recording: {
    id: "rec_abc123",
    sessionId: "550e8400-e29b...",
    status: "processing",
    downloadUrls: {
      audio: [
        "https://blob.vercel-storage.com/...",
        "https://blob.vercel-storage.com/..."
      ]
    },
    viewUrl: "https://arcanecircle.games/recordings/rec_abc123"
  }
}
```

### Webhook (API → Bot)
```typescript
POST https://bot-webhook-url/webhooks/recording-completed
X-Webhook-Signature: sha256=...

{
  event: "recording.transcription.completed",
  recordingId: "rec_abc123",
  sessionId: "550e8400-e29b...",
  guildId: "123456789",
  channelId: "987654321",
  transcript: {
    wordCount: 1542,
    confidence: 0.94,
    downloadUrl: "https://blob.vercel-storage.com/transcript.json"
  },
  viewUrl: "https://arcanecircle.games/recordings/rec_abc123"
}
```

---

## Implementation Phases

### Phase 2C.1: Upload Infrastructure (Bot Side)
**Deliverables:**
- RecordingUploadService
- API client integration
- Upload after recording
- Delete local files after upload
- Show cloud URLs in Discord

**Testing:**
- Record → Upload → Verify blob storage
- Check API database record created
- Verify local cleanup

### Phase 2C.2: Storage & Queue (API Side)
**Deliverables:**
- POST /api/recordings endpoint
- Vercel Blob upload
- Database record creation
- Bull job queue setup
- Job queuing on upload

**Testing:**
- Upload via Postman
- Verify blob storage
- Check DB record
- Verify job queued

### Phase 2C.3: Transcription Worker (API Side)
**Deliverables:**
- Bull job processor
- OpenAI Whisper integration
- Transcript storage
- Status updates
- Error handling & retries

**Testing:**
- Process queued job
- Verify transcript in DB
- Check error handling
- Test retries

### Phase 2C.4: Webhooks & Notifications (Both Sides)
**Deliverables:**
- Webhook dispatcher (API)
- Webhook receiver (Bot)
- Discord notifications
- Signature verification

**Testing:**
- End-to-end flow
- Verify Discord notification
- Test webhook failures

### Phase 2C.5: Viewing & Management (API Side)
**Deliverables:**
- GET endpoints for recordings
- Download URLs
- Web UI for viewing
- Search/filter

**Testing:**
- Access via web
- Download files
- View transcripts

---

## Configuration

### Bot (.env)
```bash
# Existing
DISCORD_TOKEN=...
PLATFORM_API_URL=https://arcanecircle.games/api

# New for Phase 2C
RECORDING_UPLOAD_ENABLED=true
RECORDING_AUTO_UPLOAD=true  # Upload after stop-save
RECORDING_KEEP_LOCAL_COPY=false  # Delete after upload
WEBHOOK_LISTENER_PORT=3001
WEBHOOK_SECRET=shared-secret-with-api
```

### API (.env)
```bash
# Existing
DATABASE_URL=...
REDIS_URL=...
OPENAI_API_KEY=...

# New for Phase 2C
BLOB_READ_WRITE_TOKEN=vercel_blob_token
TRANSCRIPTION_QUEUE_NAME=transcription-jobs
BOT_WEBHOOK_URL=https://bot-server.com/webhooks/recording-completed
BOT_WEBHOOK_SECRET=shared-secret-with-bot
```

---

## Security Considerations

### Bot → API
- ✅ API authentication via existing system (Discord user lookup)
- ✅ File size limits (50MB per file)
- ✅ File type validation (WAV only)
- ✅ Rate limiting on upload endpoint

### API → Bot (Webhooks)
- ✅ HMAC signature verification
- ✅ Replay attack prevention (timestamp)
- ✅ Secret shared between API and bot
- ✅ HTTPS required

### Storage
- ✅ Vercel Blob private by default
- ✅ Signed URLs with expiration (24 hours)
- ✅ Access control via API endpoints
- ✅ User authentication required for viewing

---

## Error Handling

### Upload Failures
- Bot retries 3x with exponential backoff
- If all fail, keep local copy
- Show error to user with support link

### Transcription Failures
- API retries job 3x
- If all fail, mark status as "failed"
- Send failure webhook to bot
- Allow manual retry via web UI

### Webhook Failures
- API retries 5x with exponential backoff
- Bot can poll API for status if webhook missed
- User can manually check via command

---

## Monitoring & Observability

### Metrics to Track
- Upload success rate
- Upload duration (p50, p95, p99)
- Transcription job duration
- Transcription success rate
- Webhook delivery success rate
- Storage costs (Vercel Blob)
- API costs (OpenAI)

### Logging
- All uploads logged with session ID
- Transcription job start/complete/fail
- Webhook deliveries
- Errors with full context

---

## Cost Estimates

### Vercel Blob Storage
- **Audio:** ~10MB per minute (WAV, stereo)
- **Example:** 30-minute session with 3 speakers = 90 minutes = 900MB
- **Cost:** $0.15/GB/month = ~$0.14/session/month
- **With 100 sessions/month:** ~$14/month

### OpenAI Whisper API
- **Cost:** $0.006 per minute
- **Example:** 30-minute session with 3 speakers = 90 minutes = $0.54
- **With 100 sessions/month:** ~$54/month

### Total Estimated Costs
- **Storage:** ~$14/month (100 sessions)
- **Transcription:** ~$54/month (100 sessions)
- **Total:** ~$68/month for 100 recording sessions

Scale linearly with usage.

---

## Future Enhancements (Phase 3+)

### Additional Formats
- FLAC (lossless compression, ~50% smaller)
- MP3 (lossy, 90% smaller)
- User-selectable format preference

### Enhanced Transcription
- Speaker diarization (identify speakers automatically)
- Sentiment analysis
- Topic extraction
- Action item detection

### Advanced Distribution
- RSS feed generation (podcast-style)
- Public/private sharing settings
- Embed players for web
- Email notifications

### Retention Policies
- Auto-delete after X days
- Archive to cheaper storage
- User-configurable retention

---

## Success Criteria

Phase 2C is complete when:

- ✅ Bot uploads recordings to API
- ✅ API stores audio in Vercel Blob
- ✅ API queues and processes transcription jobs
- ✅ Transcripts stored in database
- ✅ Users get download URLs
- ✅ Webhooks notify bot when complete
- ✅ Discord notifications show completion
- ✅ Web UI displays recordings and transcripts
- ✅ Local files cleaned up after upload
- ✅ Error handling and retries work
- ✅ End-to-end flow tested

---

## Related Documentation

- **API Spec:** `PHASE_2C_API_SPECIFICATION.md` (for platform team)
- **Previous Phases:** `PHASE_2A_TESTING.md`, `PHASE_2B_IMPLEMENTATION_SUMMARY.md`
- **Overall Plan:** `RECORDING_PHASES.md`
- **Project Overview:** `CLAUDE.md`
