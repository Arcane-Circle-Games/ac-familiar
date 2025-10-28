# Railway Deployment Guide

This guide walks you through deploying the Arcane Circle Discord bot to Railway.

## Prerequisites

- Railway account (https://railway.app)
- GitHub repository access
- Discord bot token and client ID
- Vercel bypass token from your platform deployment

## Step-by-Step Deployment

### 1. Create Railway Project

1. Go to https://railway.app and sign in
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose the `ac-familiar` repository
5. Railway will automatically detect the Dockerfile and configuration

### 2. Configure Environment Variables

In your bot service, go to **"Variables"** tab and add:

#### Required Variables:
```bash
# Discord Configuration
DISCORD_TOKEN=<your_discord_bot_token>
DISCORD_CLIENT_ID=<your_discord_client_id>

# Platform API (your Vercel deployment)
PLATFORM_API_URL=https://arcanecircle.games/api
PLATFORM_WEB_URL=https://arcanecircle.games
VERCEL_BYPASS_TOKEN=<your_vercel_bypass_token>
BOT_API_KEY=<generate_secure_key>

# Environment
NODE_ENV=production
LOG_LEVEL=info
```

#### Optional: Game Announcements
```bash
GAME_ANNOUNCEMENT_ENABLED=true
GAME_ANNOUNCEMENT_CHANNEL_ID=<your_discord_channel_id>
GAME_ANNOUNCEMENT_INTERVAL_HOURS=3
```

### 3. Deploy

Railway will automatically deploy when you:
- Push to your main branch (if connected via GitHub)
- Or click **"Deploy"** button in the dashboard

The deployment process:
1. Builds Docker image using your Dockerfile
2. Compiles TypeScript
3. Starts the bot with `node dist/index.js`

### 4. Verify Deployment

Check the **"Deployments"** tab for build logs. You should see:
```
✅ Configuration validated successfully
📍 Environment: production
🔗 API URL: https://arcanecircle.games/api
🌐 Web URL: https://arcanecircle.games
🚀 Starting Arcane Circle Discord Bot...
✅ Bot started successfully
```

### 5. Test the Bot

In Discord:
1. Run `/ping` to check bot responsiveness
2. Run `/test-api` to verify API connectivity
3. Try `/games` to test platform integration

## Monitoring

### View Logs
- Go to your bot service → **"Deployments"** tab
- Click on the latest deployment
- View real-time logs

### Check Resource Usage
- Go to **"Metrics"** tab
- Monitor CPU, Memory, and Network usage

### Restart Service
If the bot becomes unresponsive:
1. Go to service → **"Settings"**
2. Click **"Restart"** button

## Updating the Bot

Railway auto-deploys when you push to GitHub:

1. Make changes locally
2. Commit and push to main branch
3. Railway automatically builds and deploys
4. Check deployment logs for any errors

## Troubleshooting

### Bot won't start
- Check environment variables are set correctly
- Verify `DISCORD_TOKEN` is valid
- Check logs for specific error messages

### API connectivity issues
- Verify `PLATFORM_API_URL` points to your Vercel deployment
- Check `VERCEL_BYPASS_TOKEN` is valid
- Test API endpoint directly: `curl https://arcanecircle.games/api/health`

### Voice recording issues
- Ensure `@discordjs/voice` dependencies are installed
- Check Docker build logs for native dependency compilation errors
- Verify bot has proper Discord permissions in your server

## Cost Estimates

Railway pricing (as of 2024):
- **Hobby Plan**: $5/month credit
  - ~550 hours of runtime (fine for single bot)
- **Pro Plan**: $20/month for more resources

Typical usage for this bot:
- Bot service: ~$2-3/month

**Total: ~$2-3/month (easily fits in $5 Hobby plan)**

## Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | ✅ | - | Discord bot token |
| `DISCORD_CLIENT_ID` | ✅ | - | Discord application client ID |
| `DISCORD_GUILD_ID` | ❌ | - | Guild ID for instant command registration (dev only) |
| `PLATFORM_API_URL` | ✅ | - | Your Vercel API URL |
| `PLATFORM_WEB_URL` | ✅ | - | Your Vercel web URL |
| `VERCEL_BYPASS_TOKEN` | ✅ | - | Token to bypass Vercel protection |
| `BOT_API_KEY` | ✅ | - | Secret key for bot authentication |
| `NODE_ENV` | ✅ | `production` | Environment mode |
| `LOG_LEVEL` | ❌ | `info` | Logging verbosity (error/warn/info/debug) |
| `GAME_ANNOUNCEMENT_ENABLED` | ❌ | `false` | Enable automatic game announcements |
| `GAME_ANNOUNCEMENT_CHANNEL_ID` | ❌ | - | Discord channel for announcements |
| `GAME_ANNOUNCEMENT_INTERVAL_HOURS` | ❌ | `3` | How often to check for new games |

## Additional Resources

- Railway Docs: https://docs.railway.app
- Railway CLI: https://docs.railway.app/develop/cli
- Discord.js Guide: https://discordjs.guide
- Project README: [README.md](./README.md)
- API Documentation: [api-endpoints.md](./api-endpoints.md)
