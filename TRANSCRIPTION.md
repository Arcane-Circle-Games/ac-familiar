# Transcription System Documentation

## Overview

The Arcane Circle Discord bot supports dual-tier transcription for recorded voice sessions:

- **Free Tier**: Browser-based WebAssembly transcription (user's compute)
- **Paid Tier**: Automated cloud transcription via OpenAI Whisper API

## Architecture

```
Recording Flow:
Discord Voice Channel → Bot Records → Vercel Blob Storage → Platform Database
                                                                      ↓
                                                        Free: User transcribes in browser
                                                        Paid: Auto-queued to OpenAI API
```

## User Workflows

### Free Tier Workflow

1. **Record Session**
   ```
   /record-test action:stop-save transcribe:false
   ```
   - Bot records voice channel
   - Exports audio files (one per speaker, segmented by silence)
   - Uploads to Vercel Blob Storage
   - Creates recording record in database
   - Responds: "Recording saved! Visit arcanecircle.games/recordings to transcribe"

2. **Access Platform**
   - User visits `arcanecircle.games/recordings`
   - Authenticates via existing Discord OAuth link
   - Sees list of their recordings

3. **Transcribe in Browser**
   - User clicks **[🎙️ Transcribe in Browser]** button
   - Platform fetches audio from Vercel Blob (authenticated)
   - WebAssembly Whisper runs entirely client-side
   - Progress shown: "Transcribing... 50%"
   - ⚠️ **User must keep browser tab open during processing**
   - Estimated time: 15-20 minutes for 1 hour session

4. **View Result**
   - Transcript automatically saved to database
   - Status updates to ✅ Transcribed
   - User can view/download transcript

**Limitations:**
- Must keep browser tab open
- Slower processing (CPU-based)
- No background processing
- No Discord notifications

### Paid Tier Workflow

1. **Record Session (Auto-Transcribe)**
   ```
   /record-test action:stop-save transcribe:true
   ```
   - Bot records voice channel
   - Uploads to Vercel Blob Storage
   - **Automatically queues transcription job**
   - Responds: "Recording saved! Transcription queued ⏳"

2. **Background Processing**
   - Platform background worker picks up job
   - Sends audio to OpenAI Whisper API
   - Processing happens server-side (5-10x faster)
   - User can close Discord, leave site

3. **Completion Notification**
   - Platform updates recording status to ✅ Transcribed
   - (Optional) Bot DMs user: "✅ Your recording from [date] has been transcribed!"
   - User visits platform anytime to view

**Benefits:**
- Fully automatic
- 5-10x faster processing
- Background processing (close browser/Discord)
- Discord notifications
- Queue system (process multiple recordings)

## Bot Commands

### `/record-test`
Primary recording command with transcription options.

**Parameters:**
- `action`: start | stop-save
- `transcribe`: true | false (optional, defaults based on user tier)

**Examples:**
```
/record-test action:start
/record-test action:stop-save transcribe:true   # Paid: auto-queue
/record-test action:stop-save transcribe:false  # Free: manual transcribe
```

### `/download-recording`
Download audio files for offline transcription (advanced users).

**Parameters:**
- `session-id`: UUID of recording session

**Use Case:**
- Advanced users who want to transcribe offline
- Users with local Whisper setups
- Backup/archival purposes

**Returns:**
- Download links for all audio files
- Recording metadata
- Instructions for local transcription

### `/upload-transcript`
Upload locally-generated transcript files.

**Parameters:**
- `file`: transcript.json file attachment
- `recording-id`: (optional) associate with existing recording

**Use Case:**
- Users who transcribed locally (via download-recording workflow)
- Advanced users with custom transcription setups

**Format:**
Expects JSON file in LocalTranscriptManifest format:
```json
{
  "sessionId": "uuid",
  "sessionStartTime": 1234567890000,
  "sessionEndTime": 1234567920000,
  "format": "segmented",
  "segments": [
    {
      "userId": "discord-id",
      "username": "PlayerName",
      "segmentIndex": 0,
      "fileName": "Player1_seg0.wav",
      "absoluteStartTime": 1234567890000,
      "absoluteEndTime": 1234567892500,
      "transcription": {
        "text": "Full segment text",
        "segments": [
          {
            "start": 0.0,
            "end": 2.5,
            "text": "Segment text",
            "confidence": 0.95
          }
        ],
        "wordCount": 50,
        "confidence": 0.94
      }
    }
  ]
}
```

### `/transcribe`
Shows guide for local transcription workflow (for advanced users).

**No parameters required.**

**Returns:**
- Instructions for downloading recording
- Guide for running local Whisper script
- Benefits of local vs cloud transcription
- Links to transcription tools

## Platform Integration

### Database Schema

**Recordings Table:**
```typescript
{
  id: string;              // Database ID
  sessionId: string;       // Bot-generated UUID
  userId: string;          // Discord user ID
  guildId: string;         // Discord guild ID
  channelId: string;       // Discord voice channel ID

  // Metadata
  duration: number;        // Milliseconds
  participantCount: number;
  recordedAt: timestamp;
  uploadedAt: timestamp;

  // Storage
  downloadUrls: {
    audio: string[];       // Vercel Blob URLs
  };

  // Transcription
  status: 'uploaded' | 'transcribing' | 'transcribed' | 'failed';
  transcriptionMethod: 'openai' | 'webassembly' | 'manual' | null;

  // Tier tracking
  userTier: 'free' | 'paid';
}
```

**Transcriptions Table:**
```typescript
{
  id: string;
  recordingId: string;

  // Content
  content: string;         // Markdown formatted
  confidence: number;      // Average 0-1
  language: string;
  speakerCount: number;

  // Processing
  provider: 'openai' | 'webassembly' | 'other';
  processingTime: number;  // Milliseconds

  createdAt: timestamp;
}
```

**TranscriptionSegments Table:**
```typescript
{
  id: string;
  transcriptionId: string;

  startTime: number;       // Seconds from session start
  endTime: number;
  text: string;
  speaker: string;         // Username
  confidence: number;
  order: number;           // Chronological order
}
```

### API Endpoints

**GET /recordings**
List user's recordings (authenticated).

**GET /recordings/{id}**
Get recording details (authenticated).

**POST /recordings**
Create new recording (bot only).
- Accepts multipart form data with audio files
- Creates recording record
- Uploads to Vercel Blob Storage
- Returns recording ID and download URLs

**POST /recordings/{id}/transcribe**
Trigger transcription (authenticated).
- Free tier: Returns WebAssembly instructions
- Paid tier: Queues transcription job

**POST /transcriptions**
Create transcription record.
- Accepts transcript content and metadata
- Creates transcription + segments
- Updates recording status

**GET /transcriptions/{id}/segments**
Get transcript segments for display.

### WebAssembly Transcription (Free Tier)

**Technology:**
- Transformers.js (Hugging Face)
- Whisper model compiled to WebAssembly
- Runs 100% client-side in browser

**Implementation:**
```typescript
// pages/recordings/[id]/transcribe.tsx
import { pipeline } from '@xenova/transformers';

async function transcribeInBrowser(audioUrl: string) {
  // Download model (cached after first use)
  const transcriber = await pipeline(
    'automatic-speech-recognition',
    'Xenova/whisper-base'
  );

  // Fetch audio from Vercel Blob
  const audio = await fetch(audioUrl);
  const audioBuffer = await audio.arrayBuffer();

  // Transcribe
  const result = await transcriber(audioBuffer, {
    language: 'en',
    task: 'transcribe',
    return_timestamps: true
  });

  return result;
}
```

**UI Flow:**
1. User clicks "Transcribe in Browser"
2. Model downloads (one-time, ~140MB, cached)
3. Progress indicator shows:
   - Model download: 0-100%
   - Audio processing: 0-100%
   - Per-file progress (if multiple speakers)
4. Results auto-save to database
5. Redirect to transcript view

**Advantages:**
- Zero server cost
- Privacy (audio never sent to server)
- Works offline after model download

**Disadvantages:**
- Slower than server-side
- Requires keeping tab open
- Limited to browser capabilities

### OpenAI Transcription (Paid Tier)

**Technology:**
- OpenAI Whisper API
- Bull queue for job management
- Redis for queue storage

**Implementation:**
```typescript
// Background job queue
async function queueTranscription(recordingId: string) {
  await transcriptionQueue.add('transcribe', {
    recordingId,
    priority: user.tier === 'paid' ? 1 : 10
  });
}

// Worker process
transcriptionQueue.process('transcribe', async (job) => {
  const { recordingId } = job.data;
  const recording = await getRecording(recordingId);

  // Download audio from Vercel Blob
  const audioFiles = await downloadAudio(recording.downloadUrls.audio);

  // Transcribe each file
  const transcripts = await Promise.all(
    audioFiles.map(file =>
      openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment']
      })
    )
  );

  // Merge segments chronologically
  const merged = mergeTranscripts(transcripts, recording.segments);

  // Save to database
  await createTranscription({
    recordingId,
    content: merged.text,
    segments: merged.segments,
    provider: 'openai'
  });

  // Update status
  await updateRecordingStatus(recordingId, 'transcribed');

  // Send Discord notification (optional)
  await notifyUser(recording.userId, recordingId);
});
```

**Cost Management:**
- OpenAI charges $0.006/minute
- 1 hour session ≈ $0.36
- Paid tier could be $9.99/mo for ~28 hours of transcription
- Monitor usage per user

**Queue Priority:**
- Paid users: Priority 1
- Free users (if manual queue): Priority 10
- Process in order within priority levels

## Upgrade Flow

### Free User Experience

After 3rd manual transcription, show upgrade prompt:

```
┌─────────────────────────────────────────────┐
│ 🎉 You've transcribed 3 sessions!           │
│                                             │
│ Tired of waiting 15+ minutes each time?    │
│                                             │
│ Premium users get:                          │
│ ✅ Automatic transcription (queue & forget) │
│ ✅ 5-10x faster processing                  │
│ ✅ Discord notifications when ready         │
│ ✅ Background processing (close browser)    │
│ ✅ Priority queue                           │
│                                             │
│     [Upgrade to Premium - $9.99/mo]         │
│                                             │
│ Or continue with free browser transcription │
└─────────────────────────────────────────────┘
```

### Paid User Experience

Automatic transcription on every recording:

```
Discord:
> /record-test action:stop-save
Bot: ✅ Recording saved! Transcription queued (Position #2 in queue)

Platform:
Status: ⏳ Transcribing... Est. 2 mins

(2 minutes later)
Discord DM from Bot:
✅ Your recording from Jan 10, 8:00 PM has been transcribed!
View at: arcanecircle.games/recordings/abc123
```

## Technical Notes

### Audio Format
- Recorded as Opus (Discord native)
- Converted to PCM/WAV for export
- Sample rate: 48kHz (Discord standard)
- Channels: Mono per speaker (multi-track)

### Segmentation
- Silence detection threshold: configurable (default: 2 seconds)
- Minimum segment duration: 500ms
- Segments stored with absolute timestamps
- Chronological merging during transcription

### File Storage
- Vercel Blob Storage for audio files
- Signed URLs (expire after 1 hour)
- Free tier: 100GB storage
- Paid tier: Unlimited storage (within reason)

### Error Handling
- Transcription failures → status: 'failed'
- Retry mechanism: 3 attempts with exponential backoff
- User notified of failures
- Manual retry option available

## Future Enhancements

### Planned Features
1. **Speaker Diarization**: Auto-identify speakers by voice
2. **Custom Vocabulary**: Game-specific terms (spell names, locations)
3. **Language Detection**: Auto-detect language
4. **Batch Transcription**: Transcribe multiple sessions at once
5. **Transcript Editing**: In-platform editor for corrections
6. **Export Formats**: PDF, SRT, VTT for subtitles
7. **Search**: Full-text search across all transcripts
8. **AI Summary**: Generate session summaries

### Cost Optimization
- Implement transcript caching
- Offer lower-quality transcription at reduced cost
- Bulk discounts for high-usage users
- Whisper model fine-tuning for better accuracy

## Troubleshooting

### Common Issues

**"Transcription failed"**
- Check audio file integrity
- Verify Vercel Blob URLs are valid
- Check OpenAI API quota
- Review error logs

**"WebAssembly transcription stuck at 0%"**
- Clear browser cache
- Check browser compatibility (Chrome/Edge recommended)
- Ensure sufficient RAM available
- Try smaller audio file first

**"No recordings found"**
- Verify user is authenticated
- Check Discord account linking
- Ensure recording was saved (check logs)

**"Download links expired"**
- Vercel Blob URLs expire after 1 hour
- Regenerate links via `/download-recording`

## Development Setup

### Prerequisites
- Node.js 18+
- PostgreSQL (recordings database)
- Redis (queue management)
- Vercel account (blob storage)
- OpenAI API key (paid tier)

### Environment Variables
```env
# Database
DATABASE_URL=postgresql://...

# Queue
REDIS_URL=redis://...

# Storage
VERCEL_BLOB_TOKEN=...

# Transcription
OPENAI_API_KEY=sk-...
WHISPER_MODEL_SIZE=base  # tiny, base, small, medium, large

# Discord
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
```

### Testing

**Test Free Tier:**
```bash
# Record session
/record-test action:start
# ... talk for a few minutes
/record-test action:stop-save transcribe:false

# Visit platform, click "Transcribe in Browser"
# Verify progress updates
# Check transcript accuracy
```

**Test Paid Tier:**
```bash
# Record session
/record-test action:stop-save transcribe:true

# Check queue status
# Wait for completion
# Verify Discord notification
# Check transcript on platform
```

## Support

For issues or questions:
- GitHub: https://github.com/your-repo/issues
- Discord: #support channel
- Email: support@arcanecircle.games
