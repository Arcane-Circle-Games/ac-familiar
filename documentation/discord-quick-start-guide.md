# Discord Transcription Bot - Quick Start Guide

## Prerequisites
- Node.js 20+ installed
- PostgreSQL database
- Redis server
- Discord Developer Account
- OpenAI API key (for Whisper) OR Deepgram API key

## Step 1: Discord Bot Setup

### Create Discord Application
1. Go to https://discord.com/developers/applications
2. Click "New Application" and name it (e.g., "Arcane Transcription Bot")
3. Go to "Bot" section
4. Click "Add Bot"
5. Copy the bot token (you'll need this)
6. Under "Privileged Gateway Intents", enable:
   - Message Content Intent
   - Server Members Intent

### Generate Bot Invite Link
1. Go to OAuth2 → URL Generator
2. Select scopes: `bot`, `applications.commands`
3. Select permissions:
   - Read Messages/View Channels
   - Send Messages
   - Connect (Voice)
   - Speak (Voice)
   - Use Slash Commands
   - Embed Links
   - Attach Files
   - Read Message History
4. Copy the generated URL and invite bot to your server

## Step 2: Local Development Setup

```bash
# Clone the repository
git clone [your-repo-url]
cd arcane-circle-transcription-bot

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your credentials
nano .env
```

### Essential Environment Variables
```bash
# .env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
DATABASE_URL=postgresql://localhost:5432/transcription_dev
REDIS_URL=redis://localhost:6379
STORAGE_TYPE=local
STORAGE_PATH=./recordings
TRANSCRIPTION_PROVIDER=whisper
OPENAI_API_KEY=sk-...  # Your OpenAI API key
```

## Step 3: Database Setup

```bash
# Create database
createdb transcription_dev

# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# (Optional) Open Prisma Studio to view database
npx prisma studio
```

## Step 4: Start the Bot

```bash
# Development mode (with hot reload)
npm run dev

# Production mode
npm run build
npm start
```

## Step 5: Test Basic Commands

In Discord:
```
/record start    # Start recording current voice channel
/record status   # Check recording status
/record stop     # Stop and process recording
```

## Common Issues & Solutions

### Bot doesn't respond to commands
- Ensure bot has proper permissions in the Discord server
- Check that slash commands are registered (happens on first start)
- Verify bot is online (green status)

### "Must be in voice channel" error
- Join a voice channel before using commands
- Ensure bot has permission to see/join that voice channel

### Recording fails to start
- Check ffmpeg is installed: `ffmpeg -version`
- Verify storage directory exists and is writable
- Check console logs for specific errors

### Transcription fails
- Verify API key is correct and has credits
- Check file size (Whisper has 25MB limit)
- Ensure audio files are being saved correctly

## Development Workflow

### Adding New Commands
1. Create new file in `src/commands/`
2. Follow the structure in `record.ts`
3. Restart bot to register command

### Testing Transcription Locally
```bash
# Use test audio file
npm run test:transcribe -- ./test-audio.wav
```

### Viewing Logs
```bash
# Development
npm run dev

# Production (with PM2)
pm2 logs arcane-bot
```

## Quick Deployment to Production

### Using Docker
```bash
# Build and run with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f bot

# Stop services
docker-compose down
```

### Using PM2 (without Docker)
```bash
# Install PM2 globally
npm install -g pm2

# Build application
npm run build

# Start with PM2
pm2 start dist/index.js --name arcane-bot

# Save PM2 configuration
pm2 save
pm2 startup
```

## API Endpoints (Optional Web UI)

The bot includes optional REST API endpoints for web integration:

```
GET  /health              # Health check
GET  /api/sessions        # List recording sessions
GET  /api/sessions/:id    # Get session details
GET  /api/transcript/:id  # Get transcript
POST /api/export/:id      # Export transcript
```

## Cost Estimates

### Transcription Costs (per hour of audio)
- **OpenAI Whisper**: $0.36/hour
- **Deepgram Nova-2**: $0.35/hour (batch)

### Storage Costs
- **Local**: Free (your server storage)
- **AWS S3**: ~$0.023/GB/month

### Example Monthly Costs
- 100 hours recorded: ~$36 transcription + $2 storage = $38/month
- 500 hours recorded: ~$180 transcription + $10 storage = $190/month

## Security Checklist

- [ ] Never commit `.env` file to git
- [ ] Use environment variables for all secrets
- [ ] Implement rate limiting for commands
- [ ] Set up proper file permissions for recordings
- [ ] Regular cleanup of old recordings
- [ ] Monitor for unusual usage patterns

## Support & Resources

- Discord.js Documentation: https://discord.js.org/
- Prisma Documentation: https://www.prisma.io/docs
- OpenAI API: https://platform.openai.com/docs
- Deepgram API: https://developers.deepgram.com/

## Next Steps

1. **Add Authentication**: Link Discord users to your platform accounts
2. **Web Dashboard**: Build web UI for viewing/managing transcripts
3. **Advanced Features**: 
   - AI summaries of sessions
   - Keyword detection and alerts
   - Multi-language support
   - Real-time transcription option
4. **Integration**: Connect to your existing Arcane Circle platform