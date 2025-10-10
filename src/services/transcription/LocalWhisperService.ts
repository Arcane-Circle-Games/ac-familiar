import { initWhisper, type WhisperContext, type TranscribeResult, type LibVariant } from '@fugood/whisper.node';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { config } from '../../utils/config';
import {
  UserTranscript,
  TranscriptSegment,
  TranscriptionOptions
} from '../../types/transcription';

export type WhisperModelSize = 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en' | 'medium' | 'medium.en' | 'large-v1' | 'large-v2' | 'large-v3' | 'large-v3-turbo';

interface WhisperModelInfo {
  size: WhisperModelSize;
  filename: string;
  url: string;
  fileSize: string; // Human readable
}

// Model registry with download URLs from Hugging Face
const WHISPER_MODELS: Record<WhisperModelSize, WhisperModelInfo> = {
  'tiny': { size: 'tiny', filename: 'ggml-tiny.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin', fileSize: '75 MB' },
  'tiny.en': { size: 'tiny.en', filename: 'ggml-tiny.en.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin', fileSize: '75 MB' },
  'base': { size: 'base', filename: 'ggml-base.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin', fileSize: '142 MB' },
  'base.en': { size: 'base.en', filename: 'ggml-base.en.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin', fileSize: '142 MB' },
  'small': { size: 'small', filename: 'ggml-small.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin', fileSize: '466 MB' },
  'small.en': { size: 'small.en', filename: 'ggml-small.en.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin', fileSize: '466 MB' },
  'medium': { size: 'medium', filename: 'ggml-medium.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin', fileSize: '1.5 GB' },
  'medium.en': { size: 'medium.en', filename: 'ggml-medium.en.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin', fileSize: '1.5 GB' },
  'large-v1': { size: 'large-v1', filename: 'ggml-large-v1.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v1.bin', fileSize: '2.9 GB' },
  'large-v2': { size: 'large-v2', filename: 'ggml-large-v2.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v2.bin', fileSize: '2.9 GB' },
  'large-v3': { size: 'large-v3', filename: 'ggml-large-v3.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin', fileSize: '2.9 GB' },
  'large-v3-turbo': { size: 'large-v3-turbo', filename: 'ggml-large-v3-turbo.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin', fileSize: '1.6 GB' }
};

export class LocalWhisperService {
  private context: WhisperContext | null = null;
  private currentModelPath: string | null = null;
  private modelsDir: string;
  private modelSize: WhisperModelSize;
  private useGpu: boolean;
  private libVariant: LibVariant;

  constructor(
    modelSize: WhisperModelSize = 'base',
    modelsDir: string = './models',
    useGpu: boolean = true,
    libVariant: LibVariant = 'default'
  ) {
    this.modelSize = modelSize;
    this.modelsDir = modelsDir;
    this.useGpu = useGpu;
    this.libVariant = libVariant;

    logger.info('LocalWhisperService initialized', {
      modelSize,
      modelsDir,
      useGpu,
      libVariant
    });
  }

  /**
   * Check if service is available (model loaded)
   */
  isAvailable(): boolean {
    return this.context !== null;
  }

  /**
   * Initialize the Whisper context with the configured model
   */
  async initialize(): Promise<void> {
    try {
      // Ensure models directory exists
      await fs.mkdir(this.modelsDir, { recursive: true });

      // Get model path
      const modelPath = await this.ensureModelDownloaded(this.modelSize);

      logger.info('Initializing Whisper context', { modelPath, useGpu: this.useGpu });

      // Initialize context
      this.context = await initWhisper({
        filePath: modelPath,
        useGpu: this.useGpu
      }, this.libVariant);

      this.currentModelPath = modelPath;

      logger.info('LocalWhisperService context initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize LocalWhisperService', error as Error);
      throw new Error(`Failed to initialize Whisper: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Ensure model is downloaded, download if missing
   */
  private async ensureModelDownloaded(modelSize: WhisperModelSize): Promise<string> {
    const modelInfo = WHISPER_MODELS[modelSize];
    const modelPath = path.join(this.modelsDir, modelInfo.filename);

    // Check if model already exists
    try {
      await fs.access(modelPath);
      logger.info(`Model ${modelSize} already exists at ${modelPath}`);
      return modelPath;
    } catch {
      // Model doesn't exist, need to download
      logger.info(`Model ${modelSize} not found, downloading... (Size: ${modelInfo.fileSize})`);
      await this.downloadModel(modelInfo, modelPath);
      return modelPath;
    }
  }

  /**
   * Download a Whisper model from Hugging Face
   */
  private async downloadModel(modelInfo: WhisperModelInfo, outputPath: string): Promise<void> {
    logger.info(`Downloading ${modelInfo.size} model from ${modelInfo.url}`);

    try {
      const response = await fetch(modelInfo.url);

      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }

      const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
      let downloadedSize = 0;

      // Stream download with progress
      const buffer = await response.arrayBuffer();
      await fs.writeFile(outputPath, Buffer.from(buffer));

      logger.info(`Model ${modelInfo.size} downloaded successfully to ${outputPath}`);
    } catch (error) {
      logger.error(`Failed to download model ${modelInfo.size}`, error as Error);
      // Clean up partial download
      try {
        await fs.unlink(outputPath);
      } catch {}
      throw new Error(`Failed to download model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Transcribe a WAV audio file using local Whisper
   */
  async transcribeAudioFile(
    wavPath: string,
    userId: string,
    username: string,
    audioStartTime: number,
    options?: TranscriptionOptions
  ): Promise<UserTranscript> {
    if (!this.context) {
      throw new Error('Whisper context not initialized. Call initialize() first.');
    }

    try {
      logger.info(`Transcribing audio file with local Whisper: ${wavPath}`, {
        userId,
        username
      });

      // Check if file exists
      const fileStats = await fs.stat(wavPath);
      const fileSizeMB = fileStats.size / (1024 * 1024);

      logger.debug(`File size: ${fileSizeMB.toFixed(2)}MB`);

      // Transcribe
      const startTime = Date.now();
      const { promise } = this.context.transcribeFile(wavPath, {
        language: options?.language || 'en',
        temperature: options?.temperature !== undefined ? options.temperature : 0.0,
        tokenTimestamps: true,
        ...(options?.prompt && { prompt: options.prompt })
      });

      const result: TranscribeResult = await promise;
      const processingTime = Date.now() - startTime;

      logger.info(`Transcription completed in ${processingTime}ms`, {
        userId,
        segmentCount: result.segments.length,
        isAborted: result.isAborted
      });

      // Convert to UserTranscript format
      const segments: TranscriptSegment[] = result.segments.map(seg => ({
        text: seg.text.trim(),
        start: seg.t0 / 1000, // Convert from milliseconds to seconds
        end: seg.t1 / 1000,
        confidence: 0.95 // whisper.cpp doesn't provide confidence, use default
      }));

      // Calculate stats
      const duration = segments.length > 0
        ? segments[segments.length - 1].end
        : 0;
      const wordCount = result.result.trim().split(/\s+/).length;
      const avgConfidence = 0.95; // Default confidence for local whisper

      const userTranscript: UserTranscript = {
        userId,
        username,
        audioFile: path.basename(wavPath),
        audioStartTime,
        text: result.result.trim(),
        segments,
        duration,
        wordCount,
        averageConfidence: avgConfidence
      };

      logger.debug(`Transcription stats:`, {
        userId,
        wordCount,
        segmentCount: segments.length,
        duration: duration.toFixed(2)
      });

      return userTranscript;

    } catch (error) {
      logger.error(`Failed to transcribe audio file: ${wavPath}`, error as Error, {
        userId,
        username
      });
      throw error;
    }
  }

  /**
   * Transcribe multiple audio files sequentially
   */
  async transcribeMultipleFiles(
    files: Array<{
      wavPath: string;
      userId: string;
      username: string;
      audioStartTime: number;
    }>,
    options?: TranscriptionOptions
  ): Promise<UserTranscript[]> {
    if (!this.context) {
      throw new Error('Whisper context not initialized. Call initialize() first.');
    }

    logger.info(`Transcribing ${files.length} audio files with local Whisper`);

    const results: UserTranscript[] = [];
    const errors: Array<{ file: string; error: string }> = [];

    for (const file of files) {
      try {
        const transcript = await this.transcribeAudioFile(
          file.wavPath,
          file.userId,
          file.username,
          file.audioStartTime,
          options
        );
        results.push(transcript);

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Failed to transcribe ${file.wavPath}:`, error as Error);
        errors.push({
          file: file.wavPath,
          error: errorMsg
        });
      }
    }

    if (errors.length > 0) {
      logger.warn(`Transcription completed with ${errors.length} errors:`, { errors });
    }

    logger.info(`Transcription batch completed: ${results.length}/${files.length} successful`);

    return results;
  }

  /**
   * Get information about the loaded model
   */
  getModelInfo(): { modelSize: WhisperModelSize; modelPath: string | null; isLoaded: boolean } {
    return {
      modelSize: this.modelSize,
      modelPath: this.currentModelPath,
      isLoaded: this.context !== null
    };
  }

  /**
   * Estimate processing time (local is generally faster than API)
   */
  estimateTime(durationSeconds: number): string {
    // Local whisper is roughly 2-10x faster than real-time depending on hardware
    // Conservative estimate: 1x real-time on CPU, 5x on GPU
    const speedMultiplier = this.useGpu ? 5 : 1;
    const estimatedSeconds = Math.ceil(durationSeconds / speedMultiplier);

    if (estimatedSeconds < 60) {
      return `~${estimatedSeconds}s`;
    } else {
      const minutes = Math.ceil(estimatedSeconds / 60);
      return `~${minutes}m`;
    }
  }

  /**
   * Release the Whisper context and free resources
   */
  async release(): Promise<void> {
    if (this.context) {
      try {
        await this.context.release();
        logger.info('Whisper context released');
      } catch (error) {
        logger.error('Error releasing Whisper context', error as Error);
      }
      this.context = null;
      this.currentModelPath = null;
    }
  }

  /**
   * List available models in the models directory
   */
  async listDownloadedModels(): Promise<WhisperModelSize[]> {
    try {
      const files = await fs.readdir(this.modelsDir);
      const downloadedModels: WhisperModelSize[] = [];

      for (const [size, info] of Object.entries(WHISPER_MODELS)) {
        if (files.includes(info.filename)) {
          downloadedModels.push(size as WhisperModelSize);
        }
      }

      return downloadedModels;
    } catch {
      return [];
    }
  }

  /**
   * Get available model sizes and their info
   */
  static getAvailableModels(): Record<WhisperModelSize, WhisperModelInfo> {
    return WHISPER_MODELS;
  }
}

// Singleton instance (will be initialized on first use)
export const localWhisperService = new LocalWhisperService(
  (config.WHISPER_MODEL_SIZE as WhisperModelSize) || 'base',
  config.WHISPER_MODELS_PATH || './models',
  config.WHISPER_USE_GPU !== false, // Default to true
  (config.WHISPER_LIB_VARIANT as LibVariant) || 'default'
);
