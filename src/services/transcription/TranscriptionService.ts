import OpenAI from 'openai';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import { logger } from '../../utils/logger';
import { config } from '../../utils/config';
import {
  UserTranscript,
  TranscriptSegment,
  WhisperApiResponse,
  TranscriptionOptions
} from '../../types/transcription';

export class TranscriptionService {
  private openai: OpenAI | null = null;

  constructor() {
    if (config.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: config.OPENAI_API_KEY
      });
      logger.info('TranscriptionService initialized with OpenAI API key');
    } else {
      logger.warn('TranscriptionService initialized without OpenAI API key - transcription disabled');
    }
  }

  /**
   * Check if transcription is available
   */
  isAvailable(): boolean {
    return this.openai !== null;
  }

  /**
   * Transcribe a WAV audio file using OpenAI Whisper API
   */
  async transcribeAudioFile(
    wavPath: string,
    userId: string,
    username: string,
    audioStartTime: number,
    options?: TranscriptionOptions
  ): Promise<UserTranscript> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in .env');
    }

    try {
      logger.info(`Transcribing audio file: ${wavPath}`, {
        userId,
        username
      });

      // Check if file exists
      const fileStats = await fs.stat(wavPath);
      const fileSizeMB = fileStats.size / (1024 * 1024);

      if (fileSizeMB > 25) {
        throw new Error(`Audio file too large: ${fileSizeMB.toFixed(2)}MB (max 25MB)`);
      }

      logger.debug(`File size: ${fileSizeMB.toFixed(2)}MB`);

      // Create read stream for the audio file
      const audioStream = createReadStream(wavPath);

      // Call Whisper API
      const startTime = Date.now();
      const response = await this.openai.audio.transcriptions.create({
        file: audioStream as any,
        model: options?.model || 'whisper-1',
        language: options?.language || 'en',
        response_format: 'verbose_json',
        temperature: options?.temperature || 0,
        ...(options?.prompt && { prompt: options.prompt })
      });

      const processingTime = Date.now() - startTime;
      logger.info(`Transcription completed in ${processingTime}ms`, {
        userId,
        duration: response.duration,
        language: (response as any).language
      });

      // Parse response and convert to UserTranscript format
      const whisperResponse = response as any as WhisperApiResponse;
      const segments: TranscriptSegment[] = whisperResponse.segments.map(seg => ({
        text: seg.text.trim(),
        start: seg.start,
        end: seg.end,
        confidence: 1 - seg.no_speech_prob // Convert no_speech_prob to confidence
      }));

      // Calculate average confidence
      const avgConfidence = segments.length > 0
        ? segments.reduce((sum, seg) => sum + seg.confidence, 0) / segments.length
        : 0;

      // Count words in full text
      const wordCount = whisperResponse.text.trim().split(/\s+/).length;

      const userTranscript: UserTranscript = {
        userId,
        username,
        audioFile: wavPath.split('/').pop() || '',
        audioStartTime,
        text: whisperResponse.text.trim(),
        segments,
        duration: whisperResponse.duration,
        wordCount,
        averageConfidence: avgConfidence
      };

      logger.debug(`Transcription stats:`, {
        userId,
        wordCount,
        segmentCount: segments.length,
        avgConfidence: avgConfidence.toFixed(2),
        duration: whisperResponse.duration.toFixed(2)
      });

      return userTranscript;

    } catch (error) {
      logger.error(`Failed to transcribe audio file: ${wavPath}`, error as Error, {
        userId,
        username
      });

      // Check for specific OpenAI errors
      if (error instanceof OpenAI.APIError) {
        if (error.status === 429) {
          throw new Error('OpenAI API rate limit exceeded. Please try again later.');
        } else if (error.status === 401) {
          throw new Error('Invalid OpenAI API key. Check OPENAI_API_KEY configuration.');
        }
      }

      throw error;
    }
  }

  /**
   * Transcribe multiple audio files in parallel with rate limiting
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
    if (!this.openai) {
      throw new Error('OpenAI API key not configured');
    }

    logger.info(`Transcribing ${files.length} audio files`);

    const results: UserTranscript[] = [];
    const errors: Array<{ file: string; error: string }> = [];

    // Process files sequentially to avoid rate limits
    // TODO: Could add parallel processing with rate limiting if needed
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

        // Small delay to avoid rate limits
        await this.delay(500);

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
   * Estimate transcription cost
   */
  estimateCost(durationSeconds: number): number {
    // OpenAI charges $0.006 per minute
    const minutes = durationSeconds / 60;
    return minutes * 0.006;
  }

  /**
   * Format transcription time estimate
   */
  estimateTime(fileSizeMB: number): string {
    // Rough estimate: ~1 minute of processing per 5MB
    const estimatedMinutes = Math.ceil(fileSizeMB / 5);
    return estimatedMinutes === 1 ? '~1 minute' : `~${estimatedMinutes} minutes`;
  }

  /**
   * Simple delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const transcriptionService = new TranscriptionService();
