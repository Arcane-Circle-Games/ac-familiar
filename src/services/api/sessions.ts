import { apiClient } from './client';
import {
  Session,
  SessionAttendee,
  CreateSessionRequest,
  UpdateSessionRequest,
  SessionQueryParams,
  ApiResponse
} from '../../types/api';
import { logInfo, logError } from '../../utils/logger';

export class SessionService {
  
  // Get all sessions with optional filtering
  public async getSessions(params?: SessionQueryParams): Promise<ApiResponse<Session[]>> {
    try {
      logInfo('Fetching sessions', { params });
      return await apiClient.get<Session[]>('/sessions', params);
    } catch (error) {
      logError('Failed to fetch sessions', error as Error, { params });
      throw error;
    }
  }
  
  // Get a specific session by ID
  public async getSession(sessionId: string): Promise<ApiResponse<Session>> {
    try {
      logInfo('Fetching session', { sessionId });
      return await apiClient.get<Session>(`/sessions/${sessionId}`);
    } catch (error) {
      logError('Failed to fetch session', error as Error, { sessionId });
      throw error;
    }
  }
  
  // Create a new session
  public async createSession(data: CreateSessionRequest, discordUserId: string): Promise<ApiResponse<Session>> {
    try {
      logInfo('Creating session', { data, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.post<Session>('/sessions', data);
    } catch (error) {
      logError('Failed to create session', error as Error, { data, discordUserId });
      throw error;
    }
  }
  
  // Update an existing session
  public async updateSession(
    sessionId: string,
    data: UpdateSessionRequest,
    discordUserId: string
  ): Promise<ApiResponse<Session>> {
    try {
      logInfo('Updating session', { sessionId, data, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.put<Session>(`/sessions/${sessionId}`, data);
    } catch (error) {
      logError('Failed to update session', error as Error, { sessionId, data, discordUserId });
      throw error;
    }
  }
  
  // Delete a session
  public async deleteSession(sessionId: string, discordUserId: string): Promise<ApiResponse<void>> {
    try {
      logInfo('Deleting session', { sessionId, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.delete<void>(`/sessions/${sessionId}`);
    } catch (error) {
      logError('Failed to delete session', error as Error, { sessionId, discordUserId });
      throw error;
    }
  }
  
  // Get session attendees
  public async getSessionAttendees(sessionId: string): Promise<ApiResponse<SessionAttendee[]>> {
    try {
      logInfo('Fetching session attendees', { sessionId });
      return await apiClient.get<SessionAttendee[]>(`/sessions/${sessionId}/attendees`);
    } catch (error) {
      logError('Failed to fetch session attendees', error as Error, { sessionId });
      throw error;
    }
  }
  
  // Mark attendance for a session
  public async markAttendance(
    sessionId: string,
    status: SessionAttendee['status'],
    discordUserId: string,
    notes?: string
  ): Promise<ApiResponse<SessionAttendee>> {
    try {
      logInfo('Marking attendance', { sessionId, status, discordUserId, notes });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.post<SessionAttendee>(`/sessions/${sessionId}/attendance`, {
        status,
        notes
      });
    } catch (error) {
      logError('Failed to mark attendance', error as Error, { sessionId, status, discordUserId, notes });
      throw error;
    }
  }
  
  // Start a session (change status to active)
  public async startSession(sessionId: string, discordUserId: string): Promise<ApiResponse<Session>> {
    try {
      logInfo('Starting session', { sessionId, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.patch<Session>(`/sessions/${sessionId}/start`, {});
    } catch (error) {
      logError('Failed to start session', error as Error, { sessionId, discordUserId });
      throw error;
    }
  }
  
  // End a session (change status to completed)
  public async endSession(
    sessionId: string, 
    discordUserId: string, 
    notes?: string
  ): Promise<ApiResponse<Session>> {
    try {
      logInfo('Ending session', { sessionId, discordUserId, notes });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.patch<Session>(`/sessions/${sessionId}/end`, {
        notes
      });
    } catch (error) {
      logError('Failed to end session', error as Error, { sessionId, discordUserId, notes });
      throw error;
    }
  }
  
  // Get sessions for a specific campaign
  public async getCampaignSessions(campaignId: string): Promise<ApiResponse<Session[]>> {
    try {
      logInfo('Fetching campaign sessions', { campaignId });
      return await this.getSessions({ campaignId });
    } catch (error) {
      logError('Failed to fetch campaign sessions', error as Error, { campaignId });
      throw error;
    }
  }
  
  // Get upcoming sessions
  public async getUpcomingSessions(limit: number = 10): Promise<ApiResponse<Session[]>> {
    try {
      logInfo('Fetching upcoming sessions', { limit });
      
      const scheduledAfter = new Date().toISOString();
      
      return await this.getSessions({
        scheduledAfter,
        status: 'scheduled',
        limit
      });
    } catch (error) {
      logError('Failed to fetch upcoming sessions', error as Error, { limit });
      throw error;
    }
  }
  
  // Get active sessions
  public async getActiveSessions(): Promise<ApiResponse<Session[]>> {
    try {
      logInfo('Fetching active sessions');
      return await this.getSessions({ status: 'active' });
    } catch (error) {
      logError('Failed to fetch active sessions', error as Error);
      throw error;
    }
  }
  
  // Get user's sessions
  public async getUserSessions(discordUserId: string): Promise<ApiResponse<Session[]>> {
    try {
      logInfo('Fetching user sessions', { discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.get<Session[]>('/sessions/my');
    } catch (error) {
      logError('Failed to fetch user sessions', error as Error, { discordUserId });
      throw error;
    }
  }
  
  // Update session with Discord channel info
  public async updateSessionDiscordInfo(
    sessionId: string,
    discordChannelId: string,
    discordUserId: string
  ): Promise<ApiResponse<Session>> {
    try {
      logInfo('Updating session Discord info', { sessionId, discordChannelId, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.patch<Session>(`/sessions/${sessionId}`, {
        discordChannelId
      });
    } catch (error) {
      logError('Failed to update session Discord info', error as Error, { 
        sessionId, 
        discordChannelId, 
        discordUserId 
      });
      throw error;
    }
  }
  
  // Link recording to session
  public async linkRecording(
    sessionId: string,
    recordingId: string,
    discordUserId: string
  ): Promise<ApiResponse<Session>> {
    try {
      logInfo('Linking recording to session', { sessionId, recordingId, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.patch<Session>(`/sessions/${sessionId}`, {
        recordingId
      });
    } catch (error) {
      logError('Failed to link recording to session', error as Error, {
        sessionId,
        recordingId,
        discordUserId
      });
      throw error;
    }
  }
  
  // Link transcription to session
  public async linkTranscription(
    sessionId: string,
    transcriptionId: string,
    discordUserId: string
  ): Promise<ApiResponse<Session>> {
    try {
      logInfo('Linking transcription to session', { sessionId, transcriptionId, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.patch<Session>(`/sessions/${sessionId}`, {
        transcriptionId
      });
    } catch (error) {
      logError('Failed to link transcription to session', error as Error, {
        sessionId,
        transcriptionId,
        discordUserId
      });
      throw error;
    }
  }
}

export const sessionService = new SessionService();