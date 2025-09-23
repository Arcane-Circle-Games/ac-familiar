import { VoiceReceiver, EndBehaviorType } from '@discordjs/voice';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { EventEmitter } from 'events';
import prism from 'prism-media';
import { logInfo, logError, logDebug } from '../../utils/logger';
import { Client } from 'discord.js';

interface TranscriptionSegment {
  sessionId: string;
  userId: string;
  username: string;
  text: string;
  timestamp: Date;
  confidence: number;
  isFinal: boolean;
  duration?: number;
}

interface ActiveUserStream {
  userId: string;
  username: string;
  deepgramConnection: any;
  decoder: prism.opus.Decoder;
  startTime: Date;
  isActive: boolean;
}

interface SessionData {
  sessionId: string;
  gameId?: string;
  channelId?: string;
  guildId?: string;
  startedAt: Date;
  userStreams: Map<string, ActiveUserStream>;
  segments: TranscriptionSegment[];
}

export class LiveTranscriptionService extends EventEmitter {
  private activeSessions: Map<string, SessionData> = new Map();
  private discordClient: Client;
  private deepgramApiKey: string;
  private deepgramClient: any;

  constructor(discordClient: Client) {
    super();
    this.discordClient = discordClient;
    this.deepgramApiKey = process.env.DEEPGRAM_API_KEY!;

    if (!this.deepgramApiKey) {
      throw new Error('DEEPGRAM_API_KEY not found in environment variables');
    }

    // Initialize Deepgram client
    this.deepgramClient = createClient(this.deepgramApiKey);
    logInfo('LiveTranscriptionService initialized', {
      hasApiKey: !!this.deepgramApiKey
    });
  }

  async startSession(
    sessionId: string,
    voiceReceiver: VoiceReceiver,
    gameId?: string,
    channelId?: string,
    guildId?: string
  ): Promise<void> {
    try {
      if (this.activeSessions.has(sessionId)) {
        throw new Error(`Session ${sessionId} is already active`);
      }

      logInfo('Starting transcription session', {
        sessionId,
        gameId,
        channelId,
        guildId
      });

      // Initialize session data
      const sessionData: SessionData = {
        sessionId,
        gameId,
        channelId,
        guildId,
        startedAt: new Date(),
        userStreams: new Map(),
        segments: []
      };

      this.activeSessions.set(sessionId, sessionData);

      // Set up voice receiver for this session
      this.setupVoiceReceiver(voiceReceiver, sessionData);

      // Emit session started event
      this.emit('sessionStarted', {
        sessionId,
        gameId,
        channelId,
        guildId,
        startedAt: sessionData.startedAt
      });

      logInfo('Transcription session started successfully', { sessionId });
    } catch (error) {
      logError('Failed to start transcription session', error as Error, { sessionId });
      throw error;
    }
  }

  private setupVoiceReceiver(receiver: VoiceReceiver, sessionData: SessionData): void {
    const { sessionId } = sessionData;

    // Listen for users starting to speak
    receiver.speaking.on('start', async (userId) => {
      try {
        // Skip if already processing this user
        if (sessionData.userStreams.has(userId)) {
          return;
        }

        // Fetch user info
        const user = await this.discordClient.users.fetch(userId).catch(() => null);
        if (!user || user.bot) {
          return; // Skip bots or failed fetches
        }

        logDebug('User started speaking', {
          userId,
          username: user.username,
          sessionId
        });

        // Create audio stream for this user
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

        // Create Deepgram WebSocket connection
        const deepgramConnection = await this.createDeepgramConnection(
          sessionData,
          userId,
          user.username
        );

        // Store active stream info
        const userStream: ActiveUserStream = {
          userId,
          username: user.username,
          deepgramConnection,
          decoder,
          startTime: new Date(),
          isActive: true
        };

        sessionData.userStreams.set(userId, userStream);

        // Set up audio pipeline: Discord -> Opus Decoder -> PCM -> Deepgram
        audioStream
          .pipe(decoder)
          .on('data', (chunk: Buffer) => {
            if (userStream.isActive && deepgramConnection && deepgramConnection.getReadyState() === 1) {
              try {
                deepgramConnection.send(chunk);
              } catch (error) {
                logError('Error sending audio to Deepgram', error as Error, {
                  userId,
                  username: user.username,
                  sessionId
                });
              }
            }
          })
          .on('end', () => {
            logDebug('User stopped speaking', {
              userId,
              username: user.username,
              sessionId
            });

            // Finish this user's Deepgram connection
            if (deepgramConnection && deepgramConnection.getReadyState() === 1) {
              try {
                deepgramConnection.finish();
              } catch (error) {
                logError('Error finishing Deepgram connection', error as Error, {
                  userId,
                  username: user.username,
                  sessionId
                });
              }
            }

            // Mark stream as inactive and remove from active streams
            userStream.isActive = false;
            sessionData.userStreams.delete(userId);
          })
          .on('error', (error) => {
            logError('Audio stream error', error, {
              userId,
              username: user.username,
              sessionId
            });

            // Clean up on error
            userStream.isActive = false;
            sessionData.userStreams.delete(userId);

            if (deepgramConnection && deepgramConnection.getReadyState() === 1) {
              deepgramConnection.finish();
            }
          });

      } catch (error) {
        logError('Error setting up user audio stream', error as Error, {
          userId,
          sessionId
        });
      }
    });
  }

  private async createDeepgramConnection(
    sessionData: SessionData,
    userId: string,
    username: string
  ): Promise<any> {
    try {
      // Create WebSocket connection to Deepgram
      const connection = this.deepgramClient.listen.live({
        model: 'nova-2',
        language: 'en-US',
        smart_format: true,
        interim_results: true,
        punctuate: true,
        encoding: 'linear16',
        sample_rate: 48000,
        channels: 2,
      });

      // Handle transcription results
      connection.addListener(LiveTranscriptionEvents.Transcript, async (data: any) => {
        try {
          const alternative = data.channel?.alternatives?.[0];
          if (alternative?.transcript && alternative.transcript.trim()) {
            await this.handleTranscription(
              sessionData,
              userId,
              username,
              alternative
            );
          }
        } catch (error) {
          logError('Error handling transcription result', error as Error, {
            userId,
            username,
            sessionId: sessionData.sessionId
          });
        }
      });

      // Handle connection events
      connection.addListener(LiveTranscriptionEvents.Open, () => {
        logDebug('Deepgram connection opened', {
          userId,
          username,
          sessionId: sessionData.sessionId
        });
      });

      connection.addListener(LiveTranscriptionEvents.Close, () => {
        logDebug('Deepgram connection closed', {
          userId,
          username,
          sessionId: sessionData.sessionId
        });
      });

      // Handle errors with retry logic
      connection.addListener(LiveTranscriptionEvents.Error, async (error: any) => {
        logError('Deepgram connection error', error, {
          userId,
          username,
          sessionId: sessionData.sessionId
        });

        // Emit error event for monitoring
        this.emit('transcriptionError', {
          sessionId: sessionData.sessionId,
          userId,
          username,
          error: error.message || 'Unknown Deepgram error'
        });

        // Remove failed connection from active streams
        const userStream = sessionData.userStreams.get(userId);
        if (userStream) {
          userStream.isActive = false;
          sessionData.userStreams.delete(userId);
        }
      });

      return connection;
    } catch (error) {
      logError('Failed to create Deepgram connection', error as Error, {
        userId,
        username,
        sessionId: sessionData.sessionId
      });
      throw error;
    }
  }

  private async handleTranscription(
    sessionData: SessionData,
    userId: string,
    username: string,
    alternative: any
  ): Promise<void> {
    try {
      const segment: TranscriptionSegment = {
        sessionId: sessionData.sessionId,
        userId,
        username,
        text: alternative.transcript.trim(),
        timestamp: new Date(),
        confidence: alternative.confidence || 0,
        isFinal: !alternative.is_partial,
        duration: alternative.duration || undefined
      };

      // Only process non-empty, final transcriptions
      if (segment.isFinal && segment.text.length > 0) {
        // Add to session segments
        sessionData.segments.push(segment);

        // Emit event for real-time display
        this.emit('transcription', segment);

        logDebug('Transcription segment recorded', {
          sessionId: sessionData.sessionId,
          username,
          text: segment.text,
          confidence: segment.confidence
        });
      }
    } catch (error) {
      logError('Error handling transcription', error as Error, {
        sessionId: sessionData.sessionId,
        userId,
        username
      });
    }
  }

  async endSession(sessionId: string): Promise<string> {
    try {
      const sessionData = this.activeSessions.get(sessionId);
      if (!sessionData) {
        throw new Error(`Session ${sessionId} not found or already ended`);
      }

      logInfo('Ending transcription session', {
        sessionId,
        segmentCount: sessionData.segments.length,
        activeStreams: sessionData.userStreams.size
      });

      // Close all active Deepgram connections
      for (const [userId, userStream] of sessionData.userStreams) {
        try {
          if (userStream.deepgramConnection && userStream.deepgramConnection.getReadyState() === 1) {
            userStream.deepgramConnection.finish();
          }
          userStream.isActive = false;
        } catch (error) {
          logError('Error closing user stream', error as Error, {
            userId,
            username: userStream.username,
            sessionId
          });
        }
      }

      // Generate formatted transcript
      const transcript = this.formatTranscript(sessionData.segments);
      const wordCount = transcript.split(/\s+/).filter(word => word.length > 0).length;
      const participantCount = new Set(sessionData.segments.map(s => s.userId)).size;

      // Clean up session data
      this.activeSessions.delete(sessionId);

      // Emit session ended event
      this.emit('sessionEnded', {
        sessionId,
        transcript,
        wordCount,
        participantCount,
        segmentCount: sessionData.segments.length,
        duration: Date.now() - sessionData.startedAt.getTime()
      });

      logInfo('Transcription session ended successfully', {
        sessionId,
        wordCount,
        participantCount,
        segmentCount: sessionData.segments.length
      });

      return transcript;
    } catch (error) {
      logError('Failed to end transcription session', error as Error, { sessionId });
      throw error;
    }
  }

  private formatTranscript(segments: TranscriptionSegment[]): string {
    if (segments.length === 0) {
      return 'No transcription available - no speech was detected during the session.';
    }

    let transcript = '# Session Transcript\n\n';
    let currentSpeaker = '';
    let currentParagraph = '';

    for (const segment of segments.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())) {
      if (segment.username !== currentSpeaker) {
        // Finish previous speaker's paragraph
        if (currentParagraph.trim()) {
          transcript += currentParagraph.trim() + '\n\n';
        }

        // Start new speaker
        currentSpeaker = segment.username;
        transcript += `**${currentSpeaker}:** `;
        currentParagraph = segment.text + ' ';
      } else {
        // Continue with same speaker
        currentParagraph += segment.text + ' ';
      }
    }

    // Add final paragraph
    if (currentParagraph.trim()) {
      transcript += currentParagraph.trim();
    }

    return transcript;
  }

  getLiveTranscript(sessionId: string): string | null {
    const sessionData = this.activeSessions.get(sessionId);
    if (!sessionData) {
      return null;
    }

    return this.formatTranscript(sessionData.segments);
  }

  getSessionInfo(sessionId: string): any {
    const sessionData = this.activeSessions.get(sessionId);
    if (!sessionData) {
      return null;
    }

    return {
      sessionId: sessionData.sessionId,
      gameId: sessionData.gameId,
      channelId: sessionData.channelId,
      guildId: sessionData.guildId,
      startedAt: sessionData.startedAt,
      segmentCount: sessionData.segments.length,
      activeStreams: sessionData.userStreams.size,
      participants: Array.from(new Set(sessionData.segments.map(s => s.username)))
    };
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  getAllActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  // Cleanup method for graceful shutdown
  async cleanup(): Promise<void> {
    logInfo('Cleaning up all transcription sessions', {
      activeSessionCount: this.activeSessions.size
    });

    const sessionIds = Array.from(this.activeSessions.keys());
    for (const sessionId of sessionIds) {
      try {
        await this.endSession(sessionId);
      } catch (error) {
        logError('Error cleaning up transcription session', error as Error, { sessionId });
      }
    }
  }
}

export const liveTranscriptionService = new LiveTranscriptionService(
  // This will be injected when we initialize the service
  {} as Client
);