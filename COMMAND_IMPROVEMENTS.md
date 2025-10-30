# Discord Bot Command Improvements

This document tracks potential new commands and features that can be added to the Arcane Circle Discord bot by leveraging existing API endpoints.

## ✅ Implemented

### Super Easy Wins
- `/my-games` - View all your active games with next session info
- `/next-session` - See your next upcoming session across all games
- `/profile` - View your Arcane Circle profile information

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

### 6. `/attendance` - View Session Attendance
- **API:** `getSessionAttendees(sessionId)` (already exists)
- **Effort:** Low
- **Value:** See who's confirmed for upcoming session
- **Implementation:** List all players with attendance status (confirmed/absent/pending)

## 📊 Planned: Slightly More Complex but Still Quick

### 7. `/game-sessions` - View All Sessions for a Game
- **API:** `getGameSessions(gameId)` (already exists)
- **Effort:** Low-Medium (needs game autocomplete)
- **Value:** See full schedule for a campaign
- **Implementation:** Show past, current, and future sessions with status

### 8. `/gm-next-session` - GM's Next Session Across All Games
- **API:** Combine `getUpcomingSessions()` with GM filter
- **Effort:** Low
- **Value:** GMs see their next session across all games they run
- **Implementation:** Similar to `/next-session` but GM-focused

## 📋 Implementation Notes

### API Endpoints Already Available
- `GET /api/bookings/me?discordId={id}` - Get user's bookings (authenticated via bot)
- `GET /api/users/profile` - Get user profile
- `GET /api/sessions` - Query sessions with filters
- `GET /api/wiki?gameId={id}` - Get wiki by game
- `GET /api/wiki/{wikiId}/pages` - List wiki pages
- `GET /api/sessions/{id}` - Get session details
- `GET /api/sessions/{id}/attendees` - Get session attendance

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
