import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  // Discord Configuration
  DISCORD_TOKEN: z.string().min(1, 'Discord token is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'Discord client ID is required'),
  DISCORD_GUILD_ID: z.string().optional(),
  
  // Platform API Configuration
  PLATFORM_API_URL: z.string().url('Invalid Platform API URL').default('https://arcanecircle.games/api'),
  PLATFORM_WEB_URL: z.string().url('Invalid Platform Web URL').default('https://arcanecircle.games'),
  VERCEL_BYPASS_TOKEN: z.string().optional(),
  
  // Database Configuration
  DATABASE_URL: z.string().url('Invalid database URL'),
  
  // Redis Configuration
  REDIS_URL: z.string().default('redis://localhost:6379'),
  
  // Environment Configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  
  // OpenAI Configuration
  OPENAI_API_KEY: z.string().optional(),
  
  // Recording Configuration
  RECORDING_MAX_DURATION_MINUTES: z.coerce.number().min(1).max(300).default(120),
  RECORDING_AUDIO_QUALITY: z.enum(['low', 'medium', 'high']).default('high'),
  RECORDING_AUTO_TRANSCRIBE: z.coerce.boolean().default(true),
  
  // Session Management
  SESSION_TIMEOUT_MINUTES: z.coerce.number().min(5).max(120).default(30),
  MAX_CONCURRENT_RECORDINGS: z.coerce.number().min(1).max(20).default(5),
  
  // Queue Configuration
  QUEUE_REDIS_HOST: z.string().default('localhost'),
  QUEUE_REDIS_PORT: z.coerce.number().default(6379),
  QUEUE_REDIS_PASSWORD: z.string().optional(),
  
  // Webhook Configuration
  WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().optional()
});

const parseConfig = () => {
  try {
    return configSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Invalid configuration:');
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
};

export const config = parseConfig();

export const isDevelopment = config.NODE_ENV === 'development';
export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';

export const validateConfig = () => {
  const requiredForProduction = [
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID',
    'DATABASE_URL',
    'ARCANE_CIRCLE_API_URL'
  ];
  
  if (isProduction) {
    const missing = requiredForProduction.filter(key => !config[key as keyof typeof config]);
    
    if (missing.length > 0) {
      console.error('❌ Missing required production configuration:');
      missing.forEach(key => console.error(`  - ${key}`));
      process.exit(1);
    }
  }
  
  console.log('✅ Configuration validated successfully');
  console.log(`📍 Environment: ${config.NODE_ENV}`);
  console.log(`🔗 API URL: ${config.PLATFORM_API_URL}`);
  console.log(`🌐 Web URL: ${config.PLATFORM_WEB_URL}`);
  console.log(`📝 Log Level: ${config.LOG_LEVEL}`);
};

export type Config = typeof config;