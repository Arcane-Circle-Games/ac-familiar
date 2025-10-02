/**
 * WebhookListener
 * Phase 2C: Receives webhooks from platform API about transcription completion
 */

import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { config } from '../../utils/config';
import {
  RecordingWebhookPayload,
  RecordingTranscriptionCompletedWebhook,
  RecordingTranscriptionFailedWebhook,
} from '../../types/recording-api';
import { ArcaneBot } from '../../bot';

export class WebhookListener {
  private app: express.Express;
  private server: any;
  private bot: ArcaneBot | null = null;

  constructor() {
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  /**
   * Set the bot instance for sending notifications
   */
  setBot(bot: ArcaneBot): void {
    this.bot = bot;
    logger.info('Bot instance set for WebhookListener');
  }

  /**
   * Setup Express routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', service: 'webhook-listener' });
    });

    // Recording webhook handler
    this.app.post('/webhooks/recording-completed', async (req: Request, res: Response) => {
      try {
        // Verify signature
        const signature = req.headers['x-webhook-signature'] as string;
        const timestamp = req.headers['x-webhook-timestamp'] as string;

        if (!signature || !timestamp) {
          logger.warn('Webhook received without signature/timestamp');
          return res.status(401).json({ error: 'Missing signature or timestamp' });
        }

        // Verify signature
        const isValid = this.verifySignature(JSON.stringify(req.body), signature);

        if (!isValid) {
          logger.error('Webhook signature verification failed');
          return res.status(401).json({ error: 'Invalid signature' });
        }

        // Check timestamp to prevent replay attacks (within 5 minutes)
        const now = Date.now();
        const webhookTime = parseInt(timestamp, 10);
        if (Math.abs(now - webhookTime) > 5 * 60 * 1000) {
          logger.warn('Webhook timestamp too old or in the future', {
            now,
            webhookTime,
            diff: now - webhookTime,
          });
          return res.status(401).json({ error: 'Timestamp too old or in the future' });
        }

        // Process webhook
        const payload = req.body as RecordingWebhookPayload;

        logger.info(`Received webhook: ${payload.event}`, {
          recordingId: payload.recordingId,
          sessionId: payload.sessionId,
          guildId: payload.guildId,
        });

        await this.handleWebhook(payload);

        res.status(200).json({ received: true });
      } catch (error) {
        logger.error('Error processing webhook', error as Error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }

  /**
   * Verify webhook signature
   */
  private verifySignature(payload: string, signature: string): boolean {
    if (!config.WEBHOOK_SECRET) {
      logger.warn('WEBHOOK_SECRET not configured, skipping signature verification');
      return true;
    }

    const expectedSignature =
      'sha256=' + crypto.createHmac('sha256', config.WEBHOOK_SECRET).update(payload).digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  }

  /**
   * Handle webhook payload
   */
  private async handleWebhook(payload: RecordingWebhookPayload): Promise<void> {
    switch (payload.event) {
      case 'recording.transcription.completed':
        await this.handleTranscriptionCompleted(payload);
        break;

      case 'recording.transcription.failed':
        await this.handleTranscriptionFailed(payload);
        break;

      default:
        logger.warn(`Unknown webhook event: ${(payload as any).event}`);
    }
  }

  /**
   * Handle transcription completed event
   */
  private async handleTranscriptionCompleted(
    payload: RecordingTranscriptionCompletedWebhook
  ): Promise<void> {
    logger.info('Transcription completed', {
      recordingId: payload.recordingId,
      sessionId: payload.sessionId,
      wordCount: payload.transcript.wordCount,
      confidence: payload.transcript.confidence,
    });

    if (!this.bot) {
      logger.warn('Bot not set, cannot send Discord notification');
      return;
    }

    try {
      // Get Discord channel
      const channel = await this.bot.client.channels.fetch(payload.channelId);

      if (!channel || !channel.isTextBased()) {
        logger.warn(`Channel ${payload.channelId} not found or not text-based`);
        return;
      }

      // Send notification embed
      const { EmbedBuilder } = await import('discord.js');

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('📝 Transcription Complete')
        .setDescription('Your recording has been transcribed and is ready to view!')
        .addFields([
          {
            name: 'Word Count',
            value: payload.transcript.wordCount.toLocaleString(),
            inline: true,
          },
          {
            name: 'Confidence',
            value: `${Math.round(payload.transcript.confidence * 100)}%`,
            inline: true,
          },
          {
            name: 'Session ID',
            value: `\`${payload.sessionId.substring(0, 8)}...\``,
            inline: true,
          },
        ])
        .setFooter({ text: `Recording ID: ${payload.recordingId}` })
        .setTimestamp();

      if ('send' in channel) {
        await channel.send({
          content: '🎙️ Recording transcription ready!',
          embeds: [embed],
          components: [
            {
              type: 1, // ACTION_ROW
              components: [
                {
                  type: 2, // BUTTON
                  style: 5, // LINK
                  label: 'View Recording',
                  url: payload.viewUrl,
                },
                {
                  type: 2, // BUTTON
                  style: 5, // LINK
                  label: 'Download Transcript',
                  url: payload.transcript.downloadUrl,
                },
              ],
            },
          ],
        });
      }

      logger.info('Discord notification sent successfully', {
        channelId: payload.channelId,
        recordingId: payload.recordingId,
      });
    } catch (error) {
      logger.error('Failed to send Discord notification', error as Error, {
        channelId: payload.channelId,
        recordingId: payload.recordingId,
      });
    }
  }

  /**
   * Handle transcription failed event
   */
  private async handleTranscriptionFailed(
    payload: RecordingTranscriptionFailedWebhook
  ): Promise<void> {
    logger.error('Transcription failed', {
      recordingId: payload.recordingId,
      sessionId: payload.sessionId,
      error: payload.error,
      retryCount: payload.retryCount,
    });

    if (!this.bot) {
      logger.warn('Bot not set, cannot send Discord notification');
      return;
    }

    try {
      // Get Discord channel
      const channel = await this.bot.client.channels.fetch(payload.channelId);

      if (!channel || !channel.isTextBased()) {
        logger.warn(`Channel ${payload.channelId} not found or not text-based`);
        return;
      }

      // Send notification embed
      const { EmbedBuilder } = await import('discord.js');

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ Transcription Failed')
        .setDescription('The transcription process encountered an error.')
        .addFields([
          {
            name: 'Error',
            value: payload.error,
            inline: false,
          },
          {
            name: 'Retry Count',
            value: payload.retryCount.toString(),
            inline: true,
          },
          {
            name: 'Session ID',
            value: `\`${payload.sessionId.substring(0, 8)}...\``,
            inline: true,
          },
        ])
        .setFooter({ text: `Recording ID: ${payload.recordingId}` })
        .setTimestamp();

      if ('send' in channel) {
        await channel.send({
          content: '⚠️ Recording transcription failed.',
          embeds: [embed],
        });
      }

      logger.info('Discord failure notification sent', {
        channelId: payload.channelId,
        recordingId: payload.recordingId,
      });
    } catch (error) {
      logger.error('Failed to send Discord failure notification', error as Error, {
        channelId: payload.channelId,
        recordingId: payload.recordingId,
      });
    }
  }

  /**
   * Start the webhook listener server
   */
  start(port: number = 3001): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(port, () => {
          logger.info(`Webhook listener started on port ${port}`);
          resolve();
        });

        this.server.on('error', (error: Error) => {
          logger.error('Webhook listener server error', error);
          reject(error);
        });
      } catch (error) {
        logger.error('Failed to start webhook listener', error as Error);
        reject(error);
      }
    });
  }

  /**
   * Stop the webhook listener server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Webhook listener stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// Singleton instance
export const webhookListener = new WebhookListener();
