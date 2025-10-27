import {
  CommandInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  AttachmentBuilder
} from 'discord.js';
import { logger } from '../utils/logger';
import { transcriptUploadService } from '../services/transcription/TranscriptUploadService';
import { transcriptionStorage } from '../services/storage/TranscriptionStorage';
import { formatDuration } from '../utils/formatters';
import { Command } from '../bot/client';

export const uploadTranscriptCommand: Command = {
  name: 'upload-transcript',
  description: 'Upload a locally-generated transcript to the platform',
  options: [
    {
      name: 'file',
      description: 'Transcript JSON file (enhanced manifest with transcription data)',
      type: 11, // ATTACHMENT type
      required: true
    },
    {
      name: 'recording-id',
      description: 'Recording ID (if audio was already uploaded to platform)',
      type: 3, // STRING type
      required: false
    }
  ],

  async execute(interaction: CommandInteraction): Promise<void> {
    const chatInteraction = interaction as ChatInputCommandInteraction;

    // Defer reply immediately (processing may take time)
    await interaction.deferReply();

    try {
      // Get attachment
      const attachment = chatInteraction.options.getAttachment('file', true);
      const recordingId = chatInteraction.options.getString('recording-id');

      logger.info('Processing transcript upload', {
        userId: interaction.user.id,
        filename: attachment.name,
        size: attachment.size,
        recordingId
      });

      // Validate file type
      if (!attachment.name.endsWith('.json')) {
        await interaction.editReply({
          content: '❌ **Error:** File must be a JSON file (transcript.json or manifest.json)'
        });
        return;
      }

      // Download and parse JSON
      const progressEmbed = new EmbedBuilder()
        .setTitle('📥 Processing Transcript...')
        .setDescription('Downloading and parsing transcript file...')
        .setColor(0xffaa00)
        .setTimestamp();

      await interaction.editReply({ embeds: [progressEmbed] });

      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new Error(`Failed to download attachment: ${response.statusText}`);
      }

      const jsonText = await response.text();
      const jsonData = JSON.parse(jsonText);

      logger.debug('Transcript file downloaded and parsed', {
        sessionId: jsonData.sessionId,
        segmentCount: jsonData.segments?.length
      });

      // Update progress
      progressEmbed.setDescription('Converting transcript to platform format...');
      await interaction.editReply({ embeds: [progressEmbed] });

      // Process and upload
      const result = await transcriptUploadService.processAndUpload(
        jsonData,
        interaction.user.id,
        recordingId || undefined
      );

      if (!result.success) {
        await interaction.editReply({
          content: `❌ **Upload failed:** ${result.error}`
        });
        return;
      }

      // Success!
      const sessionTranscript = result.sessionTranscript!;
      const avgConfidence = (sessionTranscript.averageConfidence * 100).toFixed(1);
      const duration = formatDuration(sessionTranscript.duration);

      const successEmbed = new EmbedBuilder()
        .setTitle('✅ Transcript Uploaded Successfully')
        .setDescription(`Session \`${sessionTranscript.sessionId}\` has been uploaded to the platform!`)
        .setColor(0x00ff00)
        .addFields(
          { name: 'Transcription ID', value: `\`${result.transcriptionId}\``, inline: false },
          { name: 'Word Count', value: sessionTranscript.wordCount.toString(), inline: true },
          { name: 'Participants', value: sessionTranscript.participantCount.toString(), inline: true },
          { name: 'Confidence', value: `${avgConfidence}%`, inline: true },
          { name: 'Duration', value: duration, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Local Whisper → Platform Upload' });

      if (recordingId) {
        successEmbed.addFields({
          name: 'Recording ID',
          value: `\`${recordingId}\``,
          inline: false
        });
      }

      // Create formatted transcript attachment
      const formattedTranscript = transcriptionStorage.generateFormattedTranscript(sessionTranscript);
      const transcriptAttachment = new AttachmentBuilder(
        Buffer.from(formattedTranscript, 'utf-8'),
        { name: `transcript_${sessionTranscript.sessionId}.md` }
      );

      await interaction.editReply({
        embeds: [successEmbed],
        files: [transcriptAttachment]
      });

      logger.info('Transcript upload completed successfully', {
        userId: interaction.user.id,
        sessionId: sessionTranscript.sessionId,
        transcriptionId: result.transcriptionId,
        wordCount: sessionTranscript.wordCount
      });

    } catch (error) {
      logger.error('Error in upload-transcript command:', error);

      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

      await interaction.editReply({
        content: `❌ **Error:** ${errorMessage}`
      });
    }
  }
};
