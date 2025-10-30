# Discord Bot Command Improvements

This document tracks potential new commands and features that can be added to the Arcane Circle Discord bot by leveraging existing API endpoints.

## ✅ Implemented

### Super Easy Wins
- `/my-games` - View all your active games with next session info
- `/next-session` - See your next upcoming session across all games (includes GM games!)
- `/profile` - View your Arcane Circle profile information

### Easy & High Value
- `/attendance` - View session attendance count with interactive RSVP buttons for players
  - **Note:** Currently shows attendance count only (full attendee list endpoint not yet available on API)

## 🎯 Planned: Super Easy Wins (1-2 hours each)

All implemented! See above.

## 🎲 Planned: Easy & High Value (2-4 hours each)

### 4. `/wiki` - Browse Campaign Wiki
- **API:** `getWikiByGameId()` + `listPages()` (methods already exist)
- **Effort:** Medium - needs autocomplete for game selection + pagination
- **Value:** Access campaign lore/NPCs/locations from Discord
- **Implementation:**
  - List available wiki pages for a game
  - Optionally `/wiki-page` to read specific page content
  - Good for players checking notes during/between sessions

### 5. `/session-info` - Get Session Details
- **API:** `getSession(sessionId)` (already exists)
- **Effort:** Low - needs session ID lookup
- **Value:** Check session time, attendees, notes
- **Implementation:** Show scheduled time, duration, attendance status, GM notes
- **Note:** Most functionality covered by `/attendance` and `/next-session`

## 📊 Planned: Slightly More Complex but Still Quick

### 7. `/game-sessions` - View All Sessions for a Game
- **API:** `getGameSessions(gameId)` (already exists)
- **Effort:** Low-Medium (needs game autocomplete)
- **Value:** See full schedule for a campaign
- **Implementation:** Show past, current, and future sessions with status

### 8. ~~`/gm-next-session`~~ **Already Implemented!**
- `/next-session` now checks both player bookings AND GM games automatically

## 📋 Implementation Notes

### API Endpoints Already Available
- `GET /api/bookings/me?discordId={id}` - Get user's bookings (authenticated via bot)
- `GET /api/users/profile` - Get user profile
- `GET /api/sessions` - Query sessions with filters
- `GET /api/wiki?gameId={id}` - Get wiki by game
- `GET /api/wiki/{wikiId}/pages` - List wiki pages
- `GET /api/sessions/{id}` - Get session details
- `GET /api/sessions/{id}/attendance` - Get session attendance (not implemented yet - returns 405)
- `POST /api/sessions/{id}/attendance` - Mark attendance (working)

### Service Methods Ready to Use
All service methods are implemented in:
- `src/services/api/bookings.ts`
- `src/services/api/users.ts`
- `src/services/api/sessions.ts`
- `src/services/api/wiki.ts`

### Authentication Pattern
All commands should follow the standard pattern:
```typescript
const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
if (!user) {
  // Show "Account not linked" message
  return;
}
```

## 💡 Future Ideas

### Player Experience
- `/remind-session` - Set up session reminders via DM
- `/rsvp` - RSVP to upcoming session (mark attendance)
- `/game-calendar` - See all upcoming sessions you're in

### GM Tools
- `/announce-session` - Post session announcement to channel
- `/session-start` - Start session and notify players
- `/roll-call` - Take attendance for active session

### Social Features
- `/gm-reviews` - View reviews for a GM
- `/rate-session` - Rate a completed session
- `/recommend-game` - Get game recommendations based on preferences

---

*Last updated: 2025-10-30*
