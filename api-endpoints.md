# Arcane Circle API Documentation

This document provides a comprehensive reference for all API endpoints in the Arcane Circle MVP platform.

**Total Endpoints:** 71 endpoints across 9 functional areas
**Authentication:** NextAuth.js with session-based authentication + Bot API key support
**Base URL:** `/api`
**Response Format:** JSON with consistent error handling

---

## Authentication & User Management

### Authentication
- **GET** `/api/auth/[...nextauth]` - NextAuth.js authentication handler
- **POST** `/api/auth/[...nextauth]` - NextAuth.js authentication handler

### User Profile
- **GET** `/api/users/profile` - Get current user profile
- **PUT** `/api/users/profile` - Update user profile
  - **Auth:** Required
  - **Body:** Profile data (displayName, bio, timezone, etc.)

### Health & Testing  
- **GET** `/api/health` - Health check endpoint
- **POST** `/api/test/validation` - Validation testing endpoint
- **POST** `/api/waitlist` - Waitlist signup

---

## Games Management

### Games CRUD
- **GET** `/api/games` - Search and list published games
  - **Query:** `search`, `system`, `gameType`, `experienceLevel`, `maxPrice`, `page`, `limit`
  - **Auth:** None (public endpoint)

- **POST** `/api/games` - Create new game
  - **Auth:** Required (GM only)
  - **Body:** Game data, optional `createWiki` flag
  - **Features:** Auto-generates sessions for campaigns/series, optional wiki creation

- **GET** `/api/games/[id]` - Get game details
  - **Auth:** None for published games
  - **Response:** Includes GM info, interest count, booking count

- **PATCH** `/api/games/[id]` - Update game
  - **Auth:** Required (GM owner only)
  - **Body:** Partial game data
  - **Restrictions:** Cannot change pricing for published games

- **DELETE** `/api/games/[id]` - Delete game
  - **Auth:** Required (GM owner only)  
  - **Restrictions:** Cannot delete games with confirmed bookings

### Game Publishing
- **POST** `/api/games/[id]/publish` - Publish game
  - **Auth:** Required (GM owner only)
  - **Validation:** Ensures all required fields are present

### Game Applications & Interest
- **GET** `/api/games/[id]/applications` - Get all applications for game
  - **Auth:** Required (GM owner only)
  - **Response:** Pending, approved, and declined applications

- **POST** `/api/games/[id]/interest` - Apply to join game
  - **Auth:** Required
  - **Body:** `applicationMessage`, `characterConcept`

- **GET** `/api/games/[id]/interest` - Get current user's interest status
  - **Auth:** Required

- **PATCH** `/api/games/[id]/interest/[interestId]` - Approve/decline application
  - **Auth:** Required (GM owner only)
  - **Body:** `status` ('CONTACTED', 'DECLINED')
  - **Features:** Creates booking record on approval

- **DELETE** `/api/games/[id]/interest/[interestId]` - Remove application
  - **Auth:** Required (GM owner or applicant)

- **POST** `/api/games/[id]/interest/[interestId]/allow-reapply` - Allow player to re-apply
  - **Auth:** Required (GM owner only)

### Game Completion
- **POST** `/api/games/[id]/complete` - Mark game as complete
  - **Auth:** Required (GM owner only)

### Recently Published Games
- **GET** `/api/games/recent` - Get recently published games
  - **Query:** `minutes` (optional, 1-10080, default: 180)
  - **Auth:** None (public endpoint)
  - **Response:** Games published within the specified time window
  - **Format:**
    ```json
    {
      "success": true,
      "data": {
        "games": [
          {
            "id": "string",
            "vanitySlug": "string",
            "title": "string",
            "description": "string",
            "system": { "id": "string", "name": "string", "shortName": "string" },
            "startTime": "ISO-8601",
            "duration": number,
            "pricePerSession": "string",
            "maxPlayers": number,
            "currentPlayers": number,
            "availableSlots": number,
            "gameType": "string",
            "publishedAt": "ISO-8601",
            "gm": {
              "displayName": "string",
              "vanitySlug": "string",
              "profile": {
                "averageRating": "string",
                "totalRatings": number,
                "verified": boolean
              }
            },
            "url": "string"
          }
        ],
        "query": {
          "minutes": number,
          "cutoffTime": "ISO-8601",
          "count": number
        }
      }
    }
    ```

---

## Session Management

### Session Operations
- **GET** `/api/games/[id]/sessions/[sessionId]` - Get session details
- **PATCH** `/api/games/[id]/sessions/[sessionId]` - Update session
- **DELETE** `/api/games/[id]/sessions/[sessionId]` - Cancel session

### Session Flow Control
- **POST** `/api/games/[id]/sessions/start` - Start next session
  - **Auth:** Required (GM owner only)
  - **Features:** Charges pre-authorized payments

- **POST** `/api/games/[id]/sessions/[sessionId]/complete` - Mark session complete
  - **Auth:** Required (GM owner only)

- **POST** `/api/games/[id]/sessions/complete` - Bulk complete sessions
  - **Auth:** Required (GM owner only)

- **POST** `/api/games/[id]/sessions/[sessionId]/schedule` - Schedule session
- **POST** `/api/games/[id]/sessions/[sessionId]/confirm-payment` - Confirm session payment

### Session Attendance
- **GET** `/api/sessions/[id]/attendance` - Get attendance for session
- **POST** `/api/sessions/[id]/attendance` - Record attendance
- **PATCH** `/api/sessions/[id]/attendance/[playerId]` - Update player attendance
- **GET** `/api/games/[id]/sessions/attendance` - Get game attendance summary

### Session Payments
- **POST** `/api/sessions/[id]/start-preauth` - Start pre-authorization for session
- **POST** `/api/games/[id]/charge-bookings` - Charge all bookings for active session

---

## Booking & Payment System

### Booking Management
- **GET** `/api/bookings/me` - Get current user's bookings
  - **Auth:** Required (session) OR Bot auth with `?discordId` query param
  - **Query:** `discordId` (required for bot auth)
  - **Response:** Array of active bookings with game details
  - **Format:**
    ```json
    {
      "bookings": [
        {
          "id": "string",
          "status": "CONFIRMED|PENDING|APPROVED",
          "paymentStatus": "SUCCEEDED|PENDING|FAILED",
          "bookingType": "PLAYER",
          "game": {
            "id": "string",
            "title": "string",
            "vanitySlug": "string",
            "gameType": "CAMPAIGN|ONE_SHOT",
            "isRecurring": boolean,
            "frequency": "WEEKLY|BI_WEEKLY|MONTHLY",
            "startTime": "ISO-8601",
            "system": { "id": "string", "name": "string", "shortName": "string" },
            "gm": { "displayName": "string", "vanitySlug": "string" },
            "nextSession": { "sessionNumber": number, "scheduledTime": "ISO-8601" },
            "url": "string"
          }
        }
      ],
      "count": number
    }
    ```

- **GET** `/api/bookings/[id]` - Get booking details
  - **Auth:** Required (player or GM)

- **PATCH** `/api/bookings/[id]` - Update booking
  - **Auth:** Required (booking owner only)

- **DELETE** `/api/bookings/[id]` - Cancel booking
  - **Auth:** Required (booking owner only)

### Deferred Payment Bookings
- **POST** `/api/bookings/create-deferred` - Create campaign booking with pre-auth
  - **Auth:** Required
  - **Body:** `gameId`, `sessionId`, `paymentMethodId`, `applicationMessage`, `characterConcept`
  - **Features:** Pre-authorizes payments for all campaign sessions

### Booking Actions
- **POST** `/api/bookings/[id]/retry-payment` - Retry failed payment
- **POST** `/api/bookings/[id]/reset` - Reset booking payment status
- **POST** `/api/bookings/[id]/leave` - Leave game/campaign
  - **Auth:** Required (session) OR Bot auth (Authorization: Bearer header)
  - **Features:**
    - Cancels all active payment intents (pre-authorizations)
    - Sets booking status to CANCELLED
    - Sends notification to GM
    - Preserves history for transactions/refunds
  - **Use Case:** Players leaving campaigns via Discord bot (`/leave-game` command)

### Payment Methods
- **GET** `/api/payment-methods` - Get user's payment methods
  - **Auth:** Required

- **POST** `/api/payment-methods` - Add payment method
  - **Auth:** Required

- **DELETE** `/api/payment-methods/[id]` - Remove payment method
  - **Auth:** Required (owner only)

- **PATCH** `/api/bookings/[id]/payment-method` - Update booking payment method

### Payment Processing
- **POST** `/api/payments/intent` - Create payment intent
  - **Auth:** Required
  - **Body:** `amount`, `currency`, `gameId`

- **GET** `/api/payments/fees` - Get platform fee structure
- **POST** `/api/payments/webhook` - Stripe webhook handler
  - **Features:** Handles payment confirmations, creates transaction records

### Stripe Connect Integration
- **POST** `/api/payments/connect/onboard` - Start Stripe onboarding
  - **Auth:** Required (GM only)

- **GET** `/api/payments/connect/status` - Get onboarding status
  - **Auth:** Required (GM only)

- **POST** `/api/payments/connect/account` - Create Stripe account
  - **Auth:** Required (GM only)

- **POST** `/api/payments/connect/dashboard` - Get Stripe dashboard link
  - **Auth:** Required (GM only)

---

## Campaign Templates

### Template CRUD
- **GET** `/api/templates` - Get templates
  - **Auth:** Required
  - **Query:** `limit`, `offset`, `type`, `public` (for public templates)
  - **Features:** Personal templates or public template browsing

- **POST** `/api/templates` - Create template
  - **Auth:** Required (GM only)
  - **Body:** Template data with variables and field mappings

- **GET** `/api/templates/[templateId]` - Get template details
- **PUT** `/api/templates/[templateId]` - Update template
- **DELETE** `/api/templates/[templateId]` - Delete template

### Template Operations
- **POST** `/api/templates/[templateId]/apply` - Apply template to create game
  - **Auth:** Required (GM only)
  - **Body:** Variable values for template substitution

- **POST** `/api/templates/[templateId]/duplicate` - Duplicate template
  - **Auth:** Required (GM only)
  - **Features:** Tracks original author for analytics

- **POST** `/api/templates/[templateId]/save-as-new` - Save template as new version

### Template Sharing
- **POST** `/api/templates/[templateId]/share` - Generate share code
  - **Auth:** Required (template owner only)

- **GET** `/api/templates/preview` - Preview template via share code
  - **Query:** `shareCode`

- **POST** `/api/templates/import` - Import template via share code
  - **Auth:** Required (GM only)
  - **Body:** `shareCode`

- **POST** `/api/templates/from-game` - Create template from existing game
  - **Auth:** Required (GM only)
  - **Body:** `gameId`, template metadata

---

## Campaign Wiki System

### Wiki Management
- **GET** `/api/wiki` - Get wiki by game ID
  - **Auth:** Required (GM or player in game)
  - **Query:** `gameId`

- **POST** `/api/wiki` - Create wiki for game
  - **Auth:** Required (GM only)
  - **Body:** `gameId`, optional `name`

- **GET** `/api/wiki/[wikiId]` - Get wiki details
- **PUT** `/api/wiki/[wikiId]` - Update wiki
- **DELETE** `/api/wiki/[wikiId]` - Delete wiki

### Wiki Settings
- **GET** `/api/wiki/[wikiId]/settings` - Get wiki settings
- **PUT** `/api/wiki/[wikiId]/settings` - Update wiki settings
  - **Auth:** Required (GM only)
  - **Body:** Permissions, features, access controls

### Wiki Pages
- **GET** `/api/wiki/[wikiId]/pages` - List wiki pages
  - **Auth:** Required (wiki access)

- **POST** `/api/wiki/[wikiId]/pages` - Create wiki page
  - **Auth:** Required (edit permissions)
  - **Body:** Page content with template support

- **GET** `/api/wiki/[wikiId]/pages/[pageId]` - Get page
- **PUT** `/api/wiki/[wikiId]/pages/[pageId]` - Update page
- **DELETE** `/api/wiki/[wikiId]/pages/[pageId]` - Delete page

### Wiki Templates
- **GET** `/api/wiki/templates/[pageType]` - Get page template
  - **Params:** `pageType` (NPC, Location, Adventure Arc, Session Notes, Item, Faction, Timeline, Custom)

### Wiki Attachments
- **GET** `/api/wiki/[wikiId]/attachments` - List attachments
- **POST** `/api/wiki/[wikiId]/attachments` - Upload attachment
- **GET** `/api/wiki/[wikiId]/attachments/[attachmentId]` - Get attachment
- **DELETE** `/api/wiki/[wikiId]/attachments/[attachmentId]` - Delete attachment

---

## Admin Functions

### Admin User Management
- **POST** `/api/admin/users/[id]/make-admin` - Grant admin access
  - **Auth:** Required (admin only)
  - **Features:** Cannot grant admin to self

- **POST** `/api/admin/users/[id]/revoke-admin` - Revoke admin access
  - **Auth:** Required (admin only)
  - **Features:** Cannot revoke own admin

- **DELETE** `/api/admin/users/[id]/delete` - Delete user account
  - **Auth:** Required (admin only)
  - **Features:** Cannot delete own account, comprehensive cleanup

### Admin Game Management
- **GET** `/api/admin/games/[id]` - Get game details (admin view)
- **PUT** `/api/admin/games/[id]` - Update any game (admin override)

### Admin Operations
- **POST** `/api/admin/cleanup-interests` - Cleanup orphaned interests
- **GET** `/api/admin/transactions` - Get all platform transactions
- **POST** `/api/admin/test-payment` - Test payment processing

---

## Development & Debug

### Debug Endpoints
- **GET** `/api/debug/transactions` - Debug transaction data
- **POST** `/api/dev/reset-booking` - Reset booking for testing
- **POST** `/api/dev/reset-payments` - Reset all payment data
- **POST** `/api/dev/reset-payments/[gameId]` - Reset payments for specific game

---

## API Design Patterns

### Authentication
- **Session-based:** All protected endpoints use NextAuth.js session
- **Role-based:** GM, Player, and Admin permissions enforced
- **Ownership:** Resource owners can modify their own data

### Response Format
```json
{
  "data": {}, // Success response
  "error": "message", // Error response
  "details": {} // Additional error details (validation)
}
```

### Error Codes
- **200:** Success
- **201:** Created
- **400:** Bad Request / Validation Error
- **401:** Unauthorized 
- **403:** Forbidden
- **404:** Not Found
- **409:** Conflict
- **500:** Internal Server Error

### Rate Limiting
- No explicit rate limiting implemented
- Relies on Vercel's built-in protections

### Pagination
- **Query params:** `page`, `limit`, `offset`
- **Response:** Includes `total`, `hasMore` flags
- **Default limit:** 20 items per page

---

## Key Features

### Pre-Authorization Payment System
- Campaign bookings create payment intents for ALL future sessions
- Payment intents are confirmed but not captured initially  
- GM starts sessions to capture authorized payments session-by-session
- Comprehensive error handling for failed/expired authorizations

### Template System
- Variable substitution with type validation
- Public template marketplace with usage tracking
- Original author tracking through duplication chains
- Share codes for template distribution

### Wiki System
- Rich text editing with wiki link support `[[Page Name]]`
- Page templates for different content types
- Permission system for GM vs Player access
- File attachment support (database ready)

### Admin Tools
- Complete user management with safety protections
- Transaction monitoring and debugging tools
- Platform statistics and cleanup utilities

---

*Last updated: January 2025*  
*API Version: Phase 1 Complete*