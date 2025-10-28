export { ArcaneCircleAPIClient, apiClient } from './client';
export { GameService, gameService } from './games';
export { UserService, userService } from './users';
export { SystemService, systemService } from './systems';
export { BookingService, bookingService } from './bookings';
export { GMService, gmService } from './gms';
export { RecordingService, recordingService } from './recordings';
export { WikiService, wikiService } from './wiki';
export { SessionService, sessionService } from './sessions';

import { apiClient } from './client';
import { gameService } from './games';
import { userService } from './users';
import { systemService } from './systems';
import { bookingService } from './bookings';
import { gmService } from './gms';
import { recordingService } from './recordings';
import { wikiService } from './wiki';
import { sessionService } from './sessions';
import { logInfo, logError } from '../../utils/logger';
import { config } from '../../utils/config';

export class ArcaneCircleAPI {
  public games = gameService;
  public users = userService;
  public systems = systemService;
  public bookings = bookingService;
  public gms = gmService;
  public recordings = recordingService;
  public wiki = wikiService;
  public sessions = sessionService;

  constructor() {
    this.games = gameService;
    this.users = userService;
    this.systems = systemService;
    this.bookings = bookingService;
    this.gms = gmService;
    this.recordings = recordingService;
    this.wiki = wikiService;
    this.sessions = sessionService;
  }
  
  // Get web URL for creating links to the platform
  public getWebURL(path: string = ''): string {
    return `${config.PLATFORM_WEB_URL}${path}`;
  }
  
  // Health check for the entire API
  public async healthCheck(): Promise<boolean> {
    try {
      logInfo('Performing API health check');
      return await apiClient.healthCheck();
    } catch (error) {
      logError('API health check failed', error as Error);
      return false;
    }
  }
  
  // Get API information
  public async getApiInfo() {
    try {
      logInfo('Fetching API information');
      return await apiClient.getApiInfo();
    } catch (error) {
      logError('Failed to fetch API information', error as Error);
      throw error;
    }
  }
  
  // Set authentication token for all services
  public setAuthToken(token: string): void {
    apiClient.setAuthToken(token);
    logInfo('Authentication token set for Arcane Circle API');
  }
  
  // Clear authentication token
  public clearAuthToken(): void {
    apiClient.clearAuthToken();
    logInfo('Authentication token cleared from Arcane Circle API');
  }
  
  // Authenticate with Discord ID
  public async authenticateWithDiscord(discordId: string) {
    try {
      logInfo('Authenticating with Discord ID', { discordId });
      return await apiClient.authenticateWithDiscord(discordId);
    } catch (error) {
      logError('Failed to authenticate with Discord ID', error as Error, { discordId });
      throw error;
    }
  }

  // Convenience method: Get user by Discord ID (wraps userService method)
  public async getUserByDiscordId(discordId: string) {
    return await this.users.getUserByDiscordId(discordId);
  }
}

// Singleton instance
export const arcaneAPI = new ArcaneCircleAPI();