import {
  CommandInteraction,
  GuildMember,
  EmbedBuilder,
  VoiceChannel,
  ChatInputCommandInteraction,
  AttachmentBuilder
} from 'discord.js';
import { RecordingManager } from '../services/recording/RecordingManager';
import { logger } from '../utils/logger';
import { transcriptionStorage } from '../services/storage/TranscriptionStorage';
import { recordingUploadService } from '../services/upload/RecordingUploadService';
import { recordingService } from '../services/api/recordings';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Calculate duration from WAV file by reading header
 */
async function getWAVDuration(filePath: string): Promise<number> {
  try {
    const buffer = await fs.readFile(filePath);

    // WAV file header structure:
    // Bytes 0-3: "RIFF"
    // Bytes 4-7: File size - 8
    // Bytes 8-11: "WAVE"
    // Bytes 12-15: "fmt "
    // Bytes 16-19: Format chunk size (16 for PCM)
    // Bytes 20-21: Audio format (1 for PCM)
    // Bytes 22-23: Number of channels
    // Bytes 24-27: Sample rate
    // Bytes 28-31: Byte rate
    // Bytes 32-33: Block align
    // Bytes 34-35: Bits per sample

    if (buffer.length < 44) {
      logger.warn('WAV file too small to read header', { filePath });
      return 0;
    }

    // Verify RIFF and WAVE headers
    const riff = buffer.toString('ascii', 0, 4);
    const wave = buffer.toString('ascii', 8, 12);

    if (riff !== 'RIFF' || wave !== 'WAVE') {
      logger.warn('Invalid WAV file format', { filePath, riff, wave });
      return 0;
    }

    const byteRate = buffer.readUInt32LE(28);

    // Find data chunk
    let offset = 12;
    while (offset < buffer.length - 8) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);

      if (chunkId === 'data') {
        // Duration = data size / byte rate (in milliseconds)
        const durationMs = Math.round((chunkSize / byteRate) * 1000);
        return durationMs;
      }

      offset += 8 + chunkSize;
    }

    logger.warn('No data chunk found in WAV file', { filePath });
    return 0;
  } catch (error) {
    logger.error('Failed to calculate WAV duration', error as Error, { filePath });
    return 0;
  }
}

// Singleton instance - exported for bot startup cleanup
export const recordingManager = new RecordingManager();

export const recordCommand = {
  name: 'record',
  description: 'Record voice channel audio and manage recordings',
  options: [
    {
      name: 'action',
      description: 'Recording action to perform',
      type: 3, // STRING type
      required: true,
      choices: [
        { name: 'Start Recording', value: 'start' },
        { name: 'Stop Recording (don\'t save)', value: 'stop' },
        { name: 'Stop & Save Recording', value: 'stop-save' },
        { name: 'Check Status', value: 'status' }
      ]
    },
    {
      name: 'auto-upload',
      description: 'Upload to platform after saving (stop-save only)',
      type: 5, // BOOLEAN type
      required: false
    },
    {
      name: 'auto-transcribe',
      description: 'Transcribe with AI after saving (stop-save only, uses OpenAI credits)',
      type: 5, // BOOLEAN type
      required: false
    }
  ],

  async execute(interaction: CommandInteraction): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: '❌ This command can only be used in a server',
        ephemeral: true
      });
      return;
    }

    const member = interaction.member as GuildMember;
    const action = (interaction as ChatInputCommandInteraction).options.getString('action', true);

    // Check if user is in a voice channel for recording actions
    const voiceChannel = member.voice.channel as VoiceChannel;
    if (!voiceChannel && (action === 'start' || action === 'stop' || action === 'stop-save')) {
      await interaction.reply({
        content: '❌ You must be in a voice channel to use this command',
        ephemeral: true
      });
      return;
    }

    // Defer reply immediately for long-running actions (non-ephemeral)
    const deferredActions = ['start', 'stop', 'stop-save'];
    if (deferredActions.includes(action)) {
      await interaction.deferReply();
    }

    try {
      switch (action) {
        case 'start':
          await handleStartRecording(interaction, voiceChannel, member);
          break;
        case 'stop':
          await handleStopRecording(interaction, voiceChannel, member, false, false, false);
          break;
        case 'stop-save':
          {
            const chatInteraction = interaction as ChatInputCommandInteraction;
            const shouldUpload = chatInteraction.options.getBoolean('auto-upload') ?? false;
            const shouldTranscribe = chatInteraction.options.getBoolean('auto-transcribe') ?? false;
            await handleStopRecording(interaction, voiceChannel, member, true, shouldTranscribe, shouldUpload);
          }
          break;
        case 'status':
          await handleGetStatus(interaction, voiceChannel?.id);
          break;
        default:
          await interaction.reply({
            content: '❌ Invalid action',
            ephemeral: true
          });
          break;
      }
    } catch (error) {
      logger.error('Error in record command:', error);

      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: `❌ **Error:** ${errorMessage}`,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: `❌ **Error:** ${errorMessage}`,
          ephemeral: true
        });
      }
    }
  }
};

async function handleStartRecording(
  interaction: CommandInteraction,
  voiceChannel: VoiceChannel,
  member: GuildMember
): Promise<void> {
  const result = await recordingManager.startRecording(voiceChannel, member);

  const embed = new EmbedBuilder()
    .setTitle('🎙️ Recording Started')
    .setDescription(result.message)
    .setColor(0x00ff00)
    .addFields(
      { name: 'Channel', value: `<#${voiceChannel.id}>`, inline: true },
      { name: 'Started by', value: `<@${member.id}>`, inline: true },
      { name: 'Session ID', value: `\`${result.sessionId}\``, inline: false }
    )
    .setTimestamp()
    .setFooter({ text: 'Phase 1 Testing - Audio stored in memory' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleStopRecording(
  interaction: CommandInteraction,
  voiceChannel: VoiceChannel,
  member: GuildMember,
  saveFiles: boolean,
  autoTranscribe: boolean,
  autoUpload: boolean
): Promise<void> {
  const result = await recordingManager.stopRecording(voiceChannel.id, saveFiles, autoTranscribe);

  const embed = new EmbedBuilder()
    .setTitle('🛑 Recording Stopped')
    .setDescription(result.message)
    .setColor(0xff0000)
    .addFields(
      { name: 'Duration', value: `${result.duration} seconds`, inline: true },
      { name: 'Participants', value: result.participants.toString(), inline: true }
    )
    .setTimestamp();

  if (result.exportedRecording) {
    embed.addFields(
      { name: 'Output Directory', value: `\`${result.exportedRecording.outputDirectory}\``, inline: false },
      { name: 'Audio Files', value: result.exportedRecording.tracks.length.toString(), inline: true },
      { name: 'Total Size', value: formatBytes(result.exportedRecording.totalSize), inline: true }
    );

    if (result.transcript) {
      embed.addFields(
        { name: 'Transcript', value: `${result.transcript.wordCount} words (${(result.transcript.averageConfidence * 100).toFixed(1)}% confidence)`, inline: false }
      );
      embed.setFooter({ text: 'Phase 2B - Audio + Transcription saved!' });
    } else {
      embed.setFooter({ text: 'Phase 2A - Audio files saved to disk!' });
    }

    // Auto-upload if requested
    if (autoUpload) {
      try {
        embed.addFields({ name: 'Status', value: '📤 Uploading to platform...', inline: false });
        await interaction.editReply({ embeds: [embed] });

        const uploadResult = await recordingManager.uploadRecording(
          result.exportedRecording,
          voiceChannel,
          member
        );

        if (uploadResult.success) {
          embed.spliceFields(-1, 1); // Remove "Uploading..." field
          embed.addFields(
            { name: 'Upload', value: '✅ Uploaded to platform', inline: false },
            { name: 'Recording ID', value: uploadResult.recordingId || 'N/A', inline: true }
          );
          if (uploadResult.viewUrl) {
            embed.addFields({ name: 'View URL', value: uploadResult.viewUrl, inline: false });
          }
          embed.setFooter({ text: 'Recording saved and uploaded!' });
        } else {
          embed.spliceFields(-1, 1);
          embed.addFields({ name: 'Upload', value: `❌ Upload failed: ${uploadResult.error}`, inline: false });
        }
      } catch (error) {
        logger.error('Auto-upload failed:', error);
        embed.spliceFields(-1, 1);
        embed.addFields({
          name: 'Upload',
          value: `❌ Upload error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          inline: false
        });
      }
    }
  } else {
    embed.setFooter({ text: 'Memory only - Use "stop-save" to save files' });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleGetStatus(
  interaction: CommandInteraction,
  channelId?: string
): Promise<void> {
  const activeSessions = recordingManager.getActiveSessions();
  const totalMemoryUsage = recordingManager.getTotalMemoryUsage();

  const embed = new EmbedBuilder()
    .setTitle('📊 Recording Status')
    .setColor(0x0099ff)
    .setTimestamp();

  if (activeSessions.length === 0) {
    embed.setDescription('No active recording sessions');
  } else {
    embed.setDescription(`**Active Sessions:** ${activeSessions.length}`);

    // Add current channel status if provided
    if (channelId) {
      const status = recordingManager.getRecordingStatus(channelId);
      if (status.isRecording) {
        embed.addFields({
          name: 'Current Channel',
          value: [
            `**Session:** \`${status.sessionId}\``,
            `**Duration:** ${Math.round((status.duration || 0) / 1000)}s`,
            `**Users:** ${status.stats?.users || 0}`,
            `**Participants:** ${status.stats?.participants || 0}`,
            `**Memory Usage:** ${formatBytes(status.stats?.memoryUsage || 0)}`
          ].join('\n'),
          inline: false
        });
      } else {
        embed.addFields({
          name: 'Current Channel',
          value: 'Not recording',
          inline: true
        });
      }
    }

    // Add global stats
    embed.addFields({
      name: 'Global Stats',
      value: [
        `**Total Sessions:** ${activeSessions.length}`,
        `**Total Memory Usage:** ${formatBytes(totalMemoryUsage)}`
      ].join('\n'),
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}
