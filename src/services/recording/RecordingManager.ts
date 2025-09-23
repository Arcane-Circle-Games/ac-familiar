import { VoiceChannel, GuildMember } from 'discord.js';
import { VoiceConnectionManager } from '../voice/VoiceConnectionManager';
import { BasicRecordingService } from './BasicRecordingService';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';

interface ActiveSession {
  sessionId: string;
  channelId: string;
  startedBy: string;
  startedAt: Date;
}

export class RecordingManager {
  private voiceManager = new VoiceConnectionManager();
  private recordingService = new BasicRecordingService();
  private activeSessions: Map<string, ActiveSession> = new Map(); // channelId -> session info

  /**
   * Start recording in a voice channel
   */
  async startRecording(
    voiceChannel: VoiceChannel,
    requestedBy: GuildMember
  ): Promise<{ sessionId: string; message: string }> {
    const channelId = voiceChannel.id;

    // Check if already recording in this channel
    if (this.activeSessions.has(channelId)) {
      const existingSession = this.activeSessions.get(channelId)!;
      return {
        sessionId: existingSession.sessionId,
        message: `Already recording session ${existingSession.sessionId} in this channel (started by <@${existingSession.startedBy}>)`
      };
    }

    try {
      const sessionId = uuidv4();
      logger.info(`Starting recording in channel ${channelId}, session ${sessionId}, requested by ${requestedBy.user.username}`);

      // Connect to voice channel
      const connection = await this.voiceManager.joinChannel(voiceChannel);

      // Start recording
      await this.recordingService.startRecording(sessionId, connection.receiver, channelId);

      // Track the session
      this.activeSessions.set(channelId, {
        sessionId,
        channelId,
        startedBy: requestedBy.id,
        startedAt: new Date()
      });

      logger.info(`Recording started successfully: session ${sessionId}`);

      return {
        sessionId,
        message: `🎙️ Recording started! Session ID: \`${sessionId}\`\n\nAll voice activity in this channel is now being recorded separately for each speaker.`
      };

    } catch (error) {
      logger.error(`Failed to start recording in channel ${channelId}:`, error);

      // Cleanup on failure
      try {
        await this.voiceManager.leaveChannel(channelId);
        this.activeSessions.delete(channelId);
      } catch (cleanupError) {
        logger.error('Error during failed recording cleanup:', cleanupError);
      }

      throw new Error(`Failed to start recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Stop recording in a voice channel
   */
  async stopRecording(channelId: string): Promise<{
    sessionId: string;
    duration: number;
    segments: number;
    participants: number;
    message: string;
  }> {
    const activeSession = this.activeSessions.get(channelId);
    if (!activeSession) {
      throw new Error('No active recording found in this channel');
    }

    const { sessionId } = activeSession;

    try {
      logger.info(`Stopping recording in channel ${channelId}, session ${sessionId}`);

      // Stop the recording service
      const sessionData = await this.recordingService.stopRecording(sessionId);

      // Leave the voice channel
      await this.voiceManager.leaveChannel(channelId);

      // Clean up session tracking
      this.activeSessions.delete(channelId);

      const duration = sessionData.endTime! - sessionData.startTime;
      const participants = new Set(sessionData.segments.map(s => s.userId)).size;

      logger.info(`Recording stopped successfully: session ${sessionId}, duration: ${duration}ms, segments: ${sessionData.segments.length}, participants: ${participants}`);

      return {
        sessionId,
        duration: Math.round(duration / 1000), // Convert to seconds
        segments: sessionData.segments.length,
        participants,
        message: `🛑 Recording stopped!\n\n**Session:** \`${sessionId}\`\n**Duration:** ${Math.round(duration / 1000)}s\n**Audio segments:** ${sessionData.segments.length}\n**Participants:** ${participants}\n\n*Audio data captured in memory for Phase 1 testing.*`
      };

    } catch (error) {
      logger.error(`Failed to stop recording in channel ${channelId}:`, error);

      // Emergency cleanup
      try {
        await this.voiceManager.leaveChannel(channelId);
        this.recordingService.emergencyCleanup(sessionId);
        this.activeSessions.delete(channelId);
      } catch (cleanupError) {
        logger.error('Error during failed stop recording cleanup:', cleanupError);
      }

      throw new Error(`Failed to stop recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get status of recording in a channel
   */
  getRecordingStatus(channelId: string): {
    isRecording: boolean;
    sessionId?: string | undefined;
    startedBy?: string | undefined;
    duration?: number | undefined;
    stats?: {
      segments: number;
      participants: number;
      memoryUsage: number;
    } | undefined;
  } {
    const activeSession = this.activeSessions.get(channelId);

    if (!activeSession) {
      return { isRecording: false };
    }

    const stats = this.recordingService.getSessionStats(activeSession.sessionId);
    const memoryUsage = this.recordingService.getSessionMemoryUsage(activeSession.sessionId);

    return {
      isRecording: true,
      sessionId: activeSession.sessionId,
      startedBy: activeSession.startedBy,
      duration: stats?.duration ?? 0,
      stats: stats ? {
        segments: stats.segmentCount,
        participants: stats.participantCount,
        memoryUsage
      } : undefined
    };
  }

  /**
   * Check if recording in a specific channel
   */
  isRecording(channelId: string): boolean {
    return this.activeSessions.has(channelId);
  }

  /**
   * Get all active recording sessions
   */
  getActiveSessions(): ActiveSession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Emergency stop all recordings (useful for bot shutdown)
   */
  async emergencyStopAll(): Promise<void> {
    logger.warn('Emergency stopping all recordings');

    const sessions = Array.from(this.activeSessions.values());

    for (const session of sessions) {
      try {
        await this.stopRecording(session.channelId);
        logger.info(`Emergency stopped session ${session.sessionId}`);
      } catch (error) {
        logger.error(`Failed to emergency stop session ${session.sessionId}:`, error);
      }
    }

    // Cleanup voice connections
    await this.voiceManager.cleanup();
    this.activeSessions.clear();

    logger.warn('Emergency stop completed');
  }

  /**
   * Get memory usage across all active sessions
   */
  getTotalMemoryUsage(): number {
    let totalUsage = 0;
    for (const session of this.activeSessions.values()) {
      totalUsage += this.recordingService.getSessionMemoryUsage(session.sessionId);
    }
    return totalUsage;
  }
}