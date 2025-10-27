import {
  CommandInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { logger } from '../utils/logger';
import { formatDuration } from '../utils/formatters';
import { Command } from '../bot/client';
import { recordingService } from '../services/api/recordings';

export const downloadRecordingCommand: Command = {
  name: 'download-recording',
  description: 'Download a recording session for local transcription',
  options: [
    {
      name: 'session-id',
      description: 'Session ID to download',
      type: 3, // STRING
      required: true
    }
  ],

  async execute(interaction: CommandInteraction): Promise<void> {
    const chatInteraction = interaction as ChatInputCommandInteraction;
    const sessionId = chatInteraction.options.getString('session-id', true);

    await interaction.deferReply({ ephemeral: true });

    try {
      logger.info('Downloading recording', {
        userId: interaction.user.id,
        sessionId
      });

      // Get recording details from API
      const recording = await recordingService.getRecordingDetails(sessionId);

      if (!recording) {
        await interaction.editReply({
          content: `❌ **Error:** Recording not found for session \`${sessionId}\``
        });
        return;
      }

      // Check if user has access (basic check - you might want more sophisticated auth)
      // For now, we'll allow anyone to download

      // Create download embed with instructions
      const embed = new EmbedBuilder()
        .setTitle('📥 Download Recording for Local Transcription')
        .setDescription(`**Session:** \`${sessionId}\``)
        .setColor(0x00aaff)
        .setTimestamp();

      // Add audio file download links
      if (recording.downloadUrls?.audio && recording.downloadUrls.audio.length > 0) {
        const audioLinks = recording.downloadUrls.audio.map((url, index) => {
          return `[Audio Track ${index + 1}](${url})`;
        }).join(' • ');

        embed.addFields({
          name: '🎵 Audio Files',
          value: audioLinks,
          inline: false
        });
      } else {
        embed.addFields({
          name: '⚠️ Audio Files',
          value: 'No audio files available for this recording',
          inline: false
        });
      }

      // Add recording metadata
      embed.addFields(
        {
          name: '📊 Recording Info',
          value: [
            `**Duration:** ${formatDuration(recording.duration)}`,
            `**Participants:** ${recording.participantCount}`,
            `**Recorded:** ${new Date(recording.recordedAt).toLocaleString()}`
          ].join('\n'),
          inline: false
        }
      );

      // Add instructions for local transcription
      const instructions = [
        '**Next Steps:**',
        '',
        '1. Download all audio files above',
        '2. Download the transcription script:',
        '   `curl -o transcribe.js https://github.com/your-repo/transcribe.js`',
        '',
        '3. Place audio files in a folder',
        '',
        '4. Run the script:',
        '   `node transcribe.js /path/to/audio/folder`',
        '',
        '5. Upload the generated transcript:',
        '   `/upload-transcript file:transcript.json`',
        '',
        '**Alternative:** Use cloud transcription with `/record-test action:stop-save transcribe:true`'
      ].join('\n');

      embed.addFields({
        name: '📝 Instructions',
        value: instructions,
        inline: false
      });

      // Add link to view recording on platform
      if (recording.viewUrl) {
        embed.addFields({
          name: '🔗 View Online',
          value: `[Open on Platform](${recording.viewUrl})`,
          inline: false
        });
      }

      await interaction.editReply({ embeds: [embed] });

      logger.info('Recording download links sent', {
        userId: interaction.user.id,
        sessionId
      });

    } catch (error) {
      logger.error('Error in download-recording command:', error);

      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

      await interaction.editReply({
        content: `❌ **Error:** ${errorMessage}`
      });
    }
  }
};
