import { VoiceBasedChannel, GuildMember, Client } from 'discord.js';
import { VoiceConnectionManager } from '../voice/VoiceConnectionManager';
import { LiveTranscriptionService } from '../transcription/LiveTranscriptionService';
import { v4 as uuidv4 } from 'uuid';
import { logInfo, logError, logDebug } from '../../utils/logger';

interface ActiveRecording {
  sessionId: string;
  guildId: string;
  channelId: string;
  channelName: string;
  gameId?: string;
  startedAt: Date;
  startedBy: string; // User ID who started the recording
  participants: Set<string>; // User IDs who have spoken
}

export class RecordingManager {
  private voiceManager: VoiceConnectionManager;
  private transcriptionService: LiveTranscriptionService;
  private activeRecordings: Map<string, ActiveRecording> = new Map(); // channelId -> ActiveRecording
  private discordClient: Client;

  constructor(discordClient: Client) {
    this.discordClient = discordClient;
    this.voiceManager = new VoiceConnectionManager();
    this.transcriptionService = new LiveTranscriptionService(discordClient);

    // Listen for transcription events
    this.setupTranscriptionEventListeners();

    logInfo('RecordingManager initialized');
  }

  private setupTranscriptionEventListeners(): void {
    // Listen for transcription segments (for live updates)
    this.transcriptionService.on('transcription', (segment) => {
      const recording = this.getRecordingBySessionId(segment.sessionId);
      if (recording) {
        // Add participant to the recording
        recording.participants.add(segment.userId);

        logDebug('Transcription segment received', {
          sessionId: segment.sessionId,
          username: segment.username,
          text: segment.text.substring(0, 50) + '...',
          participantCount: recording.participants.size
        });
      }
    });

    // Listen for transcription errors
    this.transcriptionService.on('transcriptionError', (errorData) => {
      logError('Transcription error in recording session', new Error(errorData.error), {
        sessionId: errorData.sessionId,
        userId: errorData.userId,
        username: errorData.username
      });
    });

    // Listen for session events
    this.transcriptionService.on('sessionStarted', (data) => {
      logInfo('Transcription session started', data);
    });

    this.transcriptionService.on('sessionEnded', (data) => {
      logInfo('Transcription session ended', {
        sessionId: data.sessionId,
        wordCount: data.wordCount,
        participantCount: data.participantCount,
        duration: `${Math.round(data.duration / 1000)}s`
      });
    });
  }

  async joinChannel(voiceChannel: VoiceBasedChannel): Promise<void> {
    try {
      await this.voiceManager.joinChannel(voiceChannel);
      logInfo('Joined voice channel via RecordingManager', {
        channelId: voiceChannel.id,
        channelName: voiceChannel.name,
        guildId: voiceChannel.guild.id
      });
    } catch (error) {
      logError('Failed to join voice channel via RecordingManager', error as Error, {
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id
      });
      throw error;
    }
  }

  async startRecording(
    voiceChannel: VoiceBasedChannel,
    requestedBy: GuildMember,
    gameId?: string
  ): Promise<string> {
    try {
      const channelId = voiceChannel.id;
      const guildId = voiceChannel.guild.id;

      // Check if already recording in this channel
      if (this.activeRecordings.has(channelId)) {
        throw new Error('Recording already in progress in this channel');
      }

      // Ensure we're connected to the voice channel
      const connection = await this.voiceManager.joinChannel(voiceChannel);

      // Generate session ID
      const sessionId = uuidv4();

      // Create recording record
      const recording: ActiveRecording = {
        sessionId,
        guildId,
        channelId,
        channelName: voiceChannel.name,
        gameId,
        startedAt: new Date(),
        startedBy: requestedBy.id,
        participants: new Set()
      };

      this.activeRecordings.set(channelId, recording);

      // Start live transcription
      await this.transcriptionService.startSession(
        sessionId,
        connection.receiver,
        gameId,
        channelId,
        guildId
      );

      logInfo('Started recording session', {
        sessionId,
        channelId,
        channelName: voiceChannel.name,
        guildId,
        gameId,
        startedBy: requestedBy.user.username
      });

      return sessionId;
    } catch (error) {
      // Clean up on error
      this.activeRecordings.delete(voiceChannel.id);

      logError('Failed to start recording', error as Error, {
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        requestedBy: requestedBy.user.username
      });
      throw error;
    }
  }

  async stopRecording(channelId: string): Promise<{
    sessionId: string;
    transcript: string;
    stats: {
      duration: number; // milliseconds
      wordCount: number;
      participantCount: number;
      segmentCount: number;
    };
  }> {
    try {
      const recording = this.activeRecordings.get(channelId);
      if (!recording) {
        throw new Error('No active recording in this channel');
      }

      const { sessionId, startedAt } = recording;

      logInfo('Stopping recording session', {
        sessionId,
        channelId,
        duration: Date.now() - startedAt.getTime()
      });

      // End transcription session and get final transcript
      const transcript = await this.transcriptionService.endSession(sessionId);

      // Calculate stats
      const duration = Date.now() - startedAt.getTime();
      const wordCount = transcript.split(/\s+/).filter(word => word.length > 0).length;
      const participantCount = recording.participants.size;

      // Get additional stats from transcription service
      const sessionInfo = this.transcriptionService.getSessionInfo(sessionId);
      const segmentCount = sessionInfo?.segmentCount || 0;

      // Clean up recording
      this.activeRecordings.delete(channelId);

      const stats = {
        duration,
        wordCount,
        participantCount,
        segmentCount
      };

      logInfo('Recording session stopped successfully', {
        sessionId,
        channelId,
        ...stats
      });

      return {
        sessionId,
        transcript,
        stats
      };
    } catch (error) {
      logError('Failed to stop recording', error as Error, { channelId });
      throw error;
    }
  }

  getLiveTranscript(channelId: string): string | null {
    const recording = this.activeRecordings.get(channelId);
    if (!recording) {
      return null;
    }

    return this.transcriptionService.getLiveTranscript(recording.sessionId);
  }

  isRecording(channelId: string): boolean {
    return this.activeRecordings.has(channelId);
  }

  getRecordingInfo(channelId: string): {
    sessionId: string;
    channelName: string;
    gameId?: string;
    startedAt: Date;
    startedBy: string;
    duration: number; // milliseconds
    participantCount: number;
    isTranscribing: boolean;
  } | null {
    const recording = this.activeRecordings.get(channelId);
    if (!recording) {
      return null;
    }

    return {
      sessionId: recording.sessionId,
      channelName: recording.channelName,
      gameId: recording.gameId,
      startedAt: recording.startedAt,
      startedBy: recording.startedBy,
      duration: Date.now() - recording.startedAt.getTime(),
      participantCount: recording.participants.size,
      isTranscribing: this.transcriptionService.isSessionActive(recording.sessionId)
    };
  }

  private getRecordingBySessionId(sessionId: string): ActiveRecording | undefined {
    for (const recording of this.activeRecordings.values()) {
      if (recording.sessionId === sessionId) {
        return recording;
      }
    }
    return undefined;
  }

  getAllActiveRecordings(): {
    channelId: string;
    sessionId: string;
    channelName: string;
    guildId: string;
    gameId?: string;
    startedAt: Date;
    duration: number;
    participantCount: number;
  }[] {
    return Array.from(this.activeRecordings.entries()).map(([channelId, recording]) => ({
      channelId,
      sessionId: recording.sessionId,
      channelName: recording.channelName,
      guildId: recording.guildId,
      gameId: recording.gameId,
      startedAt: recording.startedAt,
      duration: Date.now() - recording.startedAt.getTime(),
      participantCount: recording.participants.size
    }));
  }

  leaveChannel(guildId: string): boolean {
    try {
      // Stop any active recordings in this guild
      const recordingsToStop = Array.from(this.activeRecordings.entries())
        .filter(([_, recording]) => recording.guildId === guildId)
        .map(([channelId]) => channelId);

      for (const channelId of recordingsToStop) {
        logInfo('Auto-stopping recording due to voice channel leave', {
          channelId,
          guildId
        });

        // Stop recording without awaiting to avoid blocking
        this.stopRecording(channelId).catch(error => {
          logError('Error auto-stopping recording on channel leave', error, {
            channelId,
            guildId
          });
        });
      }

      // Leave voice channel
      return this.voiceManager.leaveChannel(guildId);
    } catch (error) {
      logError('Error leaving channel via RecordingManager', error as Error, { guildId });
      return false;
    }
  }

  isConnectedToVoice(guildId: string): boolean {
    return this.voiceManager.isConnected(guildId);
  }

  getVoiceConnection(guildId: string) {
    return this.voiceManager.getConnection(guildId);
  }

  // Cleanup method for graceful shutdown
  async cleanup(): Promise<void> {
    logInfo('Cleaning up RecordingManager', {
      activeRecordings: this.activeRecordings.size
    });

    // Stop all active recordings
    const channelIds = Array.from(this.activeRecordings.keys());
    for (const channelId of channelIds) {
      try {
        await this.stopRecording(channelId);
      } catch (error) {
        logError('Error stopping recording during cleanup', error as Error, { channelId });
      }
    }

    // Cleanup services
    await Promise.all([
      this.voiceManager.cleanup(),
      this.transcriptionService.cleanup()
    ]);

    logInfo('RecordingManager cleanup completed');
  }
}

// Export singleton instance - will be properly initialized in bot setup
export let recordingManager: RecordingManager;

export function initializeRecordingManager(discordClient: Client): RecordingManager {
  recordingManager = new RecordingManager(discordClient);
  return recordingManager;
}