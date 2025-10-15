import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  // Discord Configuration
  DISCORD_TOKEN: z.string().min(1, 'Discord token is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'Discord client ID is required'),
  DISCORD_GUILD_ID: z.string().optional(),

  // Environment Configuration (needs to be early for conditional defaults)
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Platform API Configuration
  PLATFORM_API_URL: z.string().url('Invalid Platform API URL').optional(),
  PLATFORM_WEB_URL: z.string().url('Invalid Platform Web URL').optional(),
  VERCEL_BYPASS_TOKEN: z.string().optional(),
  BOT_API_KEY: z.string().min(1, 'Bot API key is required'),
  
  // Database Configuration
  DATABASE_URL: z.string().url('Invalid database URL').optional(),
  
  // Redis Configuration
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Logging Configuration
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  
  // OpenAI Configuration
  OPENAI_API_KEY: z.string().optional(),

  // Transcription Configuration
  TRANSCRIPTION_ENGINE: z.enum(['openai', 'local', 'deepgram']).default('openai'),
  WHISPER_MODEL_SIZE: z.enum(['tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en', 'medium', 'medium.en', 'large-v1', 'large-v2', 'large-v3', 'large-v3-turbo']).default('base'),
  WHISPER_MODELS_PATH: z.string().default('./models'),
  WHISPER_USE_GPU: z.coerce.boolean().default(true),
  WHISPER_LIB_VARIANT: z.enum(['default', 'vulkan', 'cuda']).default('default'),

  // Recording Configuration
  RECORDING_MAX_DURATION_MINUTES: z.coerce.number().min(1).max(300).default(120),
  RECORDING_AUDIO_QUALITY: z.enum(['low', 'medium', 'high']).default('high'),
  RECORDING_AUTO_TRANSCRIBE: z.coerce.boolean().default(true),
  RECORDING_AUTO_UPLOAD: z.coerce.boolean().default(false),
  RECORDING_KEEP_LOCAL_AFTER_UPLOAD: z.coerce.boolean().default(false),

  // Segment-Based Recording Configuration
  RECORDING_SILENCE_THRESHOLD: z.coerce.number().min(500).max(10000).default(2000), // ms
  RECORDING_MIN_SEGMENT_DURATION: z.coerce.number().min(100).max(5000).default(500), // ms
  RECORDING_SEGMENT_PARALLEL_LIMIT: z.coerce.number().min(1).max(20).default(5),
  
  // Session Management
  SESSION_TIMEOUT_MINUTES: z.coerce.number().min(5).max(120).default(30),
  MAX_CONCURRENT_RECORDINGS: z.coerce.number().min(1).max(20).default(5),
  
  // Queue Configuration
  QUEUE_REDIS_HOST: z.string().default('localhost'),
  QUEUE_REDIS_PORT: z.coerce.number().default(6379),
  QUEUE_REDIS_PASSWORD: z.string().optional(),
  
  // Webhook Configuration (Phase 2C)
  WEBHOOK_URL: z.string().url().optional().or(z.literal('')),
  WEBHOOK_SECRET: z.string().optional().or(z.literal('')),
  WEBHOOK_LISTENER_PORT: z.coerce.number().min(1).max(65535).default(3001),
  WEBHOOK_LISTENER_ENABLED: z.coerce.boolean().default(false)
});

const parseConfig = () => {
  try {
    const parsed = configSchema.parse(process.env);

    // Apply environment-specific defaults
    const isDev = parsed.NODE_ENV === 'development';

    return {
      ...parsed,
      PLATFORM_API_URL: parsed.PLATFORM_API_URL || (isDev ? 'http://localhost:3000/api' : 'https://arcanecircle.games/api'),
      PLATFORM_WEB_URL: parsed.PLATFORM_WEB_URL || (isDev ? 'http://localhost:3000' : 'https://arcanecircle.games')
    };
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