import { apiClient } from './client';
import { logInfo, logError } from '../../utils/logger';

export interface User {
  id: string;
  email: string;
  username: string;
  discordId?: string;
  discordUsername?: string;
  profile?: {
    id: string;
    firstName: string;
    lastName: string;
    bio?: string;
    avatarUrl?: string;
  };
  gamesAsGM?: Game[];
}

export interface Game {
  id: string;
  title: string;
  status: string;
}

export class UserService {
  
  // Link Discord account to platform user
  public async linkDiscordAccount(
    discordId: string,
    discordUsername: string
  ) {
    try {
      logInfo('Linking Discord account', { discordId, discordUsername });
      
      const response = await apiClient.post('/users/link-discord', {
        discordId,
        discordUsername
      });
      
      return response.data;
    } catch (error) {
      logError('Failed to link Discord account', error as Error, { discordId, discordUsername });
      throw error;
    }
  }
  
  // Get user by Discord ID
  public async getUserByDiscordId(discordId: string): Promise<User> {
    try {
      logInfo('Fetching user by Discord ID', { discordId });
      
      const response = await apiClient.get<{found: boolean, user: User}>(`/users/discord/${discordId}`);

      if (response.data && response.data.found && response.data.user) {
        return response.data.user;
      }

      throw new Error('User not found or not linked');
    } catch (error) {
      logError('Failed to fetch user by Discord ID', error as Error, { discordId });
      throw error;
    }
  }
  
  // Get GM profile
  public async getGMProfile(gmId: string) {
    try {
      logInfo('Fetching GM profile', { gmId });
      
      const response = await apiClient.get(`/gms/${gmId}`);
      return response.data;
    } catch (error) {
      logError('Failed to fetch GM profile', error as Error, { gmId });
      throw error;
    }
  }
  
  // Update GM profile
  public async updateGMProfile(gmId: string, updates: any, discordUserId: string) {
    try {
      logInfo('Updating GM profile', { gmId, updates, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      const response = await apiClient.put(`/gms/${gmId}`, updates);
      return response.data;
    } catch (error) {
      logError('Failed to update GM profile', error as Error, { gmId, updates, discordUserId });
      throw error;
    }
  }
}

export const userService = new UserService();