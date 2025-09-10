# API Configuration Guide
## Multi-Environment Setup for Arcane Circle Bot

## Environment Configuration

### Development (.env.development)
```bash
# API Configuration
PLATFORM_API_URL=http://localhost:3000/api
PLATFORM_WEB_URL=http://localhost:3000

# Discord Configuration
DISCORD_TOKEN=your_dev_bot_token
DISCORD_CLIENT_ID=your_dev_client_id
DISCORD_GUILD_ID=your_test_server_id

# Database (local)
DATABASE_URL=postgresql://postgres:password@localhost:5432/arcane_discord_dev
```

### Staging (.env.staging)
```bash
# API Configuration - Your current testing environment
PLATFORM_API_URL=https://arcane-circle-git-testing-arcane-circle.vercel.app/api
PLATFORM_WEB_URL=https://arcane-circle-git-testing-arcane-circle.vercel.app

# Discord Configuration
DISCORD_TOKEN=your_staging_bot_token
DISCORD_CLIENT_ID=your_staging_client_id
DISCORD_GUILD_ID=your_staging_server_id

# Database (staging)
DATABASE_URL=postgresql://user:pass@staging-db.example.com:5432/arcane_discord_staging
```

### Production (.env.production)
```bash
# API Configuration - Your production domain
PLATFORM_API_URL=https://arcanecircle.games/api
PLATFORM_WEB_URL=https://arcanecircle.games

# Discord Configuration
DISCORD_TOKEN=your_production_bot_token
DISCORD_CLIENT_ID=your_production_client_id
# No GUILD_ID for production - use global commands

# Database (production)
DATABASE_URL=postgresql://user:pass@prod-db.example.com:5432/arcane_discord_prod
```

---

## Enhanced API Client Implementation

### `src/services/api/ArcaneCircleAPI.ts` (Updated)
```typescript
import axios, { AxiosInstance, AxiosError } from 'axios';
import { Logger } from '../../utils/logger';

interface APIConfig {
  baseURL: string;
  webURL: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export class ArcaneCircleAPI {
  private client: AxiosInstance;
  private logger = new Logger('ArcaneCircleAPI');
  private config: APIConfig;
  private userTokens: Map<string, string> = new Map();

  constructor() {
    // Load configuration from environment
    this.config = {
      baseURL: process.env.PLATFORM_API_URL || 'https://arcanecircle.games/api',
      webURL: process.env.PLATFORM_WEB_URL || 'https://arcanecircle.games',
      timeout: parseInt(process.env.API_TIMEOUT || '10000'),
      retryAttempts: parseInt(process.env.API_RETRY_ATTEMPTS || '3'),
      retryDelay: parseInt(process.env.API_RETRY_DELAY || '1000'),
    };

    this.logger.info(`Initializing API client`, {
      baseURL: this.config.baseURL,
      webURL: this.config.webURL,
      environment: process.env.NODE_ENV,
    });

    this.client = axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'X-Client': 'discord-bot',
        'X-Client-Version': process.env.npm_package_version || '1.0.0',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor for auth and logging
    this.client.interceptors.request.use(
      (config) => {
        // Add auth token if available
        const token = this.getCurrentUserToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }

        // Log request in development
        if (process.env.NODE_ENV === 'development') {
          this.logger.debug(`API Request: ${config.method?.toUpperCase()} ${config.url}`, {
            params: config.params,
            data: config.data,
          });
        }

        return config;
      },
      (error) => {
        this.logger.error('Request interceptor error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling and retries
    this.client.interceptors.response.use(
      (response) => {
        // Log response in development
        if (process.env.NODE_ENV === 'development') {
          this.logger.debug(`API Response: ${response.status} ${response.config.url}`);
        }
        return response;
      },
      async (error: AxiosError) => {
        const originalRequest = error.config as any;

        // Log error details
        this.logger.error(`API Error: ${error.message}`, {
          url: originalRequest?.url,
          method: originalRequest?.method,
          status: error.response?.status,
          data: error.response?.data,
        });

        // Handle specific error cases
        if (error.response?.status === 401) {
          // Token expired or invalid
          this.logger.warn('Authentication failed, user needs to re-link account');
          throw new Error('Authentication failed. Please re-link your account using /link');
        }

        if (error.response?.status === 429) {
          // Rate limited
          const retryAfter = error.response.headers['retry-after'];
          this.logger.warn(`Rate limited. Retry after ${retryAfter} seconds`);
          throw new Error(`Rate limited. Please try again in ${retryAfter} seconds`);
        }

        // Retry logic for network errors
        if (!error.response && originalRequest._retry < this.config.retryAttempts!) {
          originalRequest._retry = (originalRequest._retry || 0) + 1;
          
          this.logger.info(`Retrying request (attempt ${originalRequest._retry}/${this.config.retryAttempts})`);
          
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay!));
          
          return this.client(originalRequest);
        }

        throw error;
      }
    );
  }

  /**
   * Get web URL for platform links
   */
  getWebURL(path: string = ''): string {
    return `${this.config.webURL}${path}`;
  }

  /**
   * Health check for API connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return false;
    }
  }

  /**
   * Test API connection and authentication
   */
  async testConnection(discordId?: string): Promise<{
    connected: boolean;
    authenticated: boolean;
    message: string;
  }> {
    try {
      // Test basic connection
      const healthOk = await this.healthCheck();
      
      if (!healthOk) {
        return {
          connected: false,
          authenticated: false,
          message: 'Cannot connect to Arcane Circle API',
        };
      }

      // Test authentication if Discord ID provided
      if (discordId) {
        try {
          await this.withUser(discordId, async () => {
            await this.getUserByDiscordId(discordId);
          });
          
          return {
            connected: true,
            authenticated: true,
            message: 'Connected and authenticated successfully',
          };
        } catch (authError) {
          return {
            connected: true,
            authenticated: false,
            message: 'Connected but not authenticated. Use /link to authenticate',
          };
        }
      }

      return {
        connected: true,
        authenticated: false,
        message: 'Connected to Arcane Circle API',
      };
    } catch (error) {
      return {
        connected: false,
        authenticated: false,
        message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // ... rest of the API methods remain the same ...
}

// Singleton instance
export const arcaneAPI = new ArcaneCircleAPI();
```

---

## Configuration Utility Update

### `src/utils/config.ts` (Enhanced)
```typescript
import { z } from 'zod';
import { Logger } from './logger';

const logger = new Logger('Config');

// Define environment schema
const envSchema = z.object({
  // Discord
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(), // Optional, only for dev
  
  // Database
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  
  // Platform API
  PLATFORM_API_URL: z.string().url(),
  PLATFORM_WEB_URL: z.string().url(),
  
  // API Configuration
  API_TIMEOUT: z.string().regex(/^\d+$/).default('10000'),
  API_RETRY_ATTEMPTS: z.string().regex(/^\d+$/).default('3'),
  API_RETRY_DELAY: z.string().regex(/^\d+$/).default('1000'),
  
  // Transcription
  TRANSCRIPTION_PROVIDER: z.enum(['whisper', 'deepgram']).default('whisper'),
  OPENAI_API_KEY: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
  
  // Storage
  STORAGE_TYPE: z.enum(['local', 's3']).default('local'),
  STORAGE_PATH: z.string().default('./recordings'),
  
  // Application
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.string().regex(/^\d+$/).default('3001'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

type EnvConfig = z.infer<typeof envSchema>;

class ConfigManager {
  private config: EnvConfig | null = null;

  load(): EnvConfig {
    if (this.config) return this.config;

    // Load environment-specific .env file
    const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
    
    logger.info(`Loading configuration from ${envFile}`);

    const result = envSchema.safeParse(process.env);
    
    if (!result.success) {
      logger.error('❌ Invalid environment variables:');
      console.error(result.error.format());
      
      // In development, provide helpful error messages
      if (process.env.NODE_ENV === 'development') {
        console.log('\n📝 Required environment variables:');
        console.log('DISCORD_TOKEN - Bot token from Discord Developer Portal');
        console.log('DISCORD_CLIENT_ID - Application ID from Discord');
        console.log('DATABASE_URL - PostgreSQL connection string');
        console.log('PLATFORM_API_URL - Arcane Circle API endpoint');
        console.log('PLATFORM_WEB_URL - Arcane Circle web URL');
        console.log('\nCreate a .env file with these values');
      }
      
      process.exit(1);
    }

    this.config = result.data;
    
    // Log configuration (hiding sensitive data)
    logger.info('Configuration loaded:', {
      environment: this.config.NODE_ENV,
      apiUrl: this.config.PLATFORM_API_URL,
      webUrl: this.config.PLATFORM_WEB_URL,
      storageType: this.config.STORAGE_TYPE,
      transcriptionProvider: this.config.TRANSCRIPTION_PROVIDER,
    });

    return this.config;
  }

  get(): EnvConfig {
    if (!this.config) {
      return this.load();
    }
    return this.config;
  }

  // Helper methods for common config needs
  isDevelopment(): boolean {
    return this.get().NODE_ENV === 'development';
  }

  isProduction(): boolean {
    return this.get().NODE_ENV === 'production';
  }

  isStaging(): boolean {
    return this.get().NODE_ENV === 'staging';
  }

  getAPIBaseURL(): string {
    return this.get().PLATFORM_API_URL;
  }

  getWebBaseURL(): string {
    return this.get().PLATFORM_WEB_URL;
  }
}

export const configManager = new ConfigManager();
export const config = configManager.get();

// Export convenience functions
export const isDevelopment = () => configManager.isDevelopment();
export const isProduction = () => configManager.isProduction();
export const isStaging = () => configManager.isStaging();
```

---

## Testing Different Environments

### `src/commands/api-test.ts` (Debug Command)
```typescript
import { SlashCommandBuilder, CommandInteraction, EmbedBuilder } from 'discord.js';
import { arcaneAPI } from '../services/api/ArcaneCircleAPI';
import { config } from '../utils/config';

export default {
  data: new SlashCommandBuilder()
    .setName('api-test')
    .setDescription('Test API connection (Admin only)'),

  async execute(interaction: CommandInteraction) {
    // Admin only command
    if (!interaction.memberPermissions?.has('Administrator')) {
      return interaction.reply({
        content: '❌ This command requires administrator permissions',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    // Test connection
    const result = await arcaneAPI.testConnection(interaction.user.id);

    const embed = new EmbedBuilder()
      .setTitle('🔌 API Connection Test')
      .setColor(result.connected ? 0x00ff00 : 0xff0000)
      .addFields(
        { name: 'Environment', value: config.NODE_ENV, inline: true },
        { name: 'API URL', value: config.PLATFORM_API_URL, inline: false },
        { name: 'Web URL', value: config.PLATFORM_WEB_URL, inline: false },
        { name: 'Connected', value: result.connected ? '✅' : '❌', inline: true },
        { name: 'Authenticated', value: result.authenticated ? '✅' : '❌', inline: true },
        { name: 'Message', value: result.message, inline: false }
      );

    await interaction.editReply({ embeds: [embed] });
  },
};
```

---

## Environment Management Script

### `scripts/env-setup.js`
```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

const environments = {
  development: {
    PLATFORM_API_URL: 'http://localhost:3000/api',
    PLATFORM_WEB_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://postgres:password@localhost:5432/arcane_discord_dev',
  },
  staging: {
    PLATFORM_API_URL: 'https://arcane-circle-git-testing-arcane-circle.vercel.app/api',
    PLATFORM_WEB_URL: 'https://arcane-circle-git-testing-arcane-circle.vercel.app',
    DATABASE_URL: 'postgresql://user:pass@staging-db:5432/arcane_discord_staging',
  },
  production: {
    PLATFORM_API_URL: 'https://arcanecircle.games/api',
    PLATFORM_WEB_URL: 'https://arcanecircle.games',
    DATABASE_URL: 'postgresql://user:pass@prod-db:5432/arcane_discord_prod',
  },
};

async function setup() {
  console.log('🚀 Arcane Circle Discord Bot - Environment Setup\n');

  const env = await question('Which environment? (development/staging/production): ');
  
  if (!environments[env]) {
    console.log('❌ Invalid environment');
    process.exit(1);
  }

  const discordToken = await question('Discord Bot Token: ');
  const discordClientId = await question('Discord Client ID: ');
  
  let envContent = `# Arcane Circle Discord Bot - ${env.toUpperCase()} Environment\n\n`;
  envContent += `NODE_ENV=${env}\n\n`;
  envContent += `# Discord Configuration\n`;
  envContent += `DISCORD_TOKEN=${discordToken}\n`;
  envContent += `DISCORD_CLIENT_ID=${discordClientId}\n`;
  
  if (env === 'development') {
    const guildId = await question('Discord Guild ID (for testing): ');
    envContent += `DISCORD_GUILD_ID=${guildId}\n`;
  }
  
  envContent += `\n# Platform API\n`;
  envContent += `PLATFORM_API_URL=${environments[env].PLATFORM_API_URL}\n`;
  envContent += `PLATFORM_WEB_URL=${environments[env].PLATFORM_WEB_URL}\n`;
  
  envContent += `\n# Database\n`;
  envContent += `DATABASE_URL=${environments[env].DATABASE_URL}\n`;
  envContent += `REDIS_URL=redis://localhost:6379\n`;
  
  envContent += `\n# Transcription\n`;
  envContent += `TRANSCRIPTION_PROVIDER=whisper\n`;
  
  const openaiKey = await question('OpenAI API Key (optional, press enter to skip): ');
  if (openaiKey) {
    envContent += `OPENAI_API_KEY=${openaiKey}\n`;
  }
  
  envContent += `\n# Storage\n`;
  envContent += `STORAGE_TYPE=local\n`;
  envContent += `STORAGE_PATH=./recordings\n`;
  
  envContent += `\n# Application\n`;
  envContent += `PORT=3001\n`;
  envContent += `LOG_LEVEL=info\n`;

  const filename = `.env.${env}`;
  fs.writeFileSync(filename, envContent);
  
  console.log(`\n✅ Created ${filename}`);
  console.log(`\nTo use this configuration, run:`);
  console.log(`  NODE_ENV=${env} npm run dev`);
  
  rl.close();
}

setup().catch(console.error);
```

---

## Package.json Scripts Update

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "dev:staging": "NODE_ENV=staging tsx watch src/index.ts",
    "dev:production": "NODE_ENV=production tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "start:staging": "NODE_ENV=staging node dist/index.js",
    "start:production": "NODE_ENV=production node dist/index.js",
    "setup:env": "node scripts/env-setup.js",
    "test:api": "tsx scripts/test-api-connection.ts"
  }
}
```

---

## Usage Examples

### Development
```bash
# Setup development environment
npm run setup:env
# Choose: development
# Enter your dev bot credentials

# Run in development
npm run dev
```

### Staging (Your Vercel URL)
```bash
# Setup staging environment
npm run setup:env
# Choose: staging
# API URL will be: https://arcane-circle-git-testing-arcane-circle.vercel.app/api

# Run in staging
npm run dev:staging
```

### Production
```bash
# Setup production environment
npm run setup:env
# Choose: production
# API URL will be: https://arcanecircle.games/api

# Run in production
NODE_ENV=production npm start
```

---

## Docker Support for Multiple Environments

### `docker-compose.yml`
```yaml
version: '3.8'

services:
  bot-dev:
    build: .
    env_file: .env.development
    volumes:
      - ./src:/app/src
      - ./recordings:/app/recordings
    depends_on:
      - postgres
      - redis
    profiles: ["development"]

  bot-staging:
    build: .
    env_file: .env.staging
    volumes:
      - ./recordings:/app/recordings
    depends_on:
      - redis
    profiles: ["staging"]

  bot-production:
    build: .
    env_file: .env.production
    volumes:
      - ./recordings:/app/recordings
    depends_on:
      - redis
    profiles: ["production"]
    restart: always

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: arcane_discord_dev
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    profiles: ["development"]

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    profiles: ["development", "staging", "production"]

volumes:
  postgres_data:
```

### Run with Docker
```bash
# Development
docker-compose --profile development up

# Staging
docker-compose --profile staging up

# Production
docker-compose --profile production up
```