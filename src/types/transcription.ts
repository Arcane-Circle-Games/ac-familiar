/**
 * Type definitions for transcription services
 */

/**
 * Individual timestamped text segment from Whisper API
 */
export interface TranscriptSegment {
  text: string;
  start: number; // Start time in seconds
  end: number; // End time in seconds
  confidence: number; // 0-1 confidence score (derived from no_speech_prob)
}

/**
 * Complete transcript for a single user/speaker
 */
export interface UserTranscript {
  userId: string;
  username: string;
  audioFile: string; // Filename of the source WAV
  audioStartTime: number; // Absolute timestamp (ms) when user started speaking in session
  text: string; // Full concatenated text
  segments: TranscriptSegment[];
  duration: number; // Total audio duration in seconds
  wordCount: number;
  averageConfidence: number;
}

/**
 * Full session transcript with merged chronological content
 */
export interface SessionTranscript {
  sessionId: string;
  transcribedAt: string; // ISO timestamp when transcription completed
  duration: number; // Session duration in ms
  participantCount: number;
  fullTranscript: string; // Markdown formatted with speaker labels
  wordCount: number;
  averageConfidence: number;
  userTranscripts: UserTranscript[];
}

/**
 * OpenAI Whisper API response format
 */
export interface WhisperApiResponse {
  text: string;
  duration: number;
  language: string;
  segments: Array<{
    id: number;
    seek: number;
    start: number;
    end: number;
    text: string;
    tokens: number[];
    temperature: number;
    avg_logprob: number;
    compression_ratio: number;
    no_speech_prob: number;
  }>;
}

/**
 * Options for transcription service
 */
export interface TranscriptionOptions {
  language?: string; // Default: 'en'
  model?: string; // Default: 'whisper-1'
  responseFormat?: 'json' | 'verbose_json' | 'text' | 'srt' | 'vtt'; // Default: 'verbose_json'
  temperature?: number; // 0-1, default: 0
  prompt?: string; // Optional context for better accuracy
}

/**
 * Timeline entry for chronological merging
 */
export interface TimelineEntry {
  userId: string;
  username: string;
  text: string;
  absoluteTime: number; // Absolute timestamp in ms from session start
  confidence: number;
}

/**
 * Result from transcription operation
 */
export interface TranscriptionResult {
  success: boolean;
  transcript?: SessionTranscript;
  error?: string;
  processingTime?: number; // Time taken in ms
}

/**
 * Local transcript upload format - Enhanced manifest with transcription data
 */
export interface LocalTranscriptSegment {
  userId: string;
  username: string;
  segmentIndex: number;
  fileName: string;
  absoluteStartTime: number; // Unix timestamp in ms
  absoluteEndTime: number; // Unix timestamp in ms
  duration: number; // Duration in ms
  transcription: {
    text: string; // Full transcript text for this segment
    segments: Array<{
      start: number; // Relative timestamp in seconds (from segment start)
      end: number; // Relative timestamp in seconds
      text: string;
      confidence: number;
    }>;
    wordCount: number;
    confidence: number; // Average confidence
  };
}

export interface LocalTranscriptManifest {
  sessionId: string;
  sessionStartTime: number; // Unix timestamp in ms
  sessionEndTime: number; // Unix timestamp in ms
  guildName?: string;
  format: 'segmented';
  participantCount?: number;
  totalSize?: number;
  segments: LocalTranscriptSegment[];
}
