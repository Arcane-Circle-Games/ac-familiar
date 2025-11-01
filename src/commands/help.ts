import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../bot/client';
import { logInfo, logError } from '../utils/logger';

export const helpCommand: Command = {
  name: 'help',
  description: 'Get a list of available commands and support information via DM',

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      // Create the help embed
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎲 Arcane Circle Bot Commands')
        .setDescription('Here are all the available commands for the Arcane Circle Discord Bot!')
        .addFields(
          {
            name: '🎮 Game Discovery',
            value:
              '`/games` - Browse available games with filtering/pagination\n' +
              '`/game-info` - Get detailed info about a specific game\n' +
              '`/search-games` - Search for games by keywords\n' +
              '`/gm-profile` - View a GM\'s profile and offerings\n' +
              '`/gm-game` - View specific GM game details\n' +
              '`/gm-bookings` - View your bookings as a GM\n' +
              '`/gm-stats` - View GM statistics',
            inline: false
          },
          {
            name: '🎯 Game Management',
            value:
              '`/join-game` - Book and join a game (requires payment method)\n' +
              '`/leave-game` - Leave a game you\'ve joined\n' +
              '`/my-games` - View your active games and bookings\n' +
              '`/next-session` - View your next scheduled session\n' +
              '`/set-game-channel` - Link a Discord channel to a game session\n' +
              '`/attendance` - Mark your attendance for a session',
            inline: false
          },
          {
            name: '🎙️ Recording',
            value:
              '`/record action:start` - Start recording voice channel\n' +
              '`/record action:stop-save` - Stop and save recording\n' +
              '**Note:** Recordings are uploaded to the Arcane Circle platform',
            inline: false
          },
          {
            name: '👤 Account Management',
            value:
              '`/link` - Connect your Discord account via OAuth\n' +
              '`/profile` - View your Arcane Circle profile',
            inline: false
          },
          {
            name: '🔧 Utility',
            value:
              '`/ping` - Check bot responsiveness\n' +
              '`/diagnostics` - Test API connectivity and authentication\n' +
              '`/help` - Show this help message',
            inline: false
          },
          {
            name: '💬 Need Help?',
            value:
              'Join our Discord server for support and community:\n' +
              '[**Join Arcane Circle Discord**](https://discord.gg/aZZz6VekQR)\n\n' +
              'You can also visit our website at [arcanecircle.games](https://arcanecircle.games)',
            inline: false
          }
        )
        .setFooter({
          text: 'Arcane Circle Discord Bot',
          iconURL: interaction.client.user?.displayAvatarURL()
        })
        .setTimestamp();

      // Try to send via DM
      try {
        await interaction.user.send({ embeds: [embed] });

        // Acknowledge in the channel
        await interaction.reply({
          content: '📬 I\'ve sent you a DM with all the available commands!',
          ephemeral: true
        });

        logInfo('Help command executed - DM sent successfully', {
          userId: interaction.user.id,
          username: interaction.user.username,
          guildId: interaction.guildId
        });

      } catch (dmError) {
        // If DM fails, send in channel instead
        logError('Failed to send DM for help command', dmError as Error, {
          userId: interaction.user.id
        });

        await interaction.reply({
          content: '⚠️ I couldn\'t send you a DM (you may have DMs disabled). Here\'s the help information:',
          embeds: [embed],
          ephemeral: true
        });

        logInfo('Help command executed - sent in channel (DM failed)', {
          userId: interaction.user.id,
          username: interaction.user.username,
          guildId: interaction.guildId
        });
      }

    } catch (error) {
      logError('Error executing help command', error as Error, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      await interaction.reply({
        content: '❌ An error occurred while sending the help information. Please try again later.',
        ephemeral: true
      });
    }
  }
};
