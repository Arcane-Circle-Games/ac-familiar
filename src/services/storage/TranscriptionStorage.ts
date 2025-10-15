import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../utils/logger';
import {
  SessionTranscript,
  UserTranscript,
  TimelineEntry
} from '../../types/transcription';

export class TranscriptionStorage {
  /**
   * Save session transcript to JSON file
   */
  async saveTranscript(
    sessionId: string,
    transcript: SessionTranscript,
    outputDir: string = './recordings',
    guildName?: string,
    sessionStartTime?: number
  ): Promise<string> {
    try {
      const sessionDir = path.join(outputDir, sessionId);

      // Generate transcript filename in format: ServerName_MM-dd-YY_transcript.json
      const transcriptFilename = this.generateTranscriptFilename(
        guildName,
        sessionStartTime || new Date(transcript.transcribedAt).getTime()
      );
      const transcriptPath = path.join(sessionDir, transcriptFilename);

      logger.info(`Saving transcript to: ${transcriptPath}`);

      // Ensure directory exists
      await fs.mkdir(sessionDir, { recursive: true });

      // Write JSON file
      await fs.writeFile(
        transcriptPath,
        JSON.stringify(transcript, null, 2),
        'utf-8'
      );

      logger.info(`Transcript saved successfully`, {
        sessionId,
        path: transcriptPath,
        wordCount: transcript.wordCount,
        participants: transcript.participantCount
      });

      return transcriptPath;

    } catch (error) {
      logger.error(`Failed to save transcript for session ${sessionId}`, error as Error);
      throw error;
    }
  }

  /**
   * Load session transcript from JSON file
   */
  async loadTranscript(
    sessionId: string,
    outputDir: string = './recordings'
  ): Promise<SessionTranscript | null> {
    try {
      const sessionDir = path.join(outputDir, sessionId);

      // Try to find transcript file (supports both old and new naming formats)
      const transcriptPath = await this.findTranscriptFile(sessionDir);

      logger.debug(`Loading transcript from: ${transcriptPath}`);

      // Check if file exists
      try {
        await fs.access(transcriptPath);
      } catch {
        logger.warn(`Transcript not found: ${transcriptPath}`);
        return null;
      }

      // Read and parse JSON
      const content = await fs.readFile(transcriptPath, 'utf-8');
      const transcript: SessionTranscript = JSON.parse(content);

      logger.debug(`Transcript loaded successfully`, {
        sessionId,
        wordCount: transcript.wordCount,
        participants: transcript.participantCount
      });

      return transcript;

    } catch (error) {
      logger.error(`Failed to load transcript for session ${sessionId}`, error as Error);
      return null;
    }
  }

  /**
   * Check if transcript exists for a session
   */
  async transcriptExists(
    sessionId: string,
    outputDir: string = './recordings'
  ): Promise<boolean> {
    try {
      const sessionDir = path.join(outputDir, sessionId);
      await this.findTranscriptFile(sessionDir);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Merge multiple user transcripts chronologically
   */
  mergeUserTranscripts(
    userTranscripts: UserTranscript[],
    sessionStartTime: number
  ): string {
    logger.debug(`Merging ${userTranscripts.length} user transcripts chronologically`);

    // Create timeline of all text segments with absolute timestamps
    const timeline: TimelineEntry[] = [];

    for (const userTranscript of userTranscripts) {
      for (const segment of userTranscript.segments) {
        timeline.push({
          userId: userTranscript.userId,
          username: userTranscript.username,
          text: segment.text.trim(),
          // Calculate absolute time: user's start time + segment start time
          absoluteTime: userTranscript.audioStartTime + (segment.start * 1000),
          confidence: segment.confidence
        });
      }
    }

    // Sort chronologically by absolute timestamp
    timeline.sort((a, b) => a.absoluteTime - b.absoluteTime);

    logger.debug(`Timeline created with ${timeline.length} entries`);

    // Group into speaker blocks (consecutive entries from same speaker)
    let markdown = '# Session Transcript\n\n';
    let currentSpeaker = '';
    let currentBlock: string[] = [];
    let blockStartTime = 0;

    for (const entry of timeline) {
      if (entry.username !== currentSpeaker) {
        // Write previous block
        if (currentBlock.length > 0) {
          const timestamp = this.formatTimestamp(blockStartTime - sessionStartTime);
          markdown += `**[${timestamp}] ${currentSpeaker}:** ${currentBlock.join(' ')}\n\n`;
        }

        // Start new block
        currentSpeaker = entry.username;
        currentBlock = [entry.text];
        blockStartTime = entry.absoluteTime;
      } else {
        // Continue current block
        currentBlock.push(entry.text);
      }
    }

    // Write final block
    if (currentBlock.length > 0) {
      const timestamp = this.formatTimestamp(blockStartTime - sessionStartTime);
      markdown += `**[${timestamp}] ${currentSpeaker}:** ${currentBlock.join(' ')}\n\n`;
    }

    logger.debug('Transcript merge completed');

    return markdown;
  }

  /**
   * Generate formatted transcript with metadata
   */
  generateFormattedTranscript(transcript: SessionTranscript): string {
    const duration = this.formatDuration(transcript.duration);
    const avgConfidence = (transcript.averageConfidence * 100).toFixed(1);

    let markdown = `# Session Transcript\n\n`;
    markdown += `**Session ID:** \`${transcript.sessionId}\`\n`;
    markdown += `**Transcribed:** ${new Date(transcript.transcribedAt).toLocaleString()}\n`;
    markdown += `**Duration:** ${duration}\n`;
    markdown += `**Participants:** ${transcript.participantCount}\n`;
    markdown += `**Word Count:** ${transcript.wordCount}\n`;
    markdown += `**Avg Confidence:** ${avgConfidence}%\n\n`;
    markdown += `---\n\n`;
    markdown += transcript.fullTranscript;

    return markdown;
  }

  /**
   * Save formatted transcript as markdown file
   */
  async saveFormattedTranscript(
    sessionId: string,
    transcript: SessionTranscript,
    outputDir: string = './recordings',
    guildName?: string,
    sessionStartTime?: number
  ): Promise<string> {
    try {
      const sessionDir = path.join(outputDir, sessionId);

      // Generate markdown filename
      const mdFilename = this.generateTranscriptFilename(
        guildName,
        sessionStartTime || new Date(transcript.transcribedAt).getTime(),
        'md'
      );
      const mdPath = path.join(sessionDir, mdFilename);

      const formatted = this.generateFormattedTranscript(transcript);

      await fs.writeFile(mdPath, formatted, 'utf-8');

      logger.debug(`Formatted transcript saved: ${mdPath}`);

      return mdPath;

    } catch (error) {
      logger.error(`Failed to save formatted transcript`, error as Error);
      throw error;
    }
  }

  /**
   * Get transcript summary without loading full content
   */
  async getTranscriptSummary(
    sessionId: string,
    outputDir: string = './recordings'
  ): Promise<{
    exists: boolean;
    wordCount?: number;
    participants?: number;
    duration?: number;
    confidence?: number;
  }> {
    const transcript = await this.loadTranscript(sessionId, outputDir);

    if (!transcript) {
      return { exists: false };
    }

    return {
      exists: true,
      wordCount: transcript.wordCount,
      participants: transcript.participantCount,
      duration: transcript.duration,
      confidence: transcript.averageConfidence
    };
  }

  /**
   * Format milliseconds to MM:SS
   */
  private formatTimestamp(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Format duration milliseconds to human readable
   */
  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Delete transcript files for a session
   */
  async deleteTranscript(
    sessionId: string,
    outputDir: string = './recordings'
  ): Promise<void> {
    try {
      const sessionDir = path.join(outputDir, sessionId);

      // Find and delete all transcript files (supports both old and new naming)
      const files = await fs.readdir(sessionDir);
      const transcriptFiles = files.filter(f =>
        f.endsWith('_transcript.json') || f.endsWith('_transcript.md') ||
        f.includes('transcript.json') || f.includes('transcript.md')
      );

      for (const file of transcriptFiles) {
        try {
          await fs.unlink(path.join(sessionDir, file));
          logger.debug(`Deleted transcript file: ${file}`);
        } catch {
          // File might not exist
        }
      }

      logger.info(`Transcript files deleted for session ${sessionId}`);

    } catch (error) {
      logger.error(`Failed to delete transcript for session ${sessionId}`, error as Error);
      throw error;
    }
  }

  /**
   * Generate transcript filename in format: ServerName_MM-dd-YY_transcript.ext
   */
  private generateTranscriptFilename(
    guildName: string | undefined,
    timestamp: number,
    extension: 'json' | 'md' = 'json'
  ): string {
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    const dateStr = `${month}-${day}-${year}`;

    const sanitizedGuildName = guildName
      ? this.sanitizeFilename(guildName)
      : 'Discord';

    return `${sanitizedGuildName}_${dateStr}_transcript.${extension}`;
  }

  /**
   * Find transcript file in session directory (supports old and new naming)
   */
  private async findTranscriptFile(sessionDir: string): Promise<string> {
    try {
      const files = await fs.readdir(sessionDir);

      // Look for transcript/summary JSON files (supports both naming conventions)
      const transcriptFiles = files.filter(f =>
        f.endsWith('_transcript.json') || f.endsWith('transcript.json') ||
        f.endsWith('_summary.json') || f.endsWith('summary.json')
      );

      if (transcriptFiles.length === 0) {
        throw new Error('No transcript file found');
      }

      // Prefer new format, but fall back to old format
      const newFormatFile = transcriptFiles.find(f =>
        f.match(/^[^_]+_\d{2}-\d{2}-\d{2}_transcript\.json$/) ||
        f.match(/^[^_]+_summary\.json$/) ||
        f.match(/^[^_]+_transcript\.json$/)
      );
      const transcriptFile = newFormatFile || transcriptFiles[0];

      if (!transcriptFile) {
        throw new Error('No transcript file found');
      }

      return path.join(sessionDir, transcriptFile);
    } catch (error) {
      throw new Error(`Transcript file not found in ${sessionDir}`);
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
}

// Singleton instance
export const transcriptionStorage = new TranscriptionStorage();
