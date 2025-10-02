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
import { config } from '../utils/config';
import { transcriptionStorage } from '../services/storage/TranscriptionStorage';
import * as fs from 'fs/promises';
import * as path from 'path';

// Singleton instance
const recordingManager = new RecordingManager();

export const recordTestCommand = {
  name: 'record-test',
  description: 'Test voice recording functionality with file export',
  options: [
    {
      name: 'action',
      description: 'Recording action to perform',
      type: 3, // STRING type
      required: true,
      choices: [
        { name: 'start', value: 'start' },
        { name: 'stop', value: 'stop' },
        { name: 'stop-save', value: 'stop-save' },
        { name: 'status', value: 'status' },
        { name: 'list-files', value: 'list-files' },
        { name: 'transcribe', value: 'transcribe' },
        { name: 'view-transcript', value: 'view-transcript' }
      ]
    },
    {
      name: 'session-id',
      description: 'Session ID (required for transcribe/view-transcript)',
      type: 3, // STRING type
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

    // Check if user is in a voice channel
    const voiceChannel = member.voice.channel as VoiceChannel;
    if (!voiceChannel && (action === 'start' || action === 'stop')) {
      await interaction.reply({
        content: '❌ You must be in a voice channel to use this command',
        ephemeral: true
      });
      return;
    }

    try {
      switch (action) {
        case 'start':
          await handleStartRecording(interaction, voiceChannel, member);
          break;
        case 'stop':
          await handleStopRecording(interaction, voiceChannel.id, false, false);
          break;
        case 'stop-save':
          await handleStopRecording(interaction, voiceChannel.id, true, config.RECORDING_AUTO_TRANSCRIBE);
          break;
        case 'status':
          await handleGetStatus(interaction, voiceChannel?.id);
          break;
        case 'list-files':
          await handleListFiles(interaction);
          break;
        case 'transcribe':
          await handleTranscribe(interaction);
          break;
        case 'view-transcript':
          await handleViewTranscript(interaction);
          break;
        default:
          await interaction.reply({
            content: '❌ Invalid action',
            ephemeral: true
          });
          break;
      }
    } catch (error) {
      logger.error('Error in record-test command:', error);

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
  await interaction.deferReply();

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
  channelId: string,
  saveFiles: boolean,
  autoTranscribe: boolean
): Promise<void> {
  await interaction.deferReply();

  const result = await recordingManager.stopRecording(channelId, saveFiles, autoTranscribe);

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

async function handleListFiles(interaction: CommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const recordingsDir = './recordings';
    const entries = await fs.readdir(recordingsDir, { withFileTypes: true });
    const sessionDirs = entries.filter(e => e.isDirectory());

    if (sessionDirs.length === 0) {
      await interaction.editReply({
        content: '📂 No recordings found in `./recordings/`'
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('📂 Saved Recordings')
      .setDescription(`Found ${sessionDirs.length} session(s)`)
      .setColor(0x0099ff)
      .setTimestamp();

    for (const sessionDir of sessionDirs.slice(0, 10)) { // Limit to 10 most recent
      const sessionPath = path.join(recordingsDir, sessionDir.name);
      const files = await fs.readdir(sessionPath);
      const audioFiles = files.filter(f =>
        f.endsWith('.wav') || f.endsWith('.flac') || f.endsWith('.mp3')
      );

      let totalSize = 0;
      for (const file of audioFiles) {
        const stats = await fs.stat(path.join(sessionPath, file));
        totalSize += stats.size;
      }

      embed.addFields({
        name: `Session: ${sessionDir.name.slice(0, 16)}...`,
        value: [
          `**Files:** ${audioFiles.length}`,
          `**Size:** ${formatBytes(totalSize)}`,
          `**Path:** \`${sessionPath}\``
        ].join('\n'),
        inline: false
      });
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    logger.error('Error listing files:', error);
    await interaction.editReply({
      content: '❌ Failed to list recordings. The directory may not exist yet.'
    });
  }
}

async function handleTranscribe(interaction: CommandInteraction): Promise<void> {
  const sessionId = (interaction as ChatInputCommandInteraction).options.getString('session-id');

  if (!sessionId) {
    await interaction.reply({
      content: '❌ Please provide a session-id for transcription',
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply();

  try {
    // Check if already transcribed
    const hasTranscript = await recordingManager.hasTranscript(sessionId);
    if (hasTranscript) {
      await interaction.editReply({
        content: `⚠️ Session \`${sessionId}\` has already been transcribed. Use \`view-transcript\` to view it.`
      });
      return;
    }

    const progressEmbed = new EmbedBuilder()
      .setTitle('🔄 Transcribing...')
      .setDescription(`Processing session \`${sessionId}\`\n\nThis may take a few minutes depending on the length of the recording.`)
      .setColor(0xffaa00)
      .setTimestamp();

    await interaction.editReply({ embeds: [progressEmbed] });

    // Transcribe the session
    const transcript = await recordingManager.transcribeSession(sessionId);

    const resultEmbed = new EmbedBuilder()
      .setTitle('✅ Transcription Complete')
      .setDescription(`Session \`${sessionId}\` has been transcribed successfully!`)
      .setColor(0x00ff00)
      .addFields(
        { name: 'Word Count', value: transcript.wordCount.toString(), inline: true },
        { name: 'Participants', value: transcript.participantCount.toString(), inline: true },
        { name: 'Confidence', value: `${(transcript.averageConfidence * 100).toFixed(1)}%`, inline: true },
        { name: 'Duration', value: formatDuration(transcript.duration), inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Use view-transcript to read the full transcript' });

    await interaction.editReply({ embeds: [resultEmbed] });

  } catch (error) {
    logger.error('Transcription error:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    await interaction.editReply({
      content: `❌ **Transcription failed:** ${errorMsg}`
    });
  }
}

async function handleViewTranscript(interaction: CommandInteraction): Promise<void> {
  const sessionId = (interaction as ChatInputCommandInteraction).options.getString('session-id');

  if (!sessionId) {
    await interaction.reply({
      content: '❌ Please provide a session-id to view transcript',
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Load transcript
    const transcript = await recordingManager.loadTranscript(sessionId);

    if (!transcript) {
      await interaction.editReply({
        content: `❌ No transcript found for session \`${sessionId}\`.\n\nUse \`/record-test action:transcribe session-id:${sessionId}\` to create one.`
      });
      return;
    }

    // Create embed with summary
    const embed = new EmbedBuilder()
      .setTitle('📝 Session Transcript')
      .setDescription(`Session \`${sessionId}\``)
      .setColor(0x0099ff)
      .addFields(
        { name: 'Transcribed', value: new Date(transcript.transcribedAt).toLocaleString(), inline: false },
        { name: 'Word Count', value: transcript.wordCount.toString(), inline: true },
        { name: 'Participants', value: transcript.participantCount.toString(), inline: true },
        { name: 'Confidence', value: `${(transcript.averageConfidence * 100).toFixed(1)}%`, inline: true },
        { name: 'Duration', value: formatDuration(transcript.duration), inline: true }
      )
      .setTimestamp();

    // Generate formatted markdown
    const formatted = transcriptionStorage.generateFormattedTranscript(transcript);

    // Create attachment
    const attachment = new AttachmentBuilder(Buffer.from(formatted, 'utf-8'), {
      name: `transcript_${sessionId}.md`
    });

    await interaction.editReply({
      embeds: [embed],
      files: [attachment]
    });

  } catch (error) {
    logger.error('View transcript error:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    await interaction.editReply({
      content: `❌ **Failed to load transcript:** ${errorMsg}`
    });
  }
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