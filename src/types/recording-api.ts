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
  platformSessionId?: string; // Platform game session ID (if linked)
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

// Two-step upload flow types matching API schema
export interface RecordingSegment {
  userId: string;
  username: string;
  segmentIndex: number;
  fileName: string;
  absoluteStartTime: number; // Unix timestamp in ms
  absoluteEndTime: number; // Unix timestamp in ms
  duration: number; // Duration in ms
  fileSize: number; // Size in bytes
  format: string; // 'wav', 'flac', 'mp3'
}

export interface RecordingUploadInitRequest {
  sessionId: string;
  platformSessionId?: string; // Platform game session ID (if linked)
  guildId: string;
  guildName: string;
  channelId: string;
  userId: string; // User who started recording
  recordedAt: string; // ISO datetime string
  sessionStartTime: number; // Unix timestamp in ms
  sessionEndTime: number; // Unix timestamp in ms
  duration: number; // Duration in ms
  participantCount: number;
  totalSize: number; // Total size in bytes
  format: 'segmented' | 'single';
  segments: RecordingSegment[];
}

export interface RecordingUploadUrl {
  fileIndex: number;
  uploadUrl: string; // Pre-signed Vercel Blob upload URL
  blobPath: string; // Full blob path: "{sessionId}/{username}/segment_000.wav"
}

export interface RecordingUploadInitResponse {
  success: true;
  recordingId: string; // Database ID for the recording
  uploadUrls: RecordingUploadUrl[];
}

export interface RecordingUploadedFile {
  fileIndex: number;
  blobUrl: string; // Full blob URL after upload
  userId: string; // Discord user ID
  username: string;
  fileName: string;
  filePath: string; // Relative path: "username/segment_000.wav"
}

export interface RecordingUploadCompleteRequest {
  files: RecordingUploadedFile[]; // Detailed file information with blob URLs
}

export interface RecordingUploadCompleteResponse {
  success: true;
  recording: {
    id: string;
    sessionId: string;
    status: RecordingStatus;
    downloadUrls: {
      audio: string[];
    };
    viewUrl: string;
    estimatedProcessingTime: string;
  };
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
  | 'live' // Recording in progress (streaming uploads)
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

// Streaming upload types (for on-the-fly segment uploads)

export interface RecordingInitLiveRequest {
  sessionId: string;
  platformSessionId?: string; // Platform game session ID (if linked)
  guildId: string;
  guildName: string;
  channelId: string;
  userId: string; // User who started recording
  recordedAt: string; // ISO datetime string
}

export interface RecordingInitLiveResponse {
  recordingId: string; // Database ID for tracking this recording
  status: 'live';
}

export interface SegmentUploadUrlRequest {
  userId: string;
  username: string;
  segmentIndex: number;
  fileName: string;
  fileSize: number;
  absoluteStartTime: number; // Unix timestamp in ms
  absoluteEndTime: number; // Unix timestamp in ms
  duration: number; // Duration in ms
  format: string; // 'wav', 'flac', 'mp3'
}

export interface SegmentUploadUrlResponse {
  uploadUrl: string; // Pre-signed upload URL
  blobPath: string; // Path in blob storage
}

export interface RecordingSegmentWithBlob extends RecordingSegment {
  blobUrl: string; // Blob URL after upload
  filePath: string; // Relative path (e.g., "Username/segment_000.wav")
}

export interface RecordingFinalizeRequest {
  sessionEndTime: number; // Unix timestamp in ms
  duration: number; // Total duration in ms
  totalSize: number; // Total size in bytes
  participantCount: number;
  segments: RecordingSegmentWithBlob[];
}

export interface RecordingFinalizeResponse {
  success: true;
  recording: {
    id: string;
    sessionId: string;
    status: RecordingStatus;
    duration: number;
    participantCount: number;
    segmentCount: number;
    totalSize: number;
    downloadUrls: {
      audio: string[];
    };
    viewUrl: string;
    estimatedProcessingTime: string;
  };
}
