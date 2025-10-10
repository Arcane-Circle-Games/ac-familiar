import * as fs from 'fs/promises';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { logger } from '../../utils/logger';

// Set ffmpeg path
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

export interface AudioTrackMetadata {
  userId: string;
  username: string;
  startTime: number;
  endTime: number;
  duration: number;
  sampleRate: number;
  channels: number;
  segmentIndex?: number; // Optional segment index for segment-based recordings
}

export interface ProcessedAudioTrack {
  metadata: AudioTrackMetadata;
  filePath: string;
  fileSize: number;
  format: 'wav' | 'flac' | 'mp3';
}

export interface AudioProcessingOptions {
  format?: 'wav' | 'flac' | 'mp3';
  sampleRate?: number;
  bitrate?: string;
  outputDir?: string;
  guildName?: string;
  sessionStartTime?: number;
}

// Default to project directory
const DEFAULT_RECORDINGS_DIR = './recordings';

export class AudioProcessor {
  private readonly DEFAULT_SAMPLE_RATE = 48000; // Discord's sample rate
  private readonly DEFAULT_CHANNELS = 2; // Stereo

  /**
   * Convert raw PCM buffer chunks to WAV file
   */
  async convertPCMToWAV(
    pcmBuffers: Buffer[],
    metadata: Omit<AudioTrackMetadata, 'duration'>,
    options: AudioProcessingOptions = {}
  ): Promise<ProcessedAudioTrack> {
    const {
      format = 'wav',
      sampleRate = this.DEFAULT_SAMPLE_RATE,
      outputDir = DEFAULT_RECORDINGS_DIR
    } = options;

    try {
      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true });

      // Combine all PCM buffers
      const combinedBuffer = Buffer.concat(pcmBuffers);

      if (combinedBuffer.length === 0) {
        throw new Error('No audio data to process');
      }

      // Check if we have meaningful audio data (at least 1 second worth)
      const minBufferSize = sampleRate * this.DEFAULT_CHANNELS * 2; // 1 second of 16-bit stereo
      if (combinedBuffer.length < minBufferSize) {
        logger.warn('Very short audio segment', {
          bufferSize: combinedBuffer.length,
          minExpected: minBufferSize,
          userId: metadata.userId
        });
      }

      const duration = metadata.endTime - metadata.startTime;
      const sanitizedUsername = this.sanitizeFilename(metadata.username);

      let outputPath: string;

      // Check if this is a segment-based recording
      if (metadata.segmentIndex !== undefined) {
        // Segment-based: Create user subdirectory and use segment naming
        const userDir = path.join(outputDir, sanitizedUsername);
        await fs.mkdir(userDir, { recursive: true });

        const segmentFilename = `segment_${metadata.segmentIndex.toString().padStart(3, '0')}.${format}`;
        outputPath = path.join(userDir, segmentFilename);
      } else {
        // Legacy: Generate filename in format: [ServerName_MM-dd-YY_username]
        const date = new Date(options.sessionStartTime || metadata.startTime);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = String(date.getFullYear()).slice(-2);
        const dateStr = `${month}-${day}-${year}`;

        const sanitizedGuildName = options.guildName
          ? this.sanitizeFilename(options.guildName)
          : 'Discord';

        const outputFilename = `${sanitizedGuildName}_${dateStr}_${sanitizedUsername}.${format}`;
        outputPath = path.join(outputDir, outputFilename);
      }

      logger.info('Processing audio track', {
        userId: metadata.userId,
        username: metadata.username,
        bufferSize: combinedBuffer.length,
        duration,
        format,
        outputPath
      });

      // Write PCM data to temporary file with unique name
      // Use userId, segmentIndex (if available), timestamp, and random value for uniqueness
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const segmentSuffix = metadata.segmentIndex !== undefined ? `_seg${metadata.segmentIndex}` : '';
      const tempPCMPath = path.join(outputDir, `temp_${metadata.userId}${segmentSuffix}_${Date.now()}_${randomSuffix}.pcm`);
      await fs.writeFile(tempPCMPath, combinedBuffer);

      logger.debug('Wrote PCM temp file', { tempPCMPath, size: combinedBuffer.length });

      try {
        // Convert PCM to desired format using ffmpeg
        await this.encodePCMToFormat(
          tempPCMPath,
          outputPath,
          {
            format,
            sampleRate,
            channels: this.DEFAULT_CHANNELS,
            ...(options.bitrate && { bitrate: options.bitrate })
          }
        );
      } finally {
        // Clean up temporary PCM file (always attempt cleanup)
        try {
          await fs.unlink(tempPCMPath);
          logger.debug('Cleaned up temp PCM file', { tempPCMPath });
        } catch (cleanupError) {
          logger.warn('Failed to cleanup temp PCM file', { tempPCMPath, error: cleanupError });
        }
      }

      // Get file size
      const stats = await fs.stat(outputPath);

      const processedTrack: ProcessedAudioTrack = {
        metadata: {
          ...metadata,
          duration,
          sampleRate,
          channels: this.DEFAULT_CHANNELS
        },
        filePath: outputPath,
        fileSize: stats.size,
        format
      };

      logger.info('Audio track processed successfully', {
        userId: metadata.userId,
        outputPath,
        fileSize: stats.size,
        format
      });

      return processedTrack;

    } catch (error) {
      logger.error('Failed to process audio track', error as Error, {
        userId: metadata.userId,
        username: metadata.username
      });
      throw error;
    }
  }

  /**
   * Encode raw PCM file to audio format using ffmpeg
   */
  private async encodePCMToFormat(
    inputPath: string,
    outputPath: string,
    options: {
      format: 'wav' | 'flac' | 'mp3';
      sampleRate: number;
      channels: number;
      bitrate?: string;
    }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let command = ffmpeg()
        .input(inputPath)
        .inputFormat('s16le') // Signed 16-bit little-endian PCM
        .inputOptions([
          `-ar ${options.sampleRate}`,
          `-ac ${options.channels}`
        ]);

      // Format-specific encoding options
      switch (options.format) {
        case 'wav':
          command = command
            .audioCodec('pcm_s16le')
            .format('wav');
          break;

        case 'flac':
          command = command
            .audioCodec('flac')
            .audioQuality(8) // Highest quality
            .format('flac');
          break;

        case 'mp3':
          command = command
            .audioCodec('libmp3lame')
            .audioBitrate(options.bitrate || '192k')
            .format('mp3');
          break;
      }

      command
        .output(outputPath)
        .on('start', (commandLine) => {
          logger.debug('FFmpeg encoding started', { commandLine });
        })
        .on('progress', (progress) => {
          logger.debug('FFmpeg encoding progress', { progress });
        })
        .on('end', () => {
          logger.debug('FFmpeg encoding completed', { outputPath });
          resolve();
        })
        .on('error', (error, stdout, stderr) => {
          logger.error('FFmpeg encoding error', error, {
            inputPath,
            outputPath,
            stderr: stderr ? stderr.substring(0, 500) : 'no stderr',
            stdout: stdout ? stdout.substring(0, 500) : 'no stdout'
          });
          reject(new Error(`FFmpeg encoding failed: ${error.message}`));
        })
        .run();
    });
  }

  /**
   * Process multiple user tracks/segments in parallel
   */
  async processMultipleTracks(
    userTracks: Array<{
      userId: string;
      username: string;
      startTime: number;
      endTime: number;
      bufferChunks: Buffer[];
      segmentIndex?: number; // Optional for segment-based recordings
    }>,
    options: AudioProcessingOptions = {}
  ): Promise<ProcessedAudioTrack[]> {
    logger.info('Processing multiple audio tracks', {
      trackCount: userTracks.length,
      format: options.format || 'wav'
    });

    const processingPromises = userTracks.map(track => {
      const metadata: Omit<AudioTrackMetadata, 'duration'> = {
        userId: track.userId,
        username: track.username,
        startTime: track.startTime,
        endTime: track.endTime,
        sampleRate: this.DEFAULT_SAMPLE_RATE,
        channels: this.DEFAULT_CHANNELS
      };

      // Only add segmentIndex if present
      if (track.segmentIndex !== undefined) {
        metadata.segmentIndex = track.segmentIndex;
      }

      return this.convertPCMToWAV(track.bufferChunks, metadata, options);
    });

    try {
      const results = await Promise.all(processingPromises);
      logger.info('All audio tracks processed successfully', {
        trackCount: results.length,
        totalSize: results.reduce((sum, track) => sum + track.fileSize, 0)
      });
      return results;
    } catch (error) {
      logger.error('Failed to process multiple tracks', error as Error);
      throw error;
    }
  }

  /**
   * Sanitize filename to remove invalid characters
   */
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 50);
  }

  /**
   * Get estimated file size for PCM buffer
   */
  estimateFileSize(
    bufferSize: number,
    format: 'wav' | 'flac' | 'mp3'
  ): number {
    switch (format) {
      case 'wav':
        // WAV is roughly same size as PCM + header
        return bufferSize + 44; // 44 bytes for WAV header

      case 'flac':
        // FLAC typically compresses to 50-70% of original
        return Math.floor(bufferSize * 0.6);

      case 'mp3':
        // MP3 compression is much higher, depends on bitrate
        // At 192kbps, roughly 15% of PCM size
        return Math.floor(bufferSize * 0.15);

      default:
        return bufferSize;
    }
  }

  /**
   * Clean up processed audio files
   */
  async cleanupFiles(filePaths: string[]): Promise<void> {
    logger.info('Cleaning up audio files', { fileCount: filePaths.length });

    const deletePromises = filePaths.map(async (filePath) => {
      try {
        await fs.unlink(filePath);
        logger.debug('Deleted audio file', { filePath });
      } catch (error) {
        logger.warn('Failed to delete audio file', { filePath, error });
      }
    });

    await Promise.allSettled(deletePromises);
  }
}

export const audioProcessor = new AudioProcessor();
