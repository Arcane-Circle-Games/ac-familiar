import FormData from 'form-data';
import * as fs from 'fs';
import { apiClient } from '../api/client';
import { logger } from '../../utils/logger';
import { ExportedRecording } from '../processing/MultiTrackExporter';
import {
  RecordingUploadMetadata,
  RecordingUploadResponse,
  RecordingDetailsResponse,
} from '../../types/recording-api';

// Re-export for backward compatibility
export type UploadMetadata = RecordingUploadMetadata;

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

interface UploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  percentage: number;
  currentFile: string;
  currentFileIndex: number;
  totalFiles: number;
}

export type UploadProgressCallback = (progress: UploadProgress) => void;

export class RecordingUploadService {
  /**
   * Upload recording to platform API
   */
  async uploadRecording(
    exportedRecording: ExportedRecording,
    metadata: RecordingUploadMetadata,
    onProgress?: UploadProgressCallback
  ): Promise<UploadResult> {
    try {
      logger.info(`Starting upload for session ${metadata.sessionId}`, {
        trackCount: exportedRecording.tracks.length,
      });

      // Create form data
      const form = new FormData();

      // Add metadata as JSON
      form.append('metadata', JSON.stringify(metadata));

      // Calculate total size for progress tracking
      let totalBytes = 0;
      const fileSizes: number[] = [];

      for (const track of exportedRecording.tracks) {
        const stats = await fs.promises.stat(track.filePath);
        fileSizes.push(stats.size);
        totalBytes += stats.size;
      }

      // Add audio files
      let uploadedBytes = 0;
      for (let i = 0; i < exportedRecording.tracks.length; i++) {
        const track = exportedRecording.tracks[i];
        const fileStream = fs.createReadStream(track.filePath);
        const filename = track.filePath.split('/').pop() || 'audio.wav';

        form.append(`file${i}`, fileStream, {
          filename,
          contentType: 'audio/wav',
        });

        logger.debug(`Added file to upload: ${filename}`, {
          size: fileSizes[i],
        });

        uploadedBytes += fileSizes[i];

        if (onProgress) {
          onProgress({
            uploadedBytes,
            totalBytes,
            percentage: Math.round((uploadedBytes / totalBytes) * 100),
            currentFile: filename,
            currentFileIndex: i,
            totalFiles: exportedRecording.tracks.length,
          });
        }
      }

      // Upload to API
      const startTime = Date.now();
      const response = await apiClient.post<RecordingUploadResponse>('/recordings', form, {
        headers: {
          ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 300000, // 5 minutes
      });

      const uploadDuration = Date.now() - startTime;

      logger.info(`Upload completed in ${uploadDuration}ms`, {
        sessionId: metadata.sessionId,
        recordingId: response.data.recording.id,
      });

      return {
        success: true,
        recordingId: response.data?.recording?.id,
        downloadUrls: response.data?.recording?.downloadUrls,
        viewUrl: response.data?.recording?.viewUrl,
        estimatedProcessingTime: response.data?.recording?.estimatedProcessingTime,
      };
    } catch (error: any) {
      logger.error(`Upload failed for session ${metadata.sessionId}`, error as Error);

      if (error.response) {
        // API returned an error
        return {
          success: false,
          error: error.response.data?.error || `API error: ${error.response.status}`,
        };
      } else if (error.request) {
        // Request made but no response
        return {
          success: false,
          error: 'No response from API - network issue or API is down',
        };
      } else {
        // Something else went wrong
        return {
          success: false,
          error: error.message || 'Unknown error during upload',
        };
      }
    }
  }

  /**
   * Upload with retry logic
   */
  async uploadWithRetry(
    exportedRecording: ExportedRecording,
    metadata: RecordingUploadMetadata,
    maxRetries: number = 3,
    onProgress?: UploadProgressCallback
  ): Promise<UploadResult> {
    let lastError: UploadResult | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      logger.info(`Upload attempt ${attempt}/${maxRetries} for session ${metadata.sessionId}`);

      const result = await this.uploadRecording(exportedRecording, metadata, onProgress);

      if (result.success) {
        return result;
      }

      lastError = result;

      // Don't retry on 4xx errors (client errors like validation failures)
      if (result.error && result.error.includes('4')) {
        logger.error('Upload failed with client error, not retrying', {
          sessionId: metadata.sessionId,
          error: result.error,
        });
        return lastError;
      }

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
        directory: exportedRecording.outputDirectory,
      });

      // Delete the entire session directory
      await fs.promises.rm(exportedRecording.outputDirectory, { recursive: true, force: true });

      logger.info(`Local files cleaned up successfully`);
    } catch (error) {
      logger.error(`Failed to cleanup local files`, error as Error, {
        directory: exportedRecording.outputDirectory,
      });
      // Don't throw - cleanup failure shouldn't break the flow
    }
  }

  /**
   * Check recording status on API
   */
  async checkStatus(recordingId: string): Promise<{
    status: 'uploading' | 'processing' | 'completed' | 'failed';
    transcript?: {
      wordCount: number;
      confidence: number;
    };
    error?: string;
  } | null> {
    try {
      const response = await apiClient.get<RecordingDetailsResponse>(`/recordings/${recordingId}`);

      return {
        status: response.data?.recording?.status || 'failed',
        transcript: response.data?.recording?.transcript
          ? {
              wordCount: response.data.recording.transcript.wordCount,
              confidence: response.data.recording.transcript.confidence,
            }
          : undefined,
        error: undefined,
      };
    } catch (error) {
      logger.error(`Failed to check status for recording ${recordingId}`, error as Error);
      return null;
    }
  }

  /**
   * Estimate upload time based on file sizes
   */
  async estimateUploadTime(exportedRecording: ExportedRecording): Promise<{
    totalSizeMB: number;
    estimatedSeconds: number;
  }> {
    let totalBytes = 0;

    for (const track of exportedRecording.tracks) {
      const stats = await fs.promises.stat(track.filePath);
      totalBytes += stats.size;
    }

    const totalSizeMB = totalBytes / (1024 * 1024);

    // Assume 1MB/s upload speed (conservative estimate)
    const estimatedSeconds = Math.ceil(totalSizeMB / 1);

    return {
      totalSizeMB: Math.round(totalSizeMB * 100) / 100,
      estimatedSeconds,
    };
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
