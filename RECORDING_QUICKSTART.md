# Recording Feature - Quick Start

## Phase 2A Status: ✅ Complete & Production Ready

### What Works
- **Continuous per-user recording** - Clean, uninterrupted audio
- **Single Opus decoder per user** - Maintains codec state throughout session
- **No fragmentation** - Professional quality output like Craig.bot
- Per-user audio capture (separate WAV file per speaker)
- Pure JavaScript Opus decoding (no native dependencies)
- Local storage in `./recordings/` folder
- Manifest.json with session metadata

---

## Quick Test (5 minutes)

### 1. Start Bot
```bash
cd ~/Documents/ac-familiar
npm run dev
```

### 2. In Discord
```
/record-test action:start
```
Bot joins your voice channel and starts recording.

### 3. Speak
Talk for 10-20 seconds. Have others join and speak too if possible.

### 4. Stop & Save
```
/record-test action:stop-save
```

### 5. Check Files
```bash
ls -lh recordings/
```

Or open `ac-familiar/recordings/` in Finder and double-click the WAV files to play them.

---

## Other Commands

```
/record-test action:stop          # Stop without saving
/record-test action:status        # Check recording status
/record-test action:list-files    # List all saved recordings
```

---

## File Locations

**Recordings**: `./recordings/{session-id}/`
- `{timestamp}_{userId}_{username}.wav` - One per speaker
- `manifest.json` - Session metadata

**Example**:
```
recordings/
└── 550e8400-e29b-41d4-a716-446655440000/
    ├── 2025-10-02T15-30-45_12345678_User1.wav
    ├── 2025-10-02T15-30-47_87654321_User2.wav
    └── manifest.json
```

---

## Recent Fixes & Improvements

### ✅ Fixed: Fragmented/Choppy Audio (2025-10-02)
**Problem:** Audio sounded like "broken radio" due to segment stitching
**Solution:**
- Implemented continuous recording per user (no segments)
- Single OpusScript decoder instance per user maintains codec state
- `EndBehaviorType.Manual` - streams never auto-end during session
- Fixed Buffer conversion to prevent data corruption

### ✅ Fixed: OpusScript Native Binding Issues
**Problem:** `dyld missing symbol` errors on macOS
**Solution:** Pure JavaScript OpusScript implementation (no native bindings required)

### ✅ Fixed: Session Management
- `stopAndExport()` no longer deletes session before export
- Proper cleanup handling in try/finally blocks
- Config accepts empty string for optional webhook

---

## What's Next

### Phase 2B: Transcription & AI Processing (NEXT)
1. **OpenAI Whisper Integration** - Transcribe audio to text
2. **Transcription Quality Testing** - Validate accuracy with local files
3. **Speaker Detection** - Identify who said what
4. **Transcription Storage** - Save alongside audio files
5. **Search/Query Capabilities** - Make transcriptions searchable

**Why this first:** Core value-add for campaign recordings. Test AI processing with local files before adding cloud complexity.

### Phase 2C: Cloud Storage & Distribution (LATER)
1. **Vercel Blob Storage** - Upload audio + transcriptions to cloud
2. **Download URLs** - Generate shareable links for both
3. **Multiple Formats** - Support FLAC and MP3
4. **Automatic Cleanup** - Delete old recordings from local + cloud

**Why after transcription:** Once AI pipeline is validated locally, migrate everything to cloud storage in one clean step.

See `PHASE_2A_TESTING.md` for detailed testing instructions.

---

## Troubleshooting

**No audio in files?**
- Check Discord voice permissions
- Verify users aren't muted
- Bot needs to hear audio (check voice channel settings)

**FFmpeg errors?**
- Check `npm ls ffmpeg-static` shows installed
- Verify project directory is writable

**Can't find recordings?**
- Must be in project directory: `cd ~/Documents/ac-familiar`
- Check: `ls recordings/`
- Files created only with `stop-save`, not plain `stop`

---

## Architecture Notes

### Recording Pipeline
1. **Discord Voice** → Opus packets (compressed audio)
2. **OpusDecoderStream** → Continuous PCM conversion per user
3. **Buffer Accumulation** → All audio data collected (including silence)
4. **MultiTrackExporter** → One WAV file per user
5. **FFmpeg** → Final WAV encoding with proper headers

### Key Components
1. **BasicRecordingService** - Continuous per-user recording with `EndBehaviorType.Manual`
2. **OpusDecoderStream** - Pure JS Opus decoder maintaining codec state
3. **AudioProcessor** - PCM to WAV conversion via FFmpeg
4. **MultiTrackExporter** - Parallel track processing
5. **RecordingManager** - Session orchestration

### Technical Details
- **Codec:** OpusScript (pure JavaScript, 48kHz, stereo)
- **Recording Mode:** Continuous (no automatic stream ending)
- **Buffer Format:** Int16Array PCM → signed 16-bit little-endian
- **Output Format:** WAV (uncompressed PCM)
- **One decoder per user** - Maintains Opus prediction state for clean audio

### Build Status
✅ All code compiles successfully
✅ No native dependencies (pure JavaScript)
✅ Production ready
