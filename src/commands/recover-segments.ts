import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { Command } from '../bot/client';
import { logInfo, logError } from '../utils/logger';
import { recordingUploadService } from '../services/upload/RecordingUploadService';
import * as fs from 'fs/promises';
import * as path from 'path';

interface SegmentFile {
  filePath: string;
  username: string;
  segmentIndex: number;
  fileSize: number;
}

export const recoverSegmentsCommand: Command = {
  name: 'recover-segments',
  description: '[ADMIN] Retry uploading failed segments from Railway temp storage',

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const sessionId = interaction.options.getString('session-id', true);
    const recordingId = interaction.options.getString('recording-id', true);

    logInfo('Starting segment recovery', {
      userId: interaction.user.id,
      sessionId,
      recordingId,
    });

    try {
      // Find all segment files in the session directory
      const sessionDir = `/tmp/recordings/${sessionId}`;

      // Check if directory exists
      try {
        await fs.access(sessionDir);
      } catch {
        return await interaction.editReply({
          content: `❌ Session directory not found: \`${sessionDir}\`\n\nThe files may have already been deleted or the container restarted.`,
        });
      }

      // Scan for all .wav files
      const segments = await scanForSegments(sessionDir);

      if (segments.length === 0) {
        return await interaction.editReply({
          content: `⚠️ No segment files found in \`${sessionDir}\``,
        });
      }

      await interaction.editReply({
        content: `🔍 Found ${segments.length} segment files. Starting upload recovery...\n\nThis may take a few minutes.`,
      });

      // Upload each segment
      const results = {
        success: 0,
        failed: 0,
        errors: [] as string[],
      };

      for (const segment of segments) {
        try {
          logInfo(`Recovering segment ${segment.segmentIndex} for ${segment.username}`);

          // Parse metadata from file
          const stats = await fs.stat(segment.filePath);

          // Estimate timing (we don't have real timing info, so use approximations)
          // Assume 48kHz, 2 channels, 16-bit (192000 bytes/sec)
          const audioBytes = stats.size - 44; // Subtract WAV header
          const durationMs = Math.round((audioBytes / 192000) * 1000);

          await recordingUploadService.uploadSegmentImmediately(
            recordingId,
            segment.filePath,
            {
              userId: 'unknown', // We don't have this info
              username: segment.username,
              segmentIndex: segment.segmentIndex,
              absoluteStartTime: Date.now(), // Placeholder
              absoluteEndTime: Date.now() + durationMs,
              duration: durationMs,
              format: 'wav',
            }
          );

          results.success++;
          logInfo(`✓ Recovered segment ${segment.segmentIndex} for ${segment.username}`);
        } catch (error: any) {
          results.failed++;
          const errorMsg = `${segment.username}/segment_${segment.segmentIndex}: ${error.message}`;
          results.errors.push(errorMsg);
          logError('Failed to recover segment', error);
        }
      }

      // Build result embed
      const embed = new EmbedBuilder()
        .setColor(results.failed === 0 ? 0x00ff00 : results.success > 0 ? 0xffaa00 : 0xff0000)
        .setTitle('🔄 Segment Recovery Results')
        .addFields(
          {
            name: '📊 Summary',
            value: `✅ Success: ${results.success}\n❌ Failed: ${results.failed}\n📁 Total: ${segments.length}`,
          },
          {
            name: '🆔 Recording ID',
            value: recordingId,
          }
        );

      if (results.errors.length > 0) {
        const errorText = results.errors.slice(0, 5).join('\n');
        const moreErrors = results.errors.length > 5 ? `\n...and ${results.errors.length - 5} more` : '';
        embed.addFields({
          name: '⚠️ Errors',
          value: `\`\`\`\n${errorText}${moreErrors}\n\`\`\``,
        });
      }

      if (results.success > 0) {
        embed.setDescription(
          '✅ Recovery partially or fully successful!\n\n' +
          '**Next Steps:**\n' +
          '1. Verify the recording on the platform\n' +
          '2. Check if transcription starts automatically\n' +
          '3. If needed, manually trigger finalization'
        );
      }

      await interaction.followUp({
        embeds: [embed],
        ephemeral: true,
      });

    } catch (error: any) {
      logError('Segment recovery failed', error);
      await interaction.editReply({
        content: `❌ Recovery failed: ${error.message}`,
      });
    }
  },
};

// Helper function to scan for segment files
async function scanForSegments(directory: string): Promise<SegmentFile[]> {
  const segments: SegmentFile[] = [];

  // Recursively find all .wav files
  async function scan(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.wav')) {
        // Parse username and segment index from path
        // Expected structure: /tmp/recordings/{sessionId}/{username}/{username}/segment_XXX.wav
        const parts = fullPath.split('/');
        const username = parts[parts.length - 2]; // Parent directory name
        const fileName = entry.name;

        // Extract segment index from filename (e.g., segment_928.wav -> 928)
        const match = fileName.match(/segment_(\d+)\.wav/);
        if (match) {
          const segmentIndex = parseInt(match[1], 10);
          const stats = await fs.stat(fullPath);

          segments.push({
            filePath: fullPath,
            username,
            segmentIndex,
            fileSize: stats.size,
          });
        }
      }
    }
  }

  await scan(directory);

  // Sort by username then segment index
  segments.sort((a, b) => {
    if (a.username !== b.username) {
      return a.username.localeCompare(b.username);
    }
    return a.segmentIndex - b.segmentIndex;
  });

  return segments;
}

// Export command builder for registration
export const recoverSegmentsCommandData = new SlashCommandBuilder()
  .setName('recover-segments')
  .setDescription('[ADMIN] Retry uploading failed segments from Railway temp storage')
  .addStringOption(option =>
    option
      .setName('session-id')
      .setDescription('Local session ID (e.g., b68fa19b-f137-4469-afb7-f2ac2557dd21)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('recording-id')
      .setDescription('API recording ID (e.g., 42f9678e-dced-4e77-90fc-28436cf7d8b1)')
      .setRequired(true)
  );
