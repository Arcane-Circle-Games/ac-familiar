# Bot Authentication Implementation Guide

## Overview
This document describes the bot authentication system for the Arcane Circle Discord bot to authenticate with the Next.js API.

## Architecture

The bot uses a **Bot API Key** authentication pattern where:
1. Bot sends `Authorization: Bearer <BOT_API_KEY>` header with all requests
2. API validates the bot key and extracts the Discord user ID from the request body
3. API verifies the Discord user is authorized for the requested operation
4. API performs the operation on behalf of the user

## Discord Bot Changes (COMPLETED)

### 1. Configuration (`src/utils/config.ts`)
Added `BOT_API_KEY` to the configuration schema:
```typescript
BOT_API_KEY: z.string().min(1, 'Bot API key is required'),
```

### 2. API Client (`src/services/api/client.ts`)
Updated to automatically send bot authentication header:
```typescript
// Add bot authentication header (preferred for bot-to-API communication)
if (config.BOT_API_KEY) {
  requestConfig.headers.Authorization = `Bearer ${config.BOT_API_KEY}`;
}
```

### 3. Wiki Service (`src/services/api/wiki.ts`)
Updated `postSessionTranscript` to include `discordUserId` in request body:
```typescript
const payload = {
  sessionId,
  summary,
  discordUserId  // Required for bot auth
};

return await apiClient.post<WikiPage>(`/wiki/${wikiId}/pages/session-summary`, payload);
```

### 4. Post Summary Command (`src/commands/post-summary.ts`)
Updated to NOT create wikis - only post to existing wikis:
- Removed wiki creation logic
- Added helpful error message directing users to create wiki on website first

### 5. Environment Variables
Added to `.env.example`:
```bash
BOT_API_KEY=your_secure_bot_api_key_here
```

## Bot Flow

1. User runs `/post-summary session-id:session_2`
2. Bot verifies user's Discord account is linked
3. Bot loads the session summary from local files
4. Bot fetches user's games where they are GM
5. User selects which game to post the summary to
6. Bot looks up wiki for the selected game (GET /api/wiki?gameId=...)
7. **If no wiki exists**: Bot tells user to create wiki on website first and exits
8. **If wiki exists**: Bot posts summary (POST /api/wiki/{wikiId}/pages/session-summary)
9. Bot shows success message with page details

## API Implementation (TODO)

### 1. Create Bot Auth Middleware (`src/lib/bot-auth.ts`)

```typescript
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export interface BotAuthContext {
  isBot: boolean;
  userId?: string;
  discordId?: string;
}

/**
 * Middleware to authenticate bot requests
 * Validates bot API key and extracts user context from request body
 */
export async function authenticateBotRequest(
  request: NextRequest,
  bodyData?: any
): Promise<BotAuthContext> {
  const authHeader = request.headers.get('authorization');

  // Check for bot auth header
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { isBot: false };
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  // Validate bot API key
  if (token !== process.env.BOT_API_KEY) {
    throw new Error('Invalid bot API key');
  }

  // Extract Discord user ID from request body
  const discordId = bodyData?.discordUserId;
  if (!discordId) {
    throw new Error('Bot requests must include discordUserId in request body');
  }

  // Look up user by Discord ID
  const user = await prisma.user.findFirst({
    where: {
      accounts: {
        some: {
          provider: 'discord',
          providerAccountId: discordId
        }
      }
    },
    select: {
      id: true
    }
  });

  if (!user) {
    throw new Error('Discord account not linked to Arcane Circle');
  }

  return {
    isBot: true,
    userId: user.id,
    discordId
  };
}
```

### 2. Update Session Summary Endpoint (`src/app/api/wiki/[wikiId]/pages/session-summary/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { authenticateBotRequest } from '@/lib/bot-auth';
import { prisma } from '@/lib/prisma';

export async function POST(
  request: NextRequest,
  { params }: { params: { wikiId: string } }
) {
  try {
    const body = await request.json();
    const { sessionId, summary, discordUserId } = body;

    // Validate required fields
    if (!sessionId || !summary) {
      return NextResponse.json(
        { error: 'sessionId and summary are required' },
        { status: 400 }
      );
    }

    let userId: string;

    // Try bot authentication first
    const botAuth = await authenticateBotRequest(request, body);

    if (botAuth.isBot) {
      // Bot authentication successful
      if (!botAuth.userId) {
        return NextResponse.json(
          { error: 'Discord account not linked' },
          { status: 401 }
        );
      }
      userId = botAuth.userId;
    } else {
      // Fall back to NextAuth session
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
      userId = session.user.id;
    }

    // Get wiki and verify it exists
    const wiki = await prisma.wiki.findUnique({
      where: { id: params.wikiId },
      include: {
        game: {
          select: {
            gmId: true
          }
        }
      }
    });

    if (!wiki) {
      return NextResponse.json(
        { error: 'Wiki not found' },
        { status: 404 }
      );
    }

    // Verify user is the GM of this game
    if (wiki.game.gmId !== userId) {
      return NextResponse.json(
        { error: 'Only the GM can post session summaries' },
        { status: 403 }
      );
    }

    // Generate page title from session date
    const sessionDate = new Date();
    const pageTitle = `Session Notes - ${sessionDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })}`;

    // Create wiki page with session summary
    const page = await prisma.wikiPage.create({
      data: {
        wikiId: params.wikiId,
        title: pageTitle,
        content: summary,
        pageType: 'Session Notes',
        isPublic: false,
        createdBy: userId,
        metadata: {
          sessionId,
          source: botAuth.isBot ? 'discord-bot' : 'web',
          ...(botAuth.isBot && { discordUserId })
        }
      }
    });

    return NextResponse.json({
      success: true,
      data: page
    });

  } catch (error) {
    console.error('Error posting session summary:', error);

    const message = error instanceof Error ? error.message : 'Failed to post session summary';
    const status = message.includes('Invalid bot API key') || message.includes('not linked') ? 401 : 500;

    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
```

### 3. Environment Variables

Add to `.env` (or `.env.local`):
```bash
BOT_API_KEY=your_secure_random_string_here
```

**Important**: Use a cryptographically secure random string. Generate with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Wiki Lookup Endpoint (`src/app/api/wiki/route.ts`)

The GET endpoint needs to support bot authentication via query parameters:

```typescript
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get('gameId');
    const discordUserId = searchParams.get('discordUserId');

    if (!gameId) {
      return NextResponse.json(
        { error: 'gameId parameter is required' },
        { status: 400 }
      );
    }

    // Authenticate bot request if discordUserId is provided
    if (discordUserId) {
      const bodyData = { discordUserId };
      const botAuth = await authenticateBotRequest(request, bodyData);

      if (!botAuth.isBot || !botAuth.userId) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }

      // Bot authenticated - proceed with wiki lookup
    }

    // Look up wiki by game ID
    const wiki = await prisma.wiki.findFirst({
      where: { gameId }
    });

    return NextResponse.json({
      success: true,
      data: { wiki: wiki || null }
    });

  } catch (error) {
    console.error('Error fetching wiki:', error);

    const message = error instanceof Error ? error.message : 'Failed to fetch wiki';
    const status = message.includes('Invalid bot API key') || message.includes('not linked') ? 401 : 500;

    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
```

**Bot Request Format:**
```
GET /api/wiki?gameId=cmfp2fj6u0001ii04u21oql78&discordUserId=93420059858305024
Authorization: Bearer <BOT_API_KEY>
```

**Important**: The bot should **NOT** create wikis. Wikis should be created through the web interface by the GM. If no wiki exists, the bot will inform the user to create one on the website first.

### 5. Wiki Creation Endpoint (Optional - Web Only)

If you want to support bot-authenticated wiki creation in the future, update the POST endpoint to support bot authentication:

```typescript
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gameId, discordUserId } = body;

    let userId: string;

    // Try bot authentication first
    const botAuth = await authenticateBotRequest(request, body);

    if (botAuth.isBot) {
      if (!botAuth.userId) {
        return NextResponse.json(
          { error: 'Discord account not linked' },
          { status: 401 }
        );
      }
      userId = botAuth.userId;
    } else {
      // Fall back to NextAuth session
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
      userId = session.user.id;
    }

    // Verify user is the GM of the game
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: { gmId: true }
    });

    if (!game || game.gmId !== userId) {
      return NextResponse.json(
        { error: 'Only the GM can create a wiki for their game' },
        { status: 403 }
      );
    }

    // Create wiki
    const wiki = await prisma.wiki.create({
      data: {
        gameId,
        name: `Wiki`, // You can make this configurable
        createdBy: userId
      }
    });

    return NextResponse.json({
      success: true,
      data: wiki
    });

  } catch (error) {
    console.error('Error creating wiki:', error);
    return NextResponse.json(
      { error: 'Failed to create wiki' },
      { status: 500 }
    );
  }
}
```


## Security Considerations

1. **API Key Storage**: Store `BOT_API_KEY` securely in environment variables, never commit to version control
2. **Key Rotation**: Plan to rotate the API key periodically
3. **Rate Limiting**: Consider adding rate limiting to bot-authenticated endpoints
4. **Audit Logging**: Log all bot operations with Discord user ID for audit trail
5. **HTTPS Only**: Ensure all bot requests use HTTPS in production
6. **Shared Secret**: Both bot and API must have the same `BOT_API_KEY` value

## Testing

### Test Bot Authentication Flow

1. Set `BOT_API_KEY` in both environments (bot `.env` and API `.env`)
2. Start the API server
3. Start the Discord bot
4. Use `/test-summary` command to verify bot can read session files
5. Use `/post-summary` command to post a session summary to a wiki
6. Verify:
   - Request includes `Authorization: Bearer <BOT_API_KEY>` header
   - Request body includes `discordUserId`
   - API successfully authenticates and creates wiki page
   - User is verified as GM of the game

### Expected Request Format

```http
POST /api/wiki/{wikiId}/pages/session-summary
Authorization: Bearer <BOT_API_KEY>
Content-Type: application/json

{
  "sessionId": "912dbedd-e70a-4e73-b645-303e6f211e86",
  "summary": "# Session Summary...",
  "discordUserId": "93420059858305024"
}
```

### Expected Response Format

```json
{
  "success": true,
  "data": {
    "id": "page-id",
    "wikiId": "wiki-id",
    "title": "Session Notes - Oct 14, 2025",
    "content": "# Session Summary...",
    "pageType": "Session Notes",
    "isPublic": false,
    "createdBy": "user-id",
    "createdAt": "2025-10-14T...",
    "updatedAt": "2025-10-14T...",
    "metadata": {
      "sessionId": "912dbedd-e70a-4e73-b645-303e6f211e86",
      "source": "discord-bot",
      "discordUserId": "93420059858305024"
    }
  }
}
```

## Deployment Checklist

### Bot (Discord Bot)
- [ ] Add `BOT_API_KEY` to `.env`
- [ ] Ensure key matches API's `BOT_API_KEY`
- [ ] Restart bot after adding key
- [ ] Test with `/post-summary` command

### API (Next.js)
- [ ] Create `src/lib/bot-auth.ts` middleware
- [ ] Update wiki endpoints to use bot auth
- [ ] Add `BOT_API_KEY` to environment variables
- [ ] Ensure key matches bot's `BOT_API_KEY`
- [ ] Deploy to Vercel/production
- [ ] Test bot authentication flow

## Troubleshooting

### 401 Unauthorized
- Verify `BOT_API_KEY` matches in both environments
- Check bot is sending `Authorization` header
- Verify Discord user is linked to Arcane Circle account

### 403 Forbidden
- Verify user is the GM of the game
- Check game ID is correct
- Verify wiki belongs to the correct game

### 404 Not Found
- Check wiki exists for the game
- Verify endpoint URL is correct (`/pages/session-summary` not `/session-summary`)
- Check route file location in Next.js

### Discord User Not Found
- User must link their Discord account via OAuth on the web platform
- Verify `/api/users/discord/{discordId}` returns user data
- Check Discord account linkage in database
