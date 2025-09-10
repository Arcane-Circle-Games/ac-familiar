import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { config } from '../../utils/config';
import { logAPICall, logError, logDebug } from '../../utils/logger';
import { ApiResponse, ApiError } from '../../types/api';

export class ArcaneCircleAPIClient {
  private client: AxiosInstance;
  private baseURL: string;
  private apiKey?: string;
  private authToken?: string;
  
  constructor() {
    this.baseURL = config.PLATFORM_API_URL;
    this.apiKey = undefined; // No API key needed based on documentation
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Arcane-Circle-Discord-Bot/1.0.0'
      }
    });
    
    this.setupInterceptors();
  }
  
  private setupInterceptors() {
    // Request interceptor
    this.client.interceptors.request.use(
      (requestConfig) => {
        const startTime = Date.now();
        requestConfig.metadata = { startTime };
        
        // Add authentication headers
        if (this.authToken) {
          requestConfig.headers.Authorization = `Bearer ${this.authToken}`;
        } else if (this.apiKey) {
          requestConfig.headers['X-API-Key'] = this.apiKey;
        }
        
        // Add Vercel bypass token if available
        if (config.VERCEL_BYPASS_TOKEN) {
          requestConfig.params = requestConfig.params || {};
          requestConfig.params['x-vercel-protection-bypass'] = config.VERCEL_BYPASS_TOKEN;
        }
        
        logDebug(`API Request: ${requestConfig.method?.toUpperCase()} ${requestConfig.url}`, {
          fullUrl: `${requestConfig.baseURL}${requestConfig.url}${requestConfig.params ? '?' + new URLSearchParams(requestConfig.params).toString() : ''}`,
          headers: this.sanitizeHeaders(requestConfig.headers),
          params: requestConfig.params,
          data: requestConfig.data
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
        const duration = Date.now() - response.config.metadata?.startTime;
        
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
            data: error.response.data,
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
    this.authToken = undefined;
    logDebug('Auth token cleared from API client');
  }
  
  public async authenticateWithDiscord(discordId: string): Promise<ApiResponse> {
    try {
      // For now, we'll use the user lookup as authentication
      // This matches how the platform works - Discord ID lookup serves as auth
      const response = await this.client.get(`/users/discord/${discordId}`);
      
      if (response.data && response.data.id) {
        // User exists, consider them authenticated
        logDebug('User authenticated via Discord ID lookup', { discordId });
        return {
          success: true,
          data: response.data
        };
      }
      
      return {
        success: false,
        error: 'User not found or not linked'
      };
    } catch (error) {
      const apiError = this.createApiError(error);
      
      // Handle common authentication errors
      if (apiError.statusCode === 404) {
        throw new Error('Discord account not linked to Arcane Circle. Use /link to link your account.');
      } else if (apiError.statusCode === 401) {
        throw new Error('Authentication failed. Please try linking your account again with /link.');
      } else if (apiError.statusCode === 0) {
        throw new Error('Cannot connect to Arcane Circle API. Please try again later.');
      }
      
      throw apiError;
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
}

// Singleton instance
export const apiClient = new ArcaneCircleAPIClient();