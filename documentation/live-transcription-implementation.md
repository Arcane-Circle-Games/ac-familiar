# Live Transcription Implementation Guide
## Complete Discord Bot Voice Recording with Deepgram

## Overview
This implementation provides speaker-separated live transcription using Discord's per-user audio streams and Deepgram's streaming API. Each speaker gets their own transcription stream, ensuring clean speaker attribution.

---

## Required Dependencies
```bash
npm install @discordjs/voice @discordjs/opus prism-media
npm install @deepgram/sdk ws
npm install @types/ws -D
```

## Environment Variables
```bash
# Add to .env
DEEPGRAM_API_KEY=your_deepgram_api_key_here
TRANSCRIPTION_MODE=live
```

---

## Core Implementation

### 1. Voice Connection Manager
`src/services/voice/VoiceConnectionManager.ts`
```typescript
import { VoiceChannel, GuildMember } from 'discord.js';
import { 
  joinVoiceChannel, 
  VoiceConnection,
  getVoiceConnection,
  VoiceConnectionStatus
} from '@discordjs/voice';
import { Logger } from '../../utils/logger';

export class VoiceConnectionManager {
  private logger = new Logger('VoiceConnectionManager');

  async joinChannel(voiceChannel: VoiceChannel): Promise<VoiceConnection> {
    // Check if already connected
    let connection = getVoiceConnection(voiceChannel.guild.id);
    
    if (!connection) {
      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false, // Must be false to receive audio
        selfMute: true,
      });

      // Wait for connection to be ready
      await new Promise<void>((resolve, reject) => {
        connection!.on(VoiceConnectionStatus.Ready, resolve);
        connection!.on(VoiceConnectionStatus.Failed, reject);
        setTimeout(() => reject(new Error('Connection timeout')), 10000);
      });
    }

    this.logger.info(`Connected to voice channel: ${voiceChannel.name}`);
    return connection;
  }

  leaveChannel(guildId: string): boolean {
    const connection = getVoiceConnection(guildId);
    if (connection) {
      connection.destroy();
      this.logger.info(`Left voice channel in guild: ${guildId}`);
      return true;
    }
    return false;
  }

  isConnected(guildId: string): boolean {
    const connection = getVoiceConnection(guildId);
    return connection?.state.status === VoiceConnectionStatus.Ready;
  }
}
```

### 2. Live Transcription Service
`src/services/transcription/LiveTranscriptionService.ts`
```typescript
import { VoiceReceiver, EndBehaviorType } from '@discordjs/voice';
import { createWebSocketConnection, LiveTranscriptionEvents } from '@deepgram/sdk';
import { EventEmitter } from 'events';
import { prisma } from '../../database/client';
import prism from 'prism-media';
import { Logger } from '../../utils/logger';
import { Client } from 'discord.js';

interface TranscriptionSegment {
  sessionId: string;
  userId: string;
  username: string;
  text: string;
  timestamp: Date;
  confidence: number;
  isFinal: boolean;
}

interface ActiveUserStream {
  userId: string;
  username: string;
  deepgramConnection: any;
  decoder: prism.opus.Decoder;
}

export class LiveTranscriptionService extends EventEmitter {
  private logger = new Logger('LiveTranscription');
  private activeSessions: Map<string, Map<string, ActiveUserStream>> = new Map();
  private userCache: Map<string, string> = new Map();
  private discordClient: Client;
  private deepgramApiKey: string;

  constructor(discordClient: Client) {
    super();
    this.discordClient = discordClient;
    this.deepgramApiKey = process.env.DEEPGRAM_API_KEY!;
    
    if (!this.deepgramApiKey) {
      throw new Error('DEEPGRAM_API_KEY not found in environment');
    }
  }

  async startSession(
    sessionId: string,
    voiceReceiver: VoiceReceiver,
    gameId?: string,
    channelId?: string
  ): Promise<void> {
    this.logger.info(`Starting transcription session: ${sessionId}`);

    // Initialize session storage
    this.activeSessions.set(sessionId, new Map());

    // Create database record
    await prisma.transcriptionSession.create({
      data: {
        id: sessionId,
        gameId,
        discordChannelId: channelId,
        status: 'LIVE',
        startedAt: new Date(),
      },
    });

    // Set up voice receiver for this session
    this.setupVoiceReceiver(voiceReceiver, sessionId);
  }

  private setupVoiceReceiver(receiver: VoiceReceiver, sessionId: string) {
    // Listen for users starting to speak
    receiver.speaking.on('start', async (userId) => {
      // Skip bots
      const user = await this.discordClient.users.fetch(userId);
      if (user.bot) return;

      this.logger.debug(`User ${user.username} started speaking`);

      // Check if we're already processing this user
      const sessionStreams = this.activeSessions.get(sessionId);
      if (!sessionStreams || sessionStreams.has(userId)) return;

      // Create Deepgram connection for this specific user
      const deepgramConnection = this.createDeepgramConnection(sessionId, userId, user.username);

      // Subscribe to this user's audio stream
      const audioStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1000, // 1 second of silence before ending
        },
      });

      // Create Opus to PCM decoder
      const decoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: 2,
        rate: 48000,
      });

      // Store active stream info
      sessionStreams.set(userId, {
        userId,
        username: user.username,
        deepgramConnection,
        decoder,
      });

      // Pipe Discord audio through decoder to Deepgram
      audioStream
        .pipe(decoder)
        .on('data', (chunk: Buffer) => {
          if (deepgramConnection.getReadyState() === 1) {
            deepgramConnection.send(chunk);
          }
        })
        .on('end', () => {
          this.logger.debug(`User ${user.username} stopped speaking`);
          
          // Finish this user's Deepgram connection
          if (deepgramConnection.getReadyState() === 1) {
            deepgramConnection.finish();
          }
          
          // Remove from active streams
          sessionStreams.delete(userId);
        })
        .on('error', (error) => {
          this.logger.error(`Audio stream error for ${user.username}:`, error);
          sessionStreams.delete(userId);
        });
    });
  }

  private createDeepgramConnection(sessionId: string, userId: string, username: string): any {
    // Create WebSocket connection to Deepgram
    const deepgram = createWebSocketConnection({
      key: this.deepgramApiKey,
      options: {
        transcription: {
          punctuate: true,
          interim_results: true,
          model: 'nova-2',
          language: 'en-US',
          smart_format: true,
          encoding: 'linear16',
          sample_rate: 48000,
          channels: 2,
        },
      },
    });

    // Handle transcription results
    deepgram.addListener(LiveTranscriptionEvents.Transcript, async (data: any) => {
      const alternative = data.channel?.alternatives[0];
      if (alternative?.transcript) {
        await this.handleTranscription(
          sessionId,
          userId,
          username,
          alternative
        );
      }
    });

    // Handle errors
    deepgram.addListener(LiveTranscriptionEvents.Error, (error: any) => {
      this.logger.error(`Deepgram error for user ${username}:`, error);
    });

    return deepgram;
  }

  private async handleTranscription(
    sessionId: string,
    userId: string,
    username: string,
    alternative: any
  ): Promise<void> {
    const segment: TranscriptionSegment = {
      sessionId,
      userId,
      username,
      text: alternative.transcript,
      timestamp: new Date(),
      confidence: alternative.confidence || 0,
      isFinal: !alternative.is_partial,
    };

    // Only save final transcriptions to database
    if (segment.isFinal && segment.text.trim().length > 0) {
      await this.saveSegment(segment);
      
      // Emit event for real-time display
      this.emit('transcription', segment);
      
      this.logger.debug(`[${username}]: ${segment.text}`);
    }
  }

  private async saveSegment(segment: TranscriptionSegment): Promise<void> {
    try {
      await prisma.transcriptionSegment.create({
        data: {
          sessionId: segment.sessionId,
          userId: segment.userId,
          username: segment.username,
          text: segment.text,
          timestamp: segment.timestamp,
          confidence: segment.confidence,
        },
      });
    } catch (error) {
      this.logger.error('Failed to save segment:', error);
    }
  }

  async endSession(sessionId: string): Promise<string> {
    this.logger.info(`Ending transcription session: ${sessionId}`);

    // Close all active connections for this session
    const sessionStreams = this.activeSessions.get(sessionId);
    if (sessionStreams) {
      for (const [userId, stream] of sessionStreams) {
        if (stream.deepgramConnection.getReadyState() === 1) {
          stream.deepgramConnection.finish();
        }
      }
      this.activeSessions.delete(sessionId);
    }

    // Get all segments from database
    const segments = await prisma.transcriptionSegment.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'asc' },
    });

    // Generate formatted transcript
    const transcript = this.formatTranscript(segments);

    // Update session in database
    await prisma.transcriptionSession.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        endedAt: new Date(),
        fullTranscript: transcript,
        wordCount: transcript.split(/\s+/).length,
      },
    });

    return transcript;
  }

  private formatTranscript(segments: any[]): string {
    if (segments.length === 0) return 'No transcription available.';

    let transcript = '# Session Transcript\n\n';
    let currentSpeaker = '';

    for (const segment of segments) {
      if (segment.username !== currentSpeaker) {
        if (currentSpeaker) transcript += '\n\n';
        currentSpeaker = segment.username;
        transcript += `**${currentSpeaker}:** `;
      }
      transcript += segment.text + ' ';
    }

    return transcript.trim();
  }

  async getLiveTranscript(sessionId: string): Promise<string> {
    const segments = await prisma.transcriptionSegment.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'asc' },
    });
    
    return this.formatTranscript(segments);
  }
}
```

### 3. Recording Manager Integration
`src/services/recording/RecordingManager.ts`
```typescript
import { VoiceChannel, GuildMember } from 'discord.js';
import { VoiceConnectionManager } from '../voice/VoiceConnectionManager';
import { LiveTranscriptionService } from '../transcription/LiveTranscriptionService';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../utils/logger';

export class RecordingManager {
  private logger = new Logger('RecordingManager');
  private voiceManager: VoiceConnectionManager;
  private transcriptionService: LiveTranscriptionService;
  private activeSessions: Map<string, string> = new Map(); // channelId -> sessionId

  constructor(discordClient: any) {
    this.voiceManager = new VoiceConnectionManager();
    this.transcriptionService = new LiveTranscriptionService(discordClient);
  }

  async joinChannel(voiceChannel: VoiceChannel): Promise<void> {
    await this.voiceManager.joinChannel(voiceChannel);
  }

  async startRecording(
    voiceChannel: VoiceChannel,
    requestedBy: GuildMember,
    gameId?: string
  ): Promise<string> {
    // Generate session ID
    const sessionId = uuidv4();
    
    // Ensure we're connected to voice
    const connection = await this.voiceManager.joinChannel(voiceChannel);

    // Start live transcription
    await this.transcriptionService.startSession(
      sessionId,
      connection.receiver,
      gameId,
      voiceChannel.id
    );

    // Track active session
    this.activeSessions.set(voiceChannel.id, sessionId);

    // Listen for transcription events (optional - for live updates)
    this.transcriptionService.on('transcription', (segment) => {
      // Could emit to Discord channel or websocket
      this.logger.debug(`Live: [${segment.username}]: ${segment.text}`);
    });

    this.logger.info(`Started recording session ${sessionId} in ${voiceChannel.name}`);
    return sessionId;
  }

  async stopRecording(channelId: string): Promise<{
    sessionId: string;
    transcript: string;
  }> {
    const sessionId = this.activeSessions.get(channelId);
    if (!sessionId) {
      throw new Error('No active recording in this channel');
    }

    // Get final transcript
    const transcript = await this.transcriptionService.endSession(sessionId);
    
    // Clean up
    this.activeSessions.delete(channelId);
    
    this.logger.info(`Stopped recording session ${sessionId}`);
    
    return { sessionId, transcript };
  }

  async getLiveTranscript(channelId: string): Promise<string | null> {
    const sessionId = this.activeSessions.get(channelId);
    if (!sessionId) return null;
    
    return this.transcriptionService.getLiveTranscript(sessionId);
  }

  isRecording(channelId: string): boolean {
    return this.activeSessions.has(channelId);
  }

  leaveChannel(guildId: string): boolean {
    return this.voiceManager.leaveChannel(guildId);
  }
}
```

### 4. Discord Commands Implementation
`src/commands/voice.ts`
```typescript
import { SlashCommandBuilder, CommandInteraction, GuildMember } from 'discord.js';
import { recordingManager } from '../services/recording/RecordingManager';

export const joinCommand = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your voice channel'),

  async execute(interaction: CommandInteraction) {
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ You must be in a voice channel!',
        ephemeral: true,
      });
    }

    try {
      await recordingManager.joinChannel(voiceChannel);
      await interaction.reply({
        content: `✅ Joined **${voiceChannel.name}**`,
      });
    } catch (error) {
      await interaction.reply({
        content: '❌ Failed to join voice channel',
        ephemeral: true,
      });
    }
  },
};

export const leaveCommand = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave the voice channel'),

  async execute(interaction: CommandInteraction) {
    const member = interaction.member as GuildMember;

    const left = recordingManager.leaveChannel(member.guild.id);
    
    if (left) {
      await interaction.reply('✅ Left voice channel');
    } else {
      await interaction.reply({
        content: '❌ Not in a voice channel',
        ephemeral: true,
      });
    }
  },
};
```

`src/commands/recording.ts`
```typescript
import { 
  SlashCommandBuilder, 
  CommandInteraction, 
  GuildMember, 
  EmbedBuilder 
} from 'discord.js';
import { recordingManager } from '../services/recording/RecordingManager';

export const recordCommand = {
  data: new SlashCommandBuilder()
    .setName('record')
    .setDescription('Manage voice recording')
    .addSubcommand(sub =>
      sub
        .setName('start')
        .setDescription('Start recording and transcription')
        .addStringOption(opt =>
          opt
            .setName('game')
            .setDescription('Game ID to link recording to')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('stop')
        .setDescription('Stop recording and get transcript')
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Check recording status')
    ),

  async execute(interaction: CommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel && subcommand !== 'status') {
      return interaction.reply({
        content: '❌ You must be in a voice channel!',
        ephemeral: true,
      });
    }

    switch (subcommand) {
      case 'start':
        return handleStart(interaction, voiceChannel!, member);
      case 'stop':
        return handleStop(interaction, voiceChannel!);
      case 'status':
        return handleStatus(interaction, voiceChannel);
    }
  },
};

async function handleStart(
  interaction: CommandInteraction,
  voiceChannel: any,
  member: GuildMember
) {
  // Check if already recording
  if (recordingManager.isRecording(voiceChannel.id)) {
    return interaction.reply({
      content: '⚠️ Already recording in this channel!',
      ephemeral: true,
    });
  }

  await interaction.deferReply();

  try {
    const gameId = interaction.options.getString('game');
    const sessionId = await recordingManager.startRecording(
      voiceChannel,
      member,
      gameId || undefined
    );

    const embed = new EmbedBuilder()
      .setTitle('🔴 Recording Started')
      .setColor(0xff0000)
      .setDescription('Live transcription is active')
      .addFields(
        { name: 'Channel', value: voiceChannel.name, inline: true },
        { name: 'Session ID', value: `\`${sessionId}\``, inline: true },
        { name: 'Status', value: '🔴 Live', inline: true }
      )
      .setFooter({ text: 'Use /record stop to end and get transcript' });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply('❌ Failed to start recording');
  }
}

async function handleStop(
  interaction: CommandInteraction,
  voiceChannel: any
) {
  if (!recordingManager.isRecording(voiceChannel.id)) {
    return interaction.reply({
      content: '❌ No active recording in this channel!',
      ephemeral: true,
    });
  }

  await interaction.deferReply();

  try {
    const { sessionId, transcript } = await recordingManager.stopRecording(
      voiceChannel.id
    );

    const wordCount = transcript.split(/\s+/).length;

    const embed = new EmbedBuilder()
      .setTitle('⏹️ Recording Stopped')
      .setColor(0x00ff00)
      .setDescription('Transcript ready!')
      .addFields(
        { name: 'Session ID', value: `\`${sessionId}\``, inline: true },
        { name: 'Words', value: wordCount.toString(), inline: true },
        { name: 'Status', value: '✅ Complete', inline: true }
      );

    // Send transcript as file if it's long
    if (transcript.length > 2000) {
      await interaction.editReply({
        embeds: [embed],
        files: [{
          attachment: Buffer.from(transcript),
          name: `transcript_${sessionId}.md`
        }]
      });
    } else {
      await interaction.editReply({
        content: `${embed}\n\n**Preview:**\n${transcript.substring(0, 500)}...`,
        embeds: [embed]
      });
    }
  } catch (error) {
    await interaction.editReply('❌ Failed to stop recording');
  }
}

async function handleStatus(
  interaction: CommandInteraction,
  voiceChannel: any
) {
  if (!voiceChannel) {
    return interaction.reply({
      content: 'Not in a voice channel',
      ephemeral: true,
    });
  }

  const isRecording = recordingManager.isRecording(voiceChannel.id);
  
  const embed = new EmbedBuilder()
    .setTitle('📊 Recording Status')
    .setColor(isRecording ? 0xff0000 : 0x808080)
    .setDescription(isRecording ? 'Recording is active' : 'No active recording')
    .addFields(
      { name: 'Channel', value: voiceChannel.name, inline: true },
      { name: 'Status', value: isRecording ? '🔴 Recording' : '⚫ Idle', inline: true }
    );

  if (isRecording) {
    const liveTranscript = await recordingManager.getLiveTranscript(voiceChannel.id);
    if (liveTranscript) {
      embed.addFields({
        name: 'Live Preview',
        value: liveTranscript.substring(0, 200) + '...',
        inline: false
      });
    }
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
```

### 5. Database Schema
`prisma/schema.prisma`
```prisma
model TranscriptionSession {
  id               String   @id @default(uuid())
  gameId           String?  @map("game_id")
  discordChannelId String?  @map("discord_channel_id")
  status           String   // 'LIVE', 'COMPLETED', 'FAILED'
  startedAt        DateTime @map("started_at")
  endedAt          DateTime? @map("ended_at")
  fullTranscript   String?  @map("full_transcript") @db.Text
  wordCount        Int?     @map("word_count")
  
  segments         TranscriptionSegment[]
  
  @@map("transcription_sessions")
}

model TranscriptionSegment {
  id           String   @id @default(uuid())
  sessionId    String   @map("session_id")
  session      TranscriptionSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  userId       String   @map("user_id")
  username     String
  text         String   @db.Text
  timestamp    DateTime
  confidence   Float
  
  @@index([sessionId, timestamp])
  @@map("transcription_segments")
}
```

### 6. Initialize Recording Manager
`src/bot/index.ts`
```typescript
import { RecordingManager } from '../services/recording/RecordingManager';

// In your bot initialization
export async function initializeBot(): Promise<TranscriptionBot> {
  const bot = new TranscriptionBot();
  
  // Initialize recording manager with Discord client
  const recordingManager = new RecordingManager(bot);
  
  // Make it available globally or pass to commands
  bot.recordingManager = recordingManager;
  
  return bot;
}
```

---

## Testing Flow

1. **Setup Environment**
   ```bash
   # Add Deepgram API key to .env
   DEEPGRAM_API_KEY=your_actual_api_key_here
   
   # Run database migration
   npx prisma migrate dev
   ```

2. **Test Commands**
   ```
   /join                  # Bot joins your voice channel
   /record start          # Starts recording with live transcription
   [Have a conversation]
   /record status         # Check if recording, see live preview
   /record stop           # Stops and gets full transcript
   /leave                 # Bot leaves channel
   ```

3. **Verify Database**
   ```sql
   -- Check session was created
   SELECT * FROM transcription_sessions ORDER BY started_at DESC LIMIT 1;
   
   -- Check segments were saved
   SELECT username, text FROM transcription_segments 
   WHERE session_id = 'your_session_id' 
   ORDER BY timestamp;
   ```

## Expected Output

The final transcript will look like:
```markdown
# Session Transcript

**DM_Sarah:** Welcome everyone to tonight's session. When we last left off, you were entering the goblin cave.

**Player_John:** I light a torch and take point.

**Player_Mary:** I'll ready my bow and stay behind John.

**DM_Sarah:** As you enter, you hear skittering sounds...
```

## Cost Estimate
- Deepgram Nova-2: $0.0059/minute
- 4-hour session: ~$1.42
- Real-time processing, no file storage needed

## Error Handling
The implementation includes error handling for:
- Failed voice connections
- Deepgram API errors
- User disconnections
- Database write failures

All errors are logged but don't crash the bot.