import {
  VoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState
} from '@discordjs/voice';
import { VoiceChannel } from 'discord.js';
import { logger } from '../../utils/logger';

export class VoiceConnectionManager {
  private connections: Map<string, VoiceConnection> = new Map();

  /**
   * Join a voice channel and return the connection
   */
  async joinChannel(voiceChannel: VoiceChannel): Promise<VoiceConnection> {
    const channelId = voiceChannel.id;

    // Check if already connected to this channel
    const existingConnection = this.connections.get(channelId);
    if (existingConnection && existingConnection.state.status !== VoiceConnectionStatus.Destroyed) {
      logger.info(`Already connected to channel ${channelId}`);
      return existingConnection;
    }

    logger.info(`Joining voice channel ${channelId} in guild ${voiceChannel.guildId}`);

    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator as any,
        selfDeaf: true,  // We only want to listen, not broadcast
        selfMute: false  // We need to receive audio
      });

      // Store the connection
      this.connections.set(channelId, connection);

      // Set up connection event handlers
      this.setupConnectionHandlers(connection, channelId);

      // Wait for connection to be ready
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      logger.info(`Successfully connected to voice channel ${channelId}`);

      return connection;

    } catch (error) {
      logger.error(`Failed to join voice channel ${channelId}:`, error);
      this.connections.delete(channelId);
      throw error;
    }
  }

  /**
   * Leave a voice channel
   */
  async leaveChannel(channelId: string): Promise<void> {
    const connection = this.connections.get(channelId);
    if (!connection) {
      logger.warn(`No connection found for channel ${channelId}`);
      return;
    }

    logger.info(`Leaving voice channel ${channelId}`);

    try {
      connection.destroy();
      this.connections.delete(channelId);
      logger.info(`Successfully left voice channel ${channelId}`);
    } catch (error) {
      logger.error(`Error leaving voice channel ${channelId}:`, error);
      // Still remove from our map even if destroy fails
      this.connections.delete(channelId);
    }
  }

  /**
   * Get an existing connection for a channel
   */
  getConnection(channelId: string): VoiceConnection | undefined {
    return this.connections.get(channelId);
  }

  /**
   * Check if bot is connected to a specific channel
   */
  isConnected(channelId: string): boolean {
    const connection = this.connections.get(channelId);
    return connection ? connection.state.status !== VoiceConnectionStatus.Destroyed : false;
  }

  /**
   * Get all active connections
   */
  getActiveConnections(): Map<string, VoiceConnection> {
    // Filter out destroyed connections
    for (const [channelId, connection] of this.connections.entries()) {
      if (connection.state.status === VoiceConnectionStatus.Destroyed) {
        this.connections.delete(channelId);
      }
    }
    return new Map(this.connections);
  }

  /**
   * Set up event handlers for a voice connection
   */
  private setupConnectionHandlers(connection: VoiceConnection, channelId: string): void {
    connection.on('stateChange', (oldState, newState) => {
      logger.debug(`Voice connection ${channelId} state changed: ${oldState.status} -> ${newState.status}`);

      if (newState.status === VoiceConnectionStatus.Disconnected) {
        logger.warn(`Voice connection ${channelId} was disconnected`);
      }

      if (newState.status === VoiceConnectionStatus.Destroyed) {
        logger.info(`Voice connection ${channelId} was destroyed`);
        this.connections.delete(channelId);
      }
    });

    connection.on('error', (error) => {
      logger.error(`Voice connection ${channelId} error:`, error);
    });
  }

  /**
   * Cleanup all connections (useful for bot shutdown)
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up all voice connections');

    const cleanupPromises = Array.from(this.connections.keys()).map(channelId =>
      this.leaveChannel(channelId)
    );

    await Promise.allSettled(cleanupPromises);
    this.connections.clear();

    logger.info('Voice connection cleanup completed');
  }
}