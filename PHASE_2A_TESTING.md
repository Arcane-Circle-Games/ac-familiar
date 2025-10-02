# Phase 2A Testing Guide - Audio File Export

## Status: ✅ Complete & Production Ready

Phase 2A delivers **professional-quality continuous audio recording** to WAV files with multi-track support. Recordings are saved locally to `./recordings/` in your project directory.

### Completed Features:
- **Continuous Recording**: Clean, uninterrupted audio per user (like Craig.bot)
- **Pure JavaScript Opus Decoding**: No native dependencies, works on all platforms
- **Single Decoder Per User**: Maintains Opus codec state for pristine audio quality
- **Multi-Track Export**: Separate WAV file per speaker
- **Local Storage**: Files saved to `./recordings/` folder in project
- **File Management**: Automatic directory creation and cleanup utilities
- **Enhanced Commands**: `/record-test` with start, stop-save, status, list-files actions

## Testing Instructions

### Prerequisites
1. Bot must be running: `npm run dev`
2. You must be in a Discord voice channel
3. At least 2 people should join and speak for best results

### Step 1: Start Recording
```
/record-test action:start
```
- Bot joins your voice channel
- Recording session starts
- You'll receive a session ID

### Step 2: Speak in the Voice Channel
- Have multiple people speak
- Each person's audio is captured separately
- Speak for at least 10-20 seconds for meaningful test files

### Step 3: Stop and Save Recording
```
/record-test action:stop-save
```
This will:
- Stop the recording
- Process each speaker's audio into separate WAV files
- Save files to `/tmp/recordings/{sessionId}/`
- Show you the output directory and file statistics

**Alternative**: Use `/record-test action:stop` to stop without saving (memory only)

### Step 4: Check Status
```
/record-test action:status
```
Shows:
- Active recording sessions
- Memory usage
- Segment counts

### Step 5: List Saved Files
```
/record-test action:list-files
```
Shows:
- All saved recording sessions
- File counts per session
- Total size per session
- File paths

### Step 6: Verify Files on Disk
In your project directory (`ac-familiar/`), check:
```bash
# From project root
ls -lh recordings/

# Example output:
# drwxr-xr-x  5 user  staff   160B Oct  2 11:30 550e8400-e29b-41d4-a716-446655440000/

ls -lh recordings/<session-id>/

# Example files:
# 2025-10-02T15-30-45_12345678_Username1.wav
# 2025-10-02T15-30-47_87654321_Username2.wav
# manifest.json
```

### Play Audio Files
The WAV files are in your local project directory, ready to play:
```bash
# macOS
afplay recordings/<session-id>/filename.wav

# Linux
aplay recordings/<session-id>/filename.wav

# Or just double-click the .wav files in Finder
```

## Expected Results

### On Successful Recording:
- ✅ One WAV file per speaker
- ✅ Files named with timestamp, userId, and username
- ✅ manifest.json with metadata
- ✅ Files are playable audio
- ✅ Each track contains only that speaker's voice

### File Structure:
```
recordings/
└── {session-id}/
    ├── 2025-10-02T15-30-45_12345678_User1.wav
    ├── 2025-10-02T15-30-47_87654321_User2.wav
    ├── 2025-10-02T15-30-50_11223344_User3.wav
    └── manifest.json
```

**Note**: The `recordings/` folder is in your project directory (next to `src/`, `package.json`, etc.) and is already added to `.gitignore` so it won't be committed to git.

### Manifest.json Example:
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "recordedAt": "2025-10-02T15:30:45.000Z",
  "duration": 120000,
  "participantCount": 3,
  "totalSize": 1234567,
  "tracks": [
    {
      "userId": "123456789012345678",
      "username": "User1",
      "filename": "2025-10-02T15-30-45_12345678_User1.wav",
      "fileSize": 456789,
      "format": "wav",
      "duration": 45000,
      "startTime": "2025-10-02T15:30:45.000Z",
      "endTime": "2025-10-02T15:31:30.000Z"
    }
  ]
}
```

## Current Limitations

1. **Local Storage Only**: Files save to `./recordings/` in project directory (cloud storage in Phase 2B)
2. **WAV Format Only**: Uncompressed WAV only (FLAC/MP3 in Phase 2B)
3. **Manual Cleanup**: Old recordings require manual deletion (auto-cleanup in Phase 2B)
4. **No Transcription**: Audio files only (text transcription in Phase 2E)
5. **No Download Links**: Files are local only (Vercel Blob URLs in Phase 2B)

## Quality Notes

✅ **Audio Quality:** Professional, broadcast-quality output
- Continuous recording prevents fragmentation
- Opus decoder maintains prediction state
- No artifacts from segment boundaries
- Clean silence periods (no cutting/stitching)

✅ **Reliability:**
- Pure JavaScript (no native binding issues)
- Works on macOS, Linux, Windows
- Handles user joins/leaves during session
- Proper stream cleanup on stop

## Troubleshooting

### "No audio data to process"
- Make sure people actually spoke during the recording
- Check that Discord voice permissions are correct
- Verify bot can hear users (not server-muted)

### "FFmpeg encoding error"
- Check that ffmpeg-static is installed: `npm ls ffmpeg-static`
- Verify /tmp/ is writable: `touch /tmp/test && rm /tmp/test`

### "Failed to create directory"
- Check disk space: `df -h .`
- Verify project directory is writable
- Check you're running bot from correct directory

### Empty or silent WAV files
- Discord audio might be muted for bot
- Check voice channel permissions
- Ensure people unmuted their microphones

## Next Steps

### Phase 2B: Transcription & AI Processing (NEXT)
Test AI features with local files before cloud migration:
1. **OpenAI Whisper Integration** - Transcribe WAV files to text
2. **Quality Validation** - Test transcription accuracy with local files
3. **Speaker Detection** - Map audio tracks to speakers
4. **Transcription Storage** - Store JSON alongside WAV files
5. **Search Capabilities** - Enable text search of recordings

**Rationale:** Core platform feature. Validate locally before adding cloud complexity.

### Phase 2C: Cloud Storage & Distribution (AFTER TRANSCRIPTION)
Migrate to cloud once AI pipeline is proven:
1. Vercel Blob Storage integration (audio + transcriptions)
2. Multiple format support (FLAC, MP3)
3. Download URL generation (both audio and transcripts)
4. Automatic cleanup of old files (local + cloud)

**Rationale:** Test transcription quality first, then migrate everything to cloud in one step.

## File Cleanup

To manually clean up test files:
```bash
# Remove all recordings (from project root)
rm -rf recordings/*

# Remove specific session
rm -rf recordings/{session-id}

# Or just delete the recordings folder in Finder
```

**Note**: The `recordings/` folder is in `.gitignore`, so these files are never committed to git.
