/**
 * Direct test of LocalWhisperService (bypasses factory)
 */

import { LocalWhisperService } from './src/services/transcription/LocalWhisperService';
import * as fs from 'fs/promises';
import * as path from 'path';

async function main() {
  try {
    console.log('🎙️  Local Whisper Direct Test\n');

    // Create service instance
    const whisperService = new LocalWhisperService(
      'base',      // model size
      './models',  // models directory
      true,        // use GPU
      'default'    // lib variant
    );

    console.log('📊 Service Info:');
    console.log(`   Model: base`);
    console.log(`   GPU: enabled`);
    console.log('');

    // Find test file
    console.log('🔍 Finding test audio file...');
    const recordingsDir = './recordings';
    const dirs = await fs.readdir(recordingsDir, { withFileTypes: true });

    let testFile: string | null = null;
    let smallestSize = Infinity;

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
      console.error('❌ No WAV files found');
      process.exit(1);
    }

    const fileSizeMB = smallestSize / (1024 * 1024);
    console.log(`   Found: ${testFile}`);
    console.log(`   Size: ${fileSizeMB.toFixed(2)} MB`);
    console.log('');

    // Initialize (downloads model if needed)
    console.log('🔄 Initializing Whisper...');
    console.log('   (This will download ~142MB model file if not present)');
    await whisperService.initialize();
    console.log('   ✅ Initialized!\n');

    // Transcribe
    console.log('🚀 Transcribing...\n');
    const startTime = Date.now();

    const transcript = await whisperService.transcribeAudioFile(
      testFile,
      'test-user',
      'TestUser',
      Date.now()
    );

    const duration = Date.now() - startTime;

    // Results
    console.log('✅ Transcription Complete!\n');
    console.log('📝 Results:');
    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Word Count: ${transcript.wordCount}`);
    console.log(`   Segments: ${transcript.segments.length}`);
    console.log(`   Audio Length: ${transcript.duration.toFixed(2)}s`);
    console.log('');

    console.log('💬 Transcript:');
    console.log('   ' + transcript.text.substring(0, 300) + (transcript.text.length > 300 ? '...' : ''));
    console.log('');

    // Cleanup
    await whisperService.release();

    console.log('✨ Test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

main();
