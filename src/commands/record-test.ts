import {
  CommandInteraction,
  GuildMember,
  EmbedBuilder,
  VoiceChannel,
  ChatInputCommandInteraction
} from 'discord.js';
import { RecordingManager } from '../services/recording/RecordingManager';
import { logger } from '../utils/logger';

// Singleton instance
const recordingManager = new RecordingManager();

export const recordTestCommand = {
  name: 'record-test',
  description: 'Test voice recording functionality (Phase 1)',
  options: [
    {
      name: 'action',
      description: 'Recording action to perform',
      type: 3, // STRING type
      required: true,
      choices: [
        { name: 'start', value: 'start' },
        { name: 'stop', value: 'stop' },
        { name: 'status', value: 'status' }
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
          await handleStopRecording(interaction, voiceChannel.id);
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
  channelId: string
): Promise<void> {
  await interaction.deferReply();

  const result = await recordingManager.stopRecording(channelId);

  const embed = new EmbedBuilder()
    .setTitle('🛑 Recording Stopped')
    .setDescription(result.message)
    .setColor(0xff0000)
    .addFields(
      { name: 'Duration', value: `${result.duration} seconds`, inline: true },
      { name: 'Audio Segments', value: result.segments.toString(), inline: true },
      { name: 'Participants', value: result.participants.toString(), inline: true }
    )
    .setTimestamp()
    .setFooter({ text: 'Phase 1 Testing - Audio stored in memory' });

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
            `**Segments:** ${status.stats?.segments || 0}`,
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