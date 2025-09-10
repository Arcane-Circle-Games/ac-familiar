import { ApiError } from '../types/api';
import { logWarning, logError, logDebug } from './logger';

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
  retryCondition?: (error: ApiError) => boolean;
  onRetry?: (error: ApiError, attempt: number) => void;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffFactor: 2,
  retryCondition: (error: ApiError) => {
    // Retry on network errors and 5xx server errors
    return error.statusCode === 0 || (error.statusCode >= 500 && error.statusCode < 600);
  }
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: ApiError;
  
  for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
    try {
      const result = await operation();
      
      if (attempt > 1) {
        logDebug(`Operation succeeded on attempt ${attempt}`);
      }
      
      return result;
      
    } catch (error) {
      lastError = error as ApiError;
      
      if (attempt === config.maxRetries + 1) {
        logError(`Operation failed after ${config.maxRetries} retries`, lastError as Error);
        break;
      }
      
      if (!config.retryCondition!(lastError)) {
        logDebug('Error not retryable, failing immediately', { error: lastError });
        break;
      }
      
      const delay = Math.min(
        config.baseDelay * Math.pow(config.backoffFactor, attempt - 1),
        config.maxDelay
      );
      
      logWarning(`Operation failed on attempt ${attempt}, retrying in ${delay}ms`, {
        error: lastError.message,
        statusCode: lastError.statusCode,
        attempt,
        totalRetries: config.maxRetries
      });
      
      if (config.onRetry) {
        config.onRetry(lastError, attempt);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

export class RetryableApiClient {
  private defaultRetryOptions: Partial<RetryOptions>;
  
  constructor(defaultOptions: Partial<RetryOptions> = {}) {
    this.defaultRetryOptions = defaultOptions;
  }
  
  public async execute<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {}
  ): Promise<T> {
    const mergedOptions = { ...this.defaultRetryOptions, ...options };
    return withRetry(operation, mergedOptions);
  }
  
  public async executeWithCustomRetry<T>(
    operation: () => Promise<T>,
    retryCondition: (error: ApiError) => boolean,
    maxRetries: number = 3
  ): Promise<T> {
    return withRetry(operation, {
      ...this.defaultRetryOptions,
      maxRetries,
      retryCondition
    });
  }
}

// Circuit breaker pattern for API calls
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private threshold: number = 5,
    private timeout: number = 60000, // 1 minute
    private resetTimeout: number = 30000 // 30 seconds
  ) {}
  
  public async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'half-open';
        logDebug('Circuit breaker moving from open to half-open');
      } else {
        throw new Error('Circuit breaker is open - too many recent failures');
      }
    }
    
    try {
      const result = await operation();
      
      if (this.state === 'half-open') {
        this.reset();
        logDebug('Circuit breaker reset to closed state');
      }
      
      return result;
      
    } catch (error) {
      this.recordFailure();
      
      if (this.failures >= this.threshold) {
        this.state = 'open';
        this.lastFailureTime = Date.now();
        logWarning(`Circuit breaker opened after ${this.failures} failures`);
      }
      
      throw error;
    }
  }
  
  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
  }
  
  private reset(): void {
    this.failures = 0;
    this.state = 'closed';
    this.lastFailureTime = 0;
  }
  
  public getState(): string {
    return this.state;
  }
  
  public getFailures(): number {
    return this.failures;
  }
}

// Rate limiter for API calls
export class RateLimiter {
  private requests: number[] = [];
  
  constructor(
    private maxRequests: number,
    private windowMs: number
  ) {}
  
  public async waitForSlot(): Promise<void> {
    const now = Date.now();
    
    // Remove old requests outside the window
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (now - oldestRequest);
      
      logDebug(`Rate limit reached, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      return this.waitForSlot(); // Recursive call to check again
    }
    
    this.requests.push(now);
  }
  
  public getRemainingRequests(): number {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    return Math.max(0, this.maxRequests - this.requests.length);
  }
}

// Combined resilient API client
export class ResilientApiClient extends RetryableApiClient {
  private circuitBreaker: CircuitBreaker;
  private rateLimiter?: RateLimiter;
  
  constructor(
    retryOptions: Partial<RetryOptions> = {},
    circuitBreakerOptions: {
      threshold?: number;
      timeout?: number;
      resetTimeout?: number;
    } = {},
    rateLimitOptions?: {
      maxRequests: number;
      windowMs: number;
    }
  ) {
    super(retryOptions);
    
    this.circuitBreaker = new CircuitBreaker(
      circuitBreakerOptions.threshold,
      circuitBreakerOptions.timeout,
      circuitBreakerOptions.resetTimeout
    );
    
    if (rateLimitOptions) {
      this.rateLimiter = new RateLimiter(
        rateLimitOptions.maxRequests,
        rateLimitOptions.windowMs
      );
    }
  }
  
  public async execute<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {}
  ): Promise<T> {
    // Wait for rate limit slot if configured
    if (this.rateLimiter) {
      await this.rateLimiter.waitForSlot();
    }
    
    // Execute with circuit breaker and retry logic
    return this.circuitBreaker.execute(async () => {
      return super.execute(operation, options);
    });
  }
  
  public getCircuitBreakerState(): string {
    return this.circuitBreaker.getState();
  }
  
  public getRemainingRequests(): number {
    return this.rateLimiter?.getRemainingRequests() || Infinity;
  }
}

// Global resilient client instance
export const resilientApiClient = new ResilientApiClient(
  {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2
  },
  {
    threshold: 5,
    timeout: 60000,
    resetTimeout: 30000
  },
  {
    maxRequests: 100,
    windowMs: 60000 // 100 requests per minute
  }
);