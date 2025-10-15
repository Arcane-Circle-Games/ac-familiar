import {
  CommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { logger } from '../utils/logger';
import { Command } from '../bot/client';

export const transcribeCommand: Command = {
  name: 'transcribe',
  description: 'Get help with local transcription using your own Whisper setup',
  options: [],

  async execute(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      const guideEmbed = new EmbedBuilder()
        .setTitle('🎙️ Local Transcription Guide')
        .setDescription('Transcribe recordings on your own computer (free compute!)')
        .setColor(0x00aaff)
        .setTimestamp();

      // Workflow overview
      guideEmbed.addFields({
        name: '📋 Workflow',
        value: [
          '**1.** Record a session: `/record-test action:stop-save transcribe:false`',
          '**2.** Download files: `/download-recording session-id:{id}`',
          '**3.** Run local script: `node transcribe.js /path/to/files`',
          '**4.** Upload result: `/upload-transcript file:transcript.json`'
        ].join('\n'),
        inline: false
      });

      // Download transcribe script
      guideEmbed.addFields({
        name: '📥 Get the Transcription Script',
        value: [
          '```bash',
          '# Download the script',
          'curl -o transcribe.js https://github.com/your-repo/transcribe.js',
          '',
          '# Or use npx (no download needed)',
          'npx @arcanecircle/transcribe /path/to/files',
          '```'
        ].join('\n'),
        inline: false
      });

      // Benefits
      guideEmbed.addFields({
        name: '✨ Why Use Local Transcription?',
        value: [
          '• **Free** - No API costs, uses your computer',
          '• **Private** - Audio never leaves your machine',
          '• **Flexible** - Choose your own Whisper model size',
          '• **Fast** - Especially with GPU acceleration'
        ].join('\n'),
        inline: false
      });

      // Alternative
      guideEmbed.addFields({
        name: '☁️ Prefer Automatic?',
        value: 'Use cloud transcription: `/record-test action:stop-save transcribe:true`\n(Uses OpenAI API, costs apply)',
        inline: false
      });

      await interaction.editReply({ embeds: [guideEmbed] });

    } catch (error) {
      logger.error('Error in transcribe command:', error);

      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

      await interaction.editReply({
        content: `❌ **Error:** ${errorMessage}`
      });
    }
  }
};
