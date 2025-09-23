import { VoiceChannel, GuildMember, VoiceBasedChannel } from 'discord.js';
import {
  joinVoiceChannel,
  VoiceConnection,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState
} from '@discordjs/voice';
import { logInfo, logError } from '../../utils/logger';

export class VoiceConnectionManager {
  private connections: Map<string, VoiceConnection> = new Map();

  async joinChannel(voiceChannel: VoiceBasedChannel): Promise<VoiceConnection> {
    try {
      const guildId = voiceChannel.guild.id;

      // Check if already connected
      let connection = this.connections.get(guildId) || getVoiceConnection(guildId);

      if (connection && connection.state.status === VoiceConnectionStatus.Ready) {
        logInfo('Already connected to voice channel', {
          guildId,
          channelId: voiceChannel.id,
          channelName: voiceChannel.name
        });
        return connection;
      }

      // Create new connection
      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false, // Must be false to receive audio
        selfMute: true,  // We don't want to speak
      });

      // Wait for connection to be ready with timeout
      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

      // Store connection
      this.connections.set(guildId, connection);

      // Set up event listeners
      this.setupConnectionListeners(connection, guildId);

      logInfo('Successfully connected to voice channel', {
        guildId,
        channelId: voiceChannel.id,
        channelName: voiceChannel.name
      });

      return connection;
    } catch (error) {
      logError('Failed to join voice channel', error as Error, {
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id
      });
      throw error;
    }
  }

  private setupConnectionListeners(connection: VoiceConnection, guildId: string): void {
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      logInfo('Voice connection disconnected', { guildId });

      try {
        // Try to reconnect
        await entersState(connection, VoiceConnectionStatus.Signalling, 5_000);
        await entersState(connection, VoiceConnectionStatus.Connecting, 5_000);
      } catch (error) {
        // Failed to reconnect, clean up
        logError('Failed to reconnect voice connection', error as Error, { guildId });
        connection.destroy();
        this.connections.delete(guildId);
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      logInfo('Voice connection destroyed', { guildId });
      this.connections.delete(guildId);
    });

    connection.on('error', (error) => {
      logError('Voice connection error', error, { guildId });
    });

    connection.on('stateChange', (oldState, newState) => {
      logInfo('Voice connection state change', {
        guildId,
        oldStatus: oldState.status,
        newStatus: newState.status
      });
    });
  }

  leaveChannel(guildId: string): boolean {
    try {
      const connection = this.connections.get(guildId) || getVoiceConnection(guildId);

      if (!connection) {
        logInfo('No voice connection found to leave', { guildId });
        return false;
      }

      connection.destroy();
      this.connections.delete(guildId);

      logInfo('Left voice channel', { guildId });
      return true;
    } catch (error) {
      logError('Failed to leave voice channel', error as Error, { guildId });
      return false;
    }
  }

  isConnected(guildId: string): boolean {
    const connection = this.connections.get(guildId) || getVoiceConnection(guildId);
    return connection?.state.status === VoiceConnectionStatus.Ready;
  }

  getConnection(guildId: string): VoiceConnection | undefined {
    return this.connections.get(guildId) || getVoiceConnection(guildId);
  }

  getAllConnections(): { guildId: string; connection: VoiceConnection; channelId?: string }[] {
    return Array.from(this.connections.entries()).map(([guildId, connection]) => ({
      guildId,
      connection,
      channelId: (connection.joinConfig as any)?.channelId
    }));
  }

  // Cleanup method for graceful shutdown
  async cleanup(): Promise<void> {
    logInfo('Cleaning up all voice connections', {
      connectionCount: this.connections.size
    });

    for (const [guildId, connection] of this.connections) {
      try {
        connection.destroy();
        this.connections.delete(guildId);
      } catch (error) {
        logError('Error cleaning up voice connection', error as Error, { guildId });
      }
    }
  }
}

export const voiceConnectionManager = new VoiceConnectionManager();