# Phase 2C API Specification - For Platform Team

**Target Audience:** Next.js/Vercel Platform Developers
**Status:** 📋 Specification Complete - Ready for Implementation
**Date:** October 2, 2025

---

## Overview

This document specifies the API endpoints and background workers needed to support Discord bot recording uploads, storage, and transcription processing.

### What the Bot Does
1. Records voice audio in Discord
2. Exports to WAV files
3. **Uploads to your API** (this spec)
4. Shows users download URLs
5. Receives webhooks when transcription completes

### What the API Needs to Do
1. Accept multipart file uploads from bot
2. Store audio files in Vercel Blob storage
3. Create database records
4. Queue transcription jobs (Bull/Redis)
5. Process transcriptions asynchronously
6. Send webhooks to bot when complete
7. Provide viewing/download endpoints

---

## Architecture Summary

```
Bot → POST /api/recordings → Vercel Blob + PostgreSQL + Bull Queue
                           ↓
                    Transcription Worker
                           ↓
                    OpenAI Whisper API
                           ↓
                    Update PostgreSQL
                           ↓
                    Webhook to Bot
```

---

## Database Schema

### Recording Model (Prisma)

```prisma
model Recording {
  id              String   @id @default(uuid())
  sessionId       String   @unique // From bot (UUID)

  // Discord info
  discordGuildId  String
  discordGuildName String
  discordChannelId String
  discordUserId   String   // User who started recording

  // Storage URLs (Vercel Blob)
  blobUrls        Json     // { audio: ["url1", "url2"], transcript: "url" }

  // Status tracking
  status          RecordingStatus // uploading, processing, completed, failed

  // Recording metadata
  duration        Int      // milliseconds
  participantCount Int
  participants    Json     // [{ userId, username, audioUrl }]
  recordedAt      DateTime

  // Transcription data
  transcriptText  String?  @db.Text  // Full markdown text
  transcriptJson  Json?    // Structured transcript with timestamps
  wordCount       Int?
  confidence      Float?   // 0-1, average confidence score

  // Processing info
  uploadedAt      DateTime?
  processedAt     DateTime?
  errorMessage    String?
  retryCount      Int      @default(0)

  // Timestamps
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Relations (optional - link to campaigns/sessions later)
  campaignId      String?
  campaign        Campaign? @relation(fields: [campaignId], references: [id])
  gameSessionId   String?
  gameSession     GameSession? @relation(fields: [gameSessionId], references: [id])

  @@index([discordGuildId])
  @@index([discordUserId])
  @@index([status])
  @@index([campaignId])
  @@index([recordedAt])
}

enum RecordingStatus {
  uploading      // Initial state during upload
  processing     // Transcription job queued/running
  completed      // Everything done
  failed         // Transcription or upload failed
}
```

---

## API Endpoints

### 1. Upload Recording

**Endpoint:** `POST /api/recordings`

**Authentication:** Required (Discord user lookup via existing auth system)

**Content-Type:** `multipart/form-data`

**Request Body:**

```typescript
// Form field: metadata (JSON string)
{
  sessionId: string         // UUID from bot
  guildId: string          // Discord guild ID
  guildName: string        // Discord guild name
  channelId: string        // Discord channel ID
  userId: string           // User who started recording
  duration: number         // Total session duration (ms)
  recordedAt: string       // ISO timestamp
  participants: Array<{
    userId: string         // Discord user ID
    username: string       // Discord username/nickname
  }>
}

// Files: audio files (multiple WAV files)
files: File[]  // ServerName_MM-dd-YY_Username.wav
```

**Response (200 OK):**

```typescript
{
  success: true,
  recording: {
    id: string              // Database ID (rec_abc123)
    sessionId: string       // Original session UUID
    status: "processing",
    downloadUrls: {
      audio: string[]       // Vercel Blob URLs for each audio file
    },
    viewUrl: string        // Web platform URL to view recording
    estimatedProcessingTime: string  // e.g., "2-3 minutes"
  }
}
```

**Response (400 Bad Request):**

```typescript
{
  success: false,
  error: "Invalid request",
  details: string
}
```

**Response (413 Payload Too Large):**

```typescript
{
  success: false,
  error: "Files too large",
  maxSize: "50MB per file"
}
```

**Implementation Notes:**
- Validate file types (WAV only)
- Limit file size (50MB per file recommended)
- Upload files to Vercel Blob storage
- Generate signed URLs (24-hour expiration)
- Create database record with status="processing"
- Queue transcription job in Bull
- Return immediately (don't wait for transcription)

---

### 2. Get Recording Details

**Endpoint:** `GET /api/recordings/:id`

**Authentication:** Required

**Response (200 OK):**

```typescript
{
  success: true,
  recording: {
    id: string
    sessionId: string
    status: RecordingStatus

    // Metadata
    guildName: string
    duration: number
    participantCount: number
    recordedAt: string
    uploadedAt: string
    processedAt: string | null

    // Download URLs
    downloadUrls: {
      audio: string[]        // Signed URLs for audio files
      transcript: string     // Signed URL for transcript JSON
      transcriptMd: string   // Signed URL for transcript Markdown
    }

    // Transcription (if completed)
    transcript: {
      text: string           // Full markdown text
      wordCount: number
      confidence: number
      participants: Array<{
        username: string
        wordCount: number
        segments: number
      }>
    } | null

    // View URL
    viewUrl: string
  }
}
```

**Response (404 Not Found):**

```typescript
{
  success: false,
  error: "Recording not found"
}
```

---

### 3. Download Audio File

**Endpoint:** `GET /api/recordings/:id/download/:fileIndex`

**Authentication:** Required

**Parameters:**
- `id`: Recording ID
- `fileIndex`: Index of audio file (0-based) or "all" for zip

**Response:** Redirect (302) to signed Vercel Blob URL

**Alternative:** Return signed URL in JSON
```typescript
{
  downloadUrl: string,  // Signed URL, expires in 1 hour
  filename: string,
  size: number
}
```

---

### 4. Get Transcript

**Endpoint:** `GET /api/recordings/:id/transcript`

**Authentication:** Required

**Query Parameters:**
- `format`: "json" | "markdown" | "text" (default: "json")

**Response (200 OK) - JSON format:**

```typescript
{
  success: true,
  transcript: {
    sessionId: string
    transcribedAt: string
    wordCount: number
    confidence: number
    fullText: string      // Plain text, no formatting
    participants: Array<{
      userId: string
      username: string
      wordCount: number
      text: string
      segments: Array<{
        text: string
        start: number     // seconds
        end: number
        confidence: number
      }>
    }>
  }
}
```

**Response (200 OK) - Markdown format:**

```typescript
Content-Type: text/markdown

# Session Transcript

**[00:15] JohnDoe:** Hello everyone...
**[00:18] JaneSmith:** Thanks for having me...
```

---

### 5. List Recordings

**Endpoint:** `GET /api/recordings`

**Authentication:** Required

**Query Parameters:**
- `guildId`: Filter by Discord guild
- `userId`: Filter by user who created recording
- `campaignId`: Filter by campaign (optional)
- `status`: Filter by status
- `limit`: Number of results (default: 20, max: 100)
- `offset`: Pagination offset

**Response (200 OK):**

```typescript
{
  success: true,
  recordings: Array<{
    id: string
    sessionId: string
    guildName: string
    status: RecordingStatus
    duration: number
    participantCount: number
    wordCount: number | null
    recordedAt: string
    viewUrl: string
  }>,
  pagination: {
    total: number
    limit: number
    offset: number
  }
}
```

---

### 6. Retry Transcription

**Endpoint:** `POST /api/recordings/:id/retranscribe`

**Authentication:** Required (admin or recording owner)

**Response (200 OK):**

```typescript
{
  success: true,
  message: "Transcription job queued",
  estimatedTime: string
}
```

**Response (409 Conflict):**

```typescript
{
  success: false,
  error: "Transcription already in progress"
}
```

---

## Background Worker: Transcription Processor

### Job Queue Setup (Bull + Redis)

**Queue Name:** `transcription-jobs`

**Job Data:**
```typescript
{
  recordingId: string,    // Database ID
  audioUrls: string[],    // Vercel Blob URLs
  sessionStartTime: number,
  participants: Array<{
    userId: string,
    username: string,
    audioUrl: string
  }>
}
```

### Worker Implementation

**File:** `src/workers/transcription-worker.ts`

```typescript
import { Job } from 'bull';
import { OpenAI } from 'openai';
import { prisma } from '@/lib/prisma';
import { downloadFromBlob, uploadToBlob } from '@/lib/blob-storage';

interface TranscriptionJob {
  recordingId: string;
  audioUrls: string[];
  sessionStartTime: number;
  participants: Array<{
    userId: string;
    username: string;
    audioUrl: string;
  }>;
}

export async function processTranscription(job: Job<TranscriptionJob>) {
  const { recordingId, audioUrls, participants } = job.data;

  try {
    console.log(`Starting transcription for recording ${recordingId}`);

    // Initialize OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Transcribe each participant's audio
    const transcripts = [];
    for (const participant of participants) {
      job.progress(transcripts.length / participants.length * 50);

      // Download audio from Vercel Blob
      const audioBuffer = await downloadFromBlob(participant.audioUrl);

      // Create temporary file (Whisper API requires file)
      const tempFile = await createTempFile(audioBuffer, 'audio.wav');

      // Transcribe with OpenAI Whisper
      const response = await openai.audio.transcriptions.create({
        file: tempFile,
        model: 'whisper-1',
        response_format: 'verbose_json',
        language: 'en'
      });

      // Parse response
      const transcript = {
        userId: participant.userId,
        username: participant.username,
        text: response.text,
        segments: response.segments.map(seg => ({
          text: seg.text,
          start: seg.start,
          end: seg.end,
          confidence: 1 - seg.no_speech_prob
        })),
        wordCount: response.text.split(/\s+/).length
      };

      transcripts.push(transcript);

      // Cleanup temp file
      await deleteTempFile(tempFile);
    }

    job.progress(60);

    // Merge transcripts chronologically
    const mergedTranscript = mergeTranscripts(transcripts, job.data.sessionStartTime);

    job.progress(70);

    // Calculate statistics
    const wordCount = transcripts.reduce((sum, t) => sum + t.wordCount, 0);
    const avgConfidence = transcripts.reduce((sum, t) =>
      sum + t.segments.reduce((s, seg) => s + seg.confidence, 0) / t.segments.length
    , 0) / transcripts.length;

    // Upload transcript to Vercel Blob
    const transcriptJson = JSON.stringify({
      sessionId: job.data.recordingId,
      transcribedAt: new Date().toISOString(),
      wordCount,
      confidence: avgConfidence,
      fullTranscript: mergedTranscript,
      participants: transcripts
    }, null, 2);

    const transcriptUrl = await uploadToBlob(
      Buffer.from(transcriptJson),
      `transcripts/${recordingId}.json`,
      'application/json'
    );

    job.progress(80);

    // Update database
    await prisma.recording.update({
      where: { id: recordingId },
      data: {
        status: 'completed',
        transcriptText: mergedTranscript,
        transcriptJson: JSON.parse(transcriptJson),
        wordCount,
        confidence: avgConfidence,
        processedAt: new Date(),
        blobUrls: {
          ...await prisma.recording.findUnique({ where: { id: recordingId }}).then(r => r.blobUrls),
          transcript: transcriptUrl
        }
      }
    });

    job.progress(90);

    // Send webhook to bot
    await sendWebhook(recordingId);

    job.progress(100);

    console.log(`Transcription completed for recording ${recordingId}`);

  } catch (error) {
    console.error(`Transcription failed for recording ${recordingId}:`, error);

    // Update database with error
    await prisma.recording.update({
      where: { id: recordingId },
      data: {
        status: 'failed',
        errorMessage: error.message,
        retryCount: { increment: 1 }
      }
    });

    // Send failure webhook
    await sendWebhook(recordingId, error);

    throw error; // Bull will retry based on job config
  }
}

// Helper: Merge transcripts chronologically
function mergeTranscripts(transcripts, sessionStartTime) {
  // Sort all segments by absolute time
  const allSegments = [];
  for (const transcript of transcripts) {
    for (const segment of transcript.segments) {
      allSegments.push({
        username: transcript.username,
        text: segment.text,
        absoluteTime: sessionStartTime + (segment.start * 1000)
      });
    }
  }

  allSegments.sort((a, b) => a.absoluteTime - b.absoluteTime);

  // Group into speaker blocks
  let markdown = '# Session Transcript\n\n';
  let currentSpeaker = '';
  let currentBlock = [];

  for (const segment of allSegments) {
    if (segment.username !== currentSpeaker) {
      if (currentBlock.length > 0) {
        markdown += `**${currentSpeaker}:** ${currentBlock.join(' ')}\n\n`;
      }
      currentSpeaker = segment.username;
      currentBlock = [segment.text];
    } else {
      currentBlock.push(segment.text);
    }
  }

  if (currentBlock.length > 0) {
    markdown += `**${currentSpeaker}:** ${currentBlock.join(' ')}\n\n`;
  }

  return markdown;
}
```

### Job Configuration

```typescript
// Queue setup
import Queue from 'bull';

export const transcriptionQueue = new Queue('transcription-jobs', {
  redis: process.env.REDIS_URL,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 60000 // 1 minute initial delay
    },
    removeOnComplete: true,
    removeOnFail: false
  }
});

// Worker setup
transcriptionQueue.process(5, processTranscription); // 5 concurrent jobs
```

---

## Webhook System

### Webhook Payload (API → Bot)

**Endpoint:** Configured in API env: `BOT_WEBHOOK_URL`

**Method:** `POST`

**Headers:**
```
Content-Type: application/json
X-Webhook-Signature: sha256=...
X-Webhook-Timestamp: 1696259445000
```

**Body (Success):**
```typescript
{
  event: "recording.transcription.completed",
  recordingId: string,
  sessionId: string,
  guildId: string,
  channelId: string,
  transcript: {
    wordCount: number,
    confidence: number,
    downloadUrl: string
  },
  viewUrl: string,
  timestamp: number
}
```

**Body (Failure):**
```typescript
{
  event: "recording.transcription.failed",
  recordingId: string,
  sessionId: string,
  guildId: string,
  channelId: string,
  error: string,
  retryCount: number,
  timestamp: number
}
```

### Signature Verification

```typescript
import crypto from 'crypto';

function generateSignature(payload: string, secret: string): string {
  return 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

// Usage in webhook dispatcher
const payload = JSON.stringify(webhookData);
const signature = generateSignature(payload, process.env.BOT_WEBHOOK_SECRET);

await fetch(process.env.BOT_WEBHOOK_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Webhook-Signature': signature,
    'X-Webhook-Timestamp': Date.now().toString()
  },
  body: payload
});
```

### Webhook Retry Logic

```typescript
async function sendWebhook(recordingId: string, error?: Error) {
  const maxRetries = 5;
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId }
  });

  const payload = error ? {
    event: 'recording.transcription.failed',
    recordingId,
    sessionId: recording.sessionId,
    guildId: recording.discordGuildId,
    channelId: recording.discordChannelId,
    error: error.message,
    retryCount: recording.retryCount,
    timestamp: Date.now()
  } : {
    event: 'recording.transcription.completed',
    recordingId,
    sessionId: recording.sessionId,
    guildId: recording.discordGuildId,
    channelId: recording.discordChannelId,
    transcript: {
      wordCount: recording.wordCount,
      confidence: recording.confidence,
      downloadUrl: recording.blobUrls.transcript
    },
    viewUrl: `${process.env.NEXT_PUBLIC_URL}/recordings/${recordingId}`,
    timestamp: Date.now()
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(process.env.BOT_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': generateSignature(JSON.stringify(payload), process.env.BOT_WEBHOOK_SECRET),
          'X-Webhook-Timestamp': Date.now().toString()
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        console.log(`Webhook sent successfully for recording ${recordingId}`);
        return;
      }

      console.warn(`Webhook attempt ${attempt + 1} failed with status ${response.status}`);

    } catch (err) {
      console.error(`Webhook attempt ${attempt + 1} error:`, err);
    }

    // Exponential backoff
    if (attempt < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  console.error(`All webhook attempts failed for recording ${recordingId}`);
}
```

---

## Vercel Blob Storage

### Upload Helper

```typescript
import { put } from '@vercel/blob';

export async function uploadToBlob(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const { url } = await put(filename, buffer, {
    access: 'public',
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN
  });

  return url;
}
```

### Download Helper

```typescript
export async function downloadFromBlob(url: string): Promise<Buffer> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
```

### Generate Signed URL

```typescript
import { generateSignedUrl } from '@vercel/blob';

export async function getSignedDownloadUrl(
  blobUrl: string,
  expiresIn: number = 3600 // 1 hour
): Promise<string> {
  return generateSignedUrl(blobUrl, {
    expiresIn,
    token: process.env.BLOB_READ_WRITE_TOKEN
  });
}
```

---

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://...

# Redis (for Bull queue)
REDIS_URL=redis://...

# Vercel Blob Storage
BLOB_READ_WRITE_TOKEN=vercel_blob_...

# OpenAI
OPENAI_API_KEY=sk-proj-...

# Bot Webhook
BOT_WEBHOOK_URL=https://your-bot-server.com/webhooks/recording-completed
BOT_WEBHOOK_SECRET=shared-secret-between-api-and-bot

# App URL
NEXT_PUBLIC_URL=https://arcanecircle.games
```

---

## Testing Checklist

### Unit Tests
- [ ] File upload validation
- [ ] Blob storage upload/download
- [ ] Database record creation
- [ ] Job queue creation
- [ ] Signature generation/verification

### Integration Tests
- [ ] Upload endpoint with real files
- [ ] Vercel Blob storage integration
- [ ] Bull job processing
- [ ] OpenAI API integration
- [ ] Webhook delivery
- [ ] Error handling and retries

### End-to-End Tests
- [ ] Bot uploads recording
- [ ] Files stored in Blob
- [ ] DB record created
- [ ] Job queued and processed
- [ ] Transcript generated
- [ ] Webhook sent to bot
- [ ] Bot receives notification

---

## Error Handling

### Upload Errors
- **Invalid file type:** Return 400 with clear message
- **File too large:** Return 413 with size limit
- **Blob upload failure:** Return 500, retry internally
- **Database error:** Return 500, rollback blob upload

### Transcription Errors
- **OpenAI API failure:** Retry job 3 times, then mark failed
- **Rate limit:** Exponential backoff, then retry
- **Invalid audio file:** Mark failed, don't retry
- **Timeout:** Increase job timeout, retry

### Webhook Errors
- **Bot offline:** Retry 5 times with exponential backoff
- **Invalid signature:** Log error, don't retry
- **Timeout:** Retry with longer timeout

---

## Performance Considerations

### Upload Endpoint
- Stream files directly to Blob (don't buffer in memory)
- Process uploads in parallel
- Return immediately (don't wait for transcription)
- Use CDN for download URLs

### Transcription Worker
- Process 5 jobs concurrently (configurable)
- Use job priorities for paid users
- Monitor queue length
- Scale workers horizontally if needed

### Database
- Index on frequently queried fields (guildId, status, recordedAt)
- Use connection pooling
- Archive old recordings to cold storage

---

## Monitoring

### Metrics to Track
- Upload success rate
- Upload duration (p50, p95, p99)
- Job queue length
- Job processing duration
- Transcription success rate
- Webhook delivery rate
- Blob storage costs
- OpenAI API costs

### Alerts
- Queue length > 100 (scale workers)
- Job failure rate > 10%
- Webhook failure rate > 20%
- Blob storage costs spike
- OpenAI rate limit hit

---

## Questions for Implementation

1. **Authentication:** Should recordings be linked to specific users in your platform, or just Discord IDs?
2. **Permissions:** Who can view/download recordings? Guild members only? Campaign members?
3. **Retention:** How long should recordings be stored? Auto-delete after X days?
4. **Costs:** What are budget limits for Blob storage and OpenAI API?
5. **Webhooks:** Should bot webhook URL be per-guild or global?
6. **UI:** Where in the platform should recordings be displayed? Campaign page? User profile?

---

## Summary for Implementation

**Required Work:**

1. **Database:**
   - Add `Recording` model to Prisma schema
   - Run migration

2. **API Endpoints:**
   - `POST /api/recordings` - Upload handler
   - `GET /api/recordings/:id` - Details
   - `GET /api/recordings/:id/download/:fileIndex` - Download
   - `GET /api/recordings/:id/transcript` - Transcript
   - `GET /api/recordings` - List
   - `POST /api/recordings/:id/retranscribe` - Retry

3. **Background Worker:**
   - Bull queue setup
   - Transcription processor
   - OpenAI integration
   - Blob upload/download helpers

4. **Webhook System:**
   - Signature generation
   - Webhook dispatcher
   - Retry logic

5. **Web UI (optional for MVP):**
   - Recording list page
   - Recording detail page
   - Transcript viewer
   - Download buttons

**Estimated Time:** 2-3 days for backend + worker, 1-2 days for UI

Let me know if you have questions!
