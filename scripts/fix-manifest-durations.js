#!/usr/bin/env node

/**
 * Fix Manifest Durations
 * Calculates actual WAV file durations and updates manifest.json
 *
 * Usage:
 *   node fix-manifest-durations.js <session-directory>
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Calculate duration from WAV file by reading header
 */
async function getWAVDuration(filePath) {
  try {
    const buffer = await fs.readFile(filePath);

    // WAV file header structure
    if (buffer.length < 44) {
      console.warn(`  ⚠️  WAV file too small: ${path.basename(filePath)}`);
      return 0;
    }

    // Verify RIFF and WAVE headers
    const riff = buffer.toString('ascii', 0, 4);
    const wave = buffer.toString('ascii', 8, 12);

    if (riff !== 'RIFF' || wave !== 'WAVE') {
      console.warn(`  ⚠️  Invalid WAV format: ${path.basename(filePath)}`);
      return 0;
    }

    const byteRate = buffer.readUInt32LE(28);

    // Find data chunk
    let offset = 12;
    while (offset < buffer.length - 8) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);

      if (chunkId === 'data') {
        // Duration = data size / byte rate (in milliseconds)
        const durationMs = Math.round((chunkSize / byteRate) * 1000);
        return durationMs;
      }

      offset += 8 + chunkSize;
    }

    console.warn(`  ⚠️  No data chunk found: ${path.basename(filePath)}`);
    return 0;
  } catch (error) {
    console.error(`  ✗ Failed to read ${path.basename(filePath)}: ${error.message}`);
    return 0;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node fix-manifest-durations.js <session-directory>');
    console.error('Example: node fix-manifest-durations.js ./recordings/abc-123-def');
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

  console.log('='.repeat(70));
  console.log('MANIFEST DURATION FIX');
  console.log('='.repeat(70));
  console.log(`Session directory: ${sessionDir}\n`);

  // Read manifest
  const manifestPath = path.join(sessionDir, 'manifest.json');
  let manifest;

  try {
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    manifest = JSON.parse(manifestContent);
  } catch (error) {
    console.error(`✗ Failed to read manifest.json: ${error.message}`);
    process.exit(1);
  }

  if (!manifest.segments || !Array.isArray(manifest.segments)) {
    console.error('✗ Manifest does not contain segments array');
    process.exit(1);
  }

  console.log(`Found ${manifest.segments.length} segments in manifest\n`);

  // Find segments with 0 or missing duration
  const segmentsToFix = manifest.segments.filter(seg =>
    !seg.duration || seg.duration === 0
  );

  if (segmentsToFix.length === 0) {
    console.log('✓ All segments already have valid durations!');
    return;
  }

  console.log(`Found ${segmentsToFix.length} segments with missing/zero duration\n`);
  console.log('Calculating durations from WAV files...\n');

  let fixed = 0;
  let failed = 0;
  let missing = 0;

  for (const segment of manifest.segments) {
    if (!segment.duration || segment.duration === 0) {
      const wavPath = path.join(sessionDir, segment.filePath || segment.fileName);

      // Check if file exists
      try {
        await fs.access(wavPath);
      } catch {
        console.log(`  ⚠️  Missing: ${segment.username} segment ${segment.segmentIndex}`);
        missing++;
        continue;
      }

      // Calculate duration
      const duration = await getWAVDuration(wavPath);

      if (duration > 0) {
        segment.duration = duration;

        // Update endTime if it equals startTime
        if (segment.absoluteEndTime === segment.absoluteStartTime) {
          segment.absoluteEndTime = segment.absoluteStartTime + duration;
        }

        console.log(`  ✓ Fixed: ${segment.username} segment ${segment.segmentIndex} -> ${(duration / 1000).toFixed(1)}s`);
        fixed++;
      } else {
        console.log(`  ✗ Failed: ${segment.username} segment ${segment.segmentIndex}`);
        failed++;
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total segments: ${manifest.segments.length}`);
  console.log(`Fixed: ${fixed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Missing files: ${missing}`);

  if (fixed > 0) {
    // Backup original manifest
    const backupPath = path.join(sessionDir, 'manifest.json.backup');
    try {
      await fs.copyFile(manifestPath, backupPath);
      console.log(`\n✓ Backed up original manifest to: ${path.basename(backupPath)}`);
    } catch (error) {
      console.error(`\n⚠️  Failed to create backup: ${error.message}`);
    }

    // Write updated manifest
    try {
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`✓ Updated manifest with ${fixed} fixed durations`);
    } catch (error) {
      console.error(`✗ Failed to write manifest: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.log('\n⚠️  No changes made to manifest');
  }

  console.log('='.repeat(70));
}

main().catch(error => {
  console.error('\nFatal error:', error);
  process.exit(1);
});
