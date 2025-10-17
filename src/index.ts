import { validateConfig } from './utils/config';
import { logError, logInfo } from './utils/logger';
import { ArcaneBot } from './bot';

async function main() {
  try {
    logInfo('🚀 Starting Arcane Circle Discord Bot...');
    
    // Validate configuration
    validateConfig();
    
    // Initialize bot
    const bot = new ArcaneBot();
    
    // Start bot
    await bot.start();
    
    logInfo('✅ Bot started successfully');
    
  } catch (error) {
    logError('❌ Failed to start bot', error as Error);
    process.exit(1);
  }
}

// Handle process signals
process.on('SIGINT', () => {
  logInfo('🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logInfo('🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  logError('🚫 Unhandled Promise Rejection', reason as Error, {
    promise: promise.toString()
  });
});

process.on('uncaughtException', (error) => {
  logError('🚫 Uncaught Exception', error);
  process.exit(1);
});

// Start the application
main().catch((error) => {
  logError('❌ Fatal error in main process', error);
  process.exit(1);
});