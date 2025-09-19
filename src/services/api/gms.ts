import { apiClient } from './client';
import { logInfo, logError } from '../../utils/logger';

export interface GMProfile {
  id: string;
  displayName: string;
  bio?: string;
  experience: string;
  systems: string[];
  timezone: string;
  rating?: number;
}

export interface GMStats {
  totalGamesRun: number;
  activeCampaigns: number;
  totalPlayers: number;
  averageRating: number;
}

export interface GMEarnings {
  thisMonth: number;
  totalEarnings: number;
  pendingPayouts: number;
}

export class GMService {
  
  // Get GM profile
  public async getProfile(gmId: string): Promise<GMProfile> {
    try {
      logInfo('Fetching GM profile', { gmId });
      
      const response = await apiClient.get<GMProfile>(`/gms/${gmId}`);
      return response.data!;
    } catch (error) {
      logError('Failed to fetch GM profile', error as Error, { gmId });
      throw error;
    }
  }
  
  // Update GM profile
  public async updateProfile(gmId: string, updates: Partial<GMProfile>): Promise<GMProfile> {
    try {
      logInfo('Updating GM profile', { gmId, updates });
      
      const response = await apiClient.put<GMProfile>(`/gms/${gmId}`, updates);
      return response.data!;
    } catch (error) {
      logError('Failed to update GM profile', error as Error, { gmId, updates });
      throw error;
    }
  }
  
  // Get GM statistics
  public async getStats(gmId: string): Promise<GMStats> {
    try {
      logInfo('Fetching GM stats', { gmId });
      
      const response = await apiClient.get<GMStats>(`/gms/${gmId}/stats`);
      return response.data!;
    } catch (error) {
      logError('Failed to fetch GM stats', error as Error, { gmId });
      throw error;
    }
  }
  
  // Get GM earnings
  public async getEarnings(gmId: string): Promise<GMEarnings> {
    try {
      logInfo('Fetching GM earnings', { gmId });
      
      const response = await apiClient.get<GMEarnings>(`/gms/${gmId}/earnings`);
      return response.data!;
    } catch (error) {
      logError('Failed to fetch GM earnings', error as Error, { gmId });
      throw error;
    }
  }
}

export const gmService = new GMService();