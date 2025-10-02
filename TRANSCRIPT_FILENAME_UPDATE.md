# Transcript Filename Format Update

**Date:** October 2, 2025
**Status:** ✅ Complete

---

## Change Summary

Updated transcript filenames to match audio file naming format.

### Before
```
550e8400-e29b-41d4-a716-446655440000_transcript.json
550e8400-e29b-41d4-a716-446655440000_transcript.md
```

### After
```
ServerName_10-02-25_transcript.json
ServerName_10-02-25_transcript.md
```

---

## Examples

### Complete Recording with Transcripts

**Audio files:**
```
MyDiscordServer_10-02-25_JohnDoe.wav
MyDiscordServer_10-02-25_JaneSmith.wav
```

**Transcript files:**
```
MyDiscordServer_10-02-25_transcript.json
MyDiscordServer_10-02-25_transcript.md
```

**Manifest:**
```
manifest.json
```

---

## Implementation Details

### Files Modified

1. **`src/services/storage/TranscriptionStorage.ts`**
   - Updated `saveTranscript()` to accept `guildName` and `sessionStartTime` parameters
   - Updated `saveFormattedTranscript()` to accept same parameters
   - Added `generateTranscriptFilename()` helper method
   - Added `findTranscriptFile()` helper to support both old and new formats
   - Updated `deleteTranscript()` to find and delete files with any naming format
   - Added `sanitizeFilename()` helper

2. **`src/services/processing/MultiTrackExporter.ts`**
   - Extract guild name from audio filenames in manifest
   - Pass `guildName` and `sessionStartTime` when saving transcripts

---

## Filename Format

```
{GuildName}_{MM-dd-YY}_transcript.{ext}
```

### Components

1. **Guild Name**
   - Extracted from audio filenames
   - Sanitized (non-alphanumeric → underscore)
   - Max 50 characters
   - Falls back to "Discord" if not available

2. **Date**
   - Format: `MM-dd-YY`
   - Uses session start time (same as audio files)
   - Zero-padded month and day

3. **Extension**
   - `.json` - Full structured transcript data
   - `.md` - Formatted markdown for reading

---

## Backward Compatibility

✅ **Full backward compatibility:**
- `loadTranscript()` finds files with both old and new naming formats
- `transcriptExists()` checks for files with any naming format
- `deleteTranscript()` removes files with any naming format
- Old transcripts continue to work without migration

### How it Works

The `findTranscriptFile()` method searches for any file ending with:
- `_transcript.json`
- `transcript.json`

It prefers new format but falls back to old format automatically.

---

## Transcript Content

The transcript **content** already includes usernames:

### JSON Format
```json
{
  "sessionId": "uuid",
  "transcribedAt": "2025-10-02T15:35:00.000Z",
  "fullTranscript": "# Session Transcript\n\n**[00:15] JohnDoe:** Hello...",
  "userTranscripts": [
    {
      "userId": "123456789",
      "username": "JohnDoe",
      "text": "Full text...",
      "segments": [...]
    }
  ]
}
```

### Markdown Format
```markdown
# Session Transcript

**Session ID:** `uuid`
**Transcribed:** 10/2/2025, 3:35:00 PM
**Duration:** 2m 15s
**Participants:** 2

---

**[00:15] JohnDoe:** Hello everyone, welcome to the session.

**[00:18] JaneSmith:** Thanks for having me! This looks great.

**[00:25] JohnDoe:** Let's get started...
```

---

## Benefits

✅ **Consistency** - Same naming format as audio files
✅ **Context** - Guild name visible in filename
✅ **Readable** - Simple date format
✅ **Organized** - Files from same session clearly grouped
✅ **Compatible** - Works with old transcripts automatically

---

## File Structure

```
recordings/
└── {session-id}/
    ├── ServerName_10-02-25_User1.wav
    ├── ServerName_10-02-25_User2.wav
    ├── manifest.json
    ├── ServerName_10-02-25_transcript.json  ← NEW FORMAT
    └── ServerName_10-02-25_transcript.md    ← NEW FORMAT
```

---

## Testing

New transcripts will automatically use the new filename format:

```bash
# Create new recording with transcription
/record-test action:start
[speak in voice channel]
/record-test action:stop-save  # with RECORDING_AUTO_TRANSCRIBE=true

# Or transcribe existing recording
/record-test action:transcribe session-id:{uuid}

# View transcript
/record-test action:view-transcript session-id:{uuid}
```

Check files:
```bash
ls recordings/{session-id}/

# New format:
# YourServer_10-02-25_User1.wav
# YourServer_10-02-25_User2.wav
# YourServer_10-02-25_transcript.json
# YourServer_10-02-25_transcript.md
# manifest.json
```

---

## Edge Cases Handled

1. **Missing guild name** → Falls back to "Discord"
2. **Special characters in guild name** → Sanitized to underscores
3. **Long guild names** → Truncated to 50 characters
4. **Old transcripts** → Still load and work correctly
5. **Multiple transcript files** → Prefers new format, falls back to old

---

## Migration Notes

**No migration needed!**

- Old transcripts continue to work
- New transcripts automatically use new format
- Both formats can coexist in same directory
- Loading/viewing works with both formats

---

## Related Updates

- See `FILENAME_UPDATE.md` for audio filename changes
- See `PHASE_2B_IMPLEMENTATION_SUMMARY.md` for transcription feature details
