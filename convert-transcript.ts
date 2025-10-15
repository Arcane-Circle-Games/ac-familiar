import * as fs from 'fs/promises';
import * as path from 'path';

interface OldTranscriptSegment {
  startTime: string;
  endTime: string;
  text: string;
}

interface UserTranscriptData {
  username: string;
  userId: string;
  segments: OldTranscriptSegment[];
  wordCount: number;
}

interface ManifestData {
  sessionId: string;
  recordedAt: string;
  duration: number;
  participantCount: number;
  tracks: Array<{
    userId: string;
    username: string;
    filename: string;
    startTime: string;
    endTime: string;
  }>;
}

interface SessionTranscriptSegment {
  timestamp: string;
  speaker: string;
  speakerId: string;
  text: string;
  confidence: number;
}

interface UserTranscript {
  userId: string;
  username: string;
  wordCount: number;
  segments: SessionTranscriptSegment[];
}

interface SessionTranscript {
  sessionId: string;
  transcribedAt: string;
  duration: number;
  participantCount: number;
  fullTranscript: string;
  wordCount: number;
  averageConfidence: number;
  userTranscripts: UserTranscript[];
}

function parseTimeToMs(timeStr: string): number {
  const [hours, minutes, secondsMs] = timeStr.split(':');
  const [seconds, ms] = secondsMs.split('.');
  return (
    parseInt(hours) * 3600000 +
    parseInt(minutes) * 60000 +
    parseInt(seconds) * 1000 +
    parseInt(ms || '0')
  );
}

function parseOldTranscriptFile(content: string): { segments: OldTranscriptSegment[]; wordCount: number } {
  const lines = content.split('\n');
  const segments: OldTranscriptSegment[] = [];
  let wordCount = 0;

  for (const line of lines) {
    // Match pattern: [HH:MM:SS.mmm → HH:MM:SS.mmm] Text
    const match = line.match(/\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*→\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.+)/);
    if (match) {
      const text = match[3].trim();
      if (text && text !== '[BLANK_AUDIO]') {
        segments.push({
          startTime: match[1],
          endTime: match[2],
          text: text
        });
        wordCount += text.split(/\s+/).length;
      }
    }
  }

  return { segments, wordCount };
}

async function convertTranscript(sessionDir: string): Promise<void> {
  console.log(`Converting transcripts in: ${sessionDir}`);

  // Read manifest
  const manifestPath = path.join(sessionDir, 'manifest.json');
  const manifestContent = await fs.readFile(manifestPath, 'utf-8');
  const manifest: ManifestData = JSON.parse(manifestContent);

  console.log(`Session ID: ${manifest.sessionId}`);
  console.log(`Participants: ${manifest.participantCount}`);

  // Find all transcript files
  const files = await fs.readdir(sessionDir);
  const transcriptFiles = files.filter(f => f.startsWith('transcript_') && f.endsWith('.txt'));

  console.log(`Found ${transcriptFiles.length} transcript files`);

  // Parse each transcript file
  const userTranscripts: UserTranscript[] = [];
  let totalWordCount = 0;

  for (const transcriptFile of transcriptFiles) {
    const filePath = path.join(sessionDir, transcriptFile);
    const content = await fs.readFile(filePath, 'utf-8');
    const { segments: oldSegments, wordCount } = parseOldTranscriptFile(content);

    // Extract username from filename: transcript_vulkan_894_AD_10-09-25_Username.txt
    const usernameMatch = transcriptFile.match(/transcript_vulkan_\d+_AD_\d{2}-\d{2}-\d{2}_(.+)\.txt$/);
    const filenameUsername = usernameMatch ? usernameMatch[1].replace(/_/g, ' ').trim() : 'Unknown';

    // Find track in manifest - try exact match first, then fuzzy match
    let track = manifest.tracks.find(t => t.username === filenameUsername);

    if (!track) {
      // Fuzzy match - remove spaces, parentheses, and case differences
      const normalizedFilename = filenameUsername.toLowerCase().replace(/\s+/g, '').replace(/[()]/g, '');
      track = manifest.tracks.find(t => {
        const normalizedTrack = t.username.toLowerCase().replace(/\s+/g, '').replace(/[()]/g, '');
        return normalizedTrack === normalizedFilename || normalizedTrack.includes(normalizedFilename) || normalizedFilename.includes(normalizedTrack);
      });
    }

    const username = track?.username || filenameUsername;
    const userId = track?.userId || `unknown_${filenameUsername}`;

    console.log(`  - ${username} (${userId}): ${oldSegments.length} segments, ${wordCount} words`);

    // Convert to new format
    const newSegments: SessionTranscriptSegment[] = oldSegments.map(seg => ({
      timestamp: seg.startTime,
      speaker: username,
      speakerId: userId,
      text: seg.text,
      confidence: 0.85 // Default confidence since old format doesn't have it
    }));

    userTranscripts.push({
      userId,
      username,
      wordCount,
      segments: newSegments
    });

    totalWordCount += wordCount;
  }

  // Sort all segments chronologically across all users
  const allSegments: SessionTranscriptSegment[] = [];
  for (const userTranscript of userTranscripts) {
    allSegments.push(...userTranscript.segments);
  }
  allSegments.sort((a, b) => parseTimeToMs(a.timestamp) - parseTimeToMs(b.timestamp));

  // Generate full transcript in markdown format
  let fullTranscript = '# Session Transcript\n\n';
  fullTranscript += `**Date:** ${new Date(manifest.recordedAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })}\n\n`;
  fullTranscript += `**Duration:** ${Math.floor(manifest.duration / 60000)} minutes\n\n`;
  fullTranscript += `**Participants:** ${manifest.tracks.map(t => t.username).join(', ')}\n\n`;
  fullTranscript += '---\n\n';

  for (const segment of allSegments) {
    fullTranscript += `**${segment.speaker}** [${segment.timestamp}]: ${segment.text}\n\n`;
  }

  // Create final SessionTranscript object
  const sessionTranscript: SessionTranscript = {
    sessionId: manifest.sessionId,
    transcribedAt: new Date().toISOString(),
    duration: manifest.duration,
    participantCount: manifest.participantCount,
    fullTranscript,
    wordCount: totalWordCount,
    averageConfidence: 0.85, // Default confidence
    userTranscripts
  };

  // Write new format JSON file
  const outputPath = path.join(sessionDir, `transcript_${manifest.sessionId}.json`);
  await fs.writeFile(outputPath, JSON.stringify(sessionTranscript, null, 2), 'utf-8');
  console.log(`\n✅ Converted transcript saved to: ${outputPath}`);

  // Also write markdown file for easy viewing
  const mdPath = path.join(sessionDir, `transcript_${manifest.sessionId}.md`);
  await fs.writeFile(mdPath, fullTranscript, 'utf-8');
  console.log(`✅ Markdown transcript saved to: ${mdPath}`);

  console.log(`\nSummary:`);
  console.log(`  - Session ID: ${manifest.sessionId}`);
  console.log(`  - Participants: ${manifest.participantCount}`);
  console.log(`  - Total segments: ${allSegments.length}`);
  console.log(`  - Total words: ${totalWordCount}`);
  console.log(`  - Duration: ${Math.floor(manifest.duration / 60000)} minutes`);
}

// Run conversion
const sessionDir = process.argv[2] || './recordings/session 2 recordings';
convertTranscript(sessionDir)
  .then(() => {
    console.log('\n✅ Conversion complete!');
  })
  .catch((error) => {
    console.error('❌ Conversion failed:', error);
    process.exit(1);
  });
