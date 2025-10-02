# Recording Filename Format Update

**Date:** October 2, 2025
**Status:** ✅ Complete

---

## Change Summary

Updated audio recording filenames from:
```
2025-10-02T15-30-45_12345678_Username.wav
```

To:
```
ServerName_MM-dd-YY_username.wav
```

---

## Examples

### Before
```
2025-10-02T15-30-45_12345678_JohnDoe.wav
2025-10-02T15-30-47_87654321_JaneSmith.wav
```

### After
```
MyDiscordServer_10-02-25_JohnDoe.wav
MyDiscordServer_10-02-25_JaneSmith.wav
```

---

## Implementation Details

### Files Modified

1. **`src/services/recording/BasicRecordingService.ts`**
   - Added `guildName: string` to `SessionMetadata` interface
   - Updated `startRecording()` to accept `guildName` parameter
   - Pass `guildName` through to export options

2. **`src/services/recording/RecordingManager.ts`**
   - Extract guild name from `voiceChannel.guild.name`
   - Pass to `BasicRecordingService.startRecording()`

3. **`src/services/processing/MultiTrackExporter.ts`**
   - Added `guildName: string` to `ExportOptions` interface
   - Pass `guildName` and `sessionStartTime` to AudioProcessor

4. **`src/services/processing/AudioProcessor.ts`**
   - Added `guildName?: string` and `sessionStartTime?: number` to `AudioProcessingOptions`
   - Updated filename generation logic:
     - Extract date from `sessionStartTime` (uses session start, not individual user start)
     - Format as `MM-dd-YY`
     - Sanitize guild name
     - Generate: `{guildName}_{date}_{username}.{format}`

---

## Filename Components

### Guild Name
- Sanitized to remove invalid characters
- Max 50 characters
- Falls back to `"Discord"` if not provided

### Date Format
- Uses session start time (consistent for all users in same session)
- Format: `MM-dd-YY` (e.g., `10-02-25`)
- Month is zero-padded
- Day is zero-padded
- Year is 2-digit

### Username
- Discord username
- Sanitized (non-alphanumeric → underscore)
- Max 50 characters

---

## Benefits

✅ **Clearer Context** - Guild name immediately visible
✅ **Better Sorting** - Files from same server group together
✅ **Simpler Dates** - MM-dd-YY easier to read than ISO timestamp
✅ **Consistency** - All files from same session use same date
✅ **No User IDs** - Removed userId suffix for cleaner names

---

## Backward Compatibility

**No breaking changes:**
- Existing recordings keep their old filenames
- Only new recordings use the new format
- Manifest.json continues to work with both formats
- Transcription system works with any filename format

---

## Testing

Test with a new recording:

```bash
/record-test action:start
[speak in voice channel]
/record-test action:stop-save
```

Then check:
```bash
ls recordings/{session-id}/

# Should see files like:
# YourServerName_10-02-25_Username1.wav
# YourServerName_10-02-25_Username2.wav
```

---

## Edge Cases Handled

1. **Special characters in guild name** → Sanitized to underscores
2. **Very long guild names** → Truncated to 50 chars
3. **Missing guild name** → Falls back to "Discord"
4. **Multiple users same session** → All use same date from session start

---

## Related Files

- `src/services/recording/BasicRecordingService.ts` - Session metadata
- `src/services/recording/RecordingManager.ts` - Guild name extraction
- `src/services/processing/MultiTrackExporter.ts` - Export options
- `src/services/processing/AudioProcessor.ts` - Filename generation
