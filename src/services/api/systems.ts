import { apiClient } from './client';
import { logInfo, logError } from '../../utils/logger';

export interface GameSystem {
  id: string;
  name: string;
  description?: string;
  publisher?: string;
  version?: string;
}

export class SystemService {
  
  // Get all available game systems
  public async getGameSystems(): Promise<GameSystem[]> {
    try {
      logInfo('Fetching game systems');
      const response = await apiClient.get<{ systems: GameSystem[] }>('/systems');
      return response.data!.systems;
    } catch (error) {
      logError('Failed to fetch game systems', error as Error);
      throw error;
    }
  }

  // Alias for getGameSystems
  public async listSystems(): Promise<GameSystem[]> {
    return this.getGameSystems();
  }
  
  // Get safety tools
  public async getSafetyTools(): Promise<string[]> {
    try {
      logInfo('Fetching safety tools');
      const response = await apiClient.get<{ tools: string[] }>('/safety-tools');
      return response.data!.tools;
    } catch (error) {
      logError('Failed to fetch safety tools', error as Error);
      throw error;
    }
  }
  
  // Get content warnings
  public async getContentWarnings(): Promise<string[]> {
    try {
      logInfo('Fetching content warnings');
      const response = await apiClient.get<{ warnings: string[] }>('/content-warnings');
      return response.data!.warnings;
    } catch (error) {
      logError('Failed to fetch content warnings', error as Error);
      throw error;
    }
  }
}

export const systemService = new SystemService();