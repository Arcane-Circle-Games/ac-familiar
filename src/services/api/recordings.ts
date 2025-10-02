import { apiClient } from './client';
import {
  Recording,
  Transcription,
  TranscriptionSegment,
  CreateRecordingRequest,
  CreateTranscriptionRequest,
  ApiResponse
} from '../../types/api';
import {
  RecordingDetailsResponse,
  RecordingListResponse,
  RecordingStatus,
} from '../../types/recording-api';
import { logInfo, logError } from '../../utils/logger';

export class RecordingService {
  
  // Get all recordings with optional filtering
  public async getRecordings(params?: {
    sessionId?: string;
    status?: Recording['status'];
    page?: number;
    limit?: number;
  }): Promise<ApiResponse<Recording[]>> {
    try {
      logInfo('Fetching recordings', { params });
      return await apiClient.get<Recording[]>('/recordings', params);
    } catch (error) {
      logError('Failed to fetch recordings', error as Error, { params });
      throw error;
    }
  }
  
  // Get a specific recording by ID
  public async getRecording(recordingId: string): Promise<ApiResponse<Recording>> {
    try {
      logInfo('Fetching recording', { recordingId });
      return await apiClient.get<Recording>(`/recordings/${recordingId}`);
    } catch (error) {
      logError('Failed to fetch recording', error as Error, { recordingId });
      throw error;
    }
  }
  
  // Create a new recording record
  public async createRecording(
    data: CreateRecordingRequest,
    discordUserId: string
  ): Promise<ApiResponse<Recording>> {
    try {
      logInfo('Creating recording record', { data, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.post<Recording>('/recordings', data);
    } catch (error) {
      logError('Failed to create recording record', error as Error, { data, discordUserId });
      throw error;
    }
  }
  
  // Update recording status
  public async updateRecordingStatus(
    recordingId: string,
    status: Recording['status'],
    discordUserId: string
  ): Promise<ApiResponse<Recording>> {
    try {
      logInfo('Updating recording status', { recordingId, status, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.patch<Recording>(`/recordings/${recordingId}`, {
        status
      });
    } catch (error) {
      logError('Failed to update recording status', error as Error, {
        recordingId,
        status,
        discordUserId
      });
      throw error;
    }
  }
  
  // Upload recording file
  public async uploadRecording(
    recordingId: string,
    fileBuffer: Buffer,
    filename: string,
    discordUserId: string
  ): Promise<ApiResponse<Recording>> {
    try {
      logInfo('Uploading recording file', { 
        recordingId, 
        filename, 
        fileSize: fileBuffer.length,
        discordUserId 
      });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      const formData = new FormData();
      formData.append('file', new Blob([fileBuffer]), filename);
      formData.append('recordingId', recordingId);
      
      return await apiClient.post<Recording>(`/recordings/${recordingId}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
    } catch (error) {
      logError('Failed to upload recording file', error as Error, {
        recordingId,
        filename,
        fileSize: fileBuffer.length,
        discordUserId
      });
      throw error;
    }
  }
  
  // Get recording download URL
  public async getRecordingDownloadUrl(
    recordingId: string,
    discordUserId: string
  ): Promise<ApiResponse<{ downloadUrl: string; expiresAt: string }>> {
    try {
      logInfo('Getting recording download URL', { recordingId, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.get<{ downloadUrl: string; expiresAt: string }>(
        `/recordings/${recordingId}/download`
      );
    } catch (error) {
      logError('Failed to get recording download URL', error as Error, {
        recordingId,
        discordUserId
      });
      throw error;
    }
  }
  
  // Delete recording
  public async deleteRecording(
    recordingId: string,
    discordUserId: string
  ): Promise<ApiResponse<void>> {
    try {
      logInfo('Deleting recording', { recordingId, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.delete<void>(`/recordings/${recordingId}`);
    } catch (error) {
      logError('Failed to delete recording', error as Error, {
        recordingId,
        discordUserId
      });
      throw error;
    }
  }
  
  // Get recordings for a session
  public async getSessionRecordings(sessionId: string): Promise<ApiResponse<Recording[]>> {
    try {
      logInfo('Fetching session recordings', { sessionId });
      return await this.getRecordings({ sessionId });
    } catch (error) {
      logError('Failed to fetch session recordings', error as Error, { sessionId });
      throw error;
    }
  }
  
  // === Transcription Methods ===
  
  // Get all transcriptions
  public async getTranscriptions(params?: {
    recordingId?: string;
    status?: Transcription['status'];
    page?: number;
    limit?: number;
  }): Promise<ApiResponse<Transcription[]>> {
    try {
      logInfo('Fetching transcriptions', { params });
      return await apiClient.get<Transcription[]>('/transcriptions', params);
    } catch (error) {
      logError('Failed to fetch transcriptions', error as Error, { params });
      throw error;
    }
  }
  
  // Get a specific transcription by ID
  public async getTranscription(transcriptionId: string): Promise<ApiResponse<Transcription>> {
    try {
      logInfo('Fetching transcription', { transcriptionId });
      return await apiClient.get<Transcription>(`/transcriptions/${transcriptionId}`);
    } catch (error) {
      logError('Failed to fetch transcription', error as Error, { transcriptionId });
      throw error;
    }
  }
  
  // Create a new transcription record
  public async createTranscription(
    data: CreateTranscriptionRequest,
    discordUserId: string
  ): Promise<ApiResponse<Transcription>> {
    try {
      logInfo('Creating transcription record', { data, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.post<Transcription>('/transcriptions', data);
    } catch (error) {
      logError('Failed to create transcription record', error as Error, { data, discordUserId });
      throw error;
    }
  }
  
  // Update transcription status
  public async updateTranscriptionStatus(
    transcriptionId: string,
    status: Transcription['status'],
    discordUserId: string
  ): Promise<ApiResponse<Transcription>> {
    try {
      logInfo('Updating transcription status', { transcriptionId, status, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.patch<Transcription>(`/transcriptions/${transcriptionId}`, {
        status
      });
    } catch (error) {
      logError('Failed to update transcription status', error as Error, {
        transcriptionId,
        status,
        discordUserId
      });
      throw error;
    }
  }
  
  // Get transcription segments
  public async getTranscriptionSegments(
    transcriptionId: string
  ): Promise<ApiResponse<TranscriptionSegment[]>> {
    try {
      logInfo('Fetching transcription segments', { transcriptionId });
      return await apiClient.get<TranscriptionSegment[]>(`/transcriptions/${transcriptionId}/segments`);
    } catch (error) {
      logError('Failed to fetch transcription segments', error as Error, { transcriptionId });
      throw error;
    }
  }
  
  // Create transcription segments
  public async createTranscriptionSegments(
    transcriptionId: string,
    segments: Omit<TranscriptionSegment, 'id' | 'transcriptionId'>[],
    discordUserId: string
  ): Promise<ApiResponse<TranscriptionSegment[]>> {
    try {
      logInfo('Creating transcription segments', { 
        transcriptionId, 
        segmentCount: segments.length, 
        discordUserId 
      });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.post<TranscriptionSegment[]>(
        `/transcriptions/${transcriptionId}/segments`,
        { segments }
      );
    } catch (error) {
      logError('Failed to create transcription segments', error as Error, {
        transcriptionId,
        segmentCount: segments.length,
        discordUserId
      });
      throw error;
    }
  }
  
  // Get transcription by recording ID
  public async getRecordingTranscription(recordingId: string): Promise<ApiResponse<Transcription>> {
    try {
      logInfo('Fetching recording transcription', { recordingId });

      const transcriptions = await this.getTranscriptions({ recordingId, limit: 1 });

      if (transcriptions.data && transcriptions.data.length > 0) {
        return {
          success: true,
          data: transcriptions.data[0]
        };
      } else {
        return {
          success: false,
          error: 'No transcription found for this recording'
        };
      }
    } catch (error) {
      logError('Failed to fetch recording transcription', error as Error, { recordingId });
      throw error;
    }
  }

  // === Phase 2C Methods ===

  /**
   * Get recording details (Phase 2C format)
   */
  public async getRecordingDetails(recordingId: string): Promise<RecordingDetailsResponse['recording'] | null> {
    try {
      logInfo('Fetching recording details (Phase 2C)', { recordingId });

      const response = await apiClient.get<RecordingDetailsResponse>(`/recordings/${recordingId}`);
      return response.data?.recording || null;
    } catch (error) {
      logError('Failed to fetch recording details', error as Error, { recordingId });
      return null;
    }
  }

  /**
   * Check recording processing status
   */
  public async checkRecordingStatus(recordingId: string): Promise<RecordingStatus | null> {
    const recording = await this.getRecordingDetails(recordingId);
    return recording ? recording.status : null;
  }

  /**
   * List recordings with Phase 2C filters
   */
  public async listRecordingsPhase2C(filters?: {
    guildId?: string;
    userId?: string;
    campaignId?: string;
    status?: RecordingStatus;
    limit?: number;
    offset?: number;
  }): Promise<RecordingListResponse | null> {
    try {
      logInfo('Listing recordings (Phase 2C)', filters);

      const params = new URLSearchParams();
      if (filters?.guildId) params.append('guildId', filters.guildId);
      if (filters?.userId) params.append('userId', filters.userId);
      if (filters?.campaignId) params.append('campaignId', filters.campaignId);
      if (filters?.status) params.append('status', filters.status);
      if (filters?.limit) params.append('limit', filters.limit.toString());
      if (filters?.offset) params.append('offset', filters.offset.toString());

      const response = await apiClient.get<RecordingListResponse>(
        `/recordings?${params.toString()}`
      );

      return response.data || null;
    } catch (error) {
      logError('Failed to list recordings', error as Error, filters);
      return null;
    }
  }

  /**
   * Retry transcription for a recording
   */
  public async retryTranscription(recordingId: string, discordUserId: string): Promise<boolean> {
    try {
      logInfo('Retrying transcription', { recordingId, discordUserId });

      await apiClient.authenticateWithDiscord(discordUserId);
      await apiClient.post(`/recordings/${recordingId}/retranscribe`, {});

      logInfo('Transcription retry queued', { recordingId });
      return true;
    } catch (error) {
      logError('Failed to retry transcription', error as Error, { recordingId, discordUserId });
      return false;
    }
  }
}

export const recordingService = new RecordingService();