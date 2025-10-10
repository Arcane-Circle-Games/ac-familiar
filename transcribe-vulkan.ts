/**
 * Transcribe a single audio file using Vulkan-accelerated Whisper
 *
 * Usage:
 *   npx tsx transcribe-vulkan.ts <path-to-wav-file>
 *
 * Example:
 *   npx tsx transcribe-vulkan.ts "./recordings/session-123/user_audio.wav"
 *
 * Requires: Vulkan-capable GPU (NVIDIA, AMD, or Intel)
 */

import { VulkanWhisperService } from './src/services/transcription/VulkanWhisperService';
import * as fs from 'fs/promises';
import * as path from 'path';

function parseTimestampedSegments(text: string): Array<{ start: string; end: string; text: string }> {
  // Parse timestamp format: HH:MM:SS.mmm HH:MM:SS.mmm  Text
  const regex = /(\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s+([^0-9]+?)(?=\d{2}:\d{2}:\d{2}\.\d{3}|$)/g;

  const segments: Array<{ start: string; end: string; text: string }> = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    segments.push({
      start: match[1],
      end: match[2],
      text: match[3].trim()
    });
  }

  return segments;
}

async function main() {
  try {
    // Get file path from command line
    const filePath = process.argv[2];

    if (!filePath) {
      console.error('❌ Usage: npx tsx transcribe-vulkan.ts <path-to-wav-file>');
      console.error('\nExample:');
      console.error('  npx tsx transcribe-vulkan.ts "./recordings/session-123/user_audio.wav"');
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

    console.log('🎙️  Vulkan Whisper File Transcription\n');
    console.log('📂 Input:');
    console.log(`   File: ${fileName}`);
    console.log(`   Path: ${fileDir}`);
    console.log(`   Size: ${fileSizeMB.toFixed(2)} MB`);
    console.log('');

    // Extract username from filename
    const fileNameWithoutExt = path.basename(absolutePath, path.extname(absolutePath));
    const parts = fileNameWithoutExt.split('_');
    const username = parts.length >= 3 ? parts.slice(2).join('_') : fileNameWithoutExt;

    console.log('🔧 Configuration:');
    console.log(`   Model: base`);
    console.log(`   Engine: Whisper.cpp with Vulkan`);
    console.log(`   Acceleration: Vulkan (GPU)`);
    console.log('');

    // Create Whisper service with Vulkan
    const whisperService = new VulkanWhisperService(
      'base',
      './models',
      true  // Enable GPU
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
    const audioDurationSec = (stats.size / (1024 * 1024)) * 6; // ~6 seconds per MB for WAV
    const estimate = whisperService.estimateTime(audioDurationSec);
    console.log(`⏱️  Estimated time: ${estimate} (GPU accelerated)\n`);

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

    // Generate output filename
    const outputFileName = `transcript_vulkan_${fileNameWithoutExt}.txt`;
    const outputPath = path.join(fileDir, outputFileName);

    // Parse segments with timestamps from the transcript text
    const segments = parseTimestampedSegments(transcript.text);

    // Create transcript content (segments only, no block text)
    const transcriptContent = [
      '='.repeat(80),
      'TRANSCRIPT (Vulkan GPU Accelerated)',
      '='.repeat(80),
      '',
      `File: ${fileName}`,
      `Transcribed: ${new Date().toLocaleString()}`,
      `Word Count: ${transcript.wordCount}`,
      `Processing Time: ${(duration / 1000).toFixed(2)}s`,
      `Speed: ${(fileSizeMB * 6 / (duration / 1000)).toFixed(1)}x real-time`,
      `Engine: Vulkan GPU`,
      '',
      '='.repeat(80),
      'SEGMENTS (with timestamps)',
      '='.repeat(80),
      '',
      ...segments.map(seg => `[${seg.start} → ${seg.end}] ${seg.text}`),
      ''
    ].join('\n');

    // Save to file
    await fs.writeFile(outputPath, transcriptContent, 'utf-8');

    // Results
    console.log('✅ Transcription Complete!\n');
    console.log('📝 Results:');
    console.log(`   Processing Time: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Word Count: ${transcript.wordCount}`);
    console.log('');

    console.log('💾 Saved:');
    console.log(`   ${outputPath}`);
    console.log('');

    console.log('💬 First 3 segments:');
    for (let i = 0; i < Math.min(3, segments.length); i++) {
      console.log(`   [${segments[i].start} → ${segments[i].end}] ${segments[i].text.substring(0, 80)}${segments[i].text.length > 80 ? '...' : ''}`);
    }
    console.log('');

    // Cleanup
    await whisperService.release();

    console.log('✨ Done!');

  } catch (error) {
    console.error('❌ Error:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

main();
