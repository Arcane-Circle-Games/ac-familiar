# Discord Bot Startup Guide
## Step-by-Step Implementation Plan

## Phase 1: Repository Setup (Day 1)

### 1.1 Create Repository Structure
```bash
# Create new repository
mkdir arcane-circle-discord-bot
cd arcane-circle-discord-bot
git init

# Create initial structure
mkdir -p src/{bot,commands,services,utils,types,database}
mkdir -p src/services/{api,recording,transcription,queue}
mkdir -p src/handlers
mkdir -p prisma
mkdir -p scripts
mkdir -p tests

# Create essential files
touch .env.example
touch .gitignore
touch README.md
touch tsconfig.json
touch package.json
touch docker-compose.yml
```

### 1.2 Initialize package.json
```json
{
  "name": "arcane-circle-discord-bot",
  "version": "0.1.0",
  "description": "Discord bot for Arcane Circle TTRPG platform",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "setup": "npm install && npm run db:generate",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "test": "jest",
    "lint": "eslint src/**/*.ts"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

### 1.3 Install Core Dependencies
```bash
# Core Discord and Node packages
npm install discord.js @discordjs/voice @discordjs/opus @discordjs/builders
npm install dotenv express axios
npm install @prisma/client prisma
npm install winston uuid
npm install zod

# Audio processing
npm install prism-media fluent-ffmpeg ffmpeg-static

# Queue system
npm install bull ioredis

# Transcription
npm install openai @deepgram/sdk

# Dev dependencies
npm install -D typescript @types/node tsx
npm install -D @types/express @types/bull @types/uuid
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
npm install -D jest @types/jest ts-jest
```

### 1.4 Create Configuration Files

**.gitignore**
```
node_modules/
dist/
.env
.env.local
*.log
recordings/
.DS_Store
*.sqlite
*.sqlite-journal
.idea/
.vscode/
```

**tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "moduleResolution": "node"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**.env.example**
```bash
# Discord Configuration
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID= # Optional: for development

# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/arcane_discord

# Redis
REDIS_URL=redis://localhost:6379

# Platform API
PLATFORM_API_URL=http://localhost:3000/api
PLATFORM_URL=http://localhost:3000

# Transcription (choose one)
TRANSCRIPTION_PROVIDER=whisper
OPENAI_API_KEY=
# DEEPGRAM_API_KEY=

# Storage
STORAGE_TYPE=local
STORAGE_PATH=./recordings

# Application
NODE_ENV=development
PORT=3001
LOG_LEVEL=info
```

---

## Phase 2: Core Bot Implementation (Day 2)

### 2.1 Create Entry Point
**src/index.ts**
```typescript
import 'dotenv/config';
import { initializeBot } from './bot';
import { Logger } from './utils/logger';
import { validateEnvironment } from './utils/config';

const logger = new Logger('Main');

async function main() {
  try {
    // Validate environment variables
    validateEnvironment();
    
    logger.info('Starting Arcane Circle Discord Bot...');
    
    // Initialize bot
    const bot = await initializeBot();
    
    // Login to Discord
    await bot.login(process.env.DISCORD_TOKEN);
    
    logger.info('Bot is online!');
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Handle shutdown gracefully
process.on('SIGINT', () => {
  logger.info('Shutting down gracefully...');
  process.exit(0);
});

main();
```

### 2.2 Create Essential Utils
**src/utils/logger.ts**
```typescript
import winston from 'winston';

export class Logger {
  private logger: winston.Logger;

  constructor(context: string) {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
          return `${timestamp} [${level.toUpperCase()}] [${context}]: ${message} ${
            Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
          }`;
        })
      ),
      defaultMeta: { context },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        }),
      ],
    });
  }

  info(message: string, meta?: any) {
    this.logger.info(message, meta);
  }

  error(message: string, error?: any) {
    this.logger.error(message, { error });
  }

  warn(message: string, meta?: any) {
    this.logger.warn(message, meta);
  }

  debug(message: string, meta?: any) {
    this.logger.debug(message, meta);
  }
}
```

**src/utils/config.ts**
```typescript
import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  PLATFORM_API_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export function validateEnvironment() {
  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }
  
  return result.data;
}

export const config = validateEnvironment();
```

### 2.3 Implement Bot Client
Copy the bot client implementation from the main documentation.

### 2.4 Create First Command
**src/commands/ping.ts** (test command)
```typescript
import { SlashCommandBuilder, CommandInteraction } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Test if the bot is responsive'),
    
  async execute(interaction: CommandInteraction) {
    const latency = Date.now() - interaction.createdTimestamp;
    await interaction.reply(`🏓 Pong! Latency: ${latency}ms`);
  },
};
```

---

## Phase 3: Database Setup (Day 2-3)

### 3.1 Create Prisma Schema
**prisma/schema.prisma**
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Start with essential models
model User {
  id              String   @id @default(uuid())
  discordId       String   @unique
  discordUsername String
  platformUserId  String?  // Link to Arcane Circle platform
  apiToken        String?  // Encrypted API token
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model RecordingSession {
  id               String   @id @default(uuid())
  discordChannelId String
  discordGuildId   String
  gameId           String?
  status           String
  createdAt        DateTime @default(now())
  
  @@index([discordGuildId])
}
```

### 3.2 Run Database Migration
```bash
# Start PostgreSQL (via Docker)
docker-compose up -d postgres

# Generate Prisma client
npm run db:generate

# Create initial migration
npm run db:migrate
```

---

## Phase 4: Progressive Implementation (Days 3-7)

### Implementation Order

#### Stage 1: Basic Bot Functionality ✅
1. **ping command** - Test bot is working
2. **help command** - Show available commands
3. **link command** - Link Discord to platform account
4. Command registration system
5. Basic interaction handling

#### Stage 2: Recording System 🎙️
1. **record start/stop** - Basic voice recording
2. Audio file management
3. Storage service (local first)
4. Database tracking

#### Stage 3: Platform API Integration 🔌
1. ArcaneCircleAPI client
2. Authentication flow
3. User linking system
4. Error handling

#### Stage 4: Campaign Commands 🎮
1. **campaign create** - Basic creation
2. **campaign list** - View campaigns
3. **campaign view** - Detailed view
4. Modal and button handlers

#### Stage 5: Player Commands 🎲
1. **join browse** - Browse games
2. **join apply** - Application system
3. **join status** - Check applications

#### Stage 6: Transcription 📝
1. Integrate Whisper/Deepgram
2. Processing queue
3. **transcript view** command

#### Stage 7: Advanced Features 🚀
1. Wiki commands
2. Session management
3. GM tools
4. Webhook integration

---

## Phase 5: Testing Strategy

### 5.1 Create Test Discord Server
1. Create a dedicated Discord server for testing
2. Invite the bot with all necessary permissions
3. Create test voice channels

### 5.2 Test Checklist
```markdown
## Core Functionality
- [ ] Bot comes online
- [ ] Slash commands register
- [ ] Ping command responds

## Recording
- [ ] Can join voice channel
- [ ] Records audio
- [ ] Saves files correctly
- [ ] Stops recording cleanly

## Platform Integration
- [ ] Account linking works
- [ ] API authentication succeeds
- [ ] Commands check permissions

## Campaign Management
- [ ] Create campaign
- [ ] List campaigns
- [ ] Edit campaign
- [ ] Delete campaign

## Error Handling
- [ ] Handles API errors gracefully
- [ ] Handles Discord errors
- [ ] Provides user-friendly error messages
```

---

## Development Workflow for AI Agents

### Instructions for AI Agents

```markdown
# AI Agent Development Instructions

## Setup Phase
1. Create all files in Phase 1 exactly as specified
2. Run `npm install` to install dependencies
3. Verify package.json has all dependencies

## Implementation Phase
Follow this order strictly:

### Task 1: Core Bot Setup
- Implement src/index.ts
- Implement src/utils/logger.ts
- Implement src/utils/config.ts
- Implement src/bot/client.ts
- Implement src/bot/index.ts
- Test: Bot should come online

### Task 2: Command System
- Implement src/commands/index.ts (command loader)
- Implement src/commands/ping.ts
- Implement src/commands/help.ts
- Test: Commands should register and respond

### Task 3: Database
- Create complete prisma/schema.prisma
- Implement src/database/client.ts
- Test: Database connection works

### Task 4: API Client
- Implement src/services/api/ArcaneCircleAPI.ts
- Implement src/commands/link.ts
- Test: API connection works

### Task 5: Recording System
- Implement src/services/recording/RecordingManager.ts
- Implement src/commands/record.ts
- Test: Voice recording works

### Task 6: Campaign Commands
- Implement src/commands/campaign.ts
- Implement src/handlers/interactions.ts
- Test: Campaign CRUD operations work

### Task 7: Additional Commands
- Implement remaining commands
- Add error handling
- Add logging

## Testing Requirements
- Each component must be tested before moving to next
- Use the test checklist provided
- Handle errors gracefully
- Add logging for debugging
```

---

## Quick Start Script

Create **scripts/quick-start.sh**:
```bash
#!/bin/bash

echo "🚀 Setting up Arcane Circle Discord Bot..."

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "❌ npm is required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "⚠️ Docker recommended for PostgreSQL"; }

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Copy environment file
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo "⚠️ Please edit .env with your configuration"
fi

# Start PostgreSQL if Docker is available
if command -v docker >/dev/null 2>&1; then
    echo "🐘 Starting PostgreSQL..."
    docker-compose up -d postgres redis
    sleep 5
fi

# Generate Prisma client
echo "🔨 Generating Prisma client..."
npm run db:generate

# Run migrations
echo "📊 Running database migrations..."
npm run db:migrate

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env with your Discord token and API keys"
echo "2. Run 'npm run dev' to start the bot in development mode"
echo "3. Test with /ping command in Discord"
```

Make it executable:
```bash
chmod +x scripts/quick-start.sh
```

---

## Repository README.md Template

```markdown
# Arcane Circle Discord Bot

Discord bot for the Arcane Circle TTRPG marketplace platform.

## Features
- 🎮 Campaign management via slash commands
- 🎙️ Voice session recording & transcription
- 📖 Wiki integration
- 🎲 Player matchmaking
- 📝 Session notes and summaries

## Quick Start

1. Clone the repository
2. Run setup script: `./scripts/quick-start.sh`
3. Configure `.env` file
4. Start bot: `npm run dev`

## Documentation
- [Setup Guide](docs/setup.md)
- [Command Reference](docs/commands.md)
- [API Integration](docs/api.md)
- [Development](docs/development.md)

## Tech Stack
- Node.js 20+
- TypeScript
- Discord.js v14
- PostgreSQL
- Redis
- OpenAI Whisper / Deepgram

## License
MIT
```

---

## Next Steps for You

1. **Create the repository**
   ```bash
   gh repo create arcane-circle-discord-bot --private
   ```

2. **Run the quick-start script** to set up the basic structure

3. **For AI Agents**, provide them with:
   - This startup guide
   - The main implementation document
   - The API integration document
   - Specific task: "Implement Task 1: Core Bot Setup"

4. **Iterate through each phase**, testing as you go

5. **Deploy to a VPS or cloud service** once basic functionality works

The modular approach means you can have different AI agents work on different components in parallel once the core is set up!