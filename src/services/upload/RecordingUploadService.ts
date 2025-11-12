import * as fs from 'fs';
import * as path from 'path';
import { put } from '@vercel/blob';
import { apiClient } from '../api/client';
import { logger, sanitizeAxiosError } from '../../utils/logger';
import { config } from '../../utils/config';
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
  RecordingInitLiveRequest,
  RecordingInitLiveResponse,
  RecordingFinalizeRequest,
  RecordingFinalizeResponse,
  RecordingSegmentWithBlob,
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
      logger.error(`Failed to initialize upload for session ${metadata.sessionId}`, sanitizeAxiosError(error));
      throw error;
    }
  }

  /**
   * Step 2: Upload files DIRECTLY to Vercel Blob Storage
   *
   * Uses signed URLs from the API to upload directly to Vercel Blob Storage.
   * This eliminates the API proxy bottleneck and allows files of any size.
   */
  private async uploadFilesToBlobStorage(
    exportedRecording: ExportedRecording,
    uploadUrls: Array<{ fileIndex: number; uploadUrl: string; blobPath: string }>,
    onProgress?: UploadProgressCallback
  ): Promise<RecordingUploadedFile[]> {
    try {
      logger.info(`Uploading ${uploadUrls.length} files directly to Vercel Blob Storage`);

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

      // Upload each file to its signed URL (direct to Vercel Blob)
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

        logger.debug(`Uploading file ${urlInfo.fileIndex} directly to Vercel Blob Storage`, {
          fileName,
          size: fileSize,
          blobPath: urlInfo.blobPath,
          url: urlInfo.uploadUrl.substring(0, 50) + '...',
        });

        // Upload using Vercel Blob server-side SDK
        const blob = await put(urlInfo.blobPath, fileBuffer, {
          access: 'public',
          contentType: 'audio/wav',
          addRandomSuffix: false,
        });

        const blobUrl = blob.url;
        logger.debug(`Uploaded via Vercel Blob server-side SDK`, {
          fileIndex: urlInfo.fileIndex,
          blobUrl: blobUrl.substring(0, 60) + '...',
        });

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
      // Extract useful error info without circular references from axios errors
      const errorInfo: Record<string, any> = {
        message: error.message,
        code: error.code,
      };

      if (error.response) {
        errorInfo['status'] = error.response.status;
        errorInfo['statusText'] = error.response.statusText;
        errorInfo['responseData'] = error.response.data;
      } else if (error.request) {
        errorInfo['requestFailed'] = true;
        errorInfo['noResponse'] = true;
      }

      // Add context about which file was being uploaded
      if (error.config?.url) {
        errorInfo['uploadUrl'] = error.config.url;
      }

      // Create a clean error object to avoid logging the massive axios error with circular refs
      const cleanError = new Error(error.message || 'Upload failed');
      cleanError.name = error.name || 'UploadError';
      cleanError.stack = error.stack;

      logger.error('Failed to upload files to Blob Storage', cleanError, errorInfo);
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
      // Check if this is the "Recording not in uploading state" error
      if (error.response?.data?.error?.includes('not in uploading state') ||
          error.response?.data?.error?.includes('Recording not in uploading state')) {
        const currentStatus = error.response?.data?.currentStatus || 'unknown';
        logger.error(
          `❌ Cannot complete upload - recording ${recordingId} is in '${currentStatus}' state, not 'uploading'.\n` +
          `This usually means the recording was initialized as a live recording but the upload flow is trying to use batch upload.\n` +
          `The recording should have been finalized using the finalize endpoint, not the complete endpoint.`
        );

        // Create a more helpful error message
        const helpfulError = new Error(
          `Recording ${recordingId} is in '${currentStatus}' state. ` +
          `This recording should use the finalize flow, not the batch upload flow. ` +
          `This is likely because the recording was started as a live recording but the recordingId wasn't properly tracked.`
        );
        (helpfulError as any).originalError = error;
        (helpfulError as any).recordingId = recordingId;
        (helpfulError as any).currentStatus = currentStatus;
        throw helpfulError;
      }

      logger.error(`Failed to complete upload for recording ${recordingId}`, sanitizeAxiosError(error));
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
        hasRecordingId: !!exportedRecording.recordingId
      });

      const startTime = Date.now();

      // Check if this is a live recording (has recordingId from init-live)
      if (exportedRecording.recordingId) {
        logger.info(`Using finalize flow for live recording ${exportedRecording.recordingId}`);

        // Build segments array for finalize request
        const segments: RecordingSegmentWithBlob[] = [];

        // Upload each track/segment individually using segment-upload-url endpoint
        for (let i = 0; i < exportedRecording.tracks.length; i++) {
          const track = exportedRecording.tracks[i];
          if (!track) continue;

          onProgress?.({
            uploadedBytes: i * (track.fileSize || 0),
            totalBytes: exportedRecording.totalSize,
            percentage: Math.round((i / exportedRecording.tracks.length) * 100),
            currentFile: track.filePath,
            currentFileIndex: i,
            totalFiles: exportedRecording.tracks.length
          });

          // Upload this segment
          const { blobUrl, blobPath } = await this.uploadSegmentImmediately(
            exportedRecording.recordingId,
            track.filePath,
            {
              userId: track.metadata.userId,
              username: track.metadata.username,
              segmentIndex: track.metadata.segmentIndex ?? i,
              absoluteStartTime: track.metadata.startTime,
              absoluteEndTime: track.metadata.endTime,
              duration: track.metadata.duration,
              format: track.format
            }
          );

          // Add to segments array
          segments.push({
            userId: track.metadata.userId,
            username: track.metadata.username,
            segmentIndex: track.metadata.segmentIndex ?? i,
            fileName: track.filePath.split('/').pop() || `segment_${i}.wav`,
            absoluteStartTime: track.metadata.startTime,
            absoluteEndTime: track.metadata.endTime,
            duration: track.metadata.duration ?? 0,
            fileSize: track.fileSize,
            format: track.format,
            blobUrl,
            filePath: blobPath
          });
        }

        // Finalize the live recording
        const finalizeResponse = await this.finalizeRecording(
          exportedRecording.recordingId,
          exportedRecording.sessionEndTime,
          segments
        );

        const uploadDuration = Date.now() - startTime;
        logger.info(`Live recording finalized in ${uploadDuration}ms`, {
          sessionId: metadata.sessionId,
          recordingId: finalizeResponse.recording.id
        });

        return {
          success: true,
          recordingId: finalizeResponse.recording.id,
          downloadUrls: finalizeResponse.recording.downloadUrls,
          viewUrl: `${config.PLATFORM_WEB_URL}/dashboard/recordings/${finalizeResponse.recording.id}`,
          estimatedProcessingTime: finalizeResponse.recording.estimatedProcessingTime,
        };
      }

      // Batch upload flow (no recordingId - not a live recording)
      logger.info(`Using batch upload flow (no live recording ID)`);

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
        viewUrl: `${config.PLATFORM_WEB_URL}/dashboard/recordings/${completeResponse.recording.id}`,
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
    status: RecordingStatus;
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

  // ========================================================================
  // STREAMING UPLOAD METHODS (for on-the-fly segment uploads)
  // ========================================================================

  /**
   * Check for active (live) recordings in a Discord channel
   * Used for crash recovery - detects orphaned recordings from previous bot crashes
   */
  async checkForActiveRecording(
    guildId: string,
    channelId: string
  ): Promise<{
    found: boolean;
    recordingId?: string;
    sessionId?: string;
    status?: RecordingStatus;
    startedAt?: string;
  }> {
    try {
      logger.info(`Checking for active recording in channel ${channelId}`);

      const response = await apiClient.get<{
        found: boolean;
        recordingId?: string;
        sessionId?: string;
        status?: RecordingStatus;
        startedAt?: string;
        participantCount?: number;
        createdAt?: string;
      }>(`/recordings/active?guildId=${guildId}&channelId=${channelId}`);

      if (response.data && response.data.found) {
        logger.info(`Found active recording: ${response.data.recordingId}`, {
          sessionId: response.data.sessionId,
          status: response.data.status,
          startedAt: response.data.startedAt,
        });
        return {
          found: true,
          ...(response.data.recordingId !== undefined && { recordingId: response.data.recordingId }),
          ...(response.data.sessionId !== undefined && { sessionId: response.data.sessionId }),
          ...(response.data.status !== undefined && { status: response.data.status }),
          ...(response.data.startedAt !== undefined && { startedAt: response.data.startedAt }),
        };
      }

      logger.info(`No active recording found in channel ${channelId}`);
      return { found: false };
    } catch (error: any) {
      // 404 means no active recording found
      if (error.response && error.response.status === 404) {
        logger.info(`No active recording found in channel ${channelId}`);
        return { found: false };
      }

      logger.error(`Failed to check for active recording in channel ${channelId}`, sanitizeAxiosError(error));
      // Don't throw - return not found on error
      return { found: false };
    }
  }

  /**
   * Initialize a live recording session (called when recording starts)
   */
  async initLiveRecording(
    sessionId: string,
    guildId: string,
    guildName: string,
    channelId: string,
    userId: string,
    platformSessionId?: string
  ): Promise<RecordingInitLiveResponse> {
    try {
      logger.info(`Initializing live recording session ${sessionId}`, {
        platformSessionId
      });

      const request: RecordingInitLiveRequest = {
        sessionId,
        ...(platformSessionId !== undefined && { platformSessionId }),
        guildId,
        guildName,
        channelId,
        userId,
        recordedAt: new Date().toISOString(),
      };

      const response = await apiClient.post<{ success: boolean; data: RecordingInitLiveResponse } | RecordingInitLiveResponse>(
        '/recordings/init-live',
        request
      );

      if (!response.data) {
        throw new Error('No data in init-live response');
      }

      // Handle both wrapped and unwrapped response formats
      // Wrapped format: { success: boolean, data: { recordingId, ... } }
      // Unwrapped format: { recordingId, ... }
      let result: RecordingInitLiveResponse;
      if ('data' in response.data && response.data.data) {
        // Wrapped format
        result = response.data.data;
        logger.debug('Parsed wrapped init-live response format');
      } else if ('recordingId' in response.data) {
        // Unwrapped format (API returns data directly)
        result = response.data as RecordingInitLiveResponse;
        logger.debug('Parsed unwrapped init-live response format');
      } else {
        // Log the actual response structure to help debug
        logger.error('Unexpected init-live response structure', {
          responseKeys: Object.keys(response.data),
          responseSample: JSON.stringify(response.data).substring(0, 200)
        });
        throw new Error('Unexpected init-live response structure');
      }

      logger.info(`Live recording initialized with ID: ${result.recordingId}`);
      return result;
    } catch (error: any) {
      logger.error(`Failed to init live recording for session ${sessionId}`, sanitizeAxiosError(error));
      throw error;
    }
  }

  /**
   * Upload a single segment immediately after it completes
   *
   * Flow:
   * 1. Upload file using Vercel Blob client upload (with handleUpload on API side)
   * 2. API generates token via handleUpload endpoint
   * 3. File uploads directly to Vercel Blob Storage
   * 4. Return blob URL
   */
  async uploadSegmentImmediately(
    recordingId: string,
    segmentFilePath: string,
    metadata: {
      userId: string;
      username: string;
      segmentIndex: number;
      absoluteStartTime: number;
      absoluteEndTime: number;
      duration: number;
      format: string;
    }
  ): Promise<{ blobUrl: string; blobPath: string }> {
    try {
      const fileName = path.basename(segmentFilePath);
      const stats = await fs.promises.stat(segmentFilePath);
      const fileSize = stats.size;

      logger.info(`Uploading segment ${metadata.segmentIndex} for user ${metadata.username}`, {
        fileName,
        fileSize,
        recordingId,
      });

      // Read file into buffer for upload
      const fileBuffer = await fs.promises.readFile(segmentFilePath);

      logger.debug(`Uploading to Vercel Blob via server-side SDK`, {
        segmentIndex: metadata.segmentIndex,
        fileSize,
        bufferLength: fileBuffer.length,
      });

      // Build the blob path for the file (where it will be stored in Vercel Blob)
      const blobPath = `recordings/${recordingId}/${metadata.username}/segment_${metadata.segmentIndex.toString().padStart(3, '0')}.wav`;

      // Upload using Vercel Blob server-side SDK (works in Node.js)
      const uploadedBlob = await put(blobPath, fileBuffer, {
        access: 'public',
        contentType: 'audio/wav',
        addRandomSuffix: false,
      });

      logger.info(`Segment ${metadata.segmentIndex} uploaded successfully`, {
        blobUrl: uploadedBlob.url.substring(0, 50) + '...',
        fileSize,
      });

      return {
        blobUrl: uploadedBlob.url,
        blobPath: uploadedBlob.pathname
      };
    } catch (error: any) {
      // Sanitize error to avoid logging large buffers
      const sanitizedError = {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        statusText: error.response?.statusText,
        url: error.config?.url,
        method: error.config?.method,
        cause: error.cause?.message,
        causeCode: error.cause?.code
      };

      // Log full error for debugging
      console.error('Full upload error:', JSON.stringify({
        name: error.name,
        message: error.message,
        code: error.code,
        cause: error.cause ? {
          message: error.cause.message,
          code: error.cause.code,
          errno: error.cause.errno,
          syscall: error.cause.syscall
        } : undefined
      }, null, 2));

      logger.error(`Failed to upload segment ${metadata.segmentIndex}`, sanitizedError);
      throw error;
    }
  }

  /**
   * Finalize recording with all uploaded segments
   */
  async finalizeRecording(
    recordingId: string,
    sessionEndTime: number,
    segments: RecordingSegmentWithBlob[]
  ): Promise<RecordingFinalizeResponse> {
    try {
      logger.info(`Finalizing recording ${recordingId}`, {
        segmentCount: segments.length,
      });

      // Calculate totals
      const totalSize = segments.reduce((sum, seg) => sum + seg.fileSize, 0);
      const participantCount = new Set(segments.map((seg) => seg.userId)).size;
      const sessionStartTime = Math.min(...segments.map((seg) => seg.absoluteStartTime));
      const duration = sessionEndTime - sessionStartTime;

      const request: RecordingFinalizeRequest = {
        sessionEndTime,
        duration,
        totalSize,
        participantCount,
        segments,
      };

      const response = await apiClient.post<{ success: boolean; data: RecordingFinalizeResponse } | RecordingFinalizeResponse>(
        `/recordings/${recordingId}/finalize`,
        request
      );

      if (!response.data) {
        throw new Error('No data in finalize response');
      }

      // Handle both wrapped and unwrapped response formats
      let result: RecordingFinalizeResponse;
      if ('data' in response.data && response.data.data) {
        result = response.data.data;
      } else if ('recording' in response.data) {
        result = response.data as RecordingFinalizeResponse;
      } else {
        logger.error('Unexpected finalize response structure', {
          responseKeys: Object.keys(response.data)
        });
        throw new Error('Unexpected finalize response structure');
      }

      logger.info(`Recording ${recordingId} finalized successfully`);
      return result;
    } catch (error: any) {
      logger.error(`Failed to finalize recording ${recordingId}`, sanitizeAxiosError(error));
      throw error;
    }
  }
}

// Singleton instance
export const recordingUploadService = new RecordingUploadService();
