import {
  CommandInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  AttachmentBuilder,
  GuildMember
} from 'discord.js';
import { recordingManager } from './record';
import { logger } from '../utils/logger';
import { transcriptionStorage } from '../services/storage/TranscriptionStorage';
import { recordingUploadService } from '../services/upload/RecordingUploadService';
import { formatBytes, formatDuration } from '../utils/formatters';
import { requiresGuild } from '../utils/context';
import { Command } from '../bot/client';
import * as fs from 'fs/promises';
import * as path from 'path';

export const recordingsCommand: Command = {
  name: 'recordings',
  description: 'Manage and view your saved recordings',
  options: [
    {
      name: 'action',
      description: 'What would you like to do?',
      type: 3, // STRING type
      required: true,
      choices: [
        { name: 'List All Recordings', value: 'list' },
        { name: 'View Transcript', value: 'view-transcript' },
        { name: 'Transcribe Recording', value: 'transcribe' },
        { name: 'Upload to Platform', value: 'upload' }
      ]
    },
    {
      name: 'session-id',
      description: 'Session ID (required for most actions)',
      type: 3, // STRING type
      required: false
    }
  ],

  async execute(interaction: CommandInteraction): Promise<void> {
    const chatInteraction = interaction as ChatInputCommandInteraction;
    const action = chatInteraction.options.getString('action', true);
    const sessionId = chatInteraction.options.getString('session-id');

    // List doesn't need session ID, but others do
    if (action !== 'list' && !sessionId) {
      await interaction.reply({
        content: '❌ Please provide a session-id for this action',
        ephemeral: true
      });
      return;
    }

    // Defer reply for potentially long operations
    if (action === 'list') {
      await interaction.deferReply({ ephemeral: true });
    } else {
      await interaction.deferReply();
    }

    try {
      switch (action) {
        case 'list':
          await handleListRecordings(interaction);
          break;
        case 'view-transcript':
          await handleViewTranscript(interaction, sessionId!);
          break;
        case 'transcribe':
          await handleTranscribe(interaction, sessionId!);
          break;
        case 'upload':
          await handleUpload(interaction, sessionId!);
          break;
        default:
          await interaction.editReply({
            content: '❌ Invalid action'
          });
          break;
      }
    } catch (error) {
      logger.error('Error in recordings command:', error);

      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
          content: `❌ **Error:** ${errorMessage}`
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

async function handleListRecordings(interaction: CommandInteraction): Promise<void> {
  try {
    const recordingsDir = './recordings';
    const entries = await fs.readdir(recordingsDir, { withFileTypes: true });
    const sessionDirs = entries.filter(e => e.isDirectory());

    if (sessionDirs.length === 0) {
      await interaction.editReply({
        content: '📂 No recordings found.\n\nRecord a session using `/record action:stop-save` to create your first recording!'
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('📂 Your Saved Recordings')
      .setDescription(`Found ${sessionDirs.length} recording(s)`)
      .setColor(0x0099ff)
      .setTimestamp();

    for (const sessionDir of sessionDirs.slice(0, 10)) { // Limit to 10 most recent
      const sessionPath = path.join(recordingsDir, sessionDir.name);
      const files = await fs.readdir(sessionPath);
      const audioFiles = files.filter(f =>
        f.endsWith('.wav') || f.endsWith('.flac') || f.endsWith('.mp3')
      );
      const hasTranscript = files.some(f =>
        (f.includes('summary') || f.includes('transcript')) && f.endsWith('.json')
      );

      let totalSize = 0;
      for (const file of audioFiles) {
        const stats = await fs.stat(path.join(sessionPath, file));
        totalSize += stats.size;
      }

      const sessionIdShort = sessionDir.name.length > 16
        ? sessionDir.name.slice(0, 8) + '...' + sessionDir.name.slice(-4)
        : sessionDir.name;

      embed.addFields({
        name: `${hasTranscript ? '📝' : '🎙️'} ${sessionIdShort}`,
        value: [
          `**Session ID:** \`${sessionDir.name}\``,
          `**Audio Files:** ${audioFiles.length}`,
          `**Size:** ${formatBytes(totalSize)}`,
          `**Transcript:** ${hasTranscript ? '✅' : '❌'}`
        ].join('\n'),
        inline: false
      });
    }

    if (sessionDirs.length > 10) {
      embed.setFooter({ text: `Showing 10 of ${sessionDirs.length} recordings` });
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    logger.error('Error listing recordings:', error);
    await interaction.editReply({
      content: '❌ No recordings directory found. Record a session first using `/record action:stop-save`'
    });
  }
}

async function handleViewTranscript(interaction: CommandInteraction, sessionId: string): Promise<void> {
  try {
    // Load transcript
    const transcript = await recordingManager.loadTranscript(sessionId);

    if (!transcript) {
      await interaction.editReply({
        content: `❌ No transcript found for session \`${sessionId}\`.\n\nUse \`/recordings action:transcribe session-id:${sessionId}\` to create one.`
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

async function handleTranscribe(interaction: CommandInteraction, sessionId: string): Promise<void> {
  try {
    // Check if already transcribed
    const hasTranscript = await recordingManager.hasTranscript(sessionId);
    if (hasTranscript) {
      await interaction.editReply({
        content: `⚠️ Session \`${sessionId}\` has already been transcribed.\n\nUse \`/recordings action:view-transcript\` to view it.`
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
      .setFooter({ text: 'Use /recordings action:view-transcript to read it' });

    await interaction.editReply({ embeds: [resultEmbed] });

  } catch (error) {
    logger.error('Transcription error:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    await interaction.editReply({
      content: `❌ **Transcription failed:** ${errorMsg}`
    });
  }
}

async function handleUpload(interaction: CommandInteraction, sessionId: string): Promise<void> {
  try {
    // Upload requires guild context for metadata
    if (!(await requiresGuild(interaction, '❌ Upload requires server context for metadata. Please use this command in a server.'))) {
      return;
    }

    const member = interaction.member as GuildMember;
    const recordingsDir = './recordings';
    const sessionPath = path.join(recordingsDir, sessionId);

    // Check if session directory exists
    try {
      await fs.access(sessionPath);
    } catch {
      await interaction.editReply({
        content: `❌ Recording \`${sessionId}\` not found.\n\nUse \`/recordings action:list\` to see available recordings.`
      });
      return;
    }

    // Load exported recording manifest
    const manifestPath = path.join(sessionPath, 'manifest.json');
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent);

    // Build ExportedRecording object from manifest, filtering out missing files
    const allTracks = manifest.segments.map((seg: any) => ({
      filePath: seg.filePath
        ? path.join(sessionPath, seg.filePath)
        : path.join(sessionPath, seg.fileName),
      fileSize: seg.fileSize,
      format: seg.format || 'wav',
      metadata: {
        userId: seg.userId,
        username: seg.username,
        segmentIndex: seg.segmentIndex,
        startTime: seg.absoluteStartTime,
        endTime: seg.absoluteEndTime,
        duration: seg.duration,
        sampleRate: 48000,
        channels: 2
      }
    }));

    // Filter out tracks where the file doesn't exist
    const existingTracks = [];
    const missingTracks = [];

    for (const track of allTracks) {
      try {
        await fs.access(track.filePath);
        const stats = await fs.stat(track.filePath);
        const updatedTrack = { ...track, fileSize: stats.size };
        existingTracks.push(updatedTrack);
      } catch {
        missingTracks.push(track);
      }
    }

    if (existingTracks.length === 0) {
      await interaction.editReply({
        content: `❌ **No audio files found for session ${sessionId}**`
      });
      return;
    }

    const actualTotalSize = existingTracks.reduce((sum, t) => sum + t.fileSize, 0);

    const exportedRecording = {
      sessionId: manifest.sessionId,
      sessionStartTime: manifest.sessionStartTime,
      sessionEndTime: manifest.sessionEndTime,
      tracks: existingTracks,
      outputDirectory: sessionPath,
      totalSize: actualTotalSize,
      participantCount: new Set(existingTracks.map(t => t.metadata.userId)).size
    };

    const sessionDuration = manifest.sessionEndTime - manifest.sessionStartTime;

    const metadata = {
      sessionId: manifest.sessionId,
      guildId: interaction.guild!.id,
      guildName: interaction.guild!.name,
      channelId: member.voice.channel?.id || 'unknown',
      userId: member.id,
      duration: sessionDuration,
      recordedAt: new Date(manifest.sessionStartTime).toISOString(),
      participants: manifest.segments.map((seg: any) => ({
        userId: seg.userId,
        username: seg.username
      }))
    };

    const progressEmbed = new EmbedBuilder()
      .setTitle('📤 Uploading...')
      .setDescription(`Uploading session \`${sessionId}\` to platform...\n\n` +
        `**Files:** ${existingTracks.length} segments` +
        (missingTracks.length > 0 ? `\n⚠️ Skipped ${missingTracks.length} missing files` : ''))
      .setColor(0xffaa00)
      .setTimestamp();

    await interaction.editReply({ embeds: [progressEmbed] });

    const result = await recordingUploadService.uploadWithRetry(exportedRecording, metadata, 3);

    if (result.success) {
      const successEmbed = new EmbedBuilder()
        .setTitle('✅ Upload Successful')
        .setDescription(`Session uploaded to platform` +
          (missingTracks.length > 0 ? `\n\n⚠️ **Note:** ${missingTracks.length} files were missing and skipped` : ''))
        .setColor(0x00ff00)
        .addFields(
          { name: 'Recording ID', value: result.recordingId || 'N/A', inline: false },
          { name: 'Status', value: 'Upload complete', inline: true },
          { name: 'Audio Files', value: `${existingTracks.length} uploaded`, inline: true }
        )
        .setTimestamp();

      if (result.viewUrl) {
        successEmbed.addFields({ name: 'View URL', value: result.viewUrl, inline: false });
      }

      await interaction.editReply({ embeds: [successEmbed] });
    } else {
      await interaction.editReply({
        content: `❌ **Upload failed:** ${result.error}`
      });
    }
  } catch (error) {
    logger.error('Upload error:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `❌ **Upload failed:** ${errorMsg}`
    });
  }
}
