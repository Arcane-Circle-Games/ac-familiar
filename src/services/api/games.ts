import { apiClient } from './client';
import { logInfo, logError } from '../../utils/logger';

export interface GameCreateData {
  title: string;
  description: string;
  shortDescription: string;
  gameType: string;
  systemId: string;
  maxPlayers: number;
  pricePerSession: number;
  timezone: string;
  contentWarnings?: string[];
  gmId: string;
}

export interface Game {
  id: string;
  title: string;
  description: string;
  shortDescription: string;
  gameType: string;
  system: any; // Can be string or object with name/shortName
  gm: any; // Can be string or object with displayName
  maxPlayers: number;
  currentPlayers?: number;
  pricePerSession: number;
  currency?: string;
  status: string;
  gmId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  gameId: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export class GameService {
  
  // Create a new game
  public async createGame(data: GameCreateData, discordUserId: string): Promise<Game> {
    try {
      logInfo('Creating game', { data, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      const response = await apiClient.post<Game>('/games', data);
      return response.data!;
    } catch (error) {
      logError('Failed to create game', error as Error, { data, discordUserId });
      throw error;
    }
  }
  
  // Get a specific game by ID
  public async getGame(gameId: string): Promise<Game> {
    try {
      logInfo('Fetching game', { gameId });
      const response = await apiClient.get<Game>(`/games/${gameId}`);
      return response.data!;
    } catch (error) {
      logError('Failed to fetch game', error as Error, { gameId });
      throw error;
    }
  }
  
  // Update an existing game
  public async updateGame(
    gameId: string, 
    updates: Partial<GameCreateData>, 
    discordUserId: string
  ): Promise<Game> {
    try {
      logInfo('Updating game', { gameId, updates, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      const response = await apiClient.put<Game>(`/games/${gameId}`, updates);
      return response.data!;
    } catch (error) {
      logError('Failed to update game', error as Error, { gameId, updates, discordUserId });
      throw error;
    }
  }
  
  // Delete a game
  public async deleteGame(gameId: string, discordUserId: string): Promise<void> {
    try {
      logInfo('Deleting game', { gameId, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      await apiClient.delete<void>(`/games/${gameId}`);
    } catch (error) {
      logError('Failed to delete game', error as Error, { gameId, discordUserId });
      throw error;
    }
  }
  
  // List games with optional filters
  public async listGames(filters?: {
    status?: string;
    gameType?: string;
    system?: string;
    gmId?: string;
    page?: number;
    limit?: number;
  }) {
    try {
      logInfo('Fetching games list', { filters });
      const response = await apiClient.get<{ data: Game[]; pagination: any }>('/games', filters);
      return response.data!.data;
    } catch (error) {
      logError('Failed to fetch games list', error as Error, { filters });
      throw error;
    }
  }
  
  // Update game status (publish/unpublish)
  public async updateGameStatus(
    gameId: string, 
    status: 'PUBLISHED' | 'DRAFT', 
    discordUserId: string
  ): Promise<Game> {
    try {
      logInfo('Updating game status', { gameId, status, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      const response = await apiClient.put<Game>(`/games/${gameId}/status`, { status });
      return response.data!;
    } catch (error) {
      logError('Failed to update game status', error as Error, { gameId, status, discordUserId });
      throw error;
    }
  }
  
  // Search games
  public async searchGames(query: string, filters?: any) {
    try {
      logInfo('Searching games', { query, filters });
      const response = await apiClient.get<{ data: Game[]; pagination: any }>('/games/search', {
        q: query,
        ...filters
      });
      return response.data!.data;
    } catch (error) {
      logError('Failed to search games', error as Error, { query, filters });
      throw error;
    }
  }
  
  // Create a session for a game
  public async createSession(
    gameId: string,
    data: {
      scheduledStart: string;
      scheduledEnd: string;
      description?: string;
    },
    discordUserId: string
  ): Promise<Session> {
    try {
      logInfo('Creating session for game', { gameId, data, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      const response = await apiClient.post<Session>(`/games/${gameId}/sessions`, data);
      return response.data!;
    } catch (error) {
      logError('Failed to create session', error as Error, { gameId, data, discordUserId });
      throw error;
    }
  }
  
  // Get session by ID
  public async getSession(sessionId: string): Promise<Session> {
    try {
      logInfo('Fetching session', { sessionId });
      const response = await apiClient.get<Session>(`/sessions/${sessionId}`);
      return response.data!;
    } catch (error) {
      logError('Failed to fetch session', error as Error, { sessionId });
      throw error;
    }
  }
  
  // Update session
  public async updateSession(
    sessionId: string,
    updates: Partial<{
      scheduledStart: string;
      scheduledEnd: string;
      description: string;
      status: Session['status'];
    }>,
    discordUserId: string
  ): Promise<Session> {
    try {
      logInfo('Updating session', { sessionId, updates, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      const response = await apiClient.put<Session>(`/sessions/${sessionId}`, updates);
      return response.data!;
    } catch (error) {
      logError('Failed to update session', error as Error, { sessionId, updates, discordUserId });
      throw error;
    }
  }
  
  // Mark attendance for a session
  public async markAttendance(
    sessionId: string, 
    attendees: string[], 
    discordUserId: string
  ): Promise<void> {
    try {
      logInfo('Marking attendance', { sessionId, attendees, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      await apiClient.post(`/sessions/${sessionId}/attendance`, {
        attendees
      });
    } catch (error) {
      logError('Failed to mark attendance', error as Error, { sessionId, attendees, discordUserId });
      throw error;
    }
  }
}

export const gameService = new GameService();