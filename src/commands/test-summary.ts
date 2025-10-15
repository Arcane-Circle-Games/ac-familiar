import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  AttachmentBuilder
} from 'discord.js';
import { transcriptionStorage } from '../services/storage/TranscriptionStorage';
import { logger } from '../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

export const testSummaryCommand = {
  name: 'test-summary',
  description: 'Test session summary file reading and formatting',
  options: [
    {
      name: 'action',
      description: 'Test action to perform',
      type: 3, // STRING
      required: true,
      choices: [
        { name: 'list-sessions', value: 'list-sessions' },
        { name: 'read-summary', value: 'read-summary' },
        { name: 'format-preview', value: 'format-preview' }
      ]
    },
    {
      name: 'session-id',
      description: 'Session ID (required for read-summary and format-preview)',
      type: 3, // STRING
      required: false
    }
  ],

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      const action = interaction.options.getString('action', true);
      const sessionId = interaction.options.getString('session-id');

      switch (action) {
        case 'list-sessions':
          await handleListSessions(interaction);
          break;
        case 'read-summary':
          if (!sessionId) {
            await interaction.editReply('❌ session-id is required for this action');
            return;
          }
          await handleReadSummary(interaction, sessionId);
          break;
        case 'format-preview':
          if (!sessionId) {
            await interaction.editReply('❌ session-id is required for this action');
            return;
          }
          await handleFormatPreview(interaction, sessionId);
          break;
        default:
          await interaction.editReply('❌ Invalid action');
          break;
      }
    } catch (error) {
      logger.error('Error in test-summary command:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      await interaction.editReply(`❌ **Error:** ${errorMessage}`);
    }
  }
};

async function handleListSessions(interaction: ChatInputCommandInteraction): Promise<void> {
  const recordingsDir = './recordings';

  try {
    // Check if recordings directory exists
    try {
      await fs.access(recordingsDir);
    } catch {
      await interaction.editReply({
        content: '📂 No recordings directory found. Record a session first using `/record-test`.'
      });
      return;
    }

    // Read all session directories
    const entries = await fs.readdir(recordingsDir, { withFileTypes: true });
    const sessionDirs = entries.filter(e => e.isDirectory());

    if (sessionDirs.length === 0) {
      await interaction.editReply({
        content: '📂 No recording sessions found in `./recordings/`'
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('📝 Available Session Summaries')
      .setDescription(`Found ${sessionDirs.length} session(s) with potential summaries`)
      .setColor(0x0099ff)
      .setTimestamp();

    // Check each session for summary files
    const sessionsWithSummaries: Array<{
      sessionId: string;
      hasJson: boolean;
      hasMd: boolean;
      audioFiles: number;
    }> = [];

    for (const sessionDir of sessionDirs.slice(0, 10)) {
      const sessionPath = path.join(recordingsDir, sessionDir.name);
      const files = await fs.readdir(sessionPath);

      const hasJson = files.some(f => (f.includes('summary') || f.includes('transcript')) && f.endsWith('.json'));
      const hasMd = files.some(f => (f.includes('summary') || f.includes('transcript')) && f.endsWith('.md'));
      const audioFiles = files.filter(f => f.endsWith('.wav') || f.endsWith('.mp3') || f.endsWith('.flac')).length;

      sessionsWithSummaries.push({
        sessionId: sessionDir.name,
        hasJson,
        hasMd,
        audioFiles
      });

      const status = hasJson ? '✅' : '⚠️';
      const sessionIdShort = sessionDir.name.slice(0, 8) + '...' + sessionDir.name.slice(-4);

      embed.addFields({
        name: `${status} ${sessionIdShort}`,
        value: [
          `**Full ID:** \`${sessionDir.name}\``,
          `**Summary JSON:** ${hasJson ? '✓' : '✗'}`,
          `**Summary MD:** ${hasMd ? '✓' : '✗'}`,
          `**Audio Files:** ${audioFiles}`
        ].join('\n'),
        inline: false
      });
    }

    if (sessionDirs.length > 10) {
      embed.setFooter({ text: `Showing first 10 of ${sessionDirs.length} sessions` });
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    logger.error('Error listing sessions:', error);
    await interaction.editReply({
      content: `❌ Failed to list sessions: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
}

async function handleReadSummary(interaction: ChatInputCommandInteraction, sessionId: string): Promise<void> {
  const recordingsDir = './recordings';

  try {
    logger.info(`Reading summary for session ${sessionId}`);

    // Try to load the summary
    const summary = await transcriptionStorage.loadTranscript(sessionId, recordingsDir);

    if (!summary) {
      await interaction.editReply({
        content: `❌ No summary found for session \`${sessionId}\`.\n\n**Troubleshooting:**\n1. Make sure the session ID is correct\n2. Check that the session has been summarized\n3. Verify the session directory exists in \`./recordings/${sessionId}/\``
      });
      return;
    }

    // Create success embed with summary details
    const embed = new EmbedBuilder()
      .setTitle('✅ Session Summary Found!')
      .setDescription(`Successfully loaded summary for session \`${sessionId}\``)
      .setColor(0x00ff00)
      .addFields(
        { name: 'Created At', value: new Date(summary.transcribedAt).toLocaleString(), inline: false },
        { name: 'Duration', value: formatDuration(summary.duration), inline: true },
        { name: 'Word Count', value: summary.wordCount.toString(), inline: true },
        { name: 'Participants', value: summary.participantCount.toString(), inline: true },
        { name: 'Avg Confidence', value: `${(summary.averageConfidence * 100).toFixed(1)}%`, inline: true },
        { name: 'Segments', value: summary.userTranscripts.reduce((sum, ut) => sum + ut.segments.length, 0).toString(), inline: true }
      )
      .setTimestamp();

    // Add participant details
    const participants = summary.userTranscripts.map(ut =>
      `• **${ut.username}** - ${ut.wordCount} words (${ut.segments.length} segments)`
    ).join('\n');

    if (participants.length < 1024) {
      embed.addFields({ name: 'Participants Breakdown', value: participants, inline: false });
    }

    // Preview first 500 characters of summary
    const preview = summary.fullTranscript.substring(0, 500) + '...';
    embed.addFields({ name: 'Preview', value: `\`\`\`\n${preview}\n\`\`\``, inline: false });

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    logger.error('Error reading summary:', error);
    await interaction.editReply({
      content: `❌ Failed to read summary: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
}

async function handleFormatPreview(interaction: ChatInputCommandInteraction, sessionId: string): Promise<void> {
  const recordingsDir = './recordings';

  try {
    logger.info(`Formatting session summary preview for session ${sessionId}`);

    // Load the summary
    const summary = await transcriptionStorage.loadTranscript(sessionId, recordingsDir);

    if (!summary) {
      await interaction.editReply({
        content: `❌ No summary found for session \`${sessionId}\``
      });
      return;
    }

    // Generate formatted summary (what would be posted to wiki)
    const formattedSummary = transcriptionStorage.generateFormattedTranscript(summary);

    // Create summary embed
    const embed = new EmbedBuilder()
      .setTitle('📄 Formatted Session Summary Preview')
      .setDescription(`This is how the session summary will appear when posted to the wiki`)
      .setColor(0x0099ff)
      .addFields(
        { name: 'Session ID', value: `\`${sessionId}\``, inline: false },
        { name: 'Title', value: `Session Notes - ${new Date(summary.transcribedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, inline: false },
        { name: 'Content Size', value: `${formattedSummary.length} characters`, inline: true },
        { name: 'Word Count', value: summary.wordCount.toString(), inline: true }
      )
      .setTimestamp();

    // Create attachment with full formatted summary
    const attachment = new AttachmentBuilder(Buffer.from(formattedSummary, 'utf-8'), {
      name: `formatted_summary_${sessionId.slice(0, 8)}.md`
    });

    await interaction.editReply({
      embeds: [embed],
      files: [attachment]
    });

    logger.info(`Successfully generated formatted summary preview for ${sessionId}`);

  } catch (error) {
    logger.error('Error formatting summary preview:', error);
    await interaction.editReply({
      content: `❌ Failed to format summary: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
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
