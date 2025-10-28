import {
  CommandInteraction,
  GuildMember,
  EmbedBuilder,
  VoiceChannel,
  ChatInputCommandInteraction,
  // @ts-expect-error - Reserved for future transcription features
  AttachmentBuilder
} from 'discord.js';
import { RecordingManager } from '../services/recording/RecordingManager';
import { logger } from '../utils/logger';
// @ts-expect-error - Reserved for future transcription features
import { transcriptionStorage } from '../services/storage/TranscriptionStorage';
// @ts-expect-error - Reserved for future transcription features
import { recordingUploadService } from '../services/upload/RecordingUploadService';
// @ts-expect-error - Reserved for future transcription features
import { recordingService } from '../services/api/recordings';
// @ts-expect-error - Reserved for future transcription features
import { formatBytes, formatDuration } from '../utils/formatters';
import * as fs from 'fs/promises';
// @ts-expect-error - Reserved for future transcription features
import * as path from 'path';

/**
 * Calculate duration from WAV file by reading header
 * TODO: Used in future transcription features
 */
// @ts-expect-error - Reserved for future transcription features
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
  description: 'Record voice channel audio (automatically uploads to platform)',
  options: [
    {
      name: 'action',
      description: 'Recording action to perform',
      type: 3, // STRING type
      required: true,
      choices: [
        { name: 'Start Recording', value: 'start' },
        { name: 'Stop Recording', value: 'stop' }
      ]
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

    // Check if user is in a voice channel
    const voiceChannel = member.voice.channel as VoiceChannel;
    if (!voiceChannel) {
      await interaction.reply({
        content: '❌ You must be in a voice channel to use this command',
        ephemeral: true
      });
      return;
    }

    // Defer reply immediately for long-running actions
    await interaction.deferReply();

    try {
      switch (action) {
        case 'start':
          await handleStartRecording(interaction, voiceChannel, member);
          break;
        case 'stop':
          // Always save and upload (transcription handled by platform)
          await handleStopRecording(interaction, voiceChannel, member, true, false, true);
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

