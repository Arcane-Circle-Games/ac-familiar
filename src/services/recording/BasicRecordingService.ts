import { VoiceReceiver, EndBehaviorType } from '@discordjs/voice';
import { Transform } from 'stream';
import OpusScript from 'opusscript';
import { Guild } from 'discord.js';
import { logger } from '../../utils/logger';
import { multiTrackExporter, ExportedRecording } from '../processing/MultiTrackExporter';
import { AudioProcessingOptions } from '../processing/AudioProcessor';

interface UserRecording {
  userId: string;
  username: string;
  startTime: number;
  endTime?: number;
  bufferChunks: Buffer[];
  decoder: OpusDecoderStream;
  opusStream?: any; // AudioReceiveStream from Discord
  pcmStream?: any; // Decoded PCM stream
}

interface SessionMetadata {
  sessionId: string;
  channelId: string;
  guildName: string;
  guild: Guild;
  startTime: number;
  endTime?: number;
  userRecordings: Map<string, UserRecording>;
  participantCount: number;
}

/**
 * Custom Opus decoder using OpusScript (pure JS, no native bindings)
 */
class OpusDecoderStream extends Transform {
  private decoder: OpusScript;
  private packetCount: number = 0;
  private totalInputBytes: number = 0;
  private totalOutputBytes: number = 0;

  constructor() {
    super();
    // 48kHz, 2 channels (stereo)
    this.decoder = new OpusScript(48000, 2);
  }

  override _transform(chunk: Buffer, _encoding: string, callback: Function): void {
    try {
      this.packetCount++;
      this.totalInputBytes += chunk.length;

      // Decode Opus packet to PCM (returns Int16Array)
      const pcm = this.decoder.decode(chunk);
      if (pcm && pcm.length > 0) {
        // OpusScript returns Int16Array - convert to Buffer properly
        // Use Buffer.from with the typed array directly, not the underlying buffer
        const buffer = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        this.totalOutputBytes += buffer.length;

        // Log every 50 packets to monitor decode quality
        if (this.packetCount % 50 === 0) {
          logger.debug(`Opus decode stats: packets=${this.packetCount}, in=${this.totalInputBytes}B, out=${this.totalOutputBytes}B, pcmSamples=${pcm.length}`);
        }

        this.push(buffer);
      }
      callback();
    } catch (error) {
      logger.error('Opus decode error:', error as Error);
      callback();
    }
  }
}

export class BasicRecordingService {
  private activeSessions: Map<string, SessionMetadata> = new Map();

  /**
   * Start recording a voice session
   */
  async startRecording(
    sessionId: string,
    voiceReceiver: VoiceReceiver,
    channelId: string,
    guildName: string,
    guild: Guild
  ): Promise<void> {
    logger.info(`Starting recording session: ${sessionId}`);

    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is already being recorded`);
    }

    const metadata: SessionMetadata = {
      sessionId,
      channelId,
      guildName,
      guild,
      startTime: Date.now(),
      userRecordings: new Map(),
      participantCount: 0
    };

    this.activeSessions.set(sessionId, metadata);

    // Start continuous recording for all users in the channel
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

    // Finalize all user recordings
    for (const [userId, userRecording] of session.userRecordings.entries()) {
      userRecording.endTime = Date.now();

      // Destroy streams to trigger final data flush
      if (userRecording.opusStream) {
        userRecording.opusStream.destroy();
      }
      if (userRecording.pcmStream) {
        userRecording.pcmStream.destroy();
      }

      const duration = userRecording.endTime - userRecording.startTime;
      const audioSize = userRecording.bufferChunks.reduce((total, chunk) => total + chunk.length, 0);

      logger.debug(`User ${userId} recording finalized. Duration: ${duration}ms, Size: ${audioSize} bytes, Chunks: ${userRecording.bufferChunks.length}`);
    }

    // Update participant count
    session.participantCount = session.userRecordings.size;

    // Clean up
    this.activeSessions.delete(sessionId);

    const duration = session.endTime - session.startTime;
    logger.info(`Recording session ${sessionId} stopped. Duration: ${duration}ms, Users: ${session.participantCount}`);

    return session;
  }

  /**
   * Get session statistics
   */
  getSessionStats(sessionId: string): {
    isRecording: boolean;
    duration: number;
    userCount: number;
    participantCount: number;
  } | null {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      isRecording: true,
      duration: Date.now() - session.startTime,
      userCount: session.userRecordings.size,
      participantCount: session.userRecordings.size
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
   * Set up voice receiver to capture per-user audio streams continuously
   */
  private setupVoiceReceiver(receiver: VoiceReceiver, sessionId: string): void {
    logger.debug(`Setting up voice receiver for session ${sessionId}`);

    // Start recording for users when they begin speaking
    receiver.speaking.on('start', async (userId) => {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        logger.warn(`Session ${sessionId} not found when user ${userId} started speaking`);
        return;
      }

      // Skip if this is a bot
      if (await this.isBot(userId, session.guild)) {
        logger.debug(`Skipping bot user ${userId}`);
        return;
      }

      // Check if we're already recording this user
      if (session.userRecordings.has(userId)) {
        logger.debug(`Already recording user ${userId} in session ${sessionId}`);
        return;
      }

      logger.info(`Starting continuous recording for user ${userId} in session ${sessionId}`);

      // Create continuous recording for this user
      const userRecording: UserRecording = {
        userId,
        username: await this.getUsername(userId, session.guild),
        startTime: Date.now(),
        bufferChunks: [],
        decoder: new OpusDecoderStream()
      };

      // Subscribe to user's audio stream with MANUAL end behavior (continuous)
      const opusStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.Manual // Never auto-end, we control when to stop
        }
      });

      // Pipe Opus stream through decoder to get PCM
      const pcmStream = opusStream.pipe(userRecording.decoder);

      // Store stream references for cleanup
      userRecording.opusStream = opusStream;
      userRecording.pcmStream = pcmStream;

      // Collect ALL PCM audio data continuously
      pcmStream.on('data', (chunk: Buffer) => {
        userRecording.bufferChunks.push(chunk);
      });

      pcmStream.on('error', (error) => {
        logger.error(`PCM stream error for user ${userId} in session ${sessionId}:`, error);
      });

      // Handle Opus stream errors
      opusStream.on('error', (error) => {
        logger.error(`Opus stream error for user ${userId} in session ${sessionId}:`, error);
      });

      // Add to session
      session.userRecordings.set(userId, userRecording);
    });
  }


  /**
   * Check if a user ID represents a bot
   */
  private async isBot(userId: string, guild: Guild): Promise<boolean> {
    try {
      const member = await guild.members.fetch(userId);
      return member.user.bot;
    } catch (error) {
      logger.warn(`Failed to check if user ${userId} is a bot`, { error });
      return false;
    }
  }

  /**
   * Get username for a user ID from Discord guild
   */
  private async getUsername(userId: string, guild: Guild): Promise<string> {
    try {
      const member = await guild.members.fetch(userId);
      // Use display name (nickname) if available, otherwise username
      return member.displayName || member.user.username;
    } catch (error) {
      logger.warn(`Failed to fetch username for user ${userId}`, { error });
      return `User_${userId.slice(-4)}`;
    }
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

    // Count all user recordings
    for (const userRecording of session.userRecordings.values()) {
      totalSize += userRecording.bufferChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    }

    return totalSize;
  }

  /**
   * Emergency cleanup - clear all data for a session
   */
  emergencyCleanup(sessionId: string): void {
    logger.warn(`Emergency cleanup for session ${sessionId}`);

    const session = this.activeSessions.get(sessionId);
    if (session) {
      // Destroy all user recording streams
      for (const userRecording of session.userRecordings.values()) {
        if (userRecording.opusStream) {
          userRecording.opusStream.destroy();
        }
        if (userRecording.pcmStream) {
          userRecording.pcmStream.destroy();
        }
      }
    }

    // Remove session
    this.activeSessions.delete(sessionId);

    logger.info(`Emergency cleanup completed for session ${sessionId}`);
  }

  /**
   * Export session audio to files
   */
  async exportSessionToFiles(
    sessionId: string,
    options?: AudioProcessingOptions
  ): Promise<ExportedRecording> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.endTime) {
      throw new Error(`Session ${sessionId} is still recording`);
    }

    logger.info('Exporting session to files', {
      sessionId,
      userCount: session.userRecordings.size,
      participantCount: session.participantCount
    });

    // Convert user recordings to array format for export
    const userTracks = Array.from(session.userRecordings.values())
      .filter(rec => rec.endTime !== undefined && rec.bufferChunks.length > 0)
      .map(rec => ({
        userId: rec.userId,
        username: rec.username,
        startTime: rec.startTime,
        endTime: rec.endTime!,
        bufferChunks: rec.bufferChunks
      }));

    if (userTracks.length === 0) {
      throw new Error('No user recordings to export');
    }

    // Export all user tracks to audio files
    const exportedRecording = await multiTrackExporter.exportMultiTrack(
      userTracks,
      {
        sessionId: session.sessionId,
        sessionStartTime: session.startTime,
        sessionEndTime: session.endTime,
        guildName: session.guildName,
        ...options
      }
    );

    logger.info('Session exported successfully', {
      sessionId,
      trackCount: exportedRecording.tracks.length,
      totalSize: exportedRecording.totalSize,
      outputDirectory: exportedRecording.outputDirectory
    });

    return exportedRecording;
  }

  /**
   * Stop recording and export to files in one operation
   */
  async stopAndExport(
    sessionId: string,
    options?: AudioProcessingOptions
  ): Promise<{ sessionData: SessionMetadata; exportedRecording: ExportedRecording }> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or not recording`);
    }

    logger.info(`Stopping and exporting recording session: ${sessionId}`);

    session.endTime = Date.now();

    // Finalize all user recordings
    for (const [userId, userRecording] of session.userRecordings.entries()) {
      userRecording.endTime = Date.now();

      // Destroy streams to trigger final data flush
      if (userRecording.opusStream) {
        userRecording.opusStream.destroy();
      }
      if (userRecording.pcmStream) {
        userRecording.pcmStream.destroy();
      }

      const duration = userRecording.endTime - userRecording.startTime;
      const audioSize = userRecording.bufferChunks.reduce((total, chunk) => total + chunk.length, 0);

      logger.debug(`User ${userId} recording finalized. Duration: ${duration}ms, Size: ${audioSize} bytes, Chunks: ${userRecording.bufferChunks.length}`);
    }

    // Update participant count
    session.participantCount = session.userRecordings.size;

    const duration = session.endTime - session.startTime;
    logger.info(`Recording session ${sessionId} stopped. Duration: ${duration}ms, Users: ${session.participantCount}`);

    // Convert user recordings to array format for export
    const userTracks = Array.from(session.userRecordings.values())
      .filter(rec => rec.endTime !== undefined && rec.bufferChunks.length > 0)
      .map(rec => ({
        userId: rec.userId,
        username: rec.username,
        startTime: rec.startTime,
        endTime: rec.endTime!,
        bufferChunks: rec.bufferChunks
      }));

    if (userTracks.length === 0) {
      throw new Error('No user recordings to export');
    }

    // Export all user tracks to audio files
    const exportedRecording = await multiTrackExporter.exportMultiTrack(
      userTracks,
      {
        sessionId: session.sessionId,
        sessionStartTime: session.startTime,
        sessionEndTime: session.endTime,
        guildName: session.guildName,
        ...options
      }
    );

    logger.info('Session exported successfully', {
      sessionId,
      trackCount: exportedRecording.tracks.length,
      totalSize: exportedRecording.totalSize,
      outputDirectory: exportedRecording.outputDirectory
    });

    // Create sessionData object to return (keep original structure for compatibility)
    const sessionData: SessionMetadata = {
      sessionId: session.sessionId,
      channelId: session.channelId,
      guildName: session.guildName,
      guild: session.guild,
      startTime: session.startTime,
      endTime: session.endTime,
      userRecordings: session.userRecordings,
      participantCount: session.participantCount
    };

    // Clean up - remove from active sessions
    this.activeSessions.delete(sessionId);

    return { sessionData, exportedRecording };
  }
}