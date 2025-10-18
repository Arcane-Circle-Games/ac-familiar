import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { apiClient } from '../api/client';
import { logger } from '../../utils/logger';
import { ExportedRecording } from '../processing/MultiTrackExporter';
import {
  RecordingUploadMetadata,
  RecordingDetailsResponse,
  RecordingStatus,
  RecordingUploadInitRequest,
  RecordingUploadInitResponse,
  RecordingUploadCompleteRequest,
  RecordingUploadCompleteResponse,
  RecordingUploadedFile,
  RecordingSegment,
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
   * Step 1: Initialize upload and get pre-signed URLs from API
   */
  private async initializeUpload(
    exportedRecording: ExportedRecording,
    metadata: RecordingUploadMetadata
  ): Promise<RecordingUploadInitResponse> {
    try {
      logger.info(`Initializing upload for session ${metadata.sessionId}`, {
        trackCount: exportedRecording.tracks.length,
      });

      // Build segments array matching API schema
      const segments: RecordingSegment[] = [];

      for (const track of exportedRecording.tracks) {
        const stats = await fs.promises.stat(track.filePath);
        const fileName = path.basename(track.filePath);

        // Debug: log actual track structure
        console.log('=== TRACK STRUCTURE ===');
        console.log('Track:', JSON.stringify(track, null, 2));
        console.log('Metadata keys:', Object.keys(track.metadata));
        console.log('Track keys:', Object.keys(track));
        console.log('=======================');

        segments.push({
          userId: track.metadata.userId,
          username: track.metadata.username,
          segmentIndex: track.metadata.segmentIndex ?? 0,
          fileName,
          absoluteStartTime: track.metadata.startTime,
          absoluteEndTime: track.metadata.endTime,
          duration: track.metadata.duration,
          fileSize: stats.size,
          format: track.format,
        });
      }

      // Build request matching API schema exactly
      const request: RecordingUploadInitRequest = {
        sessionId: metadata.sessionId,
        guildId: metadata.guildId,
        guildName: metadata.guildName,
        channelId: metadata.channelId,
        userId: metadata.userId,
        recordedAt: metadata.recordedAt,
        sessionStartTime: exportedRecording.sessionStartTime,
        sessionEndTime: exportedRecording.sessionEndTime,
        duration: metadata.duration,
        participantCount: exportedRecording.participantCount,
        totalSize: exportedRecording.totalSize,
        format: 'segmented',
        segments,
      };

      logger.debug('Sending init request with metadata:', {
        sessionId: request.sessionId,
        segmentCount: segments.length,
        totalSize: `${(request.totalSize / 1024 / 1024).toFixed(2)}MB`,
      });

      const response = await apiClient.post<RecordingUploadInitResponse>(
        '/recordings/init',
        request
      );

      if (!response.data) {
        throw new Error('No data in init upload response');
      }

      logger.info(`Upload initialized with recording ID: ${response.data.recordingId}`, {
        uploadUrlCount: response.data.uploadUrls.length,
      });

      return response.data;
    } catch (error: any) {
      logger.error(`Failed to initialize upload for session ${metadata.sessionId}`, error);
      throw error;
    }
  }

  /**
   * Step 2: Upload files to Blob Storage via API proxy
   *
   * TECH DEBT / TODO:
   * Currently uploads go through the API server as a proxy (bot → API → Vercel Blob).
   * This works but has performance implications:
   * - Double bandwidth usage (files uploaded twice)
   * - API server processes all file data
   * - Slower upload times for users
   *
   * FUTURE OPTIMIZATION:
   * Migrate to direct uploads using Vercel Blob client tokens:
   * 1. API generates client tokens via generateClientTokenFromReadWriteToken()
   * 2. Bot uses @vercel/blob SDK instead of axios PUT
   * 3. Files upload directly: bot → Vercel Blob (no proxy)
   * 4. Remove proxy endpoints from API server
   *
   * This would significantly improve upload performance and reduce API server load.
   * The current approach was chosen to avoid changing bot upload logic initially.
   */
  private async uploadFilesToBlobStorage(
    exportedRecording: ExportedRecording,
    uploadUrls: Array<{ fileIndex: number; uploadUrl: string; blobPath: string }>,
    onProgress?: UploadProgressCallback
  ): Promise<RecordingUploadedFile[]> {
    try {
      logger.info(`Uploading ${uploadUrls.length} files to Blob Storage`);

      const uploadedFiles: RecordingUploadedFile[] = [];
      let totalBytes = 0;
      let uploadedBytes = 0;

      // Calculate total size for progress tracking
      const fileSizes: number[] = [];
      for (const track of exportedRecording.tracks) {
        const stats = await fs.promises.stat(track.filePath);
        fileSizes.push(stats.size);
        totalBytes += stats.size;
      }

      // Upload each file to its pre-signed URL
      for (const urlInfo of uploadUrls) {
        const track = exportedRecording.tracks[urlInfo.fileIndex];
        if (!track) {
          throw new Error(`Track not found for file index ${urlInfo.fileIndex}`);
        }

        const fileBuffer = await fs.promises.readFile(track.filePath);
        const fileSize = fileSizes[urlInfo.fileIndex] || 0;

        // Extract relative path from outputDirectory
        const relativePath = path.relative(exportedRecording.outputDirectory, track.filePath);
        const fileName = path.basename(track.filePath);

        logger.debug(`Uploading file ${urlInfo.fileIndex} to Blob Storage`, {
          fileName,
          size: fileSize,
          blobPath: urlInfo.blobPath,
          url: urlInfo.uploadUrl.substring(0, 50) + '...',
        });

        // Upload to pre-signed URL using axios (not apiClient, since this goes to Blob Storage)
        await axios.put(urlInfo.uploadUrl, fileBuffer, {
          headers: {
            'Content-Type': 'audio/wav',
            'x-ms-blob-type': 'BlockBlob', // Required for Azure Blob Storage
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 300000, // 5 minutes
        });

        // Extract blob URL from upload URL (remove query parameters)
        const blobUrl = urlInfo.uploadUrl.split('?')[0] || urlInfo.uploadUrl;

        uploadedFiles.push({
          fileIndex: urlInfo.fileIndex,
          blobUrl,
          userId: track.metadata.userId,
          username: track.metadata.username,
          fileName,
          filePath: relativePath.replace(/\\/g, '/'), // Normalize to forward slashes
        });

        uploadedBytes += fileSize;

        logger.info(`File ${urlInfo.fileIndex} uploaded successfully`, {
          fileName,
          blobPath: urlInfo.blobPath,
          blobUrl: blobUrl.substring(0, 50) + '...',
        });

        if (onProgress) {
          onProgress({
            uploadedBytes,
            totalBytes,
            percentage: Math.round((uploadedBytes / totalBytes) * 100),
            currentFile: fileName,
            currentFileIndex: urlInfo.fileIndex,
            totalFiles: uploadUrls.length,
          });
        }
      }

      logger.info(`All ${uploadUrls.length} files uploaded to Blob Storage successfully`);
      return uploadedFiles;
    } catch (error: any) {
      // Extract useful error info without circular references
      const errorInfo: Record<string, any> = {
        message: error.message,
        code: error.code,
      };

      if (error.response) {
        errorInfo.status = error.response.status;
        errorInfo.statusText = error.response.statusText;
        errorInfo.responseData = error.response.data;
      } else if (error.request) {
        errorInfo.requestFailed = true;
        errorInfo.noResponse = true;
      }

      logger.error('Failed to upload files to Blob Storage', error as Error, errorInfo);
      throw error;
    }
  }

  /**
   * Step 3: Complete the upload by notifying the API with blob URLs
   */
  private async completeUpload(
    recordingId: string,
    uploadedFiles: RecordingUploadedFile[]
  ): Promise<RecordingUploadCompleteResponse> {
    try {
      logger.info(`Completing upload for recording ${recordingId}`, {
        fileCount: uploadedFiles.length,
      });

      const request: RecordingUploadCompleteRequest = {
        files: uploadedFiles,
      };

      logger.debug('Sending complete request with file structure:', {
        fileCount: uploadedFiles.length,
        sampleFiles: uploadedFiles.slice(0, 3).map(f => ({
          filePath: f.filePath,
          username: f.username,
        })),
      });

      const response = await apiClient.post<RecordingUploadCompleteResponse>(
        `/recordings/${recordingId}/complete`,
        request
      );

      if (!response.data) {
        throw new Error('No data in complete upload response');
      }

      logger.info(`Upload completed successfully for recording ${recordingId}`);
      return response.data;
    } catch (error: any) {
      logger.error(`Failed to complete upload for recording ${recordingId}`, error);
      throw error;
    }
  }

  /**
   * Upload recording to platform API using two-step flow
   */
  async uploadRecording(
    exportedRecording: ExportedRecording,
    metadata: RecordingUploadMetadata,
    onProgress?: UploadProgressCallback
  ): Promise<UploadResult> {
    try {
      logger.info(`Starting two-step upload for session ${metadata.sessionId}`, {
        trackCount: exportedRecording.tracks.length,
      });

      const startTime = Date.now();

      // Step 1: Initialize upload and get pre-signed URLs
      const initResponse = await this.initializeUpload(exportedRecording, metadata);

      // Step 2: Upload files directly to Blob Storage
      const uploadedFiles = await this.uploadFilesToBlobStorage(
        exportedRecording,
        initResponse.uploadUrls,
        onProgress
      );

      // Step 3: Complete the upload
      const completeResponse = await this.completeUpload(initResponse.recordingId, uploadedFiles);

      const uploadDuration = Date.now() - startTime;

      logger.info(`Upload completed in ${uploadDuration}ms`, {
        sessionId: metadata.sessionId,
        recordingId: completeResponse.recording.id,
      });

      return {
        success: true,
        recordingId: completeResponse.recording.id,
        downloadUrls: completeResponse.recording.downloadUrls,
        viewUrl: completeResponse.recording.viewUrl,
        estimatedProcessingTime: completeResponse.recording.estimatedProcessingTime,
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

      // Don't retry on 4xx errors (client errors like validation failures or duplicates)
      if (result.error && (result.error.includes('409') || result.error.includes('Duplicate') || result.error.includes('Conflict'))) {
        logger.info('Upload skipped - recording already exists on platform', {
          sessionId: metadata.sessionId,
          error: result.error,
        });
        // Treat duplicates as success since the recording is already uploaded
        return {
          success: true,
          error: 'Recording already uploaded (duplicate session ID)'
        };
      }

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

      const result: {
        status: RecordingStatus;
        transcript?: {
          wordCount: number;
          confidence: number;
        };
        error?: string;
      } = {
        status: response.data?.recording?.status || 'failed',
      };

      if (response.data?.recording?.transcript) {
        result.transcript = {
          wordCount: response.data.recording.transcript.wordCount,
          confidence: response.data.recording.transcript.confidence,
        };
      }

      return result;
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
