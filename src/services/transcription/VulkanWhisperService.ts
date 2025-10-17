// Conditional import - only works when @kutalia/whisper-node-addon is installed
let transcribe: any;
try {
  const whisperAddon = require('@kutalia/whisper-node-addon');
  transcribe = whisperAddon.transcribe;
} catch (error) {
  // Vulkan Whisper addon not available - that's OK
  // Users can still use cloud transcription or other local options
}
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../utils/logger';
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
  fileSize: string;
}

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

export class VulkanWhisperService {
  private modelsDir: string;
  private modelSize: WhisperModelSize;
  private useGpu: boolean;
  private modelPath: string | null = null;

  constructor(
    modelSize: WhisperModelSize = 'base',
    modelsDir: string = './models',
    useGpu: boolean = true
  ) {
    this.modelSize = modelSize;
    this.modelsDir = modelsDir;
    this.useGpu = useGpu;

    logger.info('VulkanWhisperService initialized', {
      modelSize,
      modelsDir,
      useGpu
    });
  }

  /**
   * Check if service is available (model loaded)
   */
  isAvailable(): boolean {
    return this.modelPath !== null;
  }

  /**
   * Initialize the Whisper model
   */
  async initialize(): Promise<void> {
    try {
      // Ensure models directory exists
      await fs.mkdir(this.modelsDir, { recursive: true });

      // Get model path
      this.modelPath = await this.ensureModelDownloaded(this.modelSize);

      logger.info('VulkanWhisperService initialized', { modelPath: this.modelPath, useGpu: this.useGpu });
    } catch (error) {
      logger.error('Failed to initialize VulkanWhisperService', error as Error);
      throw new Error(`Failed to initialize Whisper: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Ensure model is downloaded
   */
  private async ensureModelDownloaded(modelSize: WhisperModelSize): Promise<string> {
    const modelInfo = WHISPER_MODELS[modelSize];
    const modelPath = path.join(this.modelsDir, modelInfo.filename);

    // Check if model exists
    try {
      await fs.access(modelPath);
      logger.info(`Model ${modelSize} already exists at ${modelPath}`);
      return modelPath;
    } catch {
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

      const buffer = await response.arrayBuffer();
      await fs.writeFile(outputPath, Buffer.from(buffer));

      logger.info(`Model ${modelInfo.size} downloaded successfully to ${outputPath}`);
    } catch (error) {
      logger.error(`Failed to download model ${modelInfo.size}`, error as Error);
      try {
        await fs.unlink(outputPath);
      } catch {}
      throw new Error(`Failed to download model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Transcribe a WAV audio file using Vulkan-accelerated Whisper
   */
  async transcribeAudioFile(
    wavPath: string,
    userId: string,
    username: string,
    audioStartTime: number,
    options?: TranscriptionOptions
  ): Promise<UserTranscript> {
    if (!this.modelPath) {
      throw new Error('Whisper model not initialized. Call initialize() first.');
    }

    try {
      logger.info(`Transcribing audio file with Vulkan Whisper: ${wavPath}`, {
        userId,
        username
      });

      const fileStats = await fs.stat(wavPath);
      const fileSizeMB = fileStats.size / (1024 * 1024);
      logger.debug(`File size: ${fileSizeMB.toFixed(2)}MB`);

      const startTime = Date.now();

      // Transcribe using Vulkan acceleration
      const result = await transcribe({
        fname_inp: wavPath,
        model: this.modelPath,
        language: options?.language || 'en',
        use_gpu: this.useGpu
      });

      const processingTime = Date.now() - startTime;

      // Parse transcription result
      const text = this.parseTranscription(result.transcription);

      logger.info(`Transcription completed in ${processingTime}ms`, {
        userId,
        textLength: text.length
      });

      // Parse segments from result
      const segments: TranscriptSegment[] = this.parseSegments(result);

      // Calculate stats
      const lastSegment = segments.length > 0 ? segments[segments.length - 1] : null;
      const duration = lastSegment
        ? lastSegment.end
        : 0;
      const wordCount = text.trim().split(/\s+/).length;
      const avgConfidence = 0.95; // Default confidence

      const userTranscript: UserTranscript = {
        userId,
        username,
        audioFile: path.basename(wavPath),
        audioStartTime,
        text,
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
   * Parse transcription result into text
   */
  private parseTranscription(transcription: string[][] | string[]): string {
    if (Array.isArray(transcription)) {
      if (transcription.length > 0 && Array.isArray(transcription[0])) {
        // transcription is string[][]
        return (transcription as string[][]).map(seg => seg.join(' ')).join(' ');
      } else {
        // transcription is string[]
        return (transcription as string[]).join(' ');
      }
    }
    return '';
  }

  /**
   * Parse segments from whisper result
   */
  private parseSegments(result: any): TranscriptSegment[] {
    // @kutalia/whisper-node-addon may return segments with timestamps
    // For now create a single segment with full text
    const text = this.parseTranscription(result.transcription);

    return [{
      text: text.trim(),
      start: 0,
      end: 0, // We don't have duration info from this package
      confidence: 0.95
    }];
  }

  /**
   * Get model info
   */
  getModelInfo(): { modelSize: WhisperModelSize; modelPath: string | null; isLoaded: boolean } {
    return {
      modelSize: this.modelSize,
      modelPath: this.modelPath,
      isLoaded: this.modelPath !== null
    };
  }

  /**
   * Estimate processing time
   */
  estimateTime(durationSeconds: number): string {
    // With Vulkan GPU, expect ~10-20x real-time depending on GPU
    const speedMultiplier = this.useGpu ? 15 : 1;
    const estimatedSeconds = Math.ceil(durationSeconds / speedMultiplier);

    if (estimatedSeconds < 60) {
      return `~${estimatedSeconds}s`;
    } else {
      const minutes = Math.ceil(estimatedSeconds / 60);
      return `~${minutes}m`;
    }
  }

  /**
   * Release resources (no explicit release needed for this package)
   */
  async release(): Promise<void> {
    logger.info('VulkanWhisperService released');
    this.modelPath = null;
  }
}
