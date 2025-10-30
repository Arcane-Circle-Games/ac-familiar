import {
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logInfo, logError } from '../utils/logger';
import { config } from '../utils/config';

export const myGamesCommand: Command = {
  name: 'my-games',
  description: 'View all your active games with next session info',
  options: [],

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const discordUserId = interaction.user.id;

      logInfo('User requesting their games', {
        userId: discordUserId,
        username: interaction.user.username
      });

      // Verify user is linked
      const user = await arcaneAPI.getUserByDiscordId(discordUserId);
      if (!user) {
        const notLinkedEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Account Not Linked')
          .setDescription('You need to link your Discord account to Arcane Circle first.')
          .addFields({
            name: '🔗 Link Your Account',
            value: 'Use `/link` to connect your Discord account',
            inline: false
          })
          .setTimestamp();

        await interaction.editReply({ embeds: [notLinkedEmbed] });
        return;
      }

      // Fetch user's bookings
      const bookings = await arcaneAPI.bookings.getMyBookings(discordUserId);

      logInfo('Retrieved user bookings', {
        userId: discordUserId,
        bookingsCount: bookings.length
      });

      // No active games
      if (bookings.length === 0) {
        const noGamesEmbed = new EmbedBuilder()
          .setColor(0xFFA500)
          .setTitle('📚 Your Active Games')
          .setDescription('You\'re not currently in any games.')
          .addFields({
            name: '🔍 Find a Game',
            value: `Browse available games:\n• Use \`/games\` to search\n• Visit [Arcane Circle](${config.PLATFORM_WEB_URL}/games)`,
            inline: false
          })
          .setTimestamp()
          .setFooter({
            text: 'Arcane Circle',
            iconURL: interaction.client.user?.displayAvatarURL()
          });

        await interaction.editReply({ embeds: [noGamesEmbed] });
        return;
      }

      // Build the embed with all games
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`📚 Your Active Games (${bookings.length})`)
        .setDescription('Here are all the games you\'re currently playing:')
        .setTimestamp()
        .setFooter({
          text: 'Arcane Circle',
          iconURL: interaction.client.user?.displayAvatarURL()
        });

      // Add a field for each game
      bookings.forEach((booking, index) => {
        const game = booking.game;
        const gameUrl = `${config.PLATFORM_WEB_URL}/games/${game.vanitySlug || game.id}`;

        // Build game info
        const gameInfo = [
          `**GM:** ${game.gm.displayName}`,
          `**System:** ${game.system.shortName || game.system.name}`,
          `**Type:** ${game.gameType}`
        ];

        // Add next session info if available
        if (game.nextSession) {
          const sessionTime = new Date(game.nextSession.scheduledTime);
          const timeStr = `<t:${Math.floor(sessionTime.getTime() / 1000)}:F>`;
          gameInfo.push(`**Next Session:** ${timeStr}`);
        } else if (game.startTime) {
          const startTime = new Date(game.startTime);
          const timeStr = `<t:${Math.floor(startTime.getTime() / 1000)}:F>`;
          gameInfo.push(`**Starts:** ${timeStr}`);
        }

        // Add frequency for recurring games
        if (game.isRecurring && game.frequency) {
          gameInfo.push(`**Schedule:** ${game.frequency}`);
        }

        gameInfo.push(`[View Game](${gameUrl})`);

        embed.addFields({
          name: `${index === 0 ? '🎲' : index === 1 ? '🗡️' : index === 2 ? '⚔️' : '🎭'} ${game.title}`,
          value: gameInfo.join('\n'),
          inline: false
        });
      });

      await interaction.editReply({ embeds: [embed] });

      logInfo('Successfully displayed user games', {
        userId: discordUserId,
        gamesCount: bookings.length
      });

    } catch (error) {
      logError('My games command failed', error as Error, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      const errorMessage = (error as any).message || 'Unknown error';

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Failed to Load Games')
        .setDescription('Unable to retrieve your games at this time.')
        .addFields({
          name: '❗ Error Details',
          value: `\`${errorMessage}\``,
          inline: false
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
};
