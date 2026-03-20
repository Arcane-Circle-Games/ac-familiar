import { apiClient } from './client';
import { Character, VTTData } from '../../types/character';
import { logInfo, logError, logDebug } from '../../utils/logger';

interface CharacterCacheEntry {
  characterId: string;
  expiry: number;
}

interface VTTCacheEntry {
  character: Character;
  data: VTTData;
  expiry: number;
}

export class CharacterService {
  // Layer 1: Character resolution cache (discordUserId:gameId → characterId)
  private characterResolutionCache = new Map<string, CharacterCacheEntry>();

  // Layer 2: VTT data cache (characterId → VTT data)
  private vttCache = new Map<string, VTTCacheEntry>();

  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * List characters for a game
   */
  public async listByGame(gameId: string, discordUserId: string): Promise<Character[]> {
    try {
      logInfo('Fetching characters by game', { gameId, discordUserId });

      const params: Record<string, string> = { gameId };
      if (discordUserId) {
        params['discordUserId'] = discordUserId;
      }

      const response = await apiClient.get<Character[]>('/characters', params);
      return response.data || [];
    } catch (error) {
      logError('Failed to fetch characters by game', error as Error, { gameId, discordUserId });
      return [];
    }
  }

  /**
   * Get a single character
   */
  public async getCharacter(id: string, discordUserId: string): Promise<Character | null> {
    try {
      logInfo('Fetching character', { characterId: id, discordUserId });

      const params: Record<string, string> = {};
      if (discordUserId) {
        params['discordUserId'] = discordUserId;
      }

      const response = await apiClient.get<Character>(`/characters/${id}`, params);
      return response.data || null;
    } catch (error) {
      logError('Failed to fetch character', error as Error, { characterId: id, discordUserId });
      return null;
    }
  }

  /**
   * Get VTT data for a character
   */
  public async getVTTData(id: string, discordUserId: string): Promise<VTTData | null> {
    try {
      logInfo('Fetching character VTT data', { characterId: id, discordUserId });

      const params: Record<string, string> = {};
      if (discordUserId) {
        params['discordUserId'] = discordUserId;
      }

      const response = await apiClient.get<VTTData>(`/characters/${id}/vtt-data`, params);
      return response.data || null;
    } catch (error) {
      logError('Failed to fetch character VTT data', error as Error, { characterId: id, discordUserId });
      return null;
    }
  }

  /**
   * Combined resolution: gameId + discordUserId → character + VTT data
   * Uses two-layer cache to avoid repeated API calls
   */
  public async getVTTDataForUser(
    gameId: string,
    discordUserId: string
  ): Promise<{ character: Character; vttData: VTTData } | null> {
    const now = Date.now();

    // Layer 1: Resolve character (cached)
    const charCacheKey = `${discordUserId}:${gameId}`;
    const cached = this.characterResolutionCache.get(charCacheKey);
    let characterId = cached?.characterId;

    if (!characterId || !cached || now >= cached.expiry) {
      // Cache miss or expired - fetch from API
      const chars = await this.listByGame(gameId, discordUserId);

      // Filter to APPROVED characters belonging to this user
      // (API returns characters filtered by discordUserId already)
      const approved = chars.filter(c => c.status === 'APPROVED');

      if (approved.length === 0) {
        logDebug('No approved characters found for user in game', { gameId, discordUserId });
        return null;
      }

      // Use first approved character
      characterId = approved[0]!.id;

      // Cache the resolution
      this.characterResolutionCache.set(charCacheKey, {
        characterId,
        expiry: now + this.CACHE_TTL
      });

      logDebug('Character resolved and cached', { gameId, discordUserId, characterId });
    } else {
      logDebug('Character resolved from cache', { gameId, discordUserId, characterId });
    }

    // Layer 2: Get VTT data (cached)
    const vttCached = this.vttCache.get(characterId);
    if (vttCached && vttCached.expiry > now) {
      logDebug('VTT data retrieved from cache', { characterId });
      return { character: vttCached.character, vttData: vttCached.data };
    }

    // VTT cache miss - fetch both character and VTT data
    const [character, vttData] = await Promise.all([
      this.getCharacter(characterId, discordUserId),
      this.getVTTData(characterId, discordUserId)
    ]);

    if (!character || !vttData) {
      logError('Failed to fetch character or VTT data', new Error('Character or VTT data is null'), {
        characterId,
        hasCharacter: !!character,
        hasVTTData: !!vttData
      });
      return null;
    }

    // Cache the VTT data
    this.vttCache.set(characterId, {
      character,
      data: vttData,
      expiry: now + this.CACHE_TTL
    });

    logDebug('VTT data fetched and cached', { characterId });

    return { character, vttData };
  }

  /**
   * Clear all caches (useful for testing or manual reset)
   */
  public clearCache(): void {
    const charCacheSize = this.characterResolutionCache.size;
    const vttCacheSize = this.vttCache.size;

    this.characterResolutionCache.clear();
    this.vttCache.clear();

    logDebug('All character caches cleared', { charCacheSize, vttCacheSize });
  }

  /**
   * Periodic cache cleanup
   */
  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      let charCleared = 0;
      let vttCleared = 0;

      // Clean character resolution cache
      this.characterResolutionCache.forEach((entry, key) => {
        if (now >= entry.expiry) {
          this.characterResolutionCache.delete(key);
          charCleared++;
        }
      });

      // Clean VTT cache
      this.vttCache.forEach((entry, key) => {
        if (now >= entry.expiry) {
          this.vttCache.delete(key);
          vttCleared++;
        }
      });

      if (charCleared > 0 || vttCleared > 0) {
        logDebug('Character cache cleanup', {
          charCleared,
          vttCleared,
          charCacheSize: this.characterResolutionCache.size,
          vttCacheSize: this.vttCache.size
        });
      }
    }, 2 * 60 * 1000); // Clean every 2 minutes
  }

  constructor() {
    this.startCacheCleanup();
  }
}

export const characterService = new CharacterService();
