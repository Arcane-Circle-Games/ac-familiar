# Recording Feature - Development Phases

## Overview

Sequential implementation of Discord voice recording with transcription for the Arcane Circle platform.

---

## Phase 2A: Audio Recording & Export ✅ **COMPLETE**

**Goal:** Capture clean, continuous audio from Discord voice channels

**Status:** Production Ready

**Features:**
- ✅ Continuous per-user recording (no fragmentation)
- ✅ Pure JavaScript Opus decoding (no native dependencies)
- ✅ Single decoder per user maintains codec state
- ✅ Local WAV file storage (`./recordings/`)
- ✅ Multi-track export (separate file per speaker)
- ✅ Manifest.json with session metadata
- ✅ `/record-test` command for testing

**Technical Stack:**
- OpusScript for Opus decoding
- FFmpeg for WAV encoding
- Discord.js voice receiver
- Local file storage

**Documentation:**
- `RECORDING_QUICKSTART.md` - Usage guide
- `PHASE_2A_TESTING.md` - Testing instructions
- `CONTINUOUS_RECORDING_FIX.md` - Technical implementation details

---

## Phase 2B: Transcription & AI Processing 👈 **NEXT**

**Goal:** Convert audio to searchable text transcriptions

**Status:** Not Started

**Planned Features:**
1. **OpenAI Whisper Integration**
   - Transcribe WAV files to text
   - Test with local recordings
   - Validate transcription accuracy

2. **Speaker Detection**
   - Map audio tracks to speaker identities
   - Associate transcription segments with users
   - Discord user attribution

3. **Transcription Storage**
   - Store JSON transcriptions alongside WAV files
   - Include timestamps, speaker info, confidence scores
   - Local storage (same as audio)

4. **Search/Query Features**
   - Enable text search of recordings
   - Campaign session transcription browsing
   - Filter by speaker, keyword, timestamp

**Why This Order:**
- Core platform value-add (searchable campaign recordings)
- Test AI processing locally before cloud complexity
- Faster iteration with local files
- Easier debugging and quality validation

**Technical Approach:**
- Use OpenAI Whisper API for transcription
- Process each user's WAV file separately
- Store transcriptions as JSON with:
  - Full text transcript
  - Timestamped segments
  - Speaker attribution
  - Confidence scores
- Enable local testing and iteration

---

## Phase 2C: Cloud Storage & Distribution 📦 **LATER**

**Goal:** Migrate to cloud storage and add distribution features

**Status:** Not Started

**Planned Features:**
1. **Vercel Blob Storage**
   - Upload audio files to cloud
   - Upload transcription JSON
   - Remove dependency on local storage

2. **Download URLs**
   - Generate shareable links for audio
   - Generate links for transcription JSON
   - Time-limited signed URLs

3. **Multiple Formats**
   - Support FLAC (lossless compression)
   - Support MP3 (lossy, smaller files)
   - User-selectable format preference

4. **Automatic Cleanup**
   - Retention policies (e.g., 7 days)
   - Automatic deletion of old recordings
   - Clean up both local and cloud storage
   - Optional archival to long-term storage

**Why After Transcription:**
- Once AI pipeline is validated, migrate everything in one step
- Upload both audio + transcriptions together
- Avoid rework if transcription changes audio format requirements
- Clean migration path with proven system

**Technical Approach:**
- Use `@vercel/blob` for storage
- Maintain local backup during migration
- Gradual rollout with feature flags
- Cleanup automation with retention policies

---

## Development Strategy

### Sequential Implementation
Each phase builds on the previous:
1. **Phase 2A:** Get clean audio working ✅
2. **Phase 2B:** Add transcription (local testing)
3. **Phase 2C:** Move to cloud (proven system)

### Benefits of This Approach
- **Incremental value:** Each phase delivers working features
- **Risk reduction:** Test locally before cloud migration
- **Cost efficiency:** No blob storage costs during development
- **Faster iteration:** Local files easier to debug
- **Quality first:** Validate AI before committing to storage solution

---

## Current Status

**Completed:**
- ✅ Phase 2A: Audio Recording & Export

**Active:**
- 🚧 Phase 2B: Transcription & AI Processing (Ready to start)

**Upcoming:**
- ⏳ Phase 2C: Cloud Storage & Distribution

---

## Integration with Platform

### Campaign Recording Flow (End Goal)
1. GM starts Discord recording during session
2. Bot captures multi-track audio (Phase 2A) ✅
3. Bot transcribes audio to text (Phase 2B) 🚧
4. Audio + transcript uploaded to Vercel Blob (Phase 2C) ⏳
5. Links stored in campaign session via platform API
6. Players can replay audio + browse transcript
7. Search across all campaign recordings

### Platform API Integration
- Store recording metadata in campaign sessions
- Link recordings to specific game sessions
- Associate with GM and player accounts
- Enable search/filter across recordings
