import { VoiceReceiver, EndBehaviorType } from '@discordjs/voice';
import { Transform } from 'stream';
import OpusScript from 'opusscript';
import { Guild } from 'discord.js';
import { logger } from '../../utils/logger';
import { multiTrackExporter, ExportedRecording } from '../processing/MultiTrackExporter';
import { AudioProcessingOptions, audioProcessor } from '../processing/AudioProcessor';
import { config } from '../../utils/config';
import * as path from 'path';
import * as fs from 'fs/promises';
import { recordingUploadService } from '../upload/RecordingUploadService';
import { RecordingSegmentWithBlob } from '../../types/recording-api';

interface AudioSegment {
  userId: string;
  username: string;
  segmentIndex: number;
  bufferChunks: Buffer[]; // Temporary storage while recording current segment
  filePath?: string;      // File path once written to disk
  absoluteStartTime: number; // Unix timestamp (ms)
  absoluteEndTime?: number;  // Unix timestamp (ms)
  duration?: number;         // Duration in ms
}

interface UserRecording {
  userId: string;
  username: string;
  startTime: number;
  endTime?: number;
  currentSegment: AudioSegment | null;
  completedSegments: AudioSegment[];
  lastChunkTime: number; // Timestamp relative to session start (ms)
  segmentCount: number;
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
  outputDirectory: string; // Directory for storing segment files (temporary)
  recordingId?: string; // Database recording ID from API (for streaming uploads)
  uploadedSegments: RecordingSegmentWithBlob[]; // Track all uploaded segments
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
  private lastMemoryLog: number = 0; // Track last memory log time

  /**
   * Write segment to disk, upload to cloud, and delete local file
   */
  private async writeAndUploadSegment(
    session: SessionMetadata,
    segment: AudioSegment
  ): Promise<void> {
    if (!segment.bufferChunks || segment.bufferChunks.length === 0) {
      logger.warn(`Skipping empty segment ${segment.segmentIndex} for user ${segment.userId}`);
      return;
    }

    if (!segment.absoluteEndTime || !segment.duration) {
      logger.warn(`Skipping incomplete segment ${segment.segmentIndex} for user ${segment.userId}`);
      return;
    }

    try {
      // Step 1: Convert PCM buffers to WAV file
      const sanitizedUsername = this.sanitizeFilename(segment.username);
      const userDir = path.join(session.outputDirectory, sanitizedUsername);
      await fs.mkdir(userDir, { recursive: true });

      const segmentFileName = `segment_${segment.segmentIndex.toString().padStart(3, '0')}.wav`;
      const tempFilePath = path.join(userDir, segmentFileName);

      logger.debug(`Writing segment ${segment.segmentIndex} to disk`, {
        userId: segment.userId,
        username: segment.username,
        chunks: segment.bufferChunks.length,
        tempFilePath
      });

      // Use audioProcessor to convert PCM to WAV
      const processedTrack = await audioProcessor.convertPCMToWAV(
        segment.bufferChunks,
        {
          userId: segment.userId,
          username: segment.username,
          startTime: segment.absoluteStartTime,
          endTime: segment.absoluteEndTime,
          sampleRate: 48000,
          channels: 2,
          segmentIndex: segment.segmentIndex
        },
        {
          format: 'wav',
          outputDir: userDir,
          guildName: session.guildName,
          sessionStartTime: session.startTime
        }
      );

      logger.info(`Segment ${segment.segmentIndex} written to disk`, {
        filePath: processedTrack.filePath,
        fileSize: processedTrack.fileSize
      });

      // Step 2: Upload to cloud if recordingId available
      if (session.recordingId) {
        try {
          const { blobUrl } = await recordingUploadService.uploadSegmentImmediately(
            session.recordingId,
            processedTrack.filePath,
            {
              userId: segment.userId,
              username: segment.username,
              segmentIndex: segment.segmentIndex,
              absoluteStartTime: segment.absoluteStartTime,
              absoluteEndTime: segment.absoluteEndTime,
              duration: segment.duration,
              format: 'wav'
            }
          );

          // Store uploaded segment metadata
          const uploadedSegment: RecordingSegmentWithBlob = {
            userId: segment.userId,
            username: segment.username,
            segmentIndex: segment.segmentIndex,
            fileName: segmentFileName,
            absoluteStartTime: segment.absoluteStartTime,
            absoluteEndTime: segment.absoluteEndTime,
            duration: segment.duration,
            fileSize: processedTrack.fileSize,
            format: 'wav',
            blobUrl,
            filePath: `${sanitizedUsername}/${segmentFileName}`
          };

          session.uploadedSegments.push(uploadedSegment);

          logger.info(`Segment ${segment.segmentIndex} uploaded to cloud`, {
            blobUrl: blobUrl.substring(0, 50) + '...'
          });

          // Step 3: Delete local file after successful upload
          await fs.unlink(processedTrack.filePath);
          logger.debug(`Deleted local file after upload: ${processedTrack.filePath}`);

        } catch (uploadError) {
          logger.error(`Failed to upload segment ${segment.segmentIndex}, keeping local file`, uploadError);
          // Keep the local file, will try batch upload at the end
        }
      } else {
        logger.debug(`No recordingId, keeping segment ${segment.segmentIndex} on disk for batch upload`);
      }

    } catch (error) {
      logger.error(`Failed to write/upload segment ${segment.segmentIndex}`, error);
      throw error;
    }
  }

  /**
   * Sanitize filename to remove invalid characters
   */
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 50);
  }

  /**
   * Start recording a voice session
   */
  async startRecording(
    sessionId: string,
    voiceReceiver: VoiceReceiver,
    channelId: string,
    guildName: string,
    guild: Guild,
    guildId: string,
    userId: string
  ): Promise<void> {
    logger.info(`Starting recording session: ${sessionId}`);

    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is already being recorded`);
    }

    // Create temporary output directory for segment files
    const outputDirectory = path.join('/tmp/recordings', sessionId);
    await fs.mkdir(outputDirectory, { recursive: true });

    const metadata: SessionMetadata = {
      sessionId,
      channelId,
      guildName,
      guild,
      startTime: Date.now(),
      userRecordings: new Map(),
      participantCount: 0,
      outputDirectory,
      uploadedSegments: []
    };

    // Initialize live recording via API (streaming upload flow)
    try {
      const initResponse = await recordingUploadService.initLiveRecording(
        sessionId,
        guildId,
        guildName,
        channelId,
        userId
      );
      metadata.recordingId = initResponse.recordingId;
      logger.info(`Live recording initialized with ID: ${initResponse.recordingId}`);
    } catch (error) {
      logger.error(`Failed to init live recording via API, continuing without streaming uploads`, error);
      // Continue without streaming uploads - will fall back to batch upload at end
    }

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

      // Finalize any current segment that's still being recorded
      if (userRecording.currentSegment !== null) {
        const currentSegment = userRecording.currentSegment;
        currentSegment.absoluteEndTime = Date.now();
        currentSegment.duration = currentSegment.absoluteEndTime - currentSegment.absoluteStartTime;

        // Only keep segments that meet minimum duration requirement
        if (currentSegment.duration >= config.RECORDING_MIN_SEGMENT_DURATION) {
          userRecording.completedSegments.push(currentSegment);
          logger.debug(
            `Finalized final segment ${currentSegment.segmentIndex} for user ${userId}: ` +
            `duration=${currentSegment.duration}ms, chunks=${currentSegment.bufferChunks.length}`
          );
        } else {
          logger.debug(
            `Discarded final segment ${currentSegment.segmentIndex} for user ${userId}: ` +
            `too short (${currentSegment.duration}ms < ${config.RECORDING_MIN_SEGMENT_DURATION}ms)`
          );
        }

        userRecording.currentSegment = null;
      }

      // Destroy streams to trigger final data flush
      if (userRecording.opusStream) {
        userRecording.opusStream.destroy();
      }
      if (userRecording.pcmStream) {
        userRecording.pcmStream.destroy();
      }

      const duration = userRecording.endTime - userRecording.startTime;
      const totalSegments = userRecording.completedSegments.length;
      const audioSize = userRecording.completedSegments.reduce(
        (total, segment) => total + segment.bufferChunks.reduce((sum, chunk) => sum + chunk.length, 0),
        0
      );

      logger.debug(`User ${userId} recording finalized. Duration: ${duration}ms, Segments: ${totalSegments}, Total Size: ${audioSize} bytes`);
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
        currentSegment: null,
        completedSegments: [],
        lastChunkTime: 0,
        segmentCount: 0,
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

      // Collect PCM audio data with segment detection
      pcmStream.on('data', (chunk: Buffer) => {
        const currentTime = Date.now() - session.startTime; // ms since session start
        const silenceThreshold = config.RECORDING_SILENCE_THRESHOLD;

        // Log memory usage periodically (every 30 seconds)
        const now = Date.now();
        if (now - this.lastMemoryLog > 30000) {
          const memUsage = process.memoryUsage();
          const sessionMemory = this.getSessionMemoryUsage(sessionId);
          logger.info(`Memory usage update`, {
            sessionId,
            heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
            rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
            sessionBuffers: `${Math.round(sessionMemory / 1024 / 1024)}MB`,
            uploadedSegments: session.uploadedSegments.length,
            activeUsers: session.userRecordings.size
          });
          this.lastMemoryLog = now;
        }

        if (userRecording.currentSegment === null) {
          // Start new segment (first speech or after silence)
          userRecording.currentSegment = {
            userId,
            username: userRecording.username,
            segmentIndex: userRecording.segmentCount,
            bufferChunks: [chunk],
            absoluteStartTime: Date.now()
          };
          userRecording.segmentCount++;

          logger.debug(`Started segment ${userRecording.currentSegment.segmentIndex} for user ${userId} at ${currentTime}ms`);
        } else if (currentTime - userRecording.lastChunkTime > silenceThreshold) {
          // Gap detected - finalize current segment, upload it, and start new one
          const prevSegment = userRecording.currentSegment;
          prevSegment.absoluteEndTime = session.startTime + userRecording.lastChunkTime;
          prevSegment.duration = prevSegment.absoluteEndTime - prevSegment.absoluteStartTime;

          // Only process segments that meet minimum duration requirement
          if (prevSegment.duration >= config.RECORDING_MIN_SEGMENT_DURATION) {
            logger.debug(
              `Finalizing segment ${prevSegment.segmentIndex} for user ${userId}: ` +
              `duration=${prevSegment.duration}ms, chunks=${prevSegment.bufferChunks.length}`
            );

            // Copy bufferChunks before clearing them
            const bufferChunksCopy = [...prevSegment.bufferChunks];
            const segmentCopy = { ...prevSegment, bufferChunks: bufferChunksCopy };

            // Clear original buffers from memory immediately
            prevSegment.bufferChunks = [];

            // Write to disk and upload to cloud (async, don't wait)
            this.writeAndUploadSegment(session, segmentCopy)
              .then(() => {
                logger.debug(`Segment ${segmentCopy.segmentIndex} uploaded and memory cleared`);
              })
              .catch((error) => {
                logger.error(`Failed to upload segment ${segmentCopy.segmentIndex}`, error);
                // Add to completed segments for batch upload fallback
                userRecording.completedSegments.push(segmentCopy);
              });
          } else {
            logger.debug(
              `Discarded segment ${prevSegment.segmentIndex} for user ${userId}: ` +
              `too short (${prevSegment.duration}ms < ${config.RECORDING_MIN_SEGMENT_DURATION}ms)`
            );
          }

          // Start new segment
          userRecording.currentSegment = {
            userId,
            username: userRecording.username,
            segmentIndex: userRecording.segmentCount,
            bufferChunks: [chunk],
            absoluteStartTime: Date.now()
          };
          userRecording.segmentCount++;

          logger.debug(`Started segment ${userRecording.currentSegment.segmentIndex} for user ${userId} at ${currentTime}ms`);
        } else {
          // Continue current segment
          userRecording.currentSegment.bufferChunks.push(chunk);
        }

        userRecording.lastChunkTime = currentTime;
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

    // Count all user recordings (completed segments + current segment)
    for (const userRecording of session.userRecordings.values()) {
      // Add size from completed segments
      totalSize += userRecording.completedSegments.reduce(
        (sum, segment) => sum + segment.bufferChunks.reduce((chunkSum, chunk) => chunkSum + chunk.length, 0),
        0
      );

      // Add size from current segment if exists
      if (userRecording.currentSegment !== null) {
        totalSize += userRecording.currentSegment.bufferChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      }
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

    // Convert user recordings with segments to array format for export
    const segments: Array<{
      userId: string;
      username: string;
      segmentIndex: number;
      startTime: number;
      endTime: number;
      bufferChunks: Buffer[];
    }> = [];

    for (const userRecording of session.userRecordings.values()) {
      if (userRecording.endTime !== undefined) {
        for (const segment of userRecording.completedSegments) {
          if (segment.absoluteEndTime !== undefined) {
            segments.push({
              userId: segment.userId,
              username: segment.username,
              segmentIndex: segment.segmentIndex,
              startTime: segment.absoluteStartTime,
              endTime: segment.absoluteEndTime,
              bufferChunks: segment.bufferChunks
            });
          }
        }
      }
    }

    if (segments.length === 0) {
      throw new Error('No segments to export');
    }

    // Export all segments to audio files
    const exportedRecording = await multiTrackExporter.exportMultiTrack(
      segments,
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
      segmentCount: exportedRecording.tracks.length,
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

      // Finalize any current segment that's still being recorded
      if (userRecording.currentSegment !== null) {
        const currentSegment = userRecording.currentSegment;
        currentSegment.absoluteEndTime = Date.now();
        currentSegment.duration = currentSegment.absoluteEndTime - currentSegment.absoluteStartTime;

        // Only keep segments that meet minimum duration requirement
        if (currentSegment.duration >= config.RECORDING_MIN_SEGMENT_DURATION) {
          logger.debug(
            `Finalized final segment ${currentSegment.segmentIndex} for user ${userId}: ` +
            `duration=${currentSegment.duration}ms, chunks=${currentSegment.bufferChunks.length}`
          );

          // If using streaming uploads, upload final segment immediately
          if (session.recordingId) {
            try {
              await this.writeAndUploadSegment(session, currentSegment);
              logger.info(`Final segment ${currentSegment.segmentIndex} uploaded`);
            } catch (error) {
              logger.error(`Failed to upload final segment ${currentSegment.segmentIndex}`, error);
              // Add to completed segments for fallback
              userRecording.completedSegments.push(currentSegment);
            }
          } else {
            // No streaming upload, keep for batch export
            userRecording.completedSegments.push(currentSegment);
          }
        } else {
          logger.debug(
            `Discarded final segment ${currentSegment.segmentIndex} for user ${userId}: ` +
            `too short (${currentSegment.duration}ms < ${config.RECORDING_MIN_SEGMENT_DURATION}ms)`
          );
        }

        userRecording.currentSegment = null;
      }

      // Destroy streams to trigger final data flush
      if (userRecording.opusStream) {
        userRecording.opusStream.destroy();
      }
      if (userRecording.pcmStream) {
        userRecording.pcmStream.destroy();
      }

      const duration = userRecording.endTime - userRecording.startTime;
      const totalSegments = userRecording.completedSegments.length;
      const audioSize = userRecording.completedSegments.reduce(
        (total, segment) => total + segment.bufferChunks.reduce((sum, chunk) => sum + chunk.length, 0),
        0
      );

      logger.debug(`User ${userId} recording finalized. Duration: ${duration}ms, Segments: ${totalSegments}, Total Size: ${audioSize} bytes`);
    }

    // Update participant count
    session.participantCount = session.userRecordings.size;

    const duration = session.endTime - session.startTime;
    logger.info(`Recording session ${sessionId} stopped. Duration: ${duration}ms, Users: ${session.participantCount}`);

    let exportedRecording: ExportedRecording;

    // Check if we used streaming uploads
    if (session.recordingId && session.uploadedSegments.length > 0) {
      logger.info(`Finalizing recording via API (streaming upload mode)`, {
        recordingId: session.recordingId,
        uploadedSegments: session.uploadedSegments.length
      });

      // Finalize via API
      try {
        const finalizeResponse = await recordingUploadService.finalizeRecording(
          session.recordingId,
          session.endTime,
          session.uploadedSegments
        );

        logger.info(`Recording finalized successfully`, {
          recordingId: finalizeResponse.recording.id,
          segmentCount: finalizeResponse.recording.segmentCount
        });

        // Create a mock ExportedRecording for compatibility
        exportedRecording = {
          sessionId: session.sessionId,
          sessionStartTime: session.startTime,
          sessionEndTime: session.endTime,
          tracks: session.uploadedSegments.map(seg => ({
            metadata: {
              userId: seg.userId,
              username: seg.username,
              startTime: seg.absoluteStartTime,
              endTime: seg.absoluteEndTime,
              duration: seg.duration,
              sampleRate: 48000,
              channels: 2,
              segmentIndex: seg.segmentIndex
            },
            filePath: seg.blobUrl, // Use blob URL as filePath
            fileSize: seg.fileSize,
            format: 'wav' as const
          })),
          outputDirectory: session.outputDirectory,
          totalSize: finalizeResponse.recording.totalSize,
          participantCount: finalizeResponse.recording.participantCount
        };

        // Cleanup temporary directory
        try {
          await fs.rm(session.outputDirectory, { recursive: true, force: true });
          logger.info(`Cleaned up temporary directory: ${session.outputDirectory}`);
        } catch (cleanupError) {
          logger.warn(`Failed to cleanup temporary directory`, cleanupError);
        }

      } catch (error) {
        logger.error(`Failed to finalize recording via API, falling back to batch export`, error);
        // Fall through to batch export logic below
      }
    }

    // Batch export fallback (if streaming uploads failed or weren't used)
    if (!exportedRecording!) {
      logger.info(`Using batch export mode (no streaming uploads or finalize failed)`);

      // Convert user recordings with segments to array format for export
      const segments: Array<{
        userId: string;
        username: string;
        segmentIndex: number;
        startTime: number;
        endTime: number;
        bufferChunks: Buffer[];
      }> = [];

      for (const userRecording of session.userRecordings.values()) {
        if (userRecording.endTime !== undefined) {
          for (const segment of userRecording.completedSegments) {
            if (segment.absoluteEndTime !== undefined) {
              segments.push({
                userId: segment.userId,
                username: segment.username,
                segmentIndex: segment.segmentIndex,
                startTime: segment.absoluteStartTime,
                endTime: segment.absoluteEndTime,
                bufferChunks: segment.bufferChunks
              });
            }
          }
        }
      }

      if (segments.length === 0) {
        throw new Error('No segments to export');
      }

      // Export all segments to audio files
      exportedRecording = await multiTrackExporter.exportMultiTrack(
        segments,
        {
          sessionId: session.sessionId,
          sessionStartTime: session.startTime,
          sessionEndTime: session.endTime,
          guildName: session.guildName,
          ...options
        }
      );

      logger.info('Session exported successfully via batch mode', {
        sessionId,
        segmentCount: exportedRecording.tracks.length,
        totalSize: exportedRecording.totalSize,
        outputDirectory: exportedRecording.outputDirectory
      });
    }

    // Create sessionData object to return (keep original structure for compatibility)
    const sessionData: SessionMetadata = {
      sessionId: session.sessionId,
      channelId: session.channelId,
      guildName: session.guildName,
      guild: session.guild,
      startTime: session.startTime,
      endTime: session.endTime,
      userRecordings: session.userRecordings,
      participantCount: session.participantCount,
      outputDirectory: session.outputDirectory,
      uploadedSegments: session.uploadedSegments,
      ...(session.recordingId && { recordingId: session.recordingId })
    };

    // Clean up - remove from active sessions
    this.activeSessions.delete(sessionId);

    return { sessionData, exportedRecording };
  }
}