import { VoiceChannel, GuildMember } from 'discord.js';
import { VoiceConnectionManager } from '../voice/VoiceConnectionManager';
import { BasicRecordingService } from './BasicRecordingService';
import { v4 as uuidv4 } from 'uuid';
import { logger, sanitizeAxiosError } from '../../utils/logger';
import { ExportedRecording, multiTrackExporter } from '../processing/MultiTrackExporter';
import { SessionTranscript } from '../../types/transcription';
import { recordingUploadService, UploadResult } from '../upload/RecordingUploadService';
import { RecordingUploadMetadata } from '../../types/recording-api';
import { config } from '../../utils/config';
import * as fs from 'fs/promises';
import * as path from 'path';

interface ActiveSession {
  sessionId: string;
  platformSessionId?: string;
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
    requestedBy: GuildMember,
    platformSessionId?: string
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

      // Get guild name and guild object
      const guildName = voiceChannel.guild.name;
      const guildId = voiceChannel.guild.id;
      const guild = voiceChannel.guild;

      // Start recording with streaming upload support
      await this.recordingService.startRecording(
        sessionId,
        connection.receiver,
        channelId,
        guildName,
        guild,
        guildId,
        requestedBy.id,
        platformSessionId
      );

      // Track the session
      this.activeSessions.set(channelId, {
        sessionId,
        ...(platformSessionId !== undefined && { platformSessionId }),
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
  async stopRecording(channelId: string, exportToFiles: boolean = false, autoTranscribe: boolean = false): Promise<{
    sessionId: string;
    duration: number;
    participants: number;
    message: string;
    exportedRecording?: ExportedRecording;
    transcript?: SessionTranscript;
    recordingId?: string;
    viewUrl?: string;
  }> {
    const activeSession = this.activeSessions.get(channelId);
    if (!activeSession) {
      throw new Error('No active recording found in this channel');
    }

    const { sessionId } = activeSession;

    try {
      logger.info(`Stopping recording in channel ${channelId}, session ${sessionId}`, {
        exportToFiles,
        autoTranscribe
      });

      let sessionData;
      let exportedRecording: ExportedRecording | undefined;

      if (exportToFiles) {
        // Stop and export in one operation
        const result = await this.recordingService.stopAndExport(sessionId, {
          format: 'wav',
          outputDir: './recordings'
        });
        sessionData = result.sessionData;
        exportedRecording = result.exportedRecording;
      } else {
        // Just stop without exporting
        sessionData = await this.recordingService.stopRecording(sessionId);
      }

      // Leave the voice channel
      await this.voiceManager.leaveChannel(channelId);

      // Clean up session tracking
      this.activeSessions.delete(channelId);

      const duration = sessionData.endTime! - sessionData.startTime;
      const participants = sessionData.participantCount;

      logger.info(`Recording stopped successfully: session ${sessionId}, duration: ${duration}ms, participants: ${participants}`);

      let message = `🛑 Recording stopped!\n\n**Session:** \`${sessionId}\`\n**Duration:** ${Math.round(duration / 1000)}s\n**Participants:** ${participants}`;

      if (exportedRecording) {
        message += `\n\n✅ **Files saved to:** \`${exportedRecording.outputDirectory}\`\n**Track count:** ${exportedRecording.tracks.length}\n**Total size:** ${this.formatBytes(exportedRecording.totalSize)}`;
      } else {
        message += `\n\n*Audio data captured in memory only.*`;
      }

      const result: {
        sessionId: string;
        duration: number;
        participants: number;
        message: string;
        exportedRecording?: ExportedRecording;
        transcript?: SessionTranscript;
        recordingId?: string;
        viewUrl?: string;
      } = {
        sessionId,
        duration: Math.round(duration / 1000), // Convert to seconds
        participants,
        message
      };

      if (exportedRecording) {
        result.exportedRecording = exportedRecording;
      }

      // If streaming uploads were used, include recordingId and viewUrl
      if (sessionData.recordingId) {
        result.recordingId = sessionData.recordingId;
        result.viewUrl = `${config.PLATFORM_WEB_URL}/dashboard/recordings/${sessionData.recordingId}`;
      }

      // Auto-transcribe if requested and files were exported
      if (autoTranscribe && exportedRecording) {
        try {
          logger.info(`Auto-transcribing session ${sessionId}`);
          const transcript = await this.transcribeSession(sessionId);
          result.transcript = transcript;
          message += `\n\n✅ **Transcription completed**\n**Word count:** ${transcript.wordCount}\n**Confidence:** ${(transcript.averageConfidence * 100).toFixed(1)}%`;
          result.message = message;
        } catch (transcribeError) {
          logger.error(`Auto-transcription failed for session ${sessionId}:`, transcribeError as Error);
          message += `\n\n⚠️ **Transcription failed:** ${transcribeError instanceof Error ? transcribeError.message : 'Unknown error'}`;
          result.message = message;
        }
      }

      return result;

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
      users: number;
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
        users: stats.userCount,
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

  /**
   * Transcribe an existing recording session
   */
  async transcribeSession(sessionId: string, outputDir: string = './recordings'): Promise<SessionTranscript> {
    try {
      logger.info(`Transcribing session ${sessionId}`);

      // Use multiTrackExporter to transcribe
      const transcript = await multiTrackExporter.transcribeSession(sessionId, outputDir);

      logger.info(`Transcription completed for session ${sessionId}`, {
        wordCount: transcript.wordCount,
        participants: transcript.participantCount,
        confidence: transcript.averageConfidence.toFixed(2)
      });

      return transcript;
    } catch (error) {
      logger.error(`Failed to transcribe session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Load transcript for a session
   */
  async loadTranscript(sessionId: string, outputDir: string = './recordings'): Promise<SessionTranscript | null> {
    return multiTrackExporter.loadTranscript(sessionId, outputDir);
  }

  /**
   * Check if session has transcript
   */
  async hasTranscript(sessionId: string, outputDir: string = './recordings'): Promise<boolean> {
    return multiTrackExporter.hasTranscript(sessionId, outputDir);
  }

  /**
   * Upload recording to platform API (Phase 2C)
   */
  async uploadRecording(
    exportedRecording: ExportedRecording,
    voiceChannel: VoiceChannel,
    requestedBy: GuildMember
  ): Promise<UploadResult> {
    try {
      logger.info(`Uploading recording for session ${exportedRecording.sessionId}`);

      // Get platformSessionId from active session
      const activeSession = this.activeSessions.get(voiceChannel.id);

      // Build metadata
      const duration = exportedRecording.sessionEndTime - exportedRecording.sessionStartTime;
      const metadata: RecordingUploadMetadata = {
        sessionId: exportedRecording.sessionId,
        ...(activeSession?.platformSessionId !== undefined && { platformSessionId: activeSession.platformSessionId }),
        guildId: voiceChannel.guild.id,
        guildName: voiceChannel.guild.name,
        channelId: voiceChannel.id,
        userId: requestedBy.id,
        duration,
        recordedAt: new Date(exportedRecording.sessionStartTime).toISOString(),
        participants: exportedRecording.tracks.map((track) => ({
          userId: track.metadata.userId,
          username: track.metadata.username,
        })),
      };

      // Upload with retry
      const result = await recordingUploadService.uploadWithRetry(
        exportedRecording,
        metadata,
        3 // max retries
      );

      if (result.success) {
        logger.info(`Upload successful for session ${exportedRecording.sessionId}`, {
          recordingId: result.recordingId,
        });

        // Cleanup local files if configured
        if (!config.RECORDING_KEEP_LOCAL_AFTER_UPLOAD) {
          await recordingUploadService.cleanupLocalFiles(exportedRecording);
        }
      } else {
        logger.error(`Upload failed for session ${exportedRecording.sessionId}`, {
          error: result.error,
        });
      }

      return result;
    } catch (error) {
      logger.error(`Upload error for session ${exportedRecording.sessionId}:`, sanitizeAxiosError(error));
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown upload error',
      };
    }
  }

  /**
   * Clean up orphaned PCM files from crashed sessions
   * Should be called on bot startup to prevent accumulation of temp files
   */
  async cleanupOrphanedPCMFiles(recordingsDir: string = './recordings'): Promise<void> {
    try {
      logger.info('Checking for orphaned PCM files', { recordingsDir });

      // Check if recordings directory exists
      try {
        await fs.access(recordingsDir);
      } catch {
        logger.info('Recordings directory does not exist, skipping cleanup', { recordingsDir });
        return;
      }

      // Find all PCM files in recordings directory and subdirectories
      const orphanedFiles: string[] = [];

      const scanDirectory = async (dir: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            // Recursively scan subdirectories
            await scanDirectory(fullPath);
          } else if (entry.isFile() && entry.name.startsWith('temp_') && entry.name.endsWith('.pcm')) {
            // Found an orphaned PCM file
            orphanedFiles.push(fullPath);
          }
        }
      };

      await scanDirectory(recordingsDir);

      if (orphanedFiles.length === 0) {
        logger.info('No orphaned PCM files found');
        return;
      }

      logger.warn(`Found ${orphanedFiles.length} orphaned PCM files, cleaning up`, {
        sampleFiles: orphanedFiles.slice(0, 5).map(f => path.basename(f))
      });

      // Delete all orphaned PCM files
      let deletedCount = 0;
      let failedCount = 0;

      for (const filePath of orphanedFiles) {
        try {
          await fs.unlink(filePath);
          deletedCount++;
          logger.debug('Deleted orphaned PCM file', { filePath: path.basename(filePath) });
        } catch (error) {
          failedCount++;
          logger.error('Failed to delete orphaned PCM file', error as Error, {
            filePath: path.basename(filePath)
          });
        }
      }

      logger.info('Orphaned PCM cleanup completed', {
        totalFound: orphanedFiles.length,
        deleted: deletedCount,
        failed: failedCount
      });
    } catch (error) {
      logger.error('Failed to cleanup orphaned PCM files', error as Error);
      // Don't throw - cleanup failure shouldn't prevent bot startup
    }
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}