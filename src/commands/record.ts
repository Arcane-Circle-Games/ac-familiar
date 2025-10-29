import {
  CommandInteraction,
  GuildMember,
  EmbedBuilder,
  VoiceChannel,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  // @ts-expect-error - Reserved for future transcription features
  AttachmentBuilder
} from 'discord.js';
import { RecordingManager } from '../services/recording/RecordingManager';
import { logger } from '../utils/logger';
import { arcaneAPI } from '../services/api';
import { config } from '../utils/config';
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
    },
    {
      name: 'game',
      description: 'Select one of your games',
      type: 3, // STRING type
      required: false,
      autocomplete: true
    },
    {
      name: 'session',
      description: 'Select a session from the chosen game',
      type: 3, // STRING type
      required: false,
      autocomplete: true
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
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focusedOption = interaction.options.getFocused(true);

    try {
      // Get platform user
      const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
      if (!user) {
        return interaction.respond([
          { name: 'Link your Discord account first (/link)', value: 'not_linked' }
        ]);
      }

      // STEP 1: Game autocomplete
      if (focusedOption.name === 'game') {
        const games = await arcaneAPI.games.listGames({
          gmId: user.id,
          status: 'PUBLISHED'
        });

        if (!games || games.length === 0) {
          return interaction.respond([
            { name: 'No games found', value: 'no_games' }
          ]);
        }

        const choices = games
          .map(game => ({
            name: game.title.substring(0, 100),
            value: game.id
          }))
          .filter(choice =>
            choice.name.toLowerCase().includes(focusedOption.value.toLowerCase())
          )
          .slice(0, 25);

        return interaction.respond(choices);
      }

      // STEP 2: Session autocomplete (filtered by selected game)
      if (focusedOption.name === 'session') {
        const selectedGameId = interaction.options.getString('game');

        if (!selectedGameId) {
          return interaction.respond([
            { name: 'Select a game first', value: 'no_game_selected' }
          ]);
        }

        const sessions = await arcaneAPI.sessions.getGameSessions(
          selectedGameId,
          interaction.user.id
        );

        // Filter to scheduled/active only
        const activeSessions = sessions.filter(s =>
          s.status === 'scheduled' || s.status === 'active'
        );

        if (activeSessions.length === 0) {
          return interaction.respond([
            { name: 'No sessions found for this game', value: 'no_sessions' }
          ]);
        }

        const choices = activeSessions.map(session => {
          const date = new Date(session.scheduledFor).toLocaleDateString();
          const sessionNum = session.sessionNumber || '?';
          const name = `Session ${sessionNum} - ${date}`;

          return {
            name: name.substring(0, 100),
            value: session.id
          };
        })
        .filter(choice =>
          choice.name.toLowerCase().includes(focusedOption.value.toLowerCase())
        )
        .slice(0, 25);

        return interaction.respond(choices);
      }

    } catch (error) {
      logger.error('Autocomplete error:', error);
      return interaction.respond([
        { name: 'Error loading data', value: 'error' }
      ]);
    }
  }
};

async function handleStartRecording(
  interaction: CommandInteraction,
  voiceChannel: VoiceChannel,
  member: GuildMember
): Promise<void> {
  const sessionId = (interaction as ChatInputCommandInteraction)
    .options.getString('session', false);

  // Validate session if provided
  let validSessionId: string | undefined;
  if (sessionId && !['not_linked', 'no_game_selected', 'no_sessions', 'error', 'no_games'].includes(sessionId)) {
    validSessionId = sessionId;
  }

  await recordingManager.startRecording(voiceChannel, member, validSessionId);

  const embed = new EmbedBuilder()
    .setTitle('🎙️ Recording Started')
    .setDescription(`Now recording <#${voiceChannel.id}>. Use \`/record stop\` when finished.`)
    .setColor(0x00ff00)
    .setTimestamp();

  if (validSessionId) {
    embed.addFields({
      name: '🎮 Linked Session',
      value: `[View Session](${config.PLATFORM_WEB_URL}/sessions/${validSessionId})`,
      inline: false
    });
  }

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

  // Format duration in minutes and seconds
  const minutes = Math.floor(result.duration / 60);
  const seconds = result.duration % 60;
  const durationText = minutes > 0
    ? `${minutes}m ${seconds}s`
    : `${seconds}s`;

  const embed = new EmbedBuilder()
    .setTitle('🛑 Recording Stopped')
    .setDescription(`Recorded ${result.participants} ${result.participants === 1 ? 'person' : 'people'} for ${durationText}`)
    .setColor(0xff0000)
    .setTimestamp();

  // Check if recording was already uploaded via streaming upload flow
  if (result.recordingId && result.viewUrl) {
    // Recording already uploaded and finalized via streaming
    embed.setDescription(`✅ Recording uploaded successfully!\n\nRecorded ${result.participants} ${result.participants === 1 ? 'person' : 'people'} for ${durationText}`);
    embed.addFields({
      name: '🎧 Listen & Manage',
      value: result.viewUrl,
      inline: false
    });
  } else if (result.exportedRecording && autoUpload) {
    // Batch upload flow (fallback or old implementation)
    embed.addFields({ name: 'Status', value: '📤 Uploading to Arcane Circle...', inline: false });
    await interaction.editReply({ embeds: [embed] });

    try {
      const uploadResult = await recordingManager.uploadRecording(
        result.exportedRecording,
        voiceChannel,
        member
      );

      // Update embed with final status
      embed.spliceFields(0, 1); // Remove status field

      if (uploadResult.success) {
        embed.setDescription(`✅ Recording uploaded successfully!\n\nRecorded ${result.participants} ${result.participants === 1 ? 'person' : 'people'} for ${durationText}`);

        if (uploadResult.viewUrl) {
          embed.addFields({
            name: '🎧 Listen & Manage',
            value: uploadResult.viewUrl,
            inline: false
          });
        }
      } else {
        embed.setDescription(`⚠️ Recording saved but upload failed.\n\nRecorded ${result.participants} ${result.participants === 1 ? 'person' : 'people'} for ${durationText}`);
        embed.addFields({
          name: 'Error',
          value: uploadResult.error || 'Unknown error',
          inline: false
        });
      }
    } catch (error) {
      logger.error('Upload failed:', error);
      embed.spliceFields(0, 1);
      embed.setDescription(`⚠️ Recording saved but upload failed.\n\nRecorded ${result.participants} ${result.participants === 1 ? 'person' : 'people'} for ${durationText}`);
      embed.addFields({
        name: 'Error',
        value: error instanceof Error ? error.message : 'Unknown error',
        inline: false
      });
    }
  }

  await interaction.editReply({ embeds: [embed] });
}

