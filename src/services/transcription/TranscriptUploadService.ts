import { logger } from '../../utils/logger';
import { recordingService } from '../api/recordings';
import {
  LocalTranscriptManifest,
  LocalTranscriptSegment,
  SessionTranscript,
  UserTranscript,
  TranscriptSegment
} from '../../types/transcription';
import { transcriptionStorage } from '../storage/TranscriptionStorage';

export interface UploadTranscriptResult {
  success: boolean;
  transcriptionId?: string;
  recordingId?: string;
  sessionTranscript?: SessionTranscript;
  error?: string;
}

export class TranscriptUploadService {
  /**
   * Parse and validate uploaded manifest JSON
   */
  parseManifest(jsonData: any): LocalTranscriptManifest {
    try {
      // Basic validation
      if (!jsonData.sessionId || !jsonData.segments || !Array.isArray(jsonData.segments)) {
        throw new Error('Invalid manifest: missing required fields (sessionId, segments)');
      }

      if (jsonData.format !== 'segmented') {
        throw new Error('Invalid manifest: format must be "segmented"');
      }

      if (jsonData.segments.length === 0) {
        throw new Error('Invalid manifest: no segments found');
      }

      // Validate each segment has transcription
      for (const segment of jsonData.segments) {
        if (!segment.transcription) {
          throw new Error(`Segment ${segment.segmentIndex} for user ${segment.username} is missing transcription data`);
        }

        if (!segment.transcription.segments || !Array.isArray(segment.transcription.segments)) {
          throw new Error(`Segment ${segment.segmentIndex} for user ${segment.username} has invalid transcription segments`);
        }
      }

      logger.info('Manifest validation successful', {
        sessionId: jsonData.sessionId,
        segmentCount: jsonData.segments.length,
        participantCount: new Set(jsonData.segments.map((s: any) => s.userId)).size
      });

      return jsonData as LocalTranscriptManifest;

    } catch (error) {
      logger.error('Failed to parse manifest', error as Error);
      throw error;
    }
  }

  /**
   * Convert local manifest to SessionTranscript format
   */
  convertToSessionTranscript(manifest: LocalTranscriptManifest): SessionTranscript {
    try {
      logger.info('Converting manifest to SessionTranscript', {
        sessionId: manifest.sessionId,
        segmentCount: manifest.segments.length
      });

      // Group segments by user
      const userSegmentsMap = new Map<string, LocalTranscriptSegment[]>();
      for (const segment of manifest.segments) {
        const userId = segment.userId;
        if (!userSegmentsMap.has(userId)) {
          userSegmentsMap.set(userId, []);
        }
        const userSegments = userSegmentsMap.get(userId);
        if (userSegments) {
          userSegments.push(segment);
        }
      }

      // Create UserTranscripts
      const userTranscripts: UserTranscript[] = [];

      for (const [userId, segments] of userSegmentsMap) {
        // Skip if no segments
        if (segments.length === 0) {
          continue;
        }

        // Sort segments by start time
        segments.sort((a, b) => a.absoluteStartTime - b.absoluteStartTime);

        const firstSegment = segments[0]!; // Safe because we checked length > 0
        const username = firstSegment.username;
        const audioFile = segments.map(s => s.fileName).join(', ');
        const audioStartTime = firstSegment.absoluteStartTime;

        // Combine all segment transcripts
        let allText = '';
        const allSegments: TranscriptSegment[] = [];
        let totalWordCount = 0;
        let totalConfidence = 0;
        let segmentCount = 0;

        for (const segment of segments) {
          allText += segment.transcription.text + ' ';
          totalWordCount += segment.transcription.wordCount;
          totalConfidence += segment.transcription.confidence;
          segmentCount++;

          // Convert relative timestamps to absolute for this segment
          for (const relSegment of segment.transcription.segments) {
            const absoluteStart = (segment.absoluteStartTime - manifest.sessionStartTime) / 1000; // Session-relative in seconds
            allSegments.push({
              text: relSegment.text,
              start: absoluteStart + relSegment.start, // Now relative to session start
              end: absoluteStart + relSegment.end,
              confidence: relSegment.confidence
            });
          }
        }

        // Calculate total duration (from first segment start to last segment end)
        const lastSegment = segments[segments.length - 1];
        if (!lastSegment) {
          continue; // Skip if no segments
        }
        const firstSegmentStart = (firstSegment.absoluteStartTime - manifest.sessionStartTime) / 1000;
        const lastSegmentEnd = (lastSegment.absoluteEndTime - manifest.sessionStartTime) / 1000;
        const duration = lastSegmentEnd - firstSegmentStart;

        const userTranscript: UserTranscript = {
          userId,
          username,
          audioFile,
          audioStartTime,
          text: allText.trim(),
          segments: allSegments,
          duration,
          wordCount: totalWordCount,
          averageConfidence: totalConfidence / segmentCount
        };

        userTranscripts.push(userTranscript);
      }

      // Create chronological merged transcript
      const fullTranscript = transcriptionStorage.mergeUserTranscripts(
        userTranscripts,
        manifest.sessionStartTime
      );

      // Calculate session stats
      const totalWordCount = userTranscripts.reduce((sum, ut) => sum + ut.wordCount, 0);
      const averageConfidence = userTranscripts.reduce((sum, ut) => sum + ut.averageConfidence, 0) / userTranscripts.length;
      const duration = manifest.sessionEndTime - manifest.sessionStartTime;

      const sessionTranscript: SessionTranscript = {
        sessionId: manifest.sessionId,
        transcribedAt: new Date().toISOString(),
        duration,
        participantCount: userTranscripts.length,
        fullTranscript,
        wordCount: totalWordCount,
        averageConfidence,
        userTranscripts
      };

      logger.info('SessionTranscript created successfully', {
        sessionId: manifest.sessionId,
        participantCount: userTranscripts.length,
        wordCount: totalWordCount,
        confidence: averageConfidence.toFixed(2)
      });

      return sessionTranscript;

    } catch (error) {
      logger.error('Failed to convert manifest to SessionTranscript', error as Error);
      throw error;
    }
  }

  /**
   * Upload SessionTranscript to platform API
   */
  async uploadToAPI(
    sessionTranscript: SessionTranscript,
    discordUserId: string,
    recordingId?: string
  ): Promise<UploadTranscriptResult> {
    try {
      logger.info('Uploading transcript to API', {
        sessionId: sessionTranscript.sessionId,
        recordingId,
        discordUserId
      });

      // If no recordingId provided, we can't link it to a recording
      // This is okay - the transcript can exist standalone
      if (!recordingId) {
        logger.warn('No recordingId provided - transcript will be uploaded without recording association');
      }

      // Create transcription record
      const transcriptionData: any = {
        recordingId: recordingId || '', // Empty string if no recording
        content: sessionTranscript.fullTranscript,
        confidence: sessionTranscript.averageConfidence,
        language: 'en',
        speakerCount: sessionTranscript.participantCount,
        provider: 'other' as const // Local Whisper
      };

      const createTranscriptionResponse = await recordingService.createTranscription(
        transcriptionData,
        discordUserId
      );

      if (!createTranscriptionResponse.success || !createTranscriptionResponse.data) {
        throw new Error(`Failed to create transcription: ${createTranscriptionResponse.error || 'Unknown error'}`);
      }

      const transcriptionId = createTranscriptionResponse.data.id;

      logger.info('Transcription record created', { transcriptionId });

      // Create transcript segments
      const segments = [];
      let order = 0;

      for (const userTranscript of sessionTranscript.userTranscripts) {
        for (const segment of userTranscript.segments) {
          segments.push({
            startTime: segment.start,
            endTime: segment.end,
            text: segment.text,
            speaker: userTranscript.username,
            confidence: segment.confidence,
            order: order++
          });
        }
      }

      // Upload segments in batches (API might have limits)
      const BATCH_SIZE = 100;
      for (let i = 0; i < segments.length; i += BATCH_SIZE) {
        const batch = segments.slice(i, i + BATCH_SIZE);

        await recordingService.createTranscriptionSegments(
          transcriptionId,
          batch,
          discordUserId
        );

        logger.debug(`Uploaded segment batch ${i / BATCH_SIZE + 1}/${Math.ceil(segments.length / BATCH_SIZE)}`);
      }

      logger.info('Transcript upload completed successfully', {
        transcriptionId,
        segmentCount: segments.length
      });

      const result: UploadTranscriptResult = {
        success: true,
        transcriptionId,
        sessionTranscript
      };

      if (recordingId) {
        result.recordingId = recordingId;
      }

      return result;

    } catch (error) {
      logger.error('Failed to upload transcript to API', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Complete workflow: parse, convert, and upload
   */
  async processAndUpload(
    manifestJson: any,
    discordUserId: string,
    recordingId?: string
  ): Promise<UploadTranscriptResult> {
    try {
      // Parse manifest
      const manifest = this.parseManifest(manifestJson);

      // Convert to SessionTranscript
      const sessionTranscript = this.convertToSessionTranscript(manifest);

      // Upload to API
      const result = await this.uploadToAPI(sessionTranscript, discordUserId, recordingId);

      return result;

    } catch (error) {
      logger.error('Failed to process and upload transcript', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Singleton instance
export const transcriptUploadService = new TranscriptUploadService();
