import { GuildMember } from 'discord.js';

export interface DiscordUserInfo {
  id: string;
  username: string;
  discriminator: string;
  globalName?: string;
  avatarUrl?: string;
  bot: boolean;
}

export interface VoiceStateChange {
  userId: string;
  guildId: string;
  oldChannelId?: string;
  newChannelId?: string;
  member?: GuildMember;
  timestamp: Date;
}

export interface RecordingSession {
  id: string;
  sessionId?: string;
  campaignId?: string;
  channelId: string;
  channelName: string;
  guildId: string;
  startedAt: Date;
  endedAt?: Date;
  participants: RecordingParticipant[];
  status: 'active' | 'paused' | 'stopped' | 'processing';
  filename?: string;
  duration?: number;
}

export interface RecordingParticipant {
  userId: string;
  username: string;
  joinedAt: Date;
  leftAt?: Date;
  totalDuration: number;
  isMuted: boolean;
  isDeafened: boolean;
}

export interface ChannelPermissions {
  canViewChannel: boolean;
  canSendMessages: boolean;
  canManageMessages: boolean;
  canJoinVoice: boolean;
  canSpeakInVoice: boolean;
  canManageChannel: boolean;
}

export interface BotChannelConfig {
  channelId: string;
  channelType: 'text' | 'voice';
  allowedCommands: string[];
  recordingEnabled: boolean;
  transcriptionEnabled: boolean;
  permissions: ChannelPermissions;
}

export interface GuildConfig {
  guildId: string;
  prefix?: string;
  adminRoleIds: string[];
  moderatorRoleIds: string[];
  playerRoleIds: string[];
  defaultChannels: {
    announcements?: string;
    general?: string;
    campaigns?: string;
    recordings?: string;
  };
  features: {
    recordingEnabled: boolean;
    transcriptionEnabled: boolean;
    campaignManagement: boolean;
    sessionScheduling: boolean;
  };
  channels: BotChannelConfig[];
}

export interface CommandContext {
  guildId: string;
  channelId: string;
  userId: string;
  member?: GuildMember;
  permissions: ChannelPermissions;
  isAdmin: boolean;
  isModerator: boolean;
}

export interface VoiceConnection {
  guildId: string;
  channelId: string;
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'destroyed';
  recording?: RecordingSession;
}

// Event Types
export type BotEventType = 
  | 'commandExecuted'
  | 'recordingStarted' 
  | 'recordingEnded'
  | 'userJoinedVoice'
  | 'userLeftVoice'
  | 'sessionCreated'
  | 'sessionUpdated'
  | 'campaignCreated'
  | 'campaignUpdated'
  | 'error';

export interface BotEvent {
  type: BotEventType;
  timestamp: Date;
  guildId?: string;
  channelId?: string;
  userId?: string;
  data: Record<string, any>;
}

// Component Interaction Types
export interface CampaignSelectData {
  campaignId: string;
  action: 'join' | 'leave' | 'view' | 'edit' | 'delete';
}

export interface SessionSelectData {
  sessionId: string;
  action: 'join' | 'leave' | 'start' | 'end' | 'record' | 'view' | 'edit';
}

export interface ModalData {
  type: 'createCampaign' | 'editCampaign' | 'createSession' | 'editSession';
  data: Record<string, any>;
}

// Embed Types
export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface CampaignEmbedData {
  campaign: any; // Will be typed as Campaign from api.ts
  showJoinButton?: boolean;
  showEditButton?: boolean;
  showMembers?: boolean;
}

export interface SessionEmbedData {
  session: any; // Will be typed as Session from api.ts
  showAttendance?: boolean;
  showRecording?: boolean;
  showControls?: boolean;
}