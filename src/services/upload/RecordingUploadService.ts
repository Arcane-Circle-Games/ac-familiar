import FormData from 'form-data';
import * as fs from 'fs';
import { apiClient } from '../api/client';
import { logger } from '../../utils/logger';
import { ExportedRecording } from '../processing/MultiTrackExporter';

export interface UploadMetadata {
  sessionId: string;
  guildId: string;
  guildName: string;
  channelId: string;
  userId: string;
  duration: number;
  recordedAt: string;
  participants: Array<{
    userId: string;
    username: string;
  }>;
}

export interface UploadResult {
  success: boolean;
  recordingId?: string;
  downloadUrls?: {
    audio: string[];
  };
  viewUrl?: string;
  estimatedProcessingTime?: string;
  error?: string;
}

export class RecordingUploadService {
  /**
   * Upload recording to platform API
   */
  async uploadRecording(
    exportedRecording: ExportedRecording,
    metadata: UploadMetadata
  ): Promise<UploadResult> {
    try {
      logger.info(`Starting upload for session ${metadata.sessionId}`, {
        trackCount: exportedRecording.tracks.length,
        totalSize: exportedRecording.totalSize
      });

      // Create form data
      const form = new FormData();

      // Add metadata as JSON
      form.append('metadata', JSON.stringify(metadata));

      // Add audio files
      for (const track of exportedRecording.tracks) {
        const fileStream = fs.createReadStream(track.filePath);
        const filename = track.filePath.split('/').pop() || 'audio.wav';

        form.append('files', fileStream, {
          filename,
          contentType: 'audio/wav'
        });

        logger.debug(`Added file to upload: ${filename}`, {
          size: track.fileSize,
          format: track.format
        });
      }

      // Upload to API
      const startTime = Date.now();
      const response = await apiClient.post('/recordings', form, {
        headers: {
          ...form.getHeaders()
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 300000 // 5 minutes
      });

      const uploadDuration = Date.now() - startTime;

      logger.info(`Upload completed in ${uploadDuration}ms`, {
        sessionId: metadata.sessionId,
        recordingId: response.data.recording.id
      });

      return {
        success: true,
        recordingId: response.data.recording.id,
        downloadUrls: response.data.recording.downloadUrls,
        viewUrl: response.data.recording.viewUrl,
        estimatedProcessingTime: response.data.recording.estimatedProcessingTime
      };

    } catch (error) {
      logger.error(`Upload failed for session ${metadata.sessionId}`, error as Error);

      if (error.response) {
        // API returned an error
        return {
          success: false,
          error: error.response.data?.error || `API error: ${error.response.status}`
        };
      } else if (error.request) {
        // Request made but no response
        return {
          success: false,
          error: 'No response from API - network issue or API is down'
        };
      } else {
        // Something else went wrong
        return {
          success: false,
          error: error.message || 'Unknown error during upload'
        };
      }
    }
  }

  /**
   * Upload with retry logic
   */
  async uploadWithRetry(
    exportedRecording: ExportedRecording,
    metadata: UploadMetadata,
    maxRetries: number = 3
  ): Promise<UploadResult> {
    let lastError: UploadResult | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      logger.info(`Upload attempt ${attempt}/${maxRetries} for session ${metadata.sessionId}`);

      const result = await this.uploadRecording(exportedRecording, metadata);

      if (result.success) {
        return result;
      }

      lastError = result;

      if (attempt < maxRetries) {
        // Exponential backoff
        const delayMs = Math.pow(2, attempt) * 1000;
        logger.info(`Upload failed, retrying in ${delayMs}ms...`);
        await this.delay(delayMs);
      }
    }

    logger.error(`All upload attempts failed for session ${metadata.sessionId}`);
    return lastError || { success: false, error: 'All upload attempts failed' };
  }

  /**
   * Clean up local files after successful upload
   */
  async cleanupLocalFiles(exportedRecording: ExportedRecording): Promise<void> {
    try {
      logger.info(`Cleaning up local files for session ${exportedRecording.sessionId}`, {
        directory: exportedRecording.outputDirectory
      });

      // Delete the entire session directory
      await fs.promises.rm(exportedRecording.outputDirectory, { recursive: true, force: true });

      logger.info(`Local files cleaned up successfully`);
    } catch (error) {
      logger.error(`Failed to cleanup local files`, error as Error, {
        directory: exportedRecording.outputDirectory
      });
      // Don't throw - cleanup failure shouldn't break the flow
    }
  }

  /**
   * Check recording status on API
   */
  async checkStatus(recordingId: string): Promise<{
    status: 'processing' | 'completed' | 'failed';
    transcript?: {
      wordCount: number;
      confidence: number;
    };
    error?: string;
  } | null> {
    try {
      const response = await apiClient.get(`/recordings/${recordingId}`);

      return {
        status: response.data.recording.status,
        transcript: response.data.recording.transcript,
        error: response.data.recording.errorMessage
      };
    } catch (error) {
      logger.error(`Failed to check status for recording ${recordingId}`, error as Error);
      return null;
    }
  }

  /**
   * Simple delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const recordingUploadService = new RecordingUploadService();
