import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { config } from '../../utils/config';
import { logAPICall, logError, logDebug } from '../../utils/logger';
import { ApiResponse, ApiError } from '../../types/api';

interface CacheEntry {
  data: any;
  expiry: number;
}

interface NegativeCacheEntry {
  error: string;
  expiry: number;
}

interface RequestMetadata {
  startTime: number;
}

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    metadata?: RequestMetadata;
  }
}

export class ArcaneCircleAPIClient {
  private client: AxiosInstance;
  private baseURL: string;
  private apiKey?: string;
  private authToken?: string;

  // User cache for authentication
  private userCache = new Map<string, CacheEntry>();
  private negativeCache = new Map<string, NegativeCacheEntry>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly NEGATIVE_CACHE_TTL = 30 * 1000; // 30 seconds
  
  constructor() {
    this.baseURL = config.PLATFORM_API_URL;
    // No API key needed based on documentation
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Arcane-Circle-Discord-Bot/1.0.0'
      }
    });
    
    this.setupInterceptors();
    this.startCacheCleanup();
  }
  
  private setupInterceptors() {
    // Request interceptor
    this.client.interceptors.request.use(
      (requestConfig) => {
        const startTime = Date.now();
        requestConfig.metadata = { startTime };

        // Add bot authentication header (preferred for bot-to-API communication)
        if (config.BOT_API_KEY) {
          requestConfig.headers.Authorization = `Bearer ${config.BOT_API_KEY}`;
        }
        // Fallback to token-based auth if set
        else if (this.authToken) {
          requestConfig.headers.Authorization = `Bearer ${this.authToken}`;
        } else if (this.apiKey) {
          requestConfig.headers['X-API-Key'] = this.apiKey;
        }

        // Add Vercel bypass token as header if available (for production Vercel deployments)
        if (config.VERCEL_BYPASS_TOKEN) {
          requestConfig.headers['x-vercel-protection-bypass'] = config.VERCEL_BYPASS_TOKEN;
        }
        
        logDebug(`API Request: ${requestConfig.method?.toUpperCase()} ${requestConfig.url}`, {
          fullUrl: `${requestConfig.baseURL}${requestConfig.url}${requestConfig.params ? '?' + new URLSearchParams(requestConfig.params).toString() : ''}`,
          headers: this.sanitizeHeaders(requestConfig.headers),
          params: requestConfig.params,
          dataSize: requestConfig.data ? JSON.stringify(requestConfig.data).length : 0
        });
        
        return requestConfig;
      },
      (error) => {
        logError('API Request Error', error);
        return Promise.reject(error);
      }
    );
    
    // Response interceptor
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        const duration = response.config.metadata?.startTime
          ? Date.now() - response.config.metadata.startTime
          : undefined;
        
        logAPICall(
          response.config.method?.toUpperCase() || 'GET',
          response.config.url || '',
          response.status,
          duration
        );
        
        return response;
      },
      (error) => {
        const duration = error.config?.metadata?.startTime ? 
          Date.now() - error.config.metadata.startTime : undefined;
        
        if (error.response) {
          logAPICall(
            error.config?.method?.toUpperCase() || 'GET',
            error.config?.url || '',
            error.response.status,
            duration
          );
          
          logError('API Response Error', new Error(error.message), {
            status: error.response.status,
            statusText: error.response.statusText,
            responseBody: error.response.data,
            dataSize: error.response.data ? JSON.stringify(error.response.data).length : 0,
            url: error.config?.url,
            method: error.config?.method
          });
        } else if (error.request) {
          logError('API Network Error', new Error('No response received'), {
            url: error.config?.url,
            method: error.config?.method,
            timeout: error.code === 'ECONNABORTED'
          });
        } else {
          logError('API Setup Error', error);
        }
        
        return Promise.reject(this.createApiError(error));
      }
    );
  }
  
  private sanitizeHeaders(headers: any): Record<string, string> {
    const sanitized = { ...headers };
    
    // Remove sensitive headers from logs
    const sensitiveKeys = ['authorization', 'x-api-key', 'cookie'];
    sensitiveKeys.forEach(key => {
      if (sanitized[key]) {
        sanitized[key] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }
  
  private createApiError(axiosError: any): ApiError {
    if (axiosError.response) {
      return {
        message: axiosError.response.data?.message || axiosError.response.statusText || 'API Error',
        code: axiosError.response.data?.code,
        statusCode: axiosError.response.status,
        details: axiosError.response.data
      };
    } else if (axiosError.request) {
      return {
        message: 'Network Error: Unable to reach Arcane Circle API',
        code: 'NETWORK_ERROR',
        statusCode: 0
      };
    } else {
      return {
        message: axiosError.message || 'Unknown API Error',
        code: 'UNKNOWN_ERROR',
        statusCode: 0
      };
    }
  }
  
  // Authentication methods
  public setAuthToken(token: string): void {
    this.authToken = token;
    logDebug('Auth token set for API client');
  }
  
  public clearAuthToken(): void {
    delete this.authToken;
    logDebug('Auth token cleared from API client');
  }
  
  public async authenticateWithDiscord(discordId: string): Promise<ApiResponse> {
    const now = Date.now();

    // Check negative cache first (failed lookups)
    const negativeCached = this.negativeCache.get(discordId);
    if (negativeCached && now < negativeCached.expiry) {
      logDebug('User authentication failed (cached)', { discordId });
      throw new Error(negativeCached.error);
    }

    // Check positive cache
    const cached = this.userCache.get(discordId);
    if (cached && now < cached.expiry) {
      logDebug('User authenticated via cache', { discordId });
      return {
        success: true,
        data: cached.data
      };
    }

    try {
      // Cache miss - make API call
      logDebug('Cache miss - fetching user from API', { discordId });
      const response = await this.client.get(`/users/discord/${discordId}`);

      if (response.data && response.data.found && response.data.user && response.data.user.id) {
        // Cache successful result
        this.userCache.set(discordId, {
          data: response.data.user,
          expiry: now + this.CACHE_TTL
        });

        // Remove from negative cache if it exists
        this.negativeCache.delete(discordId);

        logDebug('User authenticated via Discord ID lookup (cached)', { discordId });
        return {
          success: true,
          data: response.data.user
        };
      }

      // Cache negative result
      const errorMsg = 'User not found or not linked';
      this.negativeCache.set(discordId, {
        error: errorMsg,
        expiry: now + this.NEGATIVE_CACHE_TTL
      });

      return {
        success: false,
        error: errorMsg
      };
    } catch (error) {
      const apiError = this.createApiError(error);
      let errorMsg: string;

      // Handle common authentication errors
      if (apiError.statusCode === 404) {
        errorMsg = 'Discord account not linked to Arcane Circle. Use /link to link your account.';
      } else if (apiError.statusCode === 401) {
        errorMsg = 'Authentication failed. Please try linking your account again with /link.';
      } else if (apiError.statusCode === 0) {
        errorMsg = 'Cannot connect to Arcane Circle API. Please try again later.';
      } else {
        errorMsg = apiError.message;
      }

      // Cache the error for a short time to avoid hammering the API
      this.negativeCache.set(discordId, {
        error: errorMsg,
        expiry: now + this.NEGATIVE_CACHE_TTL
      });

      throw new Error(errorMsg);
    }
  }
  
  // Generic HTTP methods
  public async get<T = any>(
    endpoint: string, 
    params?: Record<string, any>, 
    options?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.get(endpoint, {
        params,
        ...options
      });
      return response.data;
    } catch (error) {
      throw this.createApiError(error);
    }
  }
  
  public async post<T = any>(
    endpoint: string, 
    data?: any, 
    options?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.post(endpoint, data, options);
      return response.data;
    } catch (error) {
      throw this.createApiError(error);
    }
  }
  
  public async put<T = any>(
    endpoint: string, 
    data?: any, 
    options?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.put(endpoint, data, options);
      return response.data;
    } catch (error) {
      throw this.createApiError(error);
    }
  }
  
  public async patch<T = any>(
    endpoint: string, 
    data?: any, 
    options?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.patch(endpoint, data, options);
      return response.data;
    } catch (error) {
      throw this.createApiError(error);
    }
  }
  
  public async delete<T = any>(
    endpoint: string, 
    options?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.delete(endpoint, options);
      return response.data;
    } catch (error) {
      throw this.createApiError(error);
    }
  }
  
  // Health check
  public async healthCheck(): Promise<boolean> {
    try {
      const response = await this.get('/health');
      return response.success;
    } catch (error) {
      logError('API health check failed', error as Error);
      return false;
    }
  }
  
  // Get API info
  public async getApiInfo(): Promise<ApiResponse> {
    return this.get('/');
  }

  // Cache management methods
  private startCacheCleanup(): void {
    // Clean up expired entries every 2 minutes
    setInterval(() => {
      this.cleanupExpiredCache();
    }, 2 * 60 * 1000);
  }

  private cleanupExpiredCache(): void {
    const now = Date.now();
    let userCacheCleared = 0;
    let negativeCacheCleared = 0;

    // Clean user cache
    this.userCache.forEach((entry, discordId) => {
      if (now >= entry.expiry) {
        this.userCache.delete(discordId);
        userCacheCleared++;
      }
    });

    // Clean negative cache
    this.negativeCache.forEach((entry, discordId) => {
      if (now >= entry.expiry) {
        this.negativeCache.delete(discordId);
        negativeCacheCleared++;
      }
    });

    if (userCacheCleared > 0 || negativeCacheCleared > 0) {
      logDebug('Cache cleanup completed', {
        userCacheCleared,
        negativeCacheCleared,
        userCacheSize: this.userCache.size,
        negativeCacheSize: this.negativeCache.size
      });
    }
  }

  // Clear all cached data (useful for testing or manual cache reset)
  public clearCache(): void {
    const userCacheSize = this.userCache.size;
    const negativeCacheSize = this.negativeCache.size;

    this.userCache.clear();
    this.negativeCache.clear();

    logDebug('All caches cleared', { userCacheSize, negativeCacheSize });
  }
}

// Singleton instance
export const apiClient = new ArcaneCircleAPIClient();