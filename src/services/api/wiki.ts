import { apiClient } from './client';
import {
  Wiki,
  WikiPage,
  WikiSettings,
  WikiAttachment,
  CreateWikiRequest,
  CreateWikiPageRequest,
  UpdateWikiPageRequest,
  UpdateWikiSettingsRequest,
  WikiResponse,
  WikiPageResponse,
  ApiResponse,
  WikiPageType
} from '../../types/api';
import { logInfo, logError } from '../../utils/logger';

export class WikiService {
  /**
   * Get wiki by game ID
   */
  public async getWikiByGameId(gameId: string, discordUserId?: string): Promise<Wiki | null> {
    try {
      logInfo('Fetching wiki by game ID', { gameId, discordUserId });

      // Include discordUserId in query params for bot authentication
      const params: Record<string, string> = { gameId };
      if (discordUserId) {
        params['discordUserId'] = discordUserId;
      }

      const response = await apiClient.get<any>('/wiki', params);

      // Debug logging to see what API returns
      logInfo('Wiki API response', {
        fullResponse: JSON.stringify(response, null, 2),
        hasData: !!response.data,
        hasWiki: !!response.wiki,
        hasDataWiki: !!response.data?.wiki
      });

      // API returns { wiki: {...} } directly, not wrapped in { data: { wiki: {...} } }
      if (response.wiki) {
        return response.wiki;
      }

      // Fallback to nested structure in case API changes
      return response.data?.wiki || null;
    } catch (error) {
      logError('Failed to fetch wiki by game ID', error as Error, { gameId, discordUserId });
      return null;
    }
  }

  /**
   * Get wiki by wiki ID
   */
  public async getWiki(wikiId: string): Promise<WikiResponse | null> {
    try {
      logInfo('Fetching wiki', { wikiId });
      const response = await apiClient.get<WikiResponse>(`/wiki/${wikiId}`);
      return response.data || null;
    } catch (error) {
      logError('Failed to fetch wiki', error as Error, { wikiId });
      return null;
    }
  }

  /**
   * Create wiki for a game
   */
  public async createWiki(
    data: CreateWikiRequest,
    discordUserId: string
  ): Promise<ApiResponse<Wiki>> {
    try {
      logInfo('Creating wiki', { data, discordUserId });

      // Verify user exists and is linked (caches the result)
      await apiClient.authenticateWithDiscord(discordUserId);

      // Include discordUserId in payload for bot authentication
      const payload = {
        ...data,
        discordUserId
      };

      return await apiClient.post<Wiki>('/wiki', payload);
    } catch (error) {
      logError('Failed to create wiki', error as Error, { data, discordUserId });
      throw error;
    }
  }

  /**
   * Update wiki
   */
  public async updateWiki(
    wikiId: string,
    updates: Partial<CreateWikiRequest>,
    discordUserId: string
  ): Promise<ApiResponse<Wiki>> {
    try {
      logInfo('Updating wiki', { wikiId, updates, discordUserId });

      await apiClient.authenticateWithDiscord(discordUserId);

      const payload = {
        ...updates,
        discordUserId
      };

      return await apiClient.put<Wiki>(`/wiki/${wikiId}`, payload);
    } catch (error) {
      logError('Failed to update wiki', error as Error, { wikiId, updates, discordUserId });
      throw error;
    }
  }

  /**
   * Delete wiki
   */
  public async deleteWiki(wikiId: string, discordUserId: string): Promise<ApiResponse<void>> {
    try {
      logInfo('Deleting wiki', { wikiId, discordUserId });

      await apiClient.authenticateWithDiscord(discordUserId);

      return await apiClient.delete<void>(`/wiki/${wikiId}`);
    } catch (error) {
      logError('Failed to delete wiki', error as Error, { wikiId, discordUserId });
      throw error;
    }
  }

  /**
   * Get wiki settings
   */
  public async getWikiSettings(wikiId: string): Promise<WikiSettings | null> {
    try {
      logInfo('Fetching wiki settings', { wikiId });
      const response = await apiClient.get<WikiSettings>(`/wiki/${wikiId}/settings`);
      return response.data || null;
    } catch (error) {
      logError('Failed to fetch wiki settings', error as Error, { wikiId });
      return null;
    }
  }

  /**
   * Update wiki settings
   */
  public async updateWikiSettings(
    wikiId: string,
    settings: UpdateWikiSettingsRequest,
    discordUserId: string
  ): Promise<ApiResponse<WikiSettings>> {
    try {
      logInfo('Updating wiki settings', { wikiId, settings, discordUserId });

      await apiClient.authenticateWithDiscord(discordUserId);

      return await apiClient.put<WikiSettings>(`/wiki/${wikiId}/settings`, settings);
    } catch (error) {
      logError('Failed to update wiki settings', error as Error, { wikiId, settings, discordUserId });
      throw error;
    }
  }

  /**
   * List wiki pages
   */
  public async listPages(wikiId: string): Promise<WikiPage[]> {
    try {
      logInfo('Listing wiki pages', { wikiId });
      const response = await apiClient.get<WikiPage[]>(`/wiki/${wikiId}/pages`);
      return response.data || [];
    } catch (error) {
      logError('Failed to list wiki pages', error as Error, { wikiId });
      return [];
    }
  }

  /**
   * Get wiki page
   */
  public async getPage(wikiId: string, pageId: string): Promise<WikiPageResponse | null> {
    try {
      logInfo('Fetching wiki page', { wikiId, pageId });
      const response = await apiClient.get<WikiPageResponse>(`/wiki/${wikiId}/pages/${pageId}`);
      return response.data || null;
    } catch (error) {
      logError('Failed to fetch wiki page', error as Error, { wikiId, pageId });
      return null;
    }
  }

  /**
   * Create wiki page
   */
  public async createPage(
    wikiId: string,
    data: CreateWikiPageRequest,
    discordUserId: string
  ): Promise<ApiResponse<WikiPage>> {
    try {
      logInfo('Creating wiki page', { wikiId, data, discordUserId });

      await apiClient.authenticateWithDiscord(discordUserId);

      return await apiClient.post<WikiPage>(`/wiki/${wikiId}/pages`, data);
    } catch (error) {
      logError('Failed to create wiki page', error as Error, { wikiId, data, discordUserId });
      throw error;
    }
  }

  /**
   * Update wiki page
   */
  public async updatePage(
    wikiId: string,
    pageId: string,
    updates: UpdateWikiPageRequest,
    discordUserId: string
  ): Promise<ApiResponse<WikiPage>> {
    try {
      logInfo('Updating wiki page', { wikiId, pageId, updates, discordUserId });

      await apiClient.authenticateWithDiscord(discordUserId);

      return await apiClient.put<WikiPage>(`/wiki/${wikiId}/pages/${pageId}`, updates);
    } catch (error) {
      logError('Failed to update wiki page', error as Error, { wikiId, pageId, updates, discordUserId });
      throw error;
    }
  }

  /**
   * Delete wiki page
   */
  public async deletePage(
    wikiId: string,
    pageId: string,
    discordUserId: string
  ): Promise<ApiResponse<void>> {
    try {
      logInfo('Deleting wiki page', { wikiId, pageId, discordUserId });

      await apiClient.authenticateWithDiscord(discordUserId);

      return await apiClient.delete<void>(`/wiki/${wikiId}/pages/${pageId}`);
    } catch (error) {
      logError('Failed to delete wiki page', error as Error, { wikiId, pageId, discordUserId });
      throw error;
    }
  }

  /**
   * Get page template by type
   */
  public async getPageTemplate(pageType: WikiPageType): Promise<string | null> {
    try {
      logInfo('Fetching page template', { pageType });
      const response = await apiClient.get<{ template: string }>(`/wiki/templates/${pageType}`);
      return response.data?.template || null;
    } catch (error) {
      logError('Failed to fetch page template', error as Error, { pageType });
      return null;
    }
  }

  /**
   * List wiki attachments
   */
  public async listAttachments(wikiId: string): Promise<WikiAttachment[]> {
    try {
      logInfo('Listing wiki attachments', { wikiId });
      const response = await apiClient.get<WikiAttachment[]>(`/wiki/${wikiId}/attachments`);
      return response.data || [];
    } catch (error) {
      logError('Failed to list wiki attachments', error as Error, { wikiId });
      return [];
    }
  }

  /**
   * Upload wiki attachment
   */
  public async uploadAttachment(
    wikiId: string,
    file: Buffer,
    filename: string,
    discordUserId: string
  ): Promise<ApiResponse<WikiAttachment>> {
    try {
      logInfo('Uploading wiki attachment', { wikiId, filename, discordUserId });

      await apiClient.authenticateWithDiscord(discordUserId);

      const formData = new FormData();
      formData.append('file', new Blob([file]), filename);

      return await apiClient.post<WikiAttachment>(`/wiki/${wikiId}/attachments`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
    } catch (error) {
      logError('Failed to upload wiki attachment', error as Error, { wikiId, filename, discordUserId });
      throw error;
    }
  }

  /**
   * Delete wiki attachment
   */
  public async deleteAttachment(
    wikiId: string,
    attachmentId: string,
    discordUserId: string
  ): Promise<ApiResponse<void>> {
    try {
      logInfo('Deleting wiki attachment', { wikiId, attachmentId, discordUserId });

      await apiClient.authenticateWithDiscord(discordUserId);

      return await apiClient.delete<void>(`/wiki/${wikiId}/attachments/${attachmentId}`);
    } catch (error) {
      logError('Failed to delete wiki attachment', error as Error, { wikiId, attachmentId, discordUserId });
      throw error;
    }
  }

  /**
   * Post session summary to wiki
   * This is a specialized method for posting session summaries
   */
  public async postSessionTranscript(
    wikiId: string,
    sessionId: string,
    summary: string,
    discordUserId: string
  ): Promise<ApiResponse<WikiPage>> {
    try {
      logInfo('Posting session summary to wiki', {
        wikiId,
        sessionId,
        contentLength: summary.length,
        discordUserId
      });

      // Verify user exists and is linked (caches the result)
      await apiClient.authenticateWithDiscord(discordUserId);

      // Post to the session summary endpoint with bot authentication
      // API expects: { sessionId, summary, discordUserId }
      // Bot authentication is handled automatically via BOT_API_KEY header
      const payload = {
        sessionId,
        summary,
        discordUserId
      };

      return await apiClient.post<WikiPage>(`/wiki/${wikiId}/pages/session-summary`, payload);
    } catch (error) {
      logError('Failed to post session summary', error as Error, {
        wikiId,
        sessionId,
        discordUserId
      });
      throw error;
    }
  }
}

export const wikiService = new WikiService();
