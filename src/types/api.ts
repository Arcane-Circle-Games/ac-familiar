export interface User {
  id: string;
  username: string;
  email: string;
  discordId?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GameSystem {
  id: string;
  name: string;
  description: string;
  version?: string;
  publisher?: string;
  imageUrl?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  gameSystemId: string;
  gameSystem?: GameSystem;
  gameMasterId: string;
  gameMaster?: User;
  maxPlayers?: number;
  currentPlayers: number;
  status: 'active' | 'inactive' | 'completed' | 'recruiting';
  isPublic: boolean;
  discordChannelId?: string;
  discordRoleId?: string;
  imageUrl?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CampaignMember {
  id: string;
  campaignId: string;
  userId: string;
  user?: User;
  role: 'player' | 'co-gm' | 'observer';
  characterName?: string;
  characterDescription?: string;
  joinedAt: string;
}

export interface Session {
  id: string;
  campaignId: string;
  campaign?: Campaign;
  name: string;
  description?: string;
  scheduledFor: string;
  duration?: number;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  sessionNumber?: number;
  notes?: string;
  discordChannelId?: string;
  recordingId?: string;
  transcriptionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionAttendee {
  id: string;
  sessionId: string;
  userId: string;
  user?: User;
  status: 'confirmed' | 'maybe' | 'declined' | 'attended' | 'absent';
  notes?: string;
  joinedAt?: string;
  leftAt?: string;
}

export interface Recording {
  id: string;
  sessionId: string;
  session?: Session;
  filename: string;
  originalFilename?: string;
  duration: number;
  fileSize: number;
  format: string;
  quality: 'low' | 'medium' | 'high';
  status: 'processing' | 'completed' | 'failed' | 'deleted';
  storageUrl?: string;
  downloadUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Transcription {
  id: string;
  recordingId: string;
  recording?: Recording;
  content: string;
  confidence?: number;
  language?: string;
  speakerCount?: number;
  status: 'processing' | 'completed' | 'failed';
  provider: 'openai' | 'deepgram' | 'other';
  processingTime?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptionSegment {
  id: string;
  transcriptionId: string;
  startTime: number;
  endTime: number;
  text: string;
  speaker?: string;
  confidence?: number;
  order: number;
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiError {
  message: string;
  code?: string;
  statusCode: number;
  details?: Record<string, any>;
}

// Request Types
export interface CreateCampaignRequest {
  name: string;
  description?: string;
  gameSystemId: string;
  maxPlayers?: number;
  isPublic: boolean;
  discordChannelId?: string;
  discordRoleId?: string;
  imageUrl?: string;
  tags?: string[];
}

export interface UpdateCampaignRequest extends Partial<CreateCampaignRequest> {
  status?: Campaign['status'];
}

export interface CreateSessionRequest {
  campaignId: string;
  name: string;
  description?: string;
  scheduledFor: string;
  duration?: number;
  discordChannelId?: string;
}

export interface UpdateSessionRequest extends Partial<CreateSessionRequest> {
  status?: Session['status'];
  notes?: string;
  recordingId?: string;
  transcriptionId?: string;
}

export interface JoinCampaignRequest {
  campaignId: string;
  role?: 'player' | 'observer';
  characterName?: string;
  characterDescription?: string;
}

export interface CreateRecordingRequest {
  sessionId: string;
  filename: string;
  originalFilename?: string;
  duration: number;
  fileSize: number;
  format: string;
  quality: 'low' | 'medium' | 'high';
}

export interface CreateTranscriptionRequest {
  recordingId: string;
  content: string;
  confidence?: number;
  language?: string;
  speakerCount?: number;
  provider: 'openai' | 'deepgram' | 'other';
  processingTime?: number;
}

// Query Parameters
export interface CampaignQueryParams {
  page?: number;
  limit?: number;
  status?: Campaign['status'];
  gameSystemId?: string;
  search?: string;
  tags?: string[];
  isPublic?: boolean;
  discordGuildId?: string;
}

export interface SessionQueryParams {
  page?: number;
  limit?: number;
  campaignId?: string;
  status?: Session['status'];
  scheduledAfter?: string;
  scheduledBefore?: string;
}

export interface UserQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  discordId?: string;
}

// Authentication Types
export interface AuthUser {
  id: string;
  username: string;
  email: string;
  discordId: string;
  avatarUrl?: string;
  roles: string[];
}

export interface AuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  tokenType: 'Bearer';
}

export interface AuthResponse {
  user: AuthUser;
  token: AuthToken;
}