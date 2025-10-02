import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from './logger';

/**
 * Utilities for managing temporary file storage
 */

export interface DirectoryInfo {
  path: string;
  exists: boolean;
  fileCount?: number;
  totalSize?: number;
}

export class StorageManager {
  private readonly DEFAULT_RECORDINGS_DIR = './recordings';

  /**
   * Ensure a directory exists, create if it doesn't
   */
  async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
      logger.debug('Directory ensured', { dirPath });
    } catch (error) {
      logger.error('Failed to ensure directory', error as Error, { dirPath });
      throw error;
    }
  }

  /**
   * Get information about a directory
   */
  async getDirectoryInfo(dirPath: string): Promise<DirectoryInfo> {
    try {
      const stats = await fs.stat(dirPath);

      if (!stats.isDirectory()) {
        return { path: dirPath, exists: false };
      }

      const files = await fs.readdir(dirPath);
      let totalSize = 0;

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const fileStats = await fs.stat(filePath);
        if (fileStats.isFile()) {
          totalSize += fileStats.size;
        }
      }

      return {
        path: dirPath,
        exists: true,
        fileCount: files.length,
        totalSize
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { path: dirPath, exists: false };
      }
      logger.error('Failed to get directory info', error as Error, { dirPath });
      throw error;
    }
  }

  /**
   * Clean up old recordings based on age
   */
  async cleanupOldRecordings(
    maxAgeMs: number = 7 * 24 * 60 * 60 * 1000, // 7 days default
    recordingsDir: string = this.DEFAULT_RECORDINGS_DIR
  ): Promise<{ deletedCount: number; freedSpace: number }> {
    try {
      logger.info('Starting cleanup of old recordings', { maxAgeMs, recordingsDir });

      const now = Date.now();
      let deletedCount = 0;
      let freedSpace = 0;

      // Check if directory exists
      const dirInfo = await this.getDirectoryInfo(recordingsDir);
      if (!dirInfo.exists) {
        logger.info('Recordings directory does not exist, skipping cleanup');
        return { deletedCount: 0, freedSpace: 0 };
      }

      // Get all session directories
      const entries = await fs.readdir(recordingsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionPath = path.join(recordingsDir, entry.name);
          const stats = await fs.stat(sessionPath);
          const age = now - stats.mtimeMs;

          if (age > maxAgeMs) {
            // Get size before deletion
            const size = await this.getDirectorySize(sessionPath);

            // Delete directory
            await fs.rm(sessionPath, { recursive: true, force: true });

            deletedCount++;
            freedSpace += size;

            logger.info('Deleted old recording', {
              sessionPath,
              age: Math.floor(age / (1000 * 60 * 60 * 24)) + ' days',
              size
            });
          }
        }
      }

      logger.info('Cleanup completed', { deletedCount, freedSpace });
      return { deletedCount, freedSpace };

    } catch (error) {
      logger.error('Failed to cleanup old recordings', error as Error);
      throw error;
    }
  }

  /**
   * Get total size of a directory (recursive)
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;

    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        totalSize += await this.getDirectorySize(entryPath);
      } else if (entry.isFile()) {
        const stats = await fs.stat(entryPath);
        totalSize += stats.size;
      }
    }

    return totalSize;
  }

  /**
   * Get disk space usage for recordings directory
   */
  async getStorageUsage(
    recordingsDir: string = this.DEFAULT_RECORDINGS_DIR
  ): Promise<{
    totalSize: number;
    sessionCount: number;
    fileCount: number;
  }> {
    try {
      const dirInfo = await this.getDirectoryInfo(recordingsDir);

      if (!dirInfo.exists) {
        return { totalSize: 0, sessionCount: 0, fileCount: 0 };
      }

      const entries = await fs.readdir(recordingsDir, { withFileTypes: true });
      const sessionDirs = entries.filter(e => e.isDirectory());

      let totalFiles = 0;
      for (const dir of sessionDirs) {
        const sessionPath = path.join(recordingsDir, dir.name);
        const files = await fs.readdir(sessionPath);
        totalFiles += files.length;
      }

      return {
        totalSize: dirInfo.totalSize || 0,
        sessionCount: sessionDirs.length,
        fileCount: totalFiles
      };
    } catch (error) {
      logger.error('Failed to get storage usage', error as Error);
      throw error;
    }
  }

  /**
   * Format bytes to human-readable string
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Validate available disk space
   */
  async checkAvailableSpace(
    requiredBytes: number,
    dirPath: string = this.DEFAULT_RECORDINGS_DIR
  ): Promise<boolean> {
    try {
      // This is a simplified check - in production you'd want to check actual disk space
      // using something like 'check-disk-space' package
      await this.ensureDirectory(dirPath);

      // For now, just ensure we can write to the directory
      const testFile = path.join(dirPath, '.space-check');
      await fs.writeFile(testFile, 'test');
      await fs.unlink(testFile);

      return true;
    } catch (error) {
      logger.error('Failed to check available space', error as Error, {
        requiredBytes,
        dirPath
      });
      return false;
    }
  }
}

export const storageManager = new StorageManager();
