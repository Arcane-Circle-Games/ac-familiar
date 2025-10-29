# Streaming Upload API Specification

## Problem Statement

The Discord bot runs on Railway with ephemeral storage and limited memory. Long recording sessions (3+ hours with multiple users) cause out-of-memory crashes because all audio is buffered in RAM until the recording stops.

## Solution: Stream-to-Cloud Architecture

Upload audio segments to Vercel Blob Storage **immediately as they complete** during recording (after silence gaps), then clear them from memory. This keeps memory usage constant regardless of recording duration.

## Required API Changes

### 1. Initialize Live Recording Session

**Endpoint:** `POST /api/recordings/init-live`

**Purpose:** Create a recording record at the START of recording (before any segments are captured).

**Request Body:**
```json
{
  "sessionId": "uuid-v4",
  "guildId": "discord-guild-id",
  "guildName": "Server Name",
  "channelId": "discord-channel-id",
  "userId": "discord-user-id-who-started-recording",
  "recordedAt": "2025-01-15T10:30:00.000Z"
}
```

**Response:**
```json
{
  "recordingId": "database-recording-id",
  "status": "live"
}
```

**Notes:**
- Creates recording with status `live` or `recording`
- No segment data yet (segments will be uploaded incrementally)
- Recording duration/size unknown at this point

---

### 2. Request Upload URL for Single Segment

**Endpoint:** `POST /api/recordings/{recordingId}/segment-upload-url`

**Purpose:** Get a pre-signed upload URL for a single audio segment that just completed.

**Called:** Multiple times during recording, each time a segment completes (after silence gap).

**Request Body:**
```json
{
  "userId": "discord-user-id",
  "username": "Discord Display Name",
  "segmentIndex": 0,
  "fileName": "segment_000.wav",
  "fileSize": 245760,
  "absoluteStartTime": 1705315800000,
  "absoluteEndTime": 1705315810000,
  "duration": 10000,
  "format": "wav"
}
```

**Response:**
```json
{
  "uploadUrl": "https://your-api.com/api/recordings/upload-proxy/temporary-token",
  "blobPath": "recordings/session-uuid/Username/segment_000.wav"
}
```

**Notes:**
- Similar to current `/recordings/init` flow, but for ONE segment at a time
- Bot will immediately PUT the file to `uploadUrl`
- `uploadUrl` should proxy to Vercel Blob (same as current implementation)
- Response from PUT should include `{ url: "https://...blob.vercel-storage.com/..." }`

---

### 3. Finalize Recording with All Segments

**Endpoint:** `POST /api/recordings/{recordingId}/finalize`

**Purpose:** Complete the recording session with metadata for all uploaded segments.

**Called:** Once, when recording stops.

**Request Body:**
```json
{
  "sessionEndTime": 1705316400000,
  "duration": 600000,
  "totalSize": 12582912,
  "participantCount": 4,
  "segments": [
    {
      "userId": "discord-user-id",
      "username": "Username",
      "segmentIndex": 0,
      "fileName": "segment_000.wav",
      "filePath": "Username/segment_000.wav",
      "absoluteStartTime": 1705315800000,
      "absoluteEndTime": 1705315810000,
      "duration": 10000,
      "fileSize": 245760,
      "format": "wav",
      "blobUrl": "https://xxxxx.blob.vercel-storage.com/recordings/session-uuid/Username/segment_000.wav"
    },
    {
      "userId": "discord-user-id",
      "username": "Username",
      "segmentIndex": 1,
      "fileName": "segment_001.wav",
      "filePath": "Username/segment_001.wav",
      "absoluteStartTime": 1705315820000,
      "absoluteEndTime": 1705315835000,
      "duration": 15000,
      "fileSize": 368640,
      "format": "wav",
      "blobUrl": "https://xxxxx.blob.vercel-storage.com/recordings/session-uuid/Username/segment_001.wav"
    }
    // ... more segments
  ]
}
```

**Response:**
```json
{
  "recording": {
    "id": "database-recording-id",
    "sessionId": "uuid-v4",
    "status": "completed",
    "duration": 600000,
    "participantCount": 4,
    "segmentCount": 42,
    "totalSize": 12582912,
    "downloadUrls": {
      "audio": [
        "https://...blob.vercel-storage.com/recordings/.../segment_000.wav",
        "https://...blob.vercel-storage.com/recordings/.../segment_001.wav"
      ]
    },
    "estimatedProcessingTime": "5-10 minutes"
  }
}
```

**Notes:**
- All segments already uploaded to blob storage
- This endpoint just updates the recording record with final metadata
- Sets status to `completed` or `processing` (for transcription queue)

---

## Recording State Lifecycle

1. **Recording starts** → `init-live` → Recording created with status `live`
2. **Segment 0 completes** → `segment-upload-url` → Upload → Blob URL stored
3. **Segment 1 completes** → `segment-upload-url` → Upload → Blob URL stored
4. **...** (continues for duration of recording)
5. **Recording stops** → `finalize` → Recording status → `completed`

---

## Error Handling

### Duplicate Session ID
If bot crashes and restarts with same sessionId:
- `init-live` should return existing `recordingId` if sessionId already exists with status `live`
- Allow resume/continuation

### Segment Upload Failure
- Bot will retry failed segment uploads (exponential backoff)
- If segment upload fails permanently, bot logs warning and continues
- Missing segments will be noted in final `finalize` call

### Recording Timeout
- Consider adding a background job to auto-finalize recordings in `live` status for >24 hours
- Prevents orphaned recordings if bot crashes

---

## Migration from Current Implementation

**Current flow (batch upload):**
1. Record everything in memory
2. Stop recording
3. POST `/recordings/init` with all segments → get upload URLs
4. Upload all files
5. POST `/recordings/{id}/complete`

**New flow (streaming upload):**
1. Start recording → POST `/recordings/init-live`
2. Segment completes → POST `/recordings/{id}/segment-upload-url` → Upload
3. (Repeat step 2 for each segment)
4. Stop recording → POST `/recordings/{id}/finalize`

**Backward compatibility:**
- Keep existing `/recordings/init` + `/recordings/{id}/complete` endpoints
- Add new endpoints for streaming uploads
- Bot can use either flow (config flag)

---

## Example: 3-Hour Recording Session

- 3 hours = 10,800 seconds
- Average speech segment = 5 seconds
- Silence gaps = 2 seconds
- 3 users speaking

**Estimated API calls:**
- 1x `init-live` at start
- ~4,600x `segment-upload-url` (10,800 / 7 seconds × 3 users)
- 1x `finalize` at end

**Total:** ~4,602 API calls over 3 hours = ~25 calls/minute (well within limits)

---

## Implementation Checklist for API Team

- [ ] `POST /api/recordings/init-live` endpoint
  - Creates recording with status `live`
  - Returns recordingId
  - Handles duplicate sessionId (return existing)

- [ ] `POST /api/recordings/{recordingId}/segment-upload-url` endpoint
  - Generates upload URL for single segment
  - Uses Vercel Blob API (same as current proxy)
  - Returns upload URL + blob path

- [ ] `POST /api/recordings/{recordingId}/finalize` endpoint
  - Accepts all segment metadata + blob URLs
  - Updates recording status to `completed`
  - Returns full recording details

- [ ] Database schema updates (if needed)
  - Add `status` field: `live`, `completed`, `processing`, `failed`
  - Support incremental segment tracking (optional)

- [ ] Background job for orphaned recordings
  - Auto-finalize recordings in `live` status for >24 hours

---

## Questions for API Team

1. **Upload URL expiration**: How long should segment upload URLs remain valid? (Bot uploads immediately, so 5-10 minutes is fine)

2. **Rate limiting**: Should we add rate limits to `segment-upload-url` endpoint? (Expected: ~25 calls/minute during active recording)

3. **Blob storage path structure**: Prefer `recordings/{sessionId}/{username}/segment_XXX.wav` or different structure?

4. **Recording status**: Should we use `live`, `recording`, or `in_progress` for active recordings?

5. **Segment metadata storage**: Should API store each segment's metadata in database, or just the final list in `finalize`?

---

## Bot Implementation Notes

Bot-side changes will include:
- New `RecordingUploadService.initLiveRecording()` method
- New `RecordingUploadService.uploadSegmentImmediately()` method
- Modified `BasicRecordingService` to upload after each segment completion
- Memory monitoring logs to verify constant memory usage
- Config flag to toggle between batch vs streaming upload modes
