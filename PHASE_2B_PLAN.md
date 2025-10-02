# Phase 2B: Local Transcription Implementation Plan

**Status:** 🚧 In Progress
**Started:** October 2, 2025
**Goal:** Add OpenAI Whisper transcription to locally-stored recordings

---

## Overview

Add OpenAI Whisper API integration to transcribe locally-stored WAV files to text, storing transcripts alongside audio files in JSON format. This validates transcription quality before cloud migration (Phase 2C).

**Approach:** Local-first testing → Validate quality → Then migrate to cloud

---

## Architecture

### New Components

1. **TranscriptionService** (`src/services/transcription/TranscriptionService.ts`)
   - OpenAI Whisper API integration
   - Process WAV files to text
   - Generate timestamped transcripts with speaker attribution
   - Handle errors and retries

2. **TranscriptionStorage** (`src/services/storage/TranscriptionStorage.ts`)
   - Save/load transcript JSON files
   - Store alongside audio in `./recordings/{sessionId}/`
   - Format: `{sessionId}_transcript.json`

3. **Enhanced MultiTrackExporter** (modify existing)
   - Add optional transcription step after audio export
   - Merge per-user transcripts chronologically
   - Generate full session transcript

4. **New Command Actions** (modify `record-test.ts`)
   - `transcribe` - Transcribe existing recording by session ID
   - `view-transcript` - Display transcript for session
   - Enhanced `stop-save` - Optionally transcribe on stop

---

## File Structure

```
recordings/
└── {session-id}/
    ├── 2025-10-02T15-30-45_12345678_User1.wav
    ├── 2025-10-02T15-30-47_87654321_User2.wav
    ├── manifest.json
    └── {session-id}_transcript.json  ← NEW
```

### Transcript JSON Schema

```json
{
  "sessionId": "uuid",
  "transcribedAt": "ISO timestamp",
  "duration": 120000,
  "participantCount": 3,
  "fullTranscript": "Markdown formatted text with speaker labels...",
  "wordCount": 1542,
  "userTranscripts": [
    {
      "userId": "123456789",
      "username": "User1",
      "audioFile": "2025-10-02T15-30-45_12345678_User1.wav",
      "text": "Full text for this user...",
      "segments": [
        {
          "text": "segment text",
          "start": 0.5,
          "end": 2.3,
          "confidence": 0.95
        }
      ]
    }
  ]
}
```

---

## Implementation Steps

### 1. Create Type Definitions
**File:** `src/types/transcription.ts`

Define interfaces for:
- `TranscriptSegment` - Individual timestamped text segment
- `UserTranscript` - Complete transcript for one user
- `SessionTranscript` - Full session with merged chronological transcript
- `TranscriptionOptions` - Configuration options

### 2. Create TranscriptionService
**File:** `src/services/transcription/TranscriptionService.ts`

Methods:
- `transcribeAudioFile(wavPath: string, userId: string, username: string): Promise<UserTranscript>`
  - Read WAV file from disk
  - Send to OpenAI Whisper API
  - Parse response with timestamps and confidence scores
  - Return structured UserTranscript object

- Handle OpenAI API errors and rate limits
- Use existing `openai` package (already in dependencies)
- Use existing `OPENAI_API_KEY` from config

### 3. Create TranscriptionStorage
**File:** `src/services/storage/TranscriptionStorage.ts`

Methods:
- `saveTranscript(sessionId: string, transcript: SessionTranscript): Promise<void>`
  - Write transcript JSON to `./recordings/{sessionId}/{sessionId}_transcript.json`

- `loadTranscript(sessionId: string): Promise<SessionTranscript | null>`
  - Read and parse transcript JSON

- `mergeUserTranscripts(userTranscripts: UserTranscript[], sessionStartTime: number): string`
  - Sort all segments by absolute timestamp
  - Group into speaker blocks
  - Generate markdown formatted text

- `generateFormattedTranscript(transcript: SessionTranscript): string`
  - Convert to readable markdown with timestamps
  - Speaker labels and formatting

### 4. Update MultiTrackExporter
**File:** `src/services/processing/MultiTrackExporter.ts`

Add methods:
- `transcribeSession(sessionId: string, sessionDir: string): Promise<SessionTranscript>`
  - Load manifest.json to get track information
  - Iterate through each WAV file
  - Call TranscriptionService for each user
  - Merge all user transcripts chronologically
  - Save merged transcript via TranscriptionStorage
  - Return SessionTranscript object

### 5. Update RecordingManager
**File:** `src/services/recording/RecordingManager.ts`

Add methods:
- `transcribeSession(sessionId: string): Promise<SessionTranscript>`
  - Wrapper for MultiTrackExporter.transcribeSession
  - Look up session directory
  - Return transcript summary

- Modify `stopAndExport()` to optionally transcribe based on `RECORDING_AUTO_TRANSCRIBE` config

### 6. Update record-test Command
**File:** `src/commands/record-test.ts`

Add new actions:
- `transcribe` - Transcribe existing recording
  - Add `session-id` option (string, required for this action)
  - Call RecordingManager.transcribeSession()
  - Display transcript stats in embed

- `view-transcript` - Display transcript
  - Add `session-id` option (string, required for this action)
  - Load transcript JSON
  - Show stats in embed
  - Attach formatted markdown file

Update existing:
- `stop-save` - Check `RECORDING_AUTO_TRANSCRIBE` flag
  - If true, automatically transcribe after saving audio
  - Show transcription progress
  - Display transcript stats

---

## Command Flow Examples

### Auto-transcribe on stop
```
/record-test action:start
[users speak in voice channel]
/record-test action:stop-save
→ Bot stops recording
→ Saves WAV files to ./recordings/{session-id}/
→ Automatically transcribes if RECORDING_AUTO_TRANSCRIBE=true
→ Shows: audio files saved + transcript stats
```

### Manual transcribe existing recording
```
/record-test action:transcribe session-id:{uuid}
→ Reads WAV files from ./recordings/{session-id}/
→ Sends each to OpenAI Whisper API
→ Merges transcripts chronologically
→ Saves transcript JSON
→ Returns summary: word count, participants, confidence
```

### View transcript
```
/record-test action:view-transcript session-id:{uuid}
→ Loads {session-id}_transcript.json
→ Displays stats in Discord embed
→ Attaches formatted markdown file for download
```

---

## Configuration

Uses existing environment variables:
- `OPENAI_API_KEY` - Required for Whisper API
- `RECORDING_AUTO_TRANSCRIBE` - Boolean flag (default: true)

No new environment variables needed.

---

## Files to Create/Modify

### New Files (3)
1. ✅ `PHASE_2B_PLAN.md` - This documentation
2. ⏳ `src/types/transcription.ts` - Type definitions
3. ⏳ `src/services/transcription/TranscriptionService.ts` - OpenAI Whisper integration
4. ⏳ `src/services/storage/TranscriptionStorage.ts` - Transcript storage/loading

### Modified Files (3)
1. ⏳ `src/services/processing/MultiTrackExporter.ts` - Add transcription integration
2. ⏳ `src/services/recording/RecordingManager.ts` - Add transcribeSession method
3. ⏳ `src/commands/record-test.ts` - Add transcribe/view-transcript actions

---

## Benefits of Local-First Approach

✅ **Validate Quality** - Test transcription accuracy with real recordings before cloud
✅ **Iterate Fast** - No Vercel Blob storage complexity during development
✅ **Debug Easily** - All files local and inspectable
✅ **Cost Efficient** - No blob storage costs during testing phase
✅ **Reusable** - Same TranscriptionService works locally or with cloud storage later
✅ **No Breaking Changes** - Existing Phase 2A audio recording unchanged

---

## Testing Strategy

1. **Use existing recordings** from Phase 2A testing
2. **Test transcribe command** on those recordings
3. **Validate accuracy** - Listen to audio vs. read transcript
4. **Check formatting** - Ensure chronological order, proper speaker labels
5. **Test with multiple speakers** - Verify merge logic works correctly
6. **Test auto-transcribe** - Stop-save should automatically transcribe

---

## Next Phase (Phase 2C)

After validating transcription quality locally:

1. **Vercel Blob Storage Integration**
   - Upload audio files during recording
   - Upload transcripts after processing
   - Generate download URLs

2. **Platform API Integration**
   - Store recording metadata in database
   - Link to campaign sessions
   - Enable search functionality

3. **Automatic Cleanup**
   - Retention policies
   - Delete old files from blob storage
   - Clean up local files

4. **Multiple Format Support**
   - FLAC (lossless compression)
   - MP3 (lossy, smaller files)
   - User-selectable formats

---

## OpenAI Whisper API Details

### Endpoint
```
POST https://api.openai.com/v1/audio/transcriptions
```

### Request
- `file`: Audio file (WAV, up to 25MB)
- `model`: `whisper-1`
- `response_format`: `verbose_json` (includes timestamps)
- `language`: `en` (optional)

### Response
```json
{
  "text": "Full transcription text...",
  "duration": 120.5,
  "language": "en",
  "segments": [
    {
      "text": "segment text",
      "start": 0.5,
      "end": 2.3,
      "no_speech_prob": 0.05
    }
  ]
}
```

### Rate Limits
- 50 requests per minute (free tier)
- 500 requests per minute (paid tier)

### Pricing
- $0.006 per minute of audio
- Example: 10 minute recording with 3 speakers = 30 minutes = $0.18

---

## Success Criteria

Phase 2B is complete when:

- ✅ Can transcribe existing WAV files from Phase 2A
- ✅ Transcripts stored as JSON alongside audio
- ✅ Multiple user transcripts merged chronologically
- ✅ Discord commands work: transcribe, view-transcript
- ✅ Auto-transcribe on stop-save works
- ✅ Transcript quality validated with test recordings
- ✅ Ready to migrate to cloud storage (Phase 2C)

---

## Timeline

**Estimated:** 2-3 hours

1. Type definitions - 15 min
2. TranscriptionService - 45 min
3. TranscriptionStorage - 30 min
4. MultiTrackExporter updates - 30 min
5. RecordingManager updates - 15 min
6. Command updates - 30 min
7. Testing - 30 min

---

## Related Documentation

- `RECORDING_PHASES.md` - Overall recording feature roadmap
- `PHASE_2A_TESTING.md` - Audio recording testing guide
- `CONTINUOUS_RECORDING_FIX.md` - Technical details of audio implementation
- `RECORDING_QUICKSTART.md` - User guide for recording commands
