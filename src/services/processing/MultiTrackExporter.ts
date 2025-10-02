import * as fs from 'fs/promises';
import * as path from 'path';
import { audioProcessor, ProcessedAudioTrack, AudioProcessingOptions } from './AudioProcessor';
import { logger } from '../../utils/logger';
import { transcriptionService } from '../transcription/TranscriptionService';
import { transcriptionStorage } from '../storage/TranscriptionStorage';
import { SessionTranscript, UserTranscript } from '../../types/transcription';

export interface ExportedRecording {
  sessionId: string;
  sessionStartTime: number;
  sessionEndTime: number;
  tracks: ProcessedAudioTrack[];
  outputDirectory: string;
  totalSize: number;
  participantCount: number;
}

export interface ExportOptions extends AudioProcessingOptions {
  sessionId: string;
  sessionStartTime: number;
  sessionEndTime: number;
  guildName: string;
  includeManifest?: boolean;
}

export class MultiTrackExporter {
  /**
   * Export all user segments to individual audio files
   */
  async exportMultiTrack(
    userSegments: Array<{
      userId: string;
      username: string;
      startTime: number;
      endTime: number;
      bufferChunks: Buffer[];
    }>,
    options: ExportOptions
  ): Promise<ExportedRecording> {
    const { sessionId, sessionStartTime, sessionEndTime, outputDir = '/tmp/recordings' } = options;

    try {
      logger.info('Starting multi-track export', {
        sessionId,
        trackCount: userSegments.length,
        outputDir
      });

      // Create session-specific directory
      const sessionDir = path.join(outputDir, sessionId);
      await fs.mkdir(sessionDir, { recursive: true });

      // Filter out segments with no audio data
      const validSegments = userSegments.filter(
        segment => segment.bufferChunks && segment.bufferChunks.length > 0
      );

      if (validSegments.length === 0) {
        throw new Error('No valid audio segments to export');
      }

      logger.info('Processing valid audio segments', {
        totalSegments: userSegments.length,
        validSegments: validSegments.length
      });

      // Process all tracks (no merging needed - already continuous per user)
      const tracks = await audioProcessor.processMultipleTracks(
        validSegments,
        {
          ...options,
          outputDir: sessionDir,
          guildName: options.guildName,
          sessionStartTime: options.sessionStartTime
        }
      );

      // Calculate total size
      const totalSize = tracks.reduce((sum, track) => sum + track.fileSize, 0);

      // Get unique participant count
      const participantCount = new Set(tracks.map(t => t.metadata.userId)).size;

      const exportedRecording: ExportedRecording = {
        sessionId,
        sessionStartTime,
        sessionEndTime,
        tracks,
        outputDirectory: sessionDir,
        totalSize,
        participantCount
      };

      // Optionally create manifest file
      if (options.includeManifest !== false) {
        await this.createManifest(exportedRecording, sessionDir);
      }

      logger.info('Multi-track export completed', {
        sessionId,
        trackCount: tracks.length,
        totalSize,
        participantCount,
        outputDirectory: sessionDir
      });

      return exportedRecording;

    } catch (error) {
      logger.error('Failed to export multi-track recording', error as Error, {
        sessionId,
        segmentCount: userSegments.length
      });
      throw error;
    }
  }

  /**
   * Create a manifest file with recording metadata
   */
  private async createManifest(
    recording: ExportedRecording,
    outputDir: string
  ): Promise<void> {
    const manifestPath = path.join(outputDir, 'manifest.json');

    const manifest = {
      sessionId: recording.sessionId,
      recordedAt: new Date(recording.sessionStartTime).toISOString(),
      duration: recording.sessionEndTime - recording.sessionStartTime,
      participantCount: recording.participantCount,
      totalSize: recording.totalSize,
      tracks: recording.tracks.map(track => ({
        userId: track.metadata.userId,
        username: track.metadata.username,
        filename: path.basename(track.filePath),
        fileSize: track.fileSize,
        format: track.format,
        duration: track.metadata.duration,
        startTime: new Date(track.metadata.startTime).toISOString(),
        endTime: new Date(track.metadata.endTime).toISOString()
      }))
    };

    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    logger.debug('Created manifest file', { manifestPath });
  }

  /**
   * Get recording summary for a session directory
   */
  async getRecordingSummary(sessionDir: string): Promise<{
    trackCount: number;
    totalSize: number;
    files: string[];
  } | null> {
    try {
      const files = await fs.readdir(sessionDir);
      const audioFiles = files.filter(f =>
        f.endsWith('.wav') || f.endsWith('.flac') || f.endsWith('.mp3')
      );

      let totalSize = 0;
      for (const file of audioFiles) {
        const stats = await fs.stat(path.join(sessionDir, file));
        totalSize += stats.size;
      }

      return {
        trackCount: audioFiles.length,
        totalSize,
        files: audioFiles
      };
    } catch (error) {
      logger.error('Failed to get recording summary', error as Error, { sessionDir });
      return null;
    }
  }

  /**
   * Clean up session directory and all files
   */
  async cleanupSession(sessionDir: string): Promise<void> {
    try {
      logger.info('Cleaning up session directory', { sessionDir });
      await fs.rm(sessionDir, { recursive: true, force: true });
      logger.info('Session directory cleaned up', { sessionDir });
    } catch (error) {
      logger.error('Failed to cleanup session directory', error as Error, { sessionDir });
      throw error;
    }
  }

  /**
   * List all files in a session directory
   */
  async listSessionFiles(sessionDir: string): Promise<Array<{
    filename: string;
    path: string;
    size: number;
    format: string;
  }>> {
    try {
      const files = await fs.readdir(sessionDir);
      const audioFiles = files.filter(f =>
        f.endsWith('.wav') || f.endsWith('.flac') || f.endsWith('.mp3') || f.endsWith('.json')
      );

      const fileDetails = await Promise.all(
        audioFiles.map(async (filename) => {
          const filePath = path.join(sessionDir, filename);
          const stats = await fs.stat(filePath);
          const ext = path.extname(filename).slice(1);

          return {
            filename,
            path: filePath,
            size: stats.size,
            format: ext
          };
        })
      );

      return fileDetails;
    } catch (error) {
      logger.error('Failed to list session files', error as Error, { sessionDir });
      throw error;
    }
  }

  /**
   * Transcribe all audio files in a session
   */
  async transcribeSession(
    sessionId: string,
    outputDir: string = './recordings'
  ): Promise<SessionTranscript> {
    try {
      logger.info(`Starting transcription for session ${sessionId}`);

      // Check if transcription service is available
      if (!transcriptionService.isAvailable()) {
        throw new Error('Transcription service not available. Check OPENAI_API_KEY configuration.');
      }

      const sessionDir = path.join(outputDir, sessionId);

      // Load manifest to get track information
      const manifestPath = path.join(sessionDir, 'manifest.json');
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      logger.debug('Loaded manifest', {
        sessionId,
        trackCount: manifest.tracks.length
      });

      // Extract guild name from audio filename (format: ServerName_MM-dd-YY_username.wav)
      let guildName: string | undefined;
      if (manifest.tracks.length > 0 && manifest.tracks[0].filename) {
        const firstFilename = manifest.tracks[0].filename;
        const parts = firstFilename.split('_');
        if (parts.length >= 3) {
          guildName = parts[0]; // First part is guild name
        }
      }

      const sessionStartTime = manifest.recordedAt
        ? new Date(manifest.recordedAt).getTime()
        : manifest.startTime;

      // Prepare files for transcription
      const filesToTranscribe = manifest.tracks.map((track: any) => ({
        wavPath: path.join(sessionDir, track.filename),
        userId: track.userId,
        username: track.username,
        audioStartTime: new Date(track.startTime).getTime()
      }));

      // Transcribe all audio files
      const userTranscripts: UserTranscript[] = await transcriptionService.transcribeMultipleFiles(
        filesToTranscribe
      );

      if (userTranscripts.length === 0) {
        throw new Error('No transcripts generated');
      }

      logger.info(`Generated ${userTranscripts.length} user transcripts`);

      // Merge transcripts chronologically
      const fullTranscript = transcriptionStorage.mergeUserTranscripts(
        userTranscripts,
        sessionStartTime
      );

      // Calculate totals
      const wordCount = userTranscripts.reduce((sum, t) => sum + t.wordCount, 0);
      const avgConfidence = userTranscripts.length > 0
        ? userTranscripts.reduce((sum, t) => sum + t.averageConfidence, 0) / userTranscripts.length
        : 0;

      // Create session transcript object
      const sessionTranscript: SessionTranscript = {
        sessionId,
        transcribedAt: new Date().toISOString(),
        duration: manifest.duration,
        participantCount: manifest.participantCount,
        fullTranscript,
        wordCount,
        averageConfidence: avgConfidence,
        userTranscripts
      };

      // Save transcript with guild name and session start time
      await transcriptionStorage.saveTranscript(sessionId, sessionTranscript, outputDir, guildName, sessionStartTime);
      await transcriptionStorage.saveFormattedTranscript(sessionId, sessionTranscript, outputDir, guildName, sessionStartTime);

      logger.info(`Transcription completed for session ${sessionId}`, {
        wordCount,
        participants: manifest.participantCount,
        avgConfidence: avgConfidence.toFixed(2)
      });

      return sessionTranscript;

    } catch (error) {
      logger.error(`Failed to transcribe session ${sessionId}`, error as Error);
      throw error;
    }
  }

  /**
   * Check if a session has been transcribed
   */
  async hasTranscript(sessionId: string, outputDir: string = './recordings'): Promise<boolean> {
    return transcriptionStorage.transcriptExists(sessionId, outputDir);
  }

  /**
   * Load transcript for a session
   */
  async loadTranscript(sessionId: string, outputDir: string = './recordings'): Promise<SessionTranscript | null> {
    return transcriptionStorage.loadTranscript(sessionId, outputDir);
  }
}

export const multiTrackExporter = new MultiTrackExporter();
