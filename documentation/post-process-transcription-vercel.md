# Post-Processing Transcription with Vercel Blob Storage

## Overview
Records full session with per-speaker audio files, stores in Vercel Blob during session, then batch transcribes after recording ends. Maintains timestamps for chronological reconstruction.

---

## Dependencies
```bash
npm install @vercel/blob @deepgram/sdk prism-media
npm install stream-buffers  # For buffering audio chunks
```

## Environment Variables
```bash
# Add to .env
BLOB_READ_WRITE_TOKEN=vercel_blob_token_here
DEEPGRAM_API_KEY=your_deepgram_key
TRANSCRIPTION_MODE=post-process
```

---

## Implementation

### 1. Recording Service with Blob Storage
`src/services/recording/BlobRecordingService.ts`
```typescript
import { VoiceReceiver, EndBehaviorType } from '@discordjs/voice';
import { put, del, list, head } from '@vercel/blob';
import prism from 'prism-media';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../utils/logger';

interface AudioSegment {
  userId: string;
  username: string;
  startTime: number;
  endTime?: number;
  blobUrl?: string;
  bufferChunks: Buffer[];
}

interface SessionMetadata {
  sessionId: string;
  gameId?: string;
  channelId: string;
  startTime: number;
  endTime?: number;
  segments: AudioSegment[];
}

export class BlobRecordingService {
  private logger = new Logger('BlobRecording');
  private activeSessions: Map<string, SessionMetadata> = new Map();
  private activeStreams: Map<string, AudioSegment> = new Map();
  
  async startRecording(
    sessionId: string,
    voiceReceiver: VoiceReceiver,
    channelId: string,
    gameId?: string
  ): Promise<void> {
    this.logger.info(`Starting recording session: ${sessionId}`);
    
    const metadata: SessionMetadata = {
      sessionId,
      gameId,
      channelId,
      startTime: Date.now(),
      segments: [],
    };
    
    this.activeSessions.set(sessionId, metadata);
    this.setupVoiceReceiver(voiceReceiver, sessionId);
  }

  private setupVoiceReceiver(receiver: VoiceReceiver, sessionId: string) {
    receiver.speaking.on('start', async (userId) => {
      // Skip bots
      if (this.isBot(userId)) return;
      
      const segmentId = `${sessionId}_${userId}_${Date.now()}`;
      const segment: AudioSegment = {
        userId,
        username: await this.getUsername(userId),
        startTime: Date.now(),
        bufferChunks: [],
      };
      
      this.activeStreams.set(segmentId, segment);
      
      // Subscribe to user's audio
      const audioStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1000,
        },
      });
      
      // Convert to OGG format for compression
      const oggEncoder = new prism.opus.OggLogicalBitstream({
        opusHead: {
          channelCount: 2,
          sampleRate: 48000,
        },
      });
      
      audioStream
        .pipe(oggEncoder)
        .on('data', (chunk: Buffer) => {
          segment.bufferChunks.push(chunk);
        })
        .on('end', async () => {
          segment.endTime = Date.now();
          await this.uploadSegmentToBlob(sessionId, segmentId, segment);
        })
        .on('error', (error) => {
          this.logger.error(`Stream error for ${userId}:`, error);
        });
    });
  }

  private async uploadSegmentToBlob(
    sessionId: string,
    segmentId: string,
    segment: AudioSegment
  ): Promise<void> {
    try {
      // Combine buffer chunks
      const audioBuffer = Buffer.concat(segment.bufferChunks);
      
      // Upload to Vercel Blob
      const { url } = await put(
        `recordings/${sessionId}/${segment.userId}_${segment.startTime}.ogg`,
        audioBuffer,
        {
          access: 'public',
          addRandomSuffix: false,
          contentType: 'audio/ogg',
        }
      );
      
      segment.blobUrl = url;
      segment.bufferChunks = []; // Clear memory
      
      // Update session metadata
      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.segments.push({
          ...segment,
          bufferChunks: [], // Don't store buffers in metadata
        });
      }
      
      this.logger.debug(`Uploaded segment for ${segment.username}: ${url}`);
      this.activeStreams.delete(segmentId);
    } catch (error) {
      this.logger.error('Failed to upload to blob:', error);
    }
  }

  async stopRecording(sessionId: string): Promise<SessionMetadata> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    session.endTime = Date.now();
    
    // Upload metadata to blob
    await put(
      `recordings/${sessionId}/metadata.json`,
      JSON.stringify(session),
      {
        access: 'public',
        contentType: 'application/json',
      }
    );
    
    this.activeSessions.delete(sessionId);
    return session;
  }
  
  private async getUsername(userId: string): Promise<string> {
    // Implement Discord user lookup
    return 'User';
  }
  
  private isBot(userId: string): boolean {
    return false;
  }
}
```

### 2. Post-Processing Transcription Service
`src/services/transcription/PostProcessingService.ts`
```typescript
import { createClient } from '@deepgram/sdk';
import { head, del, list } from '@vercel/blob';
import { prisma } from '../../database/client';
import { Logger } from '../../utils/logger';

interface TranscriptSegment {
  userId: string;
  username: string;
  text: string;
  startTime: number;
  endTime: number;
  words: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
}

export class PostProcessingService {
  private logger = new Logger('PostProcessing');
  private deepgram = createClient(process.env.DEEPGRAM_API_KEY!);

  async processSession(sessionId: string): Promise<string> {
    this.logger.info(`Processing session ${sessionId}`);
    
    // Get metadata from blob
    const metadataBlob = await head(
      `recordings/${sessionId}/metadata.json`
    );
    const metadataResponse = await fetch(metadataBlob.url);
    const metadata = await metadataResponse.json();
    
    // Create database record
    await prisma.transcriptionSession.create({
      data: {
        id: sessionId,
        gameId: metadata.gameId,
        status: 'PROCESSING',
        startedAt: new Date(metadata.startTime),
      },
    });
    
    // Process each audio segment
    const transcripts: TranscriptSegment[] = [];
    
    for (const segment of metadata.segments) {
      if (!segment.blobUrl) continue;
      
      try {
        const transcript = await this.transcribeSegment(segment);
        transcripts.push({
          userId: segment.userId,
          username: segment.username,
          startTime: segment.startTime,
          endTime: segment.endTime,
          ...transcript,
        });
      } catch (error) {
        this.logger.error(`Failed to transcribe segment:`, error);
      }
    }
    
    // Merge transcripts chronologically
    const finalTranscript = this.mergeTranscripts(transcripts, metadata.startTime);
    
    // Save to database
    await this.saveTranscript(sessionId, finalTranscript, transcripts);
    
    // Cleanup blobs
    await this.cleanupBlobs(sessionId);
    
    return finalTranscript;
  }

  private async transcribeSegment(segment: any): Promise<any> {
    // Download audio from blob
    const audioResponse = await fetch(segment.blobUrl);
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    
    // Transcribe with Deepgram
    const { result, error } = await this.deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      {
        model: 'nova-2',
        language: 'en-US',
        smart_format: true,
        punctuate: true,
        utterances: true,
        word_timestamps: true,
      }
    );
    
    if (error) throw error;
    
    return {
      text: result.results.channels[0].alternatives[0].transcript,
      words: result.results.channels[0].alternatives[0].words,
    };
  }

  private mergeTranscripts(
    segments: TranscriptSegment[],
    sessionStartTime: number
  ): string {
    // Create timeline of all words with absolute timestamps
    const timeline: Array<{
      speaker: string;
      word: string;
      absoluteTime: number;
    }> = [];
    
    for (const segment of segments) {
      if (!segment.words) continue;
      
      for (const word of segment.words) {
        timeline.push({
          speaker: segment.username,
          word: word.word,
          absoluteTime: segment.startTime + (word.start * 1000),
        });
      }
    }
    
    // Sort chronologically
    timeline.sort((a, b) => a.absoluteTime - b.absoluteTime);
    
    // Group into speaker blocks
    let transcript = '# Session Transcript\n\n';
    let currentSpeaker = '';
    let currentBlock = '';
    
    for (const entry of timeline) {
      if (entry.speaker !== currentSpeaker) {
        if (currentBlock) {
          transcript += `**${currentSpeaker}:** ${currentBlock}\n\n`;
        }
        currentSpeaker = entry.speaker;
        currentBlock = entry.word;
      } else {
        currentBlock += ' ' + entry.word;
      }
    }
    
    // Add final block
    if (currentBlock) {
      transcript += `**${currentSpeaker}:** ${currentBlock}\n\n`;
    }
    
    return transcript;
  }

  private async saveTranscript(
    sessionId: string,
    transcript: string,
    segments: TranscriptSegment[]
  ): Promise<void> {
    // Update session
    await prisma.transcriptionSession.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        endedAt: new Date(),
        fullTranscript: transcript,
        wordCount: transcript.split(/\s+/).length,
      },
    });
    
    // Save segments for searchability
    for (const segment of segments) {
      await prisma.transcriptionSegment.create({
        data: {
          sessionId,
          userId: segment.userId,
          username: segment.username,
          text: segment.text,
          timestamp: new Date(segment.startTime),
          confidence: 0.95,
        },
      });
    }
  }

  private async cleanupBlobs(sessionId: string): Promise<void> {
    try {
      // List all blobs for this session
      const { blobs } = await list({
        prefix: `recordings/${sessionId}/`,
      });
      
      // Delete each blob
      for (const blob of blobs) {
        await del(blob.url);
      }
      
      this.logger.info(`Cleaned up ${blobs.length} blobs for session ${sessionId}`);
    } catch (error) {
      this.logger.error('Failed to cleanup blobs:', error);
    }
  }
}
```

### 3. Recording Manager
`src/services/recording/RecordingManager.ts`
```typescript
import { VoiceChannel, GuildMember } from 'discord.js';
import { VoiceConnectionManager } from '../voice/VoiceConnectionManager';
import { BlobRecordingService } from './BlobRecordingService';
import { PostProcessingService } from '../transcription/PostProcessingService';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../utils/logger';

export class RecordingManager {
  private logger = new Logger('RecordingManager');
  private voiceManager = new VoiceConnectionManager();
  private recordingService = new BlobRecordingService();
  private processingService = new PostProcessingService();
  private activeSessions: Map<string, string> = new Map();

  async startRecording(
    voiceChannel: VoiceChannel,
    requestedBy: GuildMember,
    gameId?: string
  ): Promise<string> {
    const sessionId = uuidv4();
    
    // Connect to voice
    const connection = await this.voiceManager.joinChannel(voiceChannel);
    
    // Start recording to blob
    await this.recordingService.startRecording(
      sessionId,
      connection.receiver,
      voiceChannel.id,
      gameId
    );
    
    this.activeSessions.set(voiceChannel.id, sessionId);
    this.logger.info(`Started recording ${sessionId}`);
    
    return sessionId;
  }

  async stopRecording(channelId: string): Promise<{
    sessionId: string;
    transcript: string;
  }> {
    const sessionId = this.activeSessions.get(channelId);
    if (!sessionId) throw new Error('No active recording');
    
    // Stop recording
    const metadata = await this.recordingService.stopRecording(sessionId);
    
    // Process in background (or await for immediate result)
    const transcript = await this.processingService.processSession(sessionId);
    
    this.activeSessions.delete(channelId);
    
    return { sessionId, transcript };
  }
  
  isRecording(channelId: string): boolean {
    return this.activeSessions.has(channelId);
  }
}
```

### 4. Updated Commands
`src/commands/recording.ts`
```typescript
import { SlashCommandBuilder, CommandInteraction, GuildMember, EmbedBuilder } from 'discord.js';
import { recordingManager } from '../services/recording/RecordingManager';

export const recordCommand = {
  data: new SlashCommandBuilder()
    .setName('record')
    .setDescription('Record session for transcription')
    .addSubcommand(sub =>
      sub.setName('start').setDescription('Start recording')
    )
    .addSubcommand(sub =>
      sub.setName('stop').setDescription('Stop and transcribe')
    ),

  async execute(interaction: CommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ Join a voice channel first!',
        ephemeral: true,
      });
    }

    if (subcommand === 'start') {
      if (recordingManager.isRecording(voiceChannel.id)) {
        return interaction.reply({
          content: '⚠️ Already recording!',
          ephemeral: true,
        });
      }

      await interaction.deferReply();
      const sessionId = await recordingManager.startRecording(voiceChannel, member);

      const embed = new EmbedBuilder()
        .setTitle('🔴 Recording Started')
        .setColor(0xff0000)
        .setDescription('Audio will be transcribed when you stop')
        .addFields(
          { name: 'Session', value: `\`${sessionId}\``, inline: true },
          { name: 'Storage', value: 'Vercel Blob', inline: true }
        );

      await interaction.editReply({ embeds: [embed] });
    }

    if (subcommand === 'stop') {
      if (!recordingManager.isRecording(voiceChannel.id)) {
        return interaction.reply({
          content: '❌ Not recording!',
          ephemeral: true,
        });
      }

      await interaction.deferReply();
      
      const stopEmbed = new EmbedBuilder()
        .setTitle('⏸️ Processing...')
        .setColor(0xffff00)
        .setDescription('Transcribing audio, this may take a minute...');
      
      await interaction.editReply({ embeds: [stopEmbed] });

      const { sessionId, transcript } = await recordingManager.stopRecording(voiceChannel.id);

      const completeEmbed = new EmbedBuilder()
        .setTitle('✅ Transcription Complete')
        .setColor(0x00ff00)
        .addFields(
          { name: 'Session', value: `\`${sessionId}\``, inline: true },
          { name: 'Words', value: transcript.split(/\s+/).length.toString(), inline: true }
        );

      await interaction.editReply({
        embeds: [completeEmbed],
        files: [{
          attachment: Buffer.from(transcript),
          name: `transcript_${sessionId}.md`
        }]
      });
    }
  },
};
```

---

## Database Schema
```prisma
model TranscriptionSession {
  id             String   @id
  gameId         String?  @map("game_id")
  status         String   // 'RECORDING', 'PROCESSING', 'COMPLETED'
  startedAt      DateTime @map("started_at")
  endedAt        DateTime? @map("ended_at")
  fullTranscript String?  @db.Text @map("full_transcript")
  wordCount      Int?     @map("word_count")
  
  segments       TranscriptionSegment[]
  @@map("transcription_sessions")
}

model TranscriptionSegment {
  id         String   @id @default(uuid())
  sessionId  String   @map("session_id")
  session    TranscriptionSession @relation(fields: [sessionId], references: [id])
  userId     String   @map("user_id")
  username   String
  text       String   @db.Text
  timestamp  DateTime
  confidence Float
  
  @@index([sessionId])
  @@map("transcription_segments")
}
```

---

## Key Differences from Live Version

1. **Storage**: Vercel Blob instead of local files
2. **Processing**: After recording ends, not real-time
3. **Cost**: ~50% cheaper (batch API rates)
4. **Reliability**: Can retry failed transcriptions
5. **Compatibility**: Works with both Deepgram and Whisper

## Vercel Deployment Notes

```javascript
// vercel.json
{
  "functions": {
    "api/discord-webhook.js": {
      "maxDuration": 300  // 5 minutes for processing
    }
  }
}
```

Ensure your Vercel plan supports:
- Blob storage quota (recording files)
- Function duration (transcription processing)
- Bandwidth (downloading audio for transcription)