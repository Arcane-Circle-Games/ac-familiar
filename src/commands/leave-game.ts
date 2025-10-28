import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ApplicationCommandOptionType,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logInfo, logError } from '../utils/logger';
import { config } from '../utils/config';

export const leaveGameCommand: Command = {
  name: 'leave-game',
  description: 'Leave a game you have joined',
  options: [
    {
      name: 'game',
      description: 'Select the game you want to leave',
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true
    }
  ],

  async autocomplete(interaction: AutocompleteInteraction) {
    try {
      const discordUserId = interaction.user.id;

      // Fetch user's bookings with timeout (Discord autocomplete has 3 second limit)
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Autocomplete timeout')), 2500)
      );

      const bookingsPromise = arcaneAPI.bookings.getMyBookings(discordUserId);

      const bookings = await Promise.race([bookingsPromise, timeoutPromise]);

      logInfo('Autocomplete: Retrieved bookings', {
        userId: discordUserId,
        bookingsCount: bookings.length,
        bookings: bookings
      });

      // Convert bookings to autocomplete choices
      // Format: "Game Title (GM: GM Name)"
      // Value: booking ID
      const choices = bookings.map(booking => ({
        name: `${booking.game.title} (GM: ${booking.game.gm.displayName})`,
        value: booking.id
      }));

      logInfo('Autocomplete: Generated choices', {
        userId: discordUserId,
        choicesCount: choices.length,
        choices: choices
      });

      // Discord limits autocomplete to 25 choices
      const limitedChoices = choices.slice(0, 25);

      await interaction.respond(limitedChoices);
    } catch (error: any) {
      // Don't log "Unknown interaction" errors - they're expected when responses are slow
      if (error.code !== 10062) {
        logError('Autocomplete failed for leave-game', error as Error, {
          userId: interaction.user.id
        });
      }

      // Try to respond with empty array if interaction is still valid
      try {
        await interaction.respond([]);
      } catch {
        // Interaction already expired, nothing we can do
      }
    }
  },

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const bookingId = interaction.options.getString('game', true);
      const discordUserId = interaction.user.id;

      logInfo('User attempting to leave game', {
        userId: discordUserId,
        username: interaction.user.username,
        bookingId
      });

      // Fetch user's bookings to get game details for confirmation
      const bookings = await arcaneAPI.bookings.getMyBookings(discordUserId);
      const booking = bookings.find(b => b.id === bookingId);

      if (!booking) {
        const notFoundEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Booking Not Found')
          .setDescription('Could not find that booking. It may have already been cancelled.')
          .setTimestamp();

        await interaction.editReply({ embeds: [notFoundEmbed] });
        return;
      }

      // Leave the game
      await arcaneAPI.bookings.leaveGame(bookingId, discordUserId);

      // Success message
      const successEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ You\'ve Left the Game')
        .setDescription(`You have successfully left **${booking.game.title}**. The GM has been notified.`)
        .addFields(
          {
            name: '🎮 Game Details',
            value: [
              `**System:** ${booking.game.system.shortName || booking.game.system.name}`,
              `**GM:** ${booking.game.gm.displayName}`,
              `**Type:** ${booking.game.gameType}`
            ].join('\n'),
            inline: false
          }
        );

      // Add payment info if applicable
      if (booking.paymentStatus) {
        successEmbed.addFields({
          name: '💳 Payment',
          value: 'Any pre-authorizations have been cancelled. You will not be charged for future sessions.',
          inline: false
        });
      }

      // Add link to browse other games
      successEmbed.addFields({
        name: '🔍 Find Another Game',
        value: `Looking for a new adventure? [Browse games on Arcane Circle](${config.PLATFORM_WEB_URL}/games)`,
        inline: false
      });

      successEmbed.setTimestamp();
      successEmbed.setFooter({
        text: 'Arcane Circle',
        iconURL: interaction.client.user?.displayAvatarURL()
      });

      await interaction.editReply({ embeds: [successEmbed] });

      logInfo('Successfully left game', {
        userId: discordUserId,
        bookingId,
        gameTitle: booking.game.title
      });

    } catch (error) {
      logError('Leave game command failed', error as Error, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      const errorMessage = (error as any).message || 'Unknown error';

      // Handle specific error cases
      if (errorMessage.toLowerCase().includes('not linked') || errorMessage.toLowerCase().includes('discord account')) {
        const notLinkedEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Account Not Linked')
          .setDescription('You need to link your Discord account to Arcane Circle before you can leave games.')
          .addFields({
            name: '🔗 Link Your Account',
            value: `Use \`/link\` to connect your Discord account`,
            inline: false
          })
          .setTimestamp();

        await interaction.editReply({ embeds: [notLinkedEmbed] });
        return;
      }

      // Generic error
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Failed to Leave Game')
        .setDescription('Unable to leave the game at this time.')
        .addFields(
          {
            name: '❗ Error Details',
            value: `\`${errorMessage}\``,
            inline: false
          },
          {
            name: '💡 Try Again',
            value: 'Please try again in a moment. If the issue persists, you can contact the GM directly or reach out to support.',
            inline: false
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
};
