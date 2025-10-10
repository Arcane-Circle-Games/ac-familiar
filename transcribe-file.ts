/**
 * Transcribe a single audio file using Local Whisper
 *
 * Usage:
 *   npx tsx transcribe-file.ts <path-to-wav-file>
 *
 * Example:
 *   npx tsx transcribe-file.ts "./recordings/session-123/user_audio.wav"
 */

import { LocalWhisperService } from './src/services/transcription/LocalWhisperService';
import * as fs from 'fs/promises';
import * as path from 'path';

async function main() {
  try {
    // Get file path from command line
    const filePath = process.argv[2];

    if (!filePath) {
      console.error('❌ Usage: npx tsx transcribe-file.ts <path-to-wav-file>');
      console.error('\nExample:');
      console.error('  npx tsx transcribe-file.ts "./recordings/session-123/user_audio.wav"');
      process.exit(1);
    }

    // Resolve absolute path
    const absolutePath = path.resolve(filePath);

    // Check if file exists
    try {
      await fs.access(absolutePath);
    } catch {
      console.error(`❌ File not found: ${absolutePath}`);
      process.exit(1);
    }

    // Get file info
    const stats = await fs.stat(absolutePath);
    const fileSizeMB = stats.size / (1024 * 1024);
    const fileName = path.basename(absolutePath);
    const fileDir = path.dirname(absolutePath);

    console.log('🎙️  Local Whisper File Transcription\n');
    console.log('📂 Input:');
    console.log(`   File: ${fileName}`);
    console.log(`   Path: ${fileDir}`);
    console.log(`   Size: ${fileSizeMB.toFixed(2)} MB`);
    console.log('');

    // Extract username from filename (format: ServerName_Date_Username.wav)
    const fileNameWithoutExt = path.basename(absolutePath, path.extname(absolutePath));
    const parts = fileNameWithoutExt.split('_');
    const username = parts.length >= 3 ? parts.slice(2).join('_') : fileNameWithoutExt;

    console.log('🔧 Configuration:');
    console.log(`   Model: base`);
    console.log(`   Engine: Local Whisper (whisper.cpp)`);
    console.log(`   GPU: enabled`);
    console.log('');

    // Create Whisper service
    const whisperService = new LocalWhisperService(
      'base',
      './models',
      true,
      'default'
    );

    // Initialize
    console.log('🔄 Initializing...');
    const modelInfo = whisperService.getModelInfo();
    if (!modelInfo.isLoaded) {
      console.log('   (Downloading model if needed, ~142MB)');
    }
    await whisperService.initialize();
    console.log('   ✅ Ready!\n');

    // Estimate time
    const estimate = whisperService.estimateTime(stats.size / (1024 * 1024));
    console.log(`⏱️  Estimated time: ${estimate}\n`);

    // Transcribe
    console.log('🚀 Transcribing...\n');
    const startTime = Date.now();

    const transcript = await whisperService.transcribeAudioFile(
      absolutePath,
      'unknown-id',
      username,
      Date.now()
    );

    const duration = Date.now() - startTime;

    // Generate output filename: transcript_[original-filename].txt
    const outputFileName = `transcript_${fileNameWithoutExt}.txt`;
    const outputPath = path.join(fileDir, outputFileName);

    // Create transcript content
    const transcriptContent = [
      '='.repeat(80),
      'TRANSCRIPT',
      '='.repeat(80),
      '',
      `File: ${fileName}`,
      `Transcribed: ${new Date().toLocaleString()}`,
      `Duration: ${transcript.duration.toFixed(2)}s`,
      `Word Count: ${transcript.wordCount}`,
      `Segments: ${transcript.segments.length}`,
      `Processing Time: ${(duration / 1000).toFixed(2)}s`,
      '',
      '='.repeat(80),
      'CONTENT',
      '='.repeat(80),
      '',
      transcript.text,
      '',
      '='.repeat(80),
      'SEGMENTS (with timestamps)',
      '='.repeat(80),
      '',
      ...transcript.segments.map(seg => {
        const startTime = formatTimestamp(seg.start);
        const endTime = formatTimestamp(seg.end);
        return `[${startTime} → ${endTime}] ${seg.text}`;
      }),
      ''
    ].join('\n');

    // Save to file
    await fs.writeFile(outputPath, transcriptContent, 'utf-8');

    // Results
    console.log('✅ Transcription Complete!\n');
    console.log('📝 Results:');
    console.log(`   Processing Time: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Word Count: ${transcript.wordCount}`);
    console.log(`   Segments: ${transcript.segments.length}`);
    console.log(`   Audio Duration: ${transcript.duration.toFixed(2)}s`);
    console.log('');

    console.log('💾 Saved:');
    console.log(`   ${outputPath}`);
    console.log('');

    console.log('💬 Preview:');
    const preview = transcript.text.substring(0, 200);
    console.log(`   ${preview}${transcript.text.length > 200 ? '...' : ''}`);
    console.log('');

    // Cleanup
    await whisperService.release();

    console.log('✨ Done!');

  } catch (error) {
    console.error('❌ Error:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
    }
    process.exit(1);
  }
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

main();
