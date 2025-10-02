/**
 * Type definitions for recording upload API
 * Phase 2C: Cloud Storage & Distribution
 */

export interface RecordingParticipant {
  userId: string; // Discord user ID
  username: string; // Discord username/nickname
}

export interface RecordingUploadMetadata {
  sessionId: string; // UUID from bot
  guildId: string; // Discord guild ID
  guildName: string; // Discord guild name
  channelId: string; // Discord voice channel ID
  userId: string; // User who started recording
  duration: number; // Total session duration in milliseconds
  recordedAt: string; // ISO timestamp
  participants: RecordingParticipant[];
}

export interface RecordingUploadRequest {
  metadata: RecordingUploadMetadata;
  files: File[] | Buffer[]; // Audio files (WAV)
}

export interface RecordingUploadResponse {
  success: true;
  recording: {
    id: string; // Database ID (e.g., rec_abc123)
    sessionId: string; // Original session UUID
    status: RecordingStatus;
    downloadUrls: {
      audio: string[]; // Vercel Blob URLs for each audio file
    };
    viewUrl: string; // Web platform URL to view recording
    estimatedProcessingTime: string; // e.g., "2-3 minutes"
  };
}

export interface RecordingUploadErrorResponse {
  success: false;
  error: string;
  details?: string;
  maxSize?: string;
}

export type RecordingStatus =
  | 'uploading' // Initial state during upload
  | 'processing' // Transcription job queued/running
  | 'completed' // Everything done
  | 'failed'; // Transcription or upload failed

export interface RecordingDetails {
  id: string;
  sessionId: string;
  status: RecordingStatus;

  // Metadata
  guildName: string;
  duration: number;
  participantCount: number;
  recordedAt: string;
  uploadedAt: string;
  processedAt: string | null;

  // Download URLs
  downloadUrls: {
    audio: string[]; // Signed URLs for audio files
    transcript?: string; // Signed URL for transcript JSON
    transcriptMd?: string; // Signed URL for transcript Markdown
  };

  // Transcription (if completed)
  transcript?: {
    text: string; // Full markdown text
    wordCount: number;
    confidence: number;
    participants: Array<{
      username: string;
      wordCount: number;
      segments: number;
    }>;
  } | null;

  // View URL
  viewUrl: string;
}

export interface RecordingDetailsResponse {
  success: true;
  recording: RecordingDetails;
}

export interface RecordingListItem {
  id: string;
  sessionId: string;
  guildName: string;
  status: RecordingStatus;
  duration: number;
  participantCount: number;
  wordCount: number | null;
  recordedAt: string;
  viewUrl: string;
}

export interface RecordingListResponse {
  success: true;
  recordings: RecordingListItem[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

// Webhook types
export type WebhookEvent =
  | 'recording.transcription.completed'
  | 'recording.transcription.failed';

export interface RecordingTranscriptionCompletedWebhook {
  event: 'recording.transcription.completed';
  recordingId: string;
  sessionId: string;
  guildId: string;
  channelId: string;
  transcript: {
    wordCount: number;
    confidence: number;
    downloadUrl: string;
  };
  viewUrl: string;
  timestamp: number;
}

export interface RecordingTranscriptionFailedWebhook {
  event: 'recording.transcription.failed';
  recordingId: string;
  sessionId: string;
  guildId: string;
  channelId: string;
  error: string;
  retryCount: number;
  timestamp: number;
}

export type RecordingWebhookPayload =
  | RecordingTranscriptionCompletedWebhook
  | RecordingTranscriptionFailedWebhook;

export interface WebhookHeaders {
  'X-Webhook-Signature': string;
  'X-Webhook-Timestamp': string;
}
