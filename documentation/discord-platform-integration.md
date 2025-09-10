# Platform Integration Guide
## Connecting Discord Bot to Arcane Circle Platform

## Overview

This guide explains how to integrate the Discord Transcription Bot with your existing Arcane Circle TTRPG marketplace platform, enabling seamless transcript management for your games.

## Integration Architecture

```
┌─────────────────────────────────────────────────────┐
│                 Arcane Circle Platform               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Next.js    │  │  PostgreSQL  │  │   Stripe  │  │
│  │   Frontend   │  │   Database   │  │  Payments │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │   Shared     │
                    │   Database   │
                    └──────┬──────┘
                           │
┌─────────────────────────────────────────────────────┐
│              Discord Transcription Bot               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │   Discord    │  │ Transcription│  │   Queue   │  │
│  │     Bot      │  │   Service    │  │   System  │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────┘
```

## Database Integration

### Extending Existing Schema

Add these tables to your existing Arcane Circle database:

```sql
-- Link transcripts to your existing games table
ALTER TABLE recording_sessions 
ADD COLUMN game_id UUID REFERENCES games(id) ON DELETE SET NULL,
ADD COLUMN booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL;

-- Add Discord info to your users table
ALTER TABLE users 
ADD COLUMN discord_id VARCHAR(100) UNIQUE,
ADD COLUMN discord_username VARCHAR(100),
ADD COLUMN discord_discriminator VARCHAR(10);

-- Create index for faster lookups
CREATE INDEX idx_users_discord_id ON users(discord_id);
CREATE INDEX idx_recording_sessions_game_id ON recording_sessions(game_id);
```

### User Account Linking

```typescript
// services/UserLinkingService.ts
import { prisma } from '@/lib/db';

export class UserLinkingService {
  /**
   * Link Discord account to Arcane Circle user
   */
  static async linkDiscordAccount(
    userId: string,        // Arcane Circle user ID
    discordId: string,
    discordUsername: string,
    discordDiscriminator: string
  ): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        discordId,
        discordUsername,
        discordDiscriminator,
      },
    });
  }

  /**
   * Get Arcane Circle user by Discord ID
   */
  static async getUserByDiscordId(discordId: string) {
    return prisma.user.findUnique({
      where: { discordId },
      include: {
        profile: true,
        gamesAsGM: {
          where: { status: 'PUBLISHED' },
        },
      },
    });
  }

  /**
   * Check if user is GM of a game
   */
  static async isUserGMOfGame(discordId: string, gameId: string): Promise<boolean> {
    const user = await this.getUserByDiscordId(discordId);
    if (!user) return false;

    const game = await prisma.game.findFirst({
      where: {
        id: gameId,
        gmId: user.id,
      },
    });

    return !!game;
  }
}
```

## API Endpoints for Platform

### REST API Implementation

```typescript
// app/api/discord/link/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { code } = await req.json();

  try {
    // Exchange code for Discord user info
    const discordUser = await exchangeCodeForUser(code);
    
    // Link accounts
    await UserLinkingService.linkDiscordAccount(
      session.user.id,
      discordUser.id,
      discordUser.username,
      discordUser.discriminator
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to link account' }, { status: 500 });
  }
}

// app/api/transcripts/[sessionId]/route.ts
export async function GET(
  req: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const transcript = await prisma.sessionTranscript.findFirst({
    where: { 
      sessionId: params.sessionId,
      session: {
        OR: [
          { startedBy: session.user.discordId },
          { game: { gmId: session.user.id } },
          { 
            game: { 
              bookings: {
                some: {
                  playerId: session.user.id,
                  status: 'CONFIRMED'
                }
              }
            }
          }
        ]
      }
    },
    include: {
      segments: { orderBy: { segmentIndex: 'asc' } },
      session: {
        include: {
          game: true
        }
      }
    }
  });

  if (!transcript) {
    return NextResponse.json({ error: 'Transcript not found' }, { status: 404 });
  }

  return NextResponse.json(transcript);
}
```

## Discord OAuth2 Setup

### Frontend Implementation

```typescript
// components/DiscordLinkButton.tsx
'use client';
import { Button } from '@/components/ui/button';
import { Discord } from 'lucide-react';

const DISCORD_CLIENT_ID = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
const REDIRECT_URI = process.env.NEXT_PUBLIC_DISCORD_REDIRECT_URI;

export function DiscordLinkButton() {
  const handleLink = () => {
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID!,
      redirect_uri: REDIRECT_URI!,
      response_type: 'code',
      scope: 'identify guilds',
    });

    window.location.href = `https://discord.com/api/oauth2/authorize?${params}`;
  };

  return (
    <Button onClick={handleLink} variant="outline">
      <Discord className="mr-2 h-4 w-4" />
      Link Discord Account
    </Button>
  );
}

// app/dashboard/settings/discord/callback/page.tsx
'use client';
import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function DiscordCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const code = searchParams.get('code');
    if (code) {
      linkAccount(code);
    }
  }, [searchParams]);

  const linkAccount = async (code: string) => {
    try {
      const response = await fetch('/api/discord/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (response.ok) {
        router.push('/dashboard/settings?linked=true');
      }
    } catch (error) {
      console.error('Failed to link Discord account:', error);
    }
  };

  return <div>Linking Discord account...</div>;
}
```

## Bot Commands with Platform Integration

### Enhanced Record Command

```typescript
// commands/record-enhanced.ts
import { prisma } from '@/database/client';
import { UserLinkingService } from '@/services/UserLinkingService';

async function handleStartWithGame(
  interaction: CommandInteraction,
  voiceChannel: VoiceChannel,
  gameId: string
) {
  // Verify user is GM of the game
  const isGM = await UserLinkingService.isUserGMOfGame(
    interaction.user.id,
    gameId
  );

  if (!isGM) {
    return interaction.reply({
      content: '❌ You must be the GM of this game to record it!',
      ephemeral: true,
    });
  }

  // Start recording linked to game
  const sessionId = await recordingManager.startRecordingForGame(
    voiceChannel,
    interaction.member as GuildMember,
    gameId
  );

  // Notify players in the game
  await notifyGamePlayers(gameId, sessionId);

  const embed = new EmbedBuilder()
    .setTitle('🔴 Game Recording Started')
    .setColor(0xff0000)
    .setDescription(`Recording session for game`)
    .addFields(
      { name: 'Game ID', value: gameId, inline: true },
      { name: 'Session ID', value: sessionId, inline: true }
    );

  await interaction.reply({ embeds: [embed] });
}
```

## Webhook Integration

### Notify Platform of Transcript Completion

```typescript
// services/WebhookService.ts
export class WebhookService {
  static async notifyTranscriptComplete(
    sessionId: string,
    transcriptId: string
  ) {
    const webhook = process.env.PLATFORM_WEBHOOK_URL;
    if (!webhook) return;

    try {
      await fetch(webhook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': process.env.WEBHOOK_SECRET!,
        },
        body: JSON.stringify({
          event: 'transcript.completed',
          data: {
            sessionId,
            transcriptId,
            timestamp: new Date().toISOString(),
          },
        }),
      });
    } catch (error) {
      console.error('Webhook notification failed:', error);
    }
  }
}

// In your processing queue
async function onTranscriptionComplete(sessionId: string) {
  const transcript = await getTranscript(sessionId);
  
  // Notify platform
  await WebhookService.notifyTranscriptComplete(
    sessionId,
    transcript.id
  );
  
  // Send email to GM if game is linked
  if (transcript.session.gameId) {
    await sendTranscriptEmail(transcript);
  }
}
```

## Frontend Components for Transcripts

### Transcript Viewer Component

```tsx
// components/transcript/TranscriptViewer.tsx
'use client';
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Search, Users } from 'lucide-react';

interface TranscriptViewerProps {
  sessionId: string;
  gameId?: string;
}

export function TranscriptViewer({ sessionId, gameId }: TranscriptViewerProps) {
  const [transcript, setTranscript] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string | null>(null);

  useEffect(() => {
    loadTranscript();
  }, [sessionId]);

  const loadTranscript = async () => {
    const response = await fetch(`/api/transcripts/${sessionId}`);
    const data = await response.json();
    setTranscript(data);
  };

  const exportTranscript = async (format: 'pdf' | 'txt' | 'json') => {
    const response = await fetch(`/api/transcripts/${sessionId}/export?format=${format}`);
    const blob = await response.blob();
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${sessionId}.${format}`;
    a.click();
  };

  const filteredSegments = transcript?.segments.filter((segment: any) => {
    const matchesSearch = segment.text.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSpeaker = !selectedSpeaker || segment.speaker === selectedSpeaker;
    return matchesSearch && matchesSpeaker;
  });

  if (!transcript) return <div>Loading transcript...</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="p-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold">Session Transcript</h2>
            <p className="text-muted-foreground">
              {new Date(transcript.session.startedAt).toLocaleDateString()} • 
              {transcript.wordCount} words • 
              {Math.round(transcript.duration / 60)} minutes
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => exportTranscript('pdf')} variant="outline">
              <Download className="mr-2 h-4 w-4" />
              PDF
            </Button>
            <Button onClick={() => exportTranscript('txt')} variant="outline">
              <Download className="mr-2 h-4 w-4" />
              TXT
            </Button>
          </div>
        </div>
      </Card>

      {/* Controls */}
      <Card className="p-4">
        <div className="flex gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search transcript..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <select
            value={selectedSpeaker || ''}
            onChange={(e) => setSelectedSpeaker(e.target.value || null)}
            className="px-3 py-2 border rounded-md"
          >
            <option value="">All Speakers</option>
            {Array.from(new Set(transcript.segments.map((s: any) => s.speaker))).map(speaker => (
              <option key={speaker} value={speaker}>{speaker}</option>
            ))}
          </select>
        </div>
      </Card>

      {/* Transcript Content */}
      <Card className="p-6">
        <div className="space-y-4">
          {filteredSegments?.map((segment: any, index: number) => (
            <div key={index} className="border-l-2 border-gray-200 pl-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold">{segment.speaker}</span>
                <span className="text-xs text-muted-foreground">
                  {formatTime(segment.startTime)}
                </span>
              </div>
              <p className="text-gray-700">{segment.text}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
```

### Game Dashboard Integration

```tsx
// components/game/GameTranscripts.tsx
'use client';
import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Mic, FileText, Calendar } from 'lucide-react';
import Link from 'next/link';

interface GameTranscriptsProps {
  gameId: string;
  isGM: boolean;
}

export function GameTranscripts({ gameId, isGM }: GameTranscriptsProps) {
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const [discordLinked, setDiscordLinked] = useState(false);

  useEffect(() => {
    loadTranscripts();
    checkDiscordLink();
  }, [gameId]);

  const loadTranscripts = async () => {
    const response = await fetch(`/api/games/${gameId}/transcripts`);
    const data = await response.json();
    setTranscripts(data);
  };

  const checkDiscordLink = async () => {
    const response = await fetch('/api/user/discord-status');
    const data = await response.json();
    setDiscordLinked(data.linked);
  };

  if (!discordLinked && isGM) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Enable Session Recording</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4">
            Link your Discord account to enable automatic session recording and transcription.
          </p>
          <DiscordLinkButton />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="h-5 w-5" />
          Session Transcripts
        </CardTitle>
      </CardHeader>
      <CardContent>
        {transcripts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No transcripts yet</p>
            {isGM && (
              <p className="text-sm mt-2">
                Use `/record start` in Discord to record your next session
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {transcripts.map((transcript) => (
              <div
                key={transcript.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent"
              >
                <div>
                  <div className="font-medium">
                    Session {new Date(transcript.createdAt).toLocaleDateString()}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {transcript.wordCount} words • {transcript.speakerCount} speakers
                  </div>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/games/${gameId}/transcripts/${transcript.sessionId}`}>
                    View
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

## Session Notes AI Integration

```typescript
// services/SessionNotesService.ts
import OpenAI from 'openai';

export class SessionNotesService {
  private openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  async generateSessionSummary(transcript: string): Promise<SessionSummary> {
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You are a helpful TTRPG session assistant. Analyze this session transcript and provide:
            1. A brief summary (2-3 paragraphs)
            2. Key plot developments
            3. Character moments
            4. Combat encounters
            5. Important NPCs mentioned
            6. Locations visited
            7. Items acquired
            8. Unresolved plot threads
            9. Next session setup`,
        },
        {
          role: 'user',
          content: transcript,
        },
      ],
      response_format: { type: 'json_object' },
    });

    return JSON.parse(completion.choices[0].message.content!);
  }

  async extractActionItems(transcript: string): Promise<ActionItem[]> {
    // Extract TODO items, quest objectives, etc.
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Extract action items, quests, and objectives from this TTRPG session.',
        },
        {
          role: 'user',
          content: transcript,
        },
      ],
    });

    return this.parseActionItems(completion.choices[0].message.content!);
  }
}
```

## Permissions & Security

```typescript
// middleware/transcriptAuth.ts
export async function canAccessTranscript(
  userId: string,
  sessionId: string
): Promise<boolean> {
  const session = await prisma.recordingSession.findUnique({
    where: { id: sessionId },
    include: {
      game: {
        include: {
          bookings: true,
        },
      },
    },
  });

  if (!session) return false;

  // Check if user is:
  // 1. The person who started recording
  // 2. The GM of the game
  // 3. A confirmed player in the game
  
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) return false;

  // Started the recording
  if (session.startedBy === user.discordId) return true;

  // Is GM of the game
  if (session.game?.gmId === userId) return true;

  // Is player in the game
  if (session.game?.bookings.some(b => 
    b.playerId === userId && b.status === 'CONFIRMED'
  )) {
    return true;
  }

  return false;
}
```

## Environment Variables for Integration

```bash
# Add to your .env files

# Platform Integration
PLATFORM_API_URL=http://localhost:3000
PLATFORM_WEBHOOK_URL=http://localhost:3000/api/webhooks/discord
WEBHOOK_SECRET=your_webhook_secret_here

# Discord OAuth2
DISCORD_CLIENT_ID=your_discord_app_client_id
DISCORD_CLIENT_SECRET=your_discord_app_client_secret
DISCORD_REDIRECT_URI=http://localhost:3000/dashboard/settings/discord/callback

# Shared Database
DATABASE_URL=postgresql://user:password@localhost:5432/arcane_circle

# Feature Flags
ENABLE_TRANSCRIPT_SHARING=true
ENABLE_AI_SUMMARIES=true
ENABLE_PLAYER_ACCESS=true
```

## Deployment Considerations

### Shared Infrastructure
- Use the same PostgreSQL database for both applications
- Share Redis instance for caching and queues
- Consider using a message queue (RabbitMQ/Kafka) for complex integrations

### Microservices Approach
```yaml
# docker-compose.yml for full platform
version: '3.8'

services:
  # Existing Arcane Circle services
  web:
    image: arcane-circle-web:latest
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/arcane
    depends_on:
      - db
      - redis

  # Discord Bot service
  discord-bot:
    image: arcane-discord-bot:latest
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/arcane
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis

  # Shared services
  db:
    image: postgres:15
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

## Testing Integration

```typescript
// __tests__/integration.test.ts
describe('Platform Integration', () => {
  it('should link Discord account to user', async () => {
    const userId = 'test-user-id';
    const discordId = '123456789';
    
    await UserLinkingService.linkDiscordAccount(
      userId,
      discordId,
      'TestUser',
      '0001'
    );

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    expect(user?.discordId).toBe(discordId);
  });

  it('should restrict transcript access to game participants', async () => {
    const canAccess = await canAccessTranscript('user-id', 'session-id');
    expect(canAccess).toBe(false);
  });
});
```

This integration guide provides everything needed to connect the Discord bot with your Arcane Circle platform, including database schema updates, API endpoints, frontend components, and security considerations.