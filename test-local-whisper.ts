/**
 * Test script for Local Whisper transcription
 *
 * Usage:
 *   npx tsx test-local-whisper.ts
 */

// IMPORTANT: Set env vars BEFORE any imports that use config
process.env.TRANSCRIPTION_ENGINE = 'local';
process.env.WHISPER_MODEL_SIZE = 'base';
process.env.WHISPER_USE_GPU = 'true';

// Now import modules (config will be parsed with our env vars)
import { getTranscriptionService, TranscriptionFactory } from './src/services/transcription';
import { logger } from './src/utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

async function main() {
  try {
    console.log('🎙️  Local Whisper Transcription Test\n');

    // Get engine info
    const engineInfo = TranscriptionFactory.getEngineInfo();
    console.log('📊 Engine Configuration:');
    console.log(`   Engine: ${engineInfo.engine}`);
    console.log(`   Available: ${engineInfo.isAvailable}`);
    if (engineInfo.details) {
      console.log(`   Details:`, JSON.stringify(engineInfo.details, null, 2));
    }
    console.log('');

    // Get transcription service
    const service = getTranscriptionService();

    if (!service.isAvailable()) {
      console.log('⚠️  Transcription service not available yet.');

      if (engineInfo.engine === 'local') {
        console.log('   Initializing local Whisper (this will download the model if needed)...');
        console.log('   Model download may take a few minutes depending on size and connection.');
        console.log('');
      }
    }

    // Find a small test file
    console.log('🔍 Finding test audio file...');
    const recordingsDir = './recordings';
    const dirs = await fs.readdir(recordingsDir, { withFileTypes: true });

    let testFile: string | null = null;
    let smallestSize = Infinity;

    // Find smallest WAV file for quick testing
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;

      const sessionPath = path.join(recordingsDir, dir.name);
      const files = await fs.readdir(sessionPath);

      for (const file of files) {
        if (file.endsWith('.wav')) {
          const filePath = path.join(sessionPath, file);
          const stats = await fs.stat(filePath);

          if (stats.size < smallestSize) {
            smallestSize = stats.size;
            testFile = filePath;
          }
        }
      }
    }

    if (!testFile) {
      console.error('❌ No WAV files found in ./recordings/');
      process.exit(1);
    }

    const fileSizeMB = smallestSize / (1024 * 1024);
    console.log(`   Found: ${testFile}`);
    console.log(`   Size: ${fileSizeMB.toFixed(2)} MB`);
    console.log('');

    // Estimate processing time
    if (service.estimateTime) {
      const estimate = service.estimateTime(fileSizeMB);
      console.log(`⏱️  Estimated processing time: ${estimate}\n`);
    }

    // Transcribe
    console.log('🚀 Starting transcription...\n');
    const startTime = Date.now();

    const transcript = await service.transcribeAudioFile(
      testFile,
      'test-user',
      'TestUser',
      Date.now()
    );

    const duration = Date.now() - startTime;

    // Display results
    console.log('✅ Transcription Complete!\n');
    console.log('📝 Results:');
    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Word Count: ${transcript.wordCount}`);
    console.log(`   Segments: ${transcript.segments.length}`);
    console.log(`   Confidence: ${(transcript.averageConfidence * 100).toFixed(1)}%`);
    console.log(`   Audio Duration: ${transcript.duration.toFixed(2)}s`);
    console.log('');

    console.log('💬 Transcript Preview:');
    console.log('   ' + transcript.text.substring(0, 200) + (transcript.text.length > 200 ? '...' : ''));
    console.log('');

    console.log('✨ Test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

main();
