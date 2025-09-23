import { VoiceReceiver, EndBehaviorType } from '@discordjs/voice';
import { logger } from '../../utils/logger';

interface AudioSegment {
  userId: string;
  username: string;
  startTime: number;
  endTime?: number;
  bufferChunks: Buffer[];
}

interface SessionMetadata {
  sessionId: string;
  channelId: string;
  startTime: number;
  endTime?: number;
  segments: AudioSegment[];
  participantCount: number;
}

export class BasicRecordingService {
  private activeSessions: Map<string, SessionMetadata> = new Map();
  private activeStreams: Map<string, AudioSegment> = new Map();

  /**
   * Start recording a voice session
   */
  async startRecording(
    sessionId: string,
    voiceReceiver: VoiceReceiver,
    channelId: string
  ): Promise<void> {
    logger.info(`Starting recording session: ${sessionId}`);

    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is already being recorded`);
    }

    const metadata: SessionMetadata = {
      sessionId,
      channelId,
      startTime: Date.now(),
      segments: [],
      participantCount: 0
    };

    this.activeSessions.set(sessionId, metadata);
    this.setupVoiceReceiver(voiceReceiver, sessionId);

    logger.info(`Recording session ${sessionId} started successfully`);
  }

  /**
   * Stop recording and return session data
   */
  async stopRecording(sessionId: string): Promise<SessionMetadata> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or not recording`);
    }

    logger.info(`Stopping recording session: ${sessionId}`);

    session.endTime = Date.now();

    // Process any remaining active streams
    const activeStreamIds = Array.from(this.activeStreams.keys())
      .filter(streamId => streamId.startsWith(sessionId));

    for (const streamId of activeStreamIds) {
      const segment = this.activeStreams.get(streamId);
      if (segment && !segment.endTime) {
        segment.endTime = Date.now();
        session.segments.push(segment);
        this.activeStreams.delete(streamId);
      }
    }

    // Update participant count
    session.participantCount = new Set(session.segments.map(s => s.userId)).size;

    // Clean up
    this.activeSessions.delete(sessionId);

    const duration = session.endTime - session.startTime;
    logger.info(`Recording session ${sessionId} stopped. Duration: ${duration}ms, Segments: ${session.segments.length}, Participants: ${session.participantCount}`);

    return session;
  }

  /**
   * Get session statistics
   */
  getSessionStats(sessionId: string): {
    isRecording: boolean;
    duration: number;
    segmentCount: number;
    participantCount: number;
  } | null {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      isRecording: true,
      duration: Date.now() - session.startTime,
      segmentCount: session.segments.length,
      participantCount: new Set(session.segments.map(s => s.userId)).size
    };
  }

  /**
   * Check if a session is currently recording
   */
  isRecording(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  /**
   * Get all active recording sessions
   */
  getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * Set up voice receiver to capture per-user audio streams
   */
  private setupVoiceReceiver(receiver: VoiceReceiver, sessionId: string): void {
    logger.debug(`Setting up voice receiver for session ${sessionId}`);

    receiver.speaking.on('start', (userId) => {
      // Skip if this is a bot
      if (this.isBot(userId)) {
        logger.debug(`Skipping bot user ${userId}`);
        return;
      }

      const segmentId = `${sessionId}_${userId}_${Date.now()}`;
      const startTime = Date.now();

      logger.debug(`User ${userId} started speaking in session ${sessionId}`);

      const segment: AudioSegment = {
        userId,
        username: this.getUsername(userId), // This will be a placeholder for now
        startTime,
        bufferChunks: []
      };

      this.activeStreams.set(segmentId, segment);

      // Subscribe to user's audio stream
      const audioStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1000 // 1 second of silence ends the stream
        }
      });

      // Collect audio data
      audioStream.on('data', (chunk: Buffer) => {
        if (segment.bufferChunks) {
          segment.bufferChunks.push(chunk);
        }
      });

      audioStream.on('end', () => {
        this.handleStreamEnd(sessionId, segmentId, segment);
      });

      audioStream.on('error', (error) => {
        logger.error(`Audio stream error for user ${userId} in session ${sessionId}:`, error);
        this.handleStreamEnd(sessionId, segmentId, segment);
      });
    });
  }

  /**
   * Handle when an audio stream ends
   */
  private handleStreamEnd(sessionId: string, segmentId: string, segment: AudioSegment): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      logger.warn(`Session ${sessionId} not found when handling stream end`);
      return;
    }

    segment.endTime = Date.now();
    const duration = segment.endTime - segment.startTime;
    const audioSize = segment.bufferChunks.reduce((total, chunk) => total + chunk.length, 0);

    logger.debug(`Audio segment ended for user ${segment.userId} in session ${sessionId}. Duration: ${duration}ms, Size: ${audioSize} bytes`);

    // Only store segments with actual audio data
    if (segment.bufferChunks.length > 0 && audioSize > 0) {
      session.segments.push({
        ...segment,
        bufferChunks: [...segment.bufferChunks] // Copy the buffer chunks
      });
    }

    this.activeStreams.delete(segmentId);
  }

  /**
   * Check if a user ID represents a bot
   * TODO: Implement proper bot detection using Discord client
   */
  private isBot(_userId: string): boolean {
    // For now, just return false. We'll enhance this when integrating with the Discord client
    return false;
  }

  /**
   * Get username for a user ID
   * TODO: Implement proper username lookup using Discord client
   */
  private getUsername(userId: string): string {
    // For now, return a placeholder. We'll enhance this when integrating with the Discord client
    return `User_${userId.slice(-4)}`;
  }

  /**
   * Get total buffer size for a session (for memory monitoring)
   */
  getSessionMemoryUsage(sessionId: string): number {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return 0;
    }

    let totalSize = 0;

    // Count active streams
    for (const [streamId, segment] of this.activeStreams.entries()) {
      if (streamId.startsWith(sessionId)) {
        totalSize += segment.bufferChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      }
    }

    // Count completed segments
    for (const segment of session.segments) {
      totalSize += segment.bufferChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    }

    return totalSize;
  }

  /**
   * Emergency cleanup - clear all data for a session
   */
  emergencyCleanup(sessionId: string): void {
    logger.warn(`Emergency cleanup for session ${sessionId}`);

    // Remove session
    this.activeSessions.delete(sessionId);

    // Remove active streams for this session
    const streamIdsToDelete = Array.from(this.activeStreams.keys())
      .filter(streamId => streamId.startsWith(sessionId));

    for (const streamId of streamIdsToDelete) {
      this.activeStreams.delete(streamId);
    }

    logger.info(`Emergency cleanup completed for session ${sessionId}`);
  }
}