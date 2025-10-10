import { logger } from '../../utils/logger';
import { config } from '../../utils/config';
import { TranscriptionService } from './TranscriptionService';
import { LocalWhisperService } from './LocalWhisperService';
import type { UserTranscript, TranscriptionOptions } from '../../types/transcription';

/**
 * Unified interface for all transcription services
 */
export interface ITranscriptionService {
  isAvailable(): boolean;
  transcribeAudioFile(
    wavPath: string,
    userId: string,
    username: string,
    audioStartTime: number,
    options?: TranscriptionOptions
  ): Promise<UserTranscript>;
  transcribeMultipleFiles(
    files: Array<{
      wavPath: string;
      userId: string;
      username: string;
      audioStartTime: number;
    }>,
    options?: TranscriptionOptions
  ): Promise<UserTranscript[]>;
  estimateTime?(fileSizeMB: number): string;
}

/**
 * Wrapper for LocalWhisperService to ensure initialization
 */
class LocalWhisperServiceWrapper implements ITranscriptionService {
  private service: LocalWhisperService;
  private initialized: boolean = false;

  constructor(service: LocalWhisperService) {
    this.service = service;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      logger.info('Initializing LocalWhisperService...');
      await this.service.initialize();
      this.initialized = true;
    }
  }

  isAvailable(): boolean {
    return this.service.isAvailable();
  }

  async transcribeAudioFile(
    wavPath: string,
    userId: string,
    username: string,
    audioStartTime: number,
    options?: TranscriptionOptions
  ): Promise<UserTranscript> {
    await this.ensureInitialized();
    return this.service.transcribeAudioFile(wavPath, userId, username, audioStartTime, options);
  }

  async transcribeMultipleFiles(
    files: Array<{
      wavPath: string;
      userId: string;
      username: string;
      audioStartTime: number;
    }>,
    options?: TranscriptionOptions
  ): Promise<UserTranscript[]> {
    await this.ensureInitialized();
    return this.service.transcribeMultipleFiles(files, options);
  }

  estimateTime(fileSizeMB: number): string {
    // Estimate based on file size
    // Rough estimate: local whisper processes ~1MB per second on GPU
    const estimatedSeconds = this.service.getModelInfo().isLoaded
      ? Math.ceil(fileSizeMB)
      : Math.ceil(fileSizeMB * 2);

    if (estimatedSeconds < 60) {
      return `~${estimatedSeconds}s`;
    } else {
      const minutes = Math.ceil(estimatedSeconds / 60);
      return `~${minutes}m`;
    }
  }
}

/**
 * Factory to create the appropriate transcription service based on configuration
 */
export class TranscriptionFactory {
  private static instance: ITranscriptionService | null = null;

  /**
   * Get the configured transcription service
   */
  static getService(): ITranscriptionService {
    if (!this.instance) {
      this.instance = this.createService();
    }
    return this.instance;
  }

  /**
   * Create a new transcription service based on configuration
   */
  private static createService(): ITranscriptionService {
    const engine = config.TRANSCRIPTION_ENGINE;

    logger.info(`Creating transcription service: ${engine}`);

    switch (engine) {
      case 'local': {
        // Import and configure LocalWhisperService
        const { localWhisperService } = require('./LocalWhisperService');
        return new LocalWhisperServiceWrapper(localWhisperService);
      }

      case 'openai': {
        // Use existing OpenAI-based TranscriptionService
        const { transcriptionService } = require('./TranscriptionService');
        return transcriptionService;
      }

      case 'deepgram': {
        // TODO: Implement Deepgram service when needed
        logger.warn('Deepgram transcription not yet implemented, falling back to OpenAI');
        const { transcriptionService } = require('./TranscriptionService');
        return transcriptionService;
      }

      default: {
        logger.warn(`Unknown transcription engine: ${engine}, falling back to OpenAI`);
        const { transcriptionService } = require('./TranscriptionService');
        return transcriptionService;
      }
    }
  }

  /**
   * Reset the factory (useful for testing or reconfiguration)
   */
  static reset(): void {
    this.instance = null;
  }

  /**
   * Get information about the current transcription engine
   */
  static getEngineInfo(): {
    engine: string;
    isAvailable: boolean;
    details?: any;
  } {
    const service = this.getService();
    const engine = config.TRANSCRIPTION_ENGINE;

    const info: {
      engine: string;
      isAvailable: boolean;
      details?: any;
    } = {
      engine,
      isAvailable: service.isAvailable()
    };

    // Add engine-specific details
    if (engine === 'local') {
      const { localWhisperService } = require('./LocalWhisperService');
      info.details = {
        modelSize: config.WHISPER_MODEL_SIZE,
        modelsPath: config.WHISPER_MODELS_PATH,
        useGpu: config.WHISPER_USE_GPU,
        libVariant: config.WHISPER_LIB_VARIANT,
        modelInfo: localWhisperService.getModelInfo()
      };
    } else if (engine === 'openai') {
      info.details = {
        apiKeyConfigured: !!config.OPENAI_API_KEY
      };
    }

    return info;
  }
}

// Export a singleton getter for convenience
export const getTranscriptionService = (): ITranscriptionService => {
  return TranscriptionFactory.getService();
};
