# Real Username Fix

**Date:** October 2, 2025
**Status:** ✅ Complete

---

## Issue

Transcripts and audio filenames were showing placeholder usernames like `User_5024` instead of actual Discord usernames.

---

## Root Cause

The `getUsername()` method in `BasicRecordingService` was returning a placeholder:

```typescript
// Before
private getUsername(userId: string): string {
  return `User_${userId.slice(-4)}`;
}
```

---

## Solution

Updated `BasicRecordingService` to fetch real usernames from Discord:

1. Pass the Discord `Guild` object to the recording service
2. Use `guild.members.fetch(userId)` to get the member
3. Return `member.displayName` (nickname) or `member.user.username`

---

## Changes Made

### 1. Updated BasicRecordingService

**Added Guild parameter:**
```typescript
async startRecording(
  sessionId: string,
  voiceReceiver: VoiceReceiver,
  channelId: string,
  guildName: string,
  guild: Guild  // ← NEW
): Promise<void>
```

**Store guild in session metadata:**
```typescript
interface SessionMetadata {
  sessionId: string;
  channelId: string;
  guildName: string;
  guild: Guild;  // ← NEW
  startTime: number;
  endTime?: number;
  userRecordings: Map<string, UserRecording>;
  participantCount: number;
}
```

**Fetch real usernames:**
```typescript
private async getUsername(userId: string, guild: Guild): Promise<string> {
  try {
    const member = await guild.members.fetch(userId);
    // Use display name (nickname) if available, otherwise username
    return member.displayName || member.user.username;
  } catch (error) {
    logger.warn(`Failed to fetch username for user ${userId}`, { error });
    return `User_${userId.slice(-4)}`; // Fallback
  }
}
```

**Also fixed bot detection:**
```typescript
private async isBot(userId: string, guild: Guild): Promise<boolean> {
  try {
    const member = await guild.members.fetch(userId);
    return member.user.bot;
  } catch (error) {
    logger.warn(`Failed to check if user ${userId} is a bot`, { error });
    return false;
  }
}
```

### 2. Updated RecordingManager

Pass guild to recording service:
```typescript
const guild = voiceChannel.guild;
await this.recordingService.startRecording(
  sessionId,
  connection.receiver,
  channelId,
  guildName,
  guild  // ← NEW
);
```

---

## What This Fixes

### Audio Filenames
**Before:**
```
MyServer_10-02-25_User_5024.wav
MyServer_10-02-25_User_8371.wav
```

**After:**
```
MyServer_10-02-25_JohnDoe.wav
MyServer_10-02-25_JaneSmith.wav
```

### Transcripts
**Before:**
```markdown
**[00:15] User_5024:** Hello everyone
**[00:18] User_8371:** Thanks for having me
```

**After:**
```markdown
**[00:15] JohnDoe:** Hello everyone
**[00:18] JaneSmith:** Thanks for having me
```

### Transcript JSON
**Before:**
```json
{
  "userTranscripts": [
    {
      "userId": "123456789",
      "username": "User_5024",
      "text": "..."
    }
  ]
}
```

**After:**
```json
{
  "userTranscripts": [
    {
      "userId": "123456789",
      "username": "JohnDoe",
      "text": "..."
    }
  ]
}
```

---

## Display Name vs Username

The fix prioritizes **display names** (server nicknames):

1. **First choice:** `member.displayName` - Server-specific nickname
2. **Fallback:** `member.user.username` - Global Discord username

### Example:
- Global username: `john_doe_gaming`
- Server nickname: `John`
- **Used in recordings:** `John` ✅

---

## Error Handling

If username fetch fails:
- Logs a warning
- Falls back to `User_{last4digits}` format
- Recording continues without interruption

---

## Bot Detection

Also improved bot detection to skip recording bot audio:

```typescript
if (await this.isBot(userId, session.guild)) {
  logger.debug(`Skipping bot user ${userId}`);
  return;
}
```

---

## Testing

Test with a new recording:

```bash
/record-test action:start
[speak in voice channel]
/record-test action:stop-save
```

Check files:
```bash
ls recordings/{session-id}/

# Should see real usernames:
# YourServer_10-02-25_YourName.wav
# YourServer_10-02-25_FriendName.wav
# YourServer_10-02-25_transcript.md
```

View transcript:
```bash
/record-test action:view-transcript session-id:{uuid}
```

Should show actual Discord names in the markdown!

---

## Files Modified

1. `src/services/recording/BasicRecordingService.ts`
   - Added `Guild` import
   - Updated `SessionMetadata` interface
   - Updated `startRecording()` signature
   - Made `getUsername()` async and fetch from Discord
   - Made `isBot()` async and check via Discord
   - Updated event handler to be async

2. `src/services/recording/RecordingManager.ts`
   - Pass guild object to `startRecording()`

---

## Performance Note

Username lookups are cached by Discord.js, so:
- First lookup per user: ~50-100ms (API call)
- Subsequent lookups: <1ms (cached)

Since users typically don't join mid-recording, this is a one-time cost per user at the start.

---

## Related Updates

- See `FILENAME_UPDATE.md` for audio filename format
- See `TRANSCRIPT_FILENAME_UPDATE.md` for transcript filename format
- See `PHASE_2B_IMPLEMENTATION_SUMMARY.md` for transcription feature
