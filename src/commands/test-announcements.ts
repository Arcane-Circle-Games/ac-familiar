import { ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../bot/client';
import { logInfo } from '../utils/logger';

// This will be set by the bot when scheduler is initialized
let checkForNewGamesCallback: (() => Promise<void>) | null = null;

export function setAnnouncementTestCallback(callback: () => Promise<void>) {
  checkForNewGamesCallback = callback;
}

export const testAnnouncementsCommand: Command = {
  name: 'test-announcements',
  description: '[Admin] Manually trigger the game announcement check',
  options: [],

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      logInfo('Manual announcement check triggered', {
        userId: interaction.user.id,
        username: interaction.user.username
      });

      if (!checkForNewGamesCallback) {
        await interaction.editReply({
          content: '❌ Game announcement scheduler is not initialized or not enabled.'
        });
        return;
      }

      await interaction.editReply({
        content: '🔄 Checking for new games...'
      });

      // Trigger the check
      await checkForNewGamesCallback();

      await interaction.editReply({
        content: '✅ Game announcement check completed! Check the logs or announcement channel for results.'
      });
    } catch (error) {
      await interaction.editReply({
        content: `❌ Error: ${(error as Error).message}`
      });
    }
  }
};
