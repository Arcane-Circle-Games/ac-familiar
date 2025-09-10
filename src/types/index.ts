export * from './api';
export * from './discord';

export interface Config {
  DISCORD_TOKEN: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_GUILD_ID?: string;
  ARCANE_CIRCLE_API_URL: string;
  ARCANE_CIRCLE_API_KEY?: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  NODE_ENV: 'development' | 'production' | 'test';
  LOG_LEVEL: 'error' | 'warn' | 'info' | 'debug';
  OPENAI_API_KEY?: string;
  RECORDING_MAX_DURATION_MINUTES: number;
  RECORDING_AUDIO_QUALITY: 'low' | 'medium' | 'high';
  RECORDING_AUTO_TRANSCRIBE: boolean;
  SESSION_TIMEOUT_MINUTES: number;
  MAX_CONCURRENT_RECORDINGS: number;
  QUEUE_REDIS_HOST: string;
  QUEUE_REDIS_PORT: number;
  QUEUE_REDIS_PASSWORD?: string;
  WEBHOOK_URL?: string;
  WEBHOOK_SECRET?: string;
}

export interface DatabaseRecord {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

export interface JobData {
  id: string;
  type: string;
  payload: Record<string, any>;
  retryCount?: number;
  maxRetries?: number;
  priority?: number;
  delay?: number;
}

export interface QueueJob extends JobData {
  progress?: number;
  processedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  error?: string;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LogContext {
  userId?: string;
  guildId?: string;
  channelId?: string;
  commandName?: string;
  sessionId?: string;
  campaignId?: string;
  [key: string]: any;
}