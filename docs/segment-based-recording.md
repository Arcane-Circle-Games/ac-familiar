# Segment-Based Recording Architecture

## Problem Statement

### Current Implementation Issue

The existing recording system has a fundamental timestamp accuracy problem:

**Current Behavior:**
1. Bot captures audio only when users are speaking (Discord voice activity detection)
2. Audio chunks are concatenated into a single buffer per user
3. Silent gaps between speech are NOT preserved
4. Each user's audio file contains only their speech stitched together

**Example Problem:**
- User A speaks at 00:00-00:30, then 10:00-10:30 (total: 1 minute of speech)
- Audio file generated: 1 minute long
- Whisper transcription produces segments at 0-30s and 30-60s (relative to file)
- Timeline reconstruction calculates: `audioStartTime + 30s` for second segment
- **Actual time should be: `audioStartTime + 10 minutes`**
- Result: Massive timestamp drift in transcripts

## Segment-Based Solution

### Architecture Overview

Instead of concatenating all speech into one file per user, create **multiple small audio files** - one for each distinct speaking segment with accurate absolute timestamps.

### Key Principles

1. **Segment Detection**: Identify gaps in audio stream to detect separate speaking segments
2. **Absolute Timestamps**: Record exact start/end time for each segment relative to session start
3. **Manifest-Driven**: Central manifest tracks all segments with metadata
4. **No Padding**: No artificial silence, only actual speech data
5. **Parallel Processing**: Segments can be transcribed independently and in parallel

## Data Structures

### Audio Chunk with Timestamp
```typescript
interface TimestampedAudioChunk {
  buffer: Buffer;        // PCM audio data
  timestamp: number;     // Milliseconds from session start
}
```

### Audio Segment
```typescript
interface AudioSegment {
  userId: string;
  username: string;
  segmentIndex: number;           // Sequential index for this user
  bufferChunks: Buffer[];         // PCM audio data
  absoluteStartTime: number;      // Unix timestamp (ms)
  absoluteEndTime: number;        // Unix timestamp (ms)
  duration: number;               // Duration in ms
}
```

### Session Manifest
```typescript
interface SegmentedSessionManifest {
  sessionId: string;
  sessionStartTime: number;       // Unix timestamp (ms)
  sessionEndTime: number;         // Unix timestamp (ms)
  totalDuration: number;          // ms
  participantCount: number;
  segments: Array<{
    userId: string;
    username: string;
    segmentIndex: number;
    fileName: string;             // e.g., "Alice_segment_001.wav"
    absoluteStartTime: number;    // Unix timestamp (ms)
    absoluteEndTime: number;      // Unix timestamp (ms)
    duration: number;             // ms
    fileSize: number;             // bytes
    format: 'wav' | 'flac' | 'mp3';
  }>;
}
```

### User Recording (Internal)
```typescript
interface UserRecording {
  userId: string;
  username: string;
  currentSegment: AudioSegment | null;     // Active segment being recorded
  completedSegments: AudioSegment[];       // Finalized segments
  lastChunkTime: number;                   // Timestamp of last audio chunk
  segmentCount: number;                    // Counter for segment indexing
}
```

## Workflow

### 1. Recording Phase

#### Segment Detection Logic
```
When audio chunk received:
  currentTime = Date.now() - sessionStartTime

  if currentSegment is null:
    // Start new segment (first speech or after silence)
    currentSegment = createSegment(userId, currentTime)
    currentSegment.bufferChunks.push(chunk)

  else if (currentTime - lastChunkTime) > SILENCE_THRESHOLD:
    // Gap detected - finalize current segment and start new one
    currentSegment.absoluteEndTime = lastChunkTime
    completedSegments.push(currentSegment)

    currentSegment = createSegment(userId, currentTime)
    currentSegment.bufferChunks.push(chunk)

  else:
    // Continue current segment
    currentSegment.bufferChunks.push(chunk)

  lastChunkTime = currentTime
```

**Configuration:**
- `SILENCE_THRESHOLD`: Default 2000ms (2 seconds)
- Configurable per deployment needs
- Balances between segment granularity and file count

### 2. Export Phase

#### Process Each Segment to Audio File
```
For each user:
  // Create user subdirectory
  userDir = path.join(sessionDir, username)
  mkdir(userDir)

  For each completed segment:
    fileName = `segment_{index:03d}.{format}`
    filePath = path.join(userDir, fileName)
    audioFile = convertPCMToWAV(segment.bufferChunks)
    save(audioFile, filePath)

    manifestEntry = {
      userId: segment.userId,
      username: segment.username,
      segmentIndex: segment.segmentIndex,
      fileName: `{username}/segment_{index:03d}.{format}`,  // Relative path
      absoluteStartTime: segment.absoluteStartTime,
      absoluteEndTime: segment.absoluteEndTime,
      duration: segment.duration,
      fileSize: audioFile.size,
      format: format
    }
    manifest.segments.push(manifestEntry)
```

**File Organization:**
- Directory: `{sessionDir}/{username}/`
- File format: `segment_{index}.{ext}` (e.g., `segment_001.wav`)
- Manifest stores relative path: `{username}/segment_{index}.{ext}`
- Simple numeric indexing within each user's folder

### 3. Transcription Phase

#### Segment-Based Transcription
```
transcripts = []

For each segment in manifest.segments (can parallelize):
  segmentTranscript = await transcribe(segment.fileName)

  For each word/phrase in segmentTranscript:
    word.absoluteTime = segment.absoluteStartTime + word.relativeOffset

  transcripts.push({
    ...segmentTranscript,
    userId: segment.userId,
    username: segment.username,
    segmentIndex: segment.segmentIndex
  })

// Merge all transcripts chronologically
fullTimeline = transcripts
  .flatMap(t => t.words)
  .sort((a, b) => a.absoluteTime - b.absoluteTime)

// Format as conversational transcript
formatAsConversation(fullTimeline)
```

## Directory Structure

### Before (Current - Broken)
```
recordings/
└── session_abc123/
    ├── manifest.json
    ├── ServerName_01-15-25_Alice.wav    (1 min - stitched speech only)
    ├── ServerName_01-15-25_Bob.wav      (3 min - stitched speech only)
    └── ServerName_01-15-25_transcript.json
```

### After (Segment-Based - Accurate)
```
recordings/
└── session_abc123/
    ├── manifest.json
    ├── ServerName_01-15-25_transcript.json
    ├── Alice/
    │   ├── segment_001.wav    (30s at 00:00-00:30)
    │   ├── segment_002.wav    (30s at 10:00-10:30)
    │   └── segment_003.wav    (45s at 15:00-15:45)
    └── Bob/
        ├── segment_001.wav    (45s at 00:15-01:00)
        └── segment_002.wav    (120s at 05:00-07:00)
```

**Organization:**
- Each user gets their own subdirectory (named by username)
- Segments stored as `segment_{index}.wav` within user folders
- Makes testing and debugging easier - can isolate individual user recordings
- Manifest at session level tracks relative paths to all segments

## Implementation Plan

### Phase 1: Data Structure Updates
- [ ] Update `UserRecording` interface to track segments
- [ ] Create `AudioSegment` interface
- [ ] Create `TimestampedAudioChunk` interface
- [ ] Update manifest schema to support segment metadata

### Phase 2: Recording Service Changes
- [ ] Add chunk timestamp capture in `BasicRecordingService`
- [ ] Implement segment detection logic (silence gap detection)
- [ ] Track current vs completed segments per user
- [ ] Finalize segments on session stop

### Phase 3: Export Changes
- [ ] Update `AudioProcessor` to process segments individually
- [ ] Generate sequential filenames per user segment
- [ ] Create enhanced manifest with segment metadata
- [ ] Update `MultiTrackExporter` for segment-based export

### Phase 4: Transcription Updates
- [ ] Update transcription service to process segments
- [ ] Implement parallel segment transcription
- [ ] Timeline reconstruction from segment absolute times
- [ ] Merge segment transcripts chronologically

### Phase 5: Testing & Validation
- [ ] Test with recording containing speech gaps
- [ ] Validate timestamp accuracy in transcript
- [ ] Test parallel transcription performance
- [ ] Validate manifest completeness

## Configuration Options

### Environment Variables
```env
# Segment detection
RECORDING_SILENCE_THRESHOLD=2000        # ms of silence to trigger new segment
RECORDING_MIN_SEGMENT_DURATION=500     # ms minimum segment length

# Processing
RECORDING_SEGMENT_PARALLEL_LIMIT=5     # Max concurrent segment transcriptions
```

### Tuning Considerations

**SILENCE_THRESHOLD**
- Too low (< 1s): Excessive segments, normal pauses split speech
- Too high (> 5s): Fewer segments but less granular timeline
- Recommended: 2000ms (2 seconds)

**MIN_SEGMENT_DURATION**
- Filters out very short audio artifacts
- Prevents transcription of non-speech sounds
- Recommended: 500ms minimum

## Advantages Over Current System

| Aspect | Current (Broken) | Segment-Based (Fixed) |
|--------|------------------|----------------------|
| Timestamp Accuracy | ❌ Massive drift | ✅ Exact to chunk level |
| Storage Efficiency | ⚠️ Wastes space on single large file | ✅ Only actual speech stored |
| Transcription Speed | ❌ Large files slow | ✅ Parallel small segments fast |
| Debugging | ❌ Hard to inspect timeline | ✅ Easy to identify/play segments |
| Gap Handling | ❌ Gaps eliminated | ✅ Gaps preserved in metadata |
| Timeline Reconstruction | ❌ Impossible without timestamps | ✅ Accurate via manifest |

## Migration Strategy

### Backward Compatibility

**Option 1: Feature Flag**
```typescript
if (config.RECORDING_USE_SEGMENTS) {
  // New segment-based logic
} else {
  // Old concatenated logic (deprecated)
}
```

**Option 2: Clean Break**
- Mark current recordings as "legacy format"
- All new recordings use segment-based approach
- Provide migration tool for old recordings (if needed)

### Recommended: Clean Break
- Current system is fundamentally broken
- No production recordings to migrate yet
- Simpler codebase without dual-mode support

## Future Enhancements

1. **Smart Segmentation**: Use ML to detect actual speaker turns vs pauses
2. **Compression**: Store segments in compressed format initially
3. **Streaming Upload**: Upload segments to API as they complete (don't wait for session end)
4. **Segment Caching**: Cache transcriptions per segment for replay/reprocessing
5. **Cross-Talk Detection**: Flag segments where multiple users spoke simultaneously

## References

- Current implementation: `src/services/recording/BasicRecordingService.ts`
- Audio processing: `src/services/processing/AudioProcessor.ts`
- Manifest generation: `src/services/processing/MultiTrackExporter.ts`
- Transcription: `src/services/transcription/TranscriptionService.ts`
