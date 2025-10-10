/**
 * Transcription Services
 *
 * This module provides a unified interface for different transcription engines:
 * - OpenAI Whisper API (cloud, pay-per-use)
 * - Local Whisper (whisper.cpp, free, offline)
 * - Deepgram (cloud, pay-per-use, planned)
 *
 * The active engine is configured via TRANSCRIPTION_ENGINE environment variable.
 */

// Export the factory and convenience getter
export { TranscriptionFactory, getTranscriptionService } from './TranscriptionFactory';
export type { ITranscriptionService } from './TranscriptionFactory';

// Export individual services for direct access if needed
export { TranscriptionService, transcriptionService } from './TranscriptionService';
export { LocalWhisperService, localWhisperService } from './LocalWhisperService';
export type { WhisperModelSize } from './LocalWhisperService';

// Export types
export type {
  UserTranscript,
  TranscriptSegment,
  SessionTranscript,
  TranscriptionOptions,
  TranscriptionResult,
  TimelineEntry
} from '../../types/transcription';

/**
 * Usage Example:
 *
 * ```typescript
 * import { getTranscriptionService } from '@/services/transcription';
 *
 * const transcriptionService = getTranscriptionService();
 *
 * if (transcriptionService.isAvailable()) {
 *   const transcript = await transcriptionService.transcribeAudioFile(
 *     './audio.wav',
 *     'user-123',
 *     'JohnDoe',
 *     Date.now()
 *   );
 * }
 * ```
 *
 * The service will automatically use the configured engine (OpenAI, Local, etc.)
 * based on the TRANSCRIPTION_ENGINE environment variable.
 */
