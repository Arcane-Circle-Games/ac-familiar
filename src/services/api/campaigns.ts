import { apiClient } from './client';
import { 
  Campaign, 
  CampaignMember, 
  CreateCampaignRequest, 
  UpdateCampaignRequest,
  JoinCampaignRequest,
  CampaignQueryParams,
  ApiResponse,
  GameSystem
} from '../../types/api';
import { logInfo, logError } from '../../utils/logger';

export class CampaignService {
  
  // Get all campaigns with optional filtering
  public async getCampaigns(params?: CampaignQueryParams): Promise<ApiResponse<Campaign[]>> {
    try {
      logInfo('Fetching campaigns', { params });
      return await apiClient.get<Campaign[]>('/campaigns', params);
    } catch (error) {
      logError('Failed to fetch campaigns', error as Error, { params });
      throw error;
    }
  }
  
  // Get a specific campaign by ID
  public async getCampaign(campaignId: string): Promise<ApiResponse<Campaign>> {
    try {
      logInfo('Fetching campaign', { campaignId });
      return await apiClient.get<Campaign>(`/campaigns/${campaignId}`);
    } catch (error) {
      logError('Failed to fetch campaign', error as Error, { campaignId });
      throw error;
    }
  }
  
  // Create a new campaign
  public async createCampaign(data: CreateCampaignRequest, discordUserId: string): Promise<ApiResponse<Campaign>> {
    try {
      logInfo('Creating campaign', { data, discordUserId });
      
      // Ensure the user is authenticated first
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.post<Campaign>('/campaigns', data);
    } catch (error) {
      logError('Failed to create campaign', error as Error, { data, discordUserId });
      throw error;
    }
  }
  
  // Update an existing campaign
  public async updateCampaign(
    campaignId: string, 
    data: UpdateCampaignRequest, 
    discordUserId: string
  ): Promise<ApiResponse<Campaign>> {
    try {
      logInfo('Updating campaign', { campaignId, data, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.put<Campaign>(`/campaigns/${campaignId}`, data);
    } catch (error) {
      logError('Failed to update campaign', error as Error, { campaignId, data, discordUserId });
      throw error;
    }
  }
  
  // Delete a campaign
  public async deleteCampaign(campaignId: string, discordUserId: string): Promise<ApiResponse<void>> {
    try {
      logInfo('Deleting campaign', { campaignId, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.delete<void>(`/campaigns/${campaignId}`);
    } catch (error) {
      logError('Failed to delete campaign', error as Error, { campaignId, discordUserId });
      throw error;
    }
  }
  
  // Get campaign members
  public async getCampaignMembers(campaignId: string): Promise<ApiResponse<CampaignMember[]>> {
    try {
      logInfo('Fetching campaign members', { campaignId });
      return await apiClient.get<CampaignMember[]>(`/campaigns/${campaignId}/members`);
    } catch (error) {
      logError('Failed to fetch campaign members', error as Error, { campaignId });
      throw error;
    }
  }
  
  // Join a campaign
  public async joinCampaign(data: JoinCampaignRequest, discordUserId: string): Promise<ApiResponse<CampaignMember>> {
    try {
      logInfo('Joining campaign', { data, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.post<CampaignMember>(`/campaigns/${data.campaignId}/join`, {
        role: data.role || 'player',
        characterName: data.characterName,
        characterDescription: data.characterDescription
      });
    } catch (error) {
      logError('Failed to join campaign', error as Error, { data, discordUserId });
      throw error;
    }
  }
  
  // Leave a campaign
  public async leaveCampaign(campaignId: string, discordUserId: string): Promise<ApiResponse<void>> {
    try {
      logInfo('Leaving campaign', { campaignId, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.delete<void>(`/campaigns/${campaignId}/leave`);
    } catch (error) {
      logError('Failed to leave campaign', error as Error, { campaignId, discordUserId });
      throw error;
    }
  }
  
  // Update campaign member
  public async updateCampaignMember(
    campaignId: string,
    memberId: string,
    data: Partial<Pick<CampaignMember, 'role' | 'characterName' | 'characterDescription'>>,
    discordUserId: string
  ): Promise<ApiResponse<CampaignMember>> {
    try {
      logInfo('Updating campaign member', { campaignId, memberId, data, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.patch<CampaignMember>(`/campaigns/${campaignId}/members/${memberId}`, data);
    } catch (error) {
      logError('Failed to update campaign member', error as Error, { campaignId, memberId, data, discordUserId });
      throw error;
    }
  }
  
  // Remove campaign member (GM only)
  public async removeCampaignMember(
    campaignId: string,
    memberId: string,
    discordUserId: string
  ): Promise<ApiResponse<void>> {
    try {
      logInfo('Removing campaign member', { campaignId, memberId, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.delete<void>(`/campaigns/${campaignId}/members/${memberId}`);
    } catch (error) {
      logError('Failed to remove campaign member', error as Error, { campaignId, memberId, discordUserId });
      throw error;
    }
  }
  
  // Get campaigns where user is a member
  public async getUserCampaigns(discordUserId: string): Promise<ApiResponse<Campaign[]>> {
    try {
      logInfo('Fetching user campaigns', { discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      return await apiClient.get<Campaign[]>('/campaigns/my');
    } catch (error) {
      logError('Failed to fetch user campaigns', error as Error, { discordUserId });
      throw error;
    }
  }
  
  // Get campaigns by Discord Guild ID
  public async getCampaignsByGuild(guildId: string): Promise<ApiResponse<Campaign[]>> {
    try {
      logInfo('Fetching campaigns by guild', { guildId });
      
      return await apiClient.get<Campaign[]>('/campaigns', { 
        discordGuildId: guildId 
      });
    } catch (error) {
      logError('Failed to fetch campaigns by guild', error as Error, { guildId });
      throw error;
    }
  }
  
  // Get available game systems
  public async getGameSystems(): Promise<ApiResponse<GameSystem[]>> {
    try {
      logInfo('Fetching game systems');
      return await apiClient.get<GameSystem[]>('/game-systems');
    } catch (error) {
      logError('Failed to fetch game systems', error as Error);
      throw error;
    }
  }
}

export const campaignService = new CampaignService();