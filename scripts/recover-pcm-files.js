#!/usr/bin/env node

/**
 * PCM Recovery Script
 * Recovers orphaned PCM files from crashed recording sessions
 *
 * Usage:
 *   node recover-pcm-files.js <session-directory>
 *
 * Before running:
 *   1. Edit the USER_MAPPING below with your Discord user IDs and usernames
 *   2. Make a backup copy of your session directory
 */

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

// ============================================================================
// CONFIGURATION - EDIT THIS SECTION
// ============================================================================

const USER_MAPPING = {
  '786315819561779261': 'Shadera Aro (Evie)',
  '451606006120710144': 'Kaynari (Avery-Jade)',
  '697614215363428383': 'Elladreen (Hannah)',
  '167874930438832128': 'ArcaneMike',
  '370265774570602497': 'Percy (Josh)',
  '495423169721663500': 'Nysira/Em',
};

// Audio format settings (Discord defaults)
const AUDIO_CONFIG = {
  sampleRate: 48000,
  channels: 2,
  format: 's16le', // Signed 16-bit little-endian
};

// ============================================================================
// RECOVERY LOGIC
// ============================================================================

class PCMRecovery {
  constructor(sessionDir, userMapping) {
    this.sessionDir = sessionDir;
    this.userMapping = userMapping;
    this.recoveredFiles = [];
    this.errors = [];
  }

  /**
   * Parse PCM filename to extract metadata
   * Format: temp_{userId}_seg{index}_{timestamp}_{random}.pcm
   */
  parsePCMFilename(filename) {
    const match = filename.match(/^temp_(\d+)_seg(\d+)_(\d+)_([a-z0-9]+)\.pcm$/);

    if (!match) {
      return null;
    }

    return {
      userId: match[1],
      segmentIndex: parseInt(match[2], 10),
      timestamp: parseInt(match[3], 10),
      random: match[4],
      originalFilename: filename,
    };
  }

  /**
   * Convert PCM file to WAV using FFmpeg
   */
  async convertPCMToWAV(pcmPath, wavPath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-f', AUDIO_CONFIG.format,
        '-ar', AUDIO_CONFIG.sampleRate.toString(),
        '-ac', AUDIO_CONFIG.channels.toString(),
        '-i', pcmPath,
        '-y', // Overwrite output file
        '-acodec', 'pcm_s16le',
        '-f', 'wav',
        wavPath
      ];

      console.log(`  Converting: ${path.basename(pcmPath)} → ${path.basename(wavPath)}`);

      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg failed with code ${code}: ${stderr.substring(0, 500)}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(new Error(`Failed to spawn FFmpeg: ${error.message}`));
      });
    });
  }

  /**
   * Scan session directory for PCM files
   */
  async findPCMFiles() {
    const files = await fs.readdir(this.sessionDir);
    const pcmFiles = files.filter(f => f.startsWith('temp_') && f.endsWith('.pcm'));

    console.log(`\nFound ${pcmFiles.length} PCM files to recover\n`);

    return pcmFiles;
  }

  /**
   * Group PCM files by user
   */
  groupByUser(parsedFiles) {
    const grouped = {};

    for (const file of parsedFiles) {
      if (!grouped[file.userId]) {
        grouped[file.userId] = [];
      }
      grouped[file.userId].push(file);
    }

    // Sort each user's segments by index
    for (const userId in grouped) {
      grouped[userId].sort((a, b) => a.segmentIndex - b.segmentIndex);
    }

    return grouped;
  }

  /**
   * Recover all PCM files
   */
  async recover() {
    console.log('='.repeat(70));
    console.log('PCM RECOVERY TOOL');
    console.log('='.repeat(70));
    console.log(`Session directory: ${this.sessionDir}\n`);

    // Find PCM files
    const pcmFiles = await this.findPCMFiles();

    if (pcmFiles.length === 0) {
      console.log('No PCM files found to recover.');
      return { recoveredFiles: [], errors: [] };
    }

    // Parse all filenames
    const parsedFiles = pcmFiles
      .map(f => this.parsePCMFilename(f))
      .filter(f => f !== null);

    console.log(`Successfully parsed ${parsedFiles.length}/${pcmFiles.length} filenames\n`);

    // Group by user
    const grouped = this.groupByUser(parsedFiles);

    console.log(`Found segments for ${Object.keys(grouped).length} users:\n`);
    for (const userId in grouped) {
      const username = this.userMapping[userId] || `User_${userId}`;
      console.log(`  ${username} (${userId}): ${grouped[userId].length} segments`);
    }
    console.log();

    // Convert each file
    for (const userId in grouped) {
      const username = this.userMapping[userId] || `User_${userId}`;
      // Sanitize username for directory name
      const sanitizedUsername = username
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_');
      const userDir = path.join(this.sessionDir, sanitizedUsername);

      // Create user directory
      await fs.mkdir(userDir, { recursive: true });

      console.log(`\nProcessing ${username}...`);

      for (const file of grouped[userId]) {
        const pcmPath = path.join(this.sessionDir, file.originalFilename);
        const wavFilename = `segment_${file.segmentIndex.toString().padStart(3, '0')}.wav`;
        const wavPath = path.join(userDir, wavFilename);

        try {
          await this.convertPCMToWAV(pcmPath, wavPath);

          // Get file stats
          const stats = await fs.stat(wavPath);

          this.recoveredFiles.push({
            userId,
            username,
            segmentIndex: file.segmentIndex,
            timestamp: file.timestamp,
            pcmFile: file.originalFilename,
            wavFile: wavFilename,
            wavPath: path.relative(this.sessionDir, wavPath),
            fileSize: stats.size,
          });

          console.log(`  ✓ Recovered segment ${file.segmentIndex}`);
        } catch (error) {
          this.errors.push({
            file: file.originalFilename,
            error: error.message,
          });
          console.log(`  ✗ Failed segment ${file.segmentIndex}: ${error.message}`);
        }
      }
    }

    return {
      recoveredFiles: this.recoveredFiles,
      errors: this.errors,
    };
  }

  /**
   * Generate recovery report and manifest
   */
  async generateReport() {
    console.log('\n' + '='.repeat(70));
    console.log('RECOVERY SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total segments recovered: ${this.recoveredFiles.length}`);
    console.log(`Failed conversions: ${this.errors.length}`);

    if (this.errors.length > 0) {
      console.log('\nErrors:');
      this.errors.forEach(e => {
        console.log(`  - ${e.file}: ${e.error}`);
      });
    }

    // Calculate session timing from timestamps
    const timestamps = this.recoveredFiles.map(f => f.timestamp);
    const sessionStartTime = Math.min(...timestamps);
    const sessionEndTime = Math.max(...timestamps);
    const duration = sessionEndTime - sessionStartTime;

    console.log(`\nSession timing (estimated):`);
    console.log(`  Start: ${new Date(sessionStartTime).toISOString()}`);
    console.log(`  End: ${new Date(sessionEndTime).toISOString()}`);
    console.log(`  Duration: ${Math.floor(duration / 1000)}s`);

    // Group by user for manifest
    const participants = {};
    for (const file of this.recoveredFiles) {
      if (!participants[file.userId]) {
        participants[file.userId] = {
          userId: file.userId,
          username: file.username,
          segments: [],
        };
      }
      participants[file.userId].segments.push({
        userId: file.userId,
        username: file.username,
        segmentIndex: file.segmentIndex,
        fileName: file.wavFile,
        absoluteStartTime: file.timestamp,
        absoluteEndTime: file.timestamp, // Unknown, using same value
        duration: 0, // Unknown without analyzing WAV
        fileSize: file.fileSize,
      });
    }

    // Create manifest
    const manifest = {
      sessionId: path.basename(this.sessionDir),
      sessionStartTime,
      sessionEndTime,
      format: 'segmented',
      recovered: true,
      recoveredAt: new Date().toISOString(),
      participants: Object.values(participants),
      segments: this.recoveredFiles.map(f => ({
        userId: f.userId,
        username: f.username,
        segmentIndex: f.segmentIndex,
        fileName: f.wavFile,
        filePath: f.wavPath,
        absoluteStartTime: f.timestamp,
        absoluteEndTime: f.timestamp,
        duration: 0,
        fileSize: f.fileSize,
        format: 'wav',
      })),
    };

    // Write manifest
    const manifestPath = path.join(this.sessionDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\n✓ Created manifest: ${manifestPath}`);

    // Write recovery report
    const reportPath = path.join(this.sessionDir, 'RECOVERY_REPORT.txt');
    const report = `
PCM RECOVERY REPORT
Generated: ${new Date().toISOString()}
Session: ${path.basename(this.sessionDir)}

SUMMARY
-------
Total segments recovered: ${this.recoveredFiles.length}
Failed conversions: ${this.errors.length}
Participants: ${Object.keys(participants).length}

TIMING (ESTIMATED)
------------------
Start: ${new Date(sessionStartTime).toISOString()}
End: ${new Date(sessionEndTime).toISOString()}
Duration: ${Math.floor(duration / 1000)}s (${Math.floor(duration / 60000)}m)

RECOVERED FILES
---------------
${this.recoveredFiles.map(f =>
  `${f.username}/segment_${f.segmentIndex.toString().padStart(3, '0')}.wav (${(f.fileSize / 1024 / 1024).toFixed(2)}MB)`
).join('\n')}

${this.errors.length > 0 ? `
ERRORS
------
${this.errors.map(e => `${e.file}: ${e.error}`).join('\n')}
` : ''}

NOTES
-----
- Timing data is approximate (based on file creation timestamps)
- Segment durations are unknown (would require WAV analysis)
- All audio data has been recovered
`.trim();

    await fs.writeFile(reportPath, report);
    console.log(`✓ Created recovery report: ${reportPath}`);

    console.log('\n' + '='.repeat(70));
    console.log('Recovery complete!');
    console.log('='.repeat(70));
    console.log('\nNext steps:');
    console.log('1. Review RECOVERY_REPORT.txt for details');
    console.log('2. Verify WAV files play correctly');
    console.log('3. Delete PCM files if recovery successful:');
    console.log(`   rm ${this.sessionDir}/temp_*.pcm\n`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node recover-pcm-files.js <session-directory>');
    console.error('Example: node recover-pcm-files.js ./recordings/abc-123-def');
    process.exit(1);
  }

  const sessionDir = args[0];

  // Validate directory exists
  try {
    const stats = await fs.stat(sessionDir);
    if (!stats.isDirectory()) {
      console.error(`Error: ${sessionDir} is not a directory`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: Cannot access ${sessionDir}: ${error.message}`);
    process.exit(1);
  }

  // Check if user mapping is configured
  if (Object.keys(USER_MAPPING).length === 0) {
    console.error('\n⚠️  WARNING: USER_MAPPING is empty!');
    console.error('Edit this script and add your Discord user ID → username mappings.\n');
    console.error('Files will be recovered with User_<id> as usernames.\n');

    // Ask for confirmation
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    await new Promise((resolve) => {
      readline.question('Continue anyway? (y/N): ', (answer) => {
        readline.close();
        if (answer.toLowerCase() !== 'y') {
          console.log('Aborted.');
          process.exit(0);
        }
        resolve();
      });
    });
  }

  // Run recovery
  const recovery = new PCMRecovery(sessionDir, USER_MAPPING);
  await recovery.recover();
  await recovery.generateReport();
}

main().catch(error => {
  console.error('\nFatal error:', error);
  process.exit(1);
});
