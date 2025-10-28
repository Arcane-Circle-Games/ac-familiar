import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  ApplicationCommandOptionType
} from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logInfo, logError } from '../utils/logger';
import { config } from '../utils/config';

export const joinGameCommand: Command = {
  name: 'join-game',
  description: 'Book and join a game on Arcane Circle (requires payment method)',
  options: [
    {
      name: 'game-id',
      description: 'The game ID (from /games or /search-games)',
      type: ApplicationCommandOptionType.String,
      required: true
    },
    {
      name: 'message',
      description: 'Message to the GM (optional)',
      type: ApplicationCommandOptionType.String,
      required: false
    },
    {
      name: 'character',
      description: 'Your character concept (optional)',
      type: ApplicationCommandOptionType.String,
      required: false
    }
  ],

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const gameId = interaction.options.getString('game-id', true);
      const applicationMessage = interaction.options.getString('message');
      const characterConcept = interaction.options.getString('character');

      logInfo('User applying to join game', {
        userId: interaction.user.id,
        username: interaction.user.username,
        gameId,
        hasMessage: !!applicationMessage,
        hasCharacter: !!characterConcept
      });

      // Get game details first
      let game;
      try {
        game = await arcaneAPI.games.getGame(gameId);
      } catch (error) {
        const gameNotFoundEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Game Not Found')
          .setDescription(`Could not find a game with ID: \`${gameId}\``)
          .addFields({
            name: '💡 How to Find Game IDs',
            value: 'Use `/games` or `/search-games` to browse games.\nGame IDs are shown in the "View Details" links.',
            inline: false
          })
          .setTimestamp();

        await interaction.editReply({ embeds: [gameNotFoundEmbed] });
        return;
      }

      // Create deferred booking
      const bookingData: any = {};
      if (applicationMessage) {
        bookingData.applicationMessage = applicationMessage;
      }
      if (characterConcept) {
        bookingData.characterConcept = characterConcept;
      }

      // API will handle:
      // - User lookup via discordUserId
      // - Default payment method lookup
      // - First future session lookup
      // - Deferred booking creation with payment pre-auth
      let booking;
      try {
        const result = await arcaneAPI.games.createDeferredBooking(gameId, bookingData, interaction.user.id);
        booking = result.data || result;
      } catch (error: any) {
        // Handle specific error cases from API
        const errorMessage = error.message?.toLowerCase() || '';

        if (errorMessage.includes('not linked') || errorMessage.includes('discord account')) {
          const notLinkedEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Account Not Linked')
            .setDescription('You need to link your Discord account to Arcane Circle before joining games.')
            .addFields({
              name: '🔗 Link Your Account',
              value: `Use \`/link\` to connect your Discord account`,
              inline: false
            })
            .setTimestamp();

          await interaction.editReply({ embeds: [notLinkedEmbed] });
          return;
        }

        if (errorMessage.includes('payment method') || errorMessage.includes('no default payment')) {
          const noPaymentEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ No Payment Method')
            .setDescription('You need to add a payment method to your Arcane Circle account before joining paid games.')
            .addFields({
              name: '💳 Add Payment Method',
              value: `[Manage Payment Methods](${config.PLATFORM_WEB_URL}/dashboard/settings/payments)`,
              inline: false
            })
            .setTimestamp();

          await interaction.editReply({ embeds: [noPaymentEmbed] });
          return;
        }

        if (errorMessage.includes('no future sessions') || errorMessage.includes('no sessions')) {
          const noSessionsEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ No Sessions Available')
            .setDescription(`This game has no upcoming sessions scheduled.`)
            .addFields({
              name: '📅 Contact GM',
              value: `Please contact the GM to schedule sessions before booking.`,
              inline: false
            })
            .setTimestamp();

          await interaction.editReply({ embeds: [noSessionsEmbed] });
          return;
        }

        if (errorMessage.includes('full') || errorMessage.includes('max players')) {
          const gameFullEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Game is Full')
            .setDescription(`**${game.title}** has reached maximum capacity.`)
            .addFields({
              name: '👥 Wait List',
              value: `Consider contacting the GM to be added to a wait list.`,
              inline: false
            })
            .setTimestamp();

          await interaction.editReply({ embeds: [gameFullEmbed] });
          return;
        }

        // Re-throw other errors to be handled below
        throw error;
      }

      // Success!
      const systemName = typeof game.system === 'object'
        ? game.system.shortName || game.system.name
        : game.system;
      const gmName = typeof game.gm === 'object'
        ? game.gm.displayName
        : 'the GM';

      const successEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ Booking Confirmed!')
        .setDescription(`You've successfully joined **${game.title}**! Payment has been pre-authorized for future sessions.`)
        .addFields(
          {
            name: '🎮 Game Details',
            value: [
              `**System:** ${systemName}`,
              `**Type:** ${game.gameType}`,
              `**GM:** ${gmName}`
            ].join('\n'),
            inline: false
          }
        );

      if (booking?.id) {
        successEmbed.addFields({
          name: '📋 Booking ID',
          value: `\`${booking.id}\``,
          inline: false
        });
      }

      if (applicationMessage) {
        successEmbed.addFields({
          name: '💬 Your Message',
          value: applicationMessage.length > 200
            ? applicationMessage.substring(0, 200) + '...'
            : applicationMessage,
          inline: false
        });
      }

      if (characterConcept) {
        successEmbed.addFields({
          name: '🎭 Character Concept',
          value: characterConcept.length > 200
            ? characterConcept.substring(0, 200) + '...'
            : characterConcept,
          inline: false
        });
      }

      successEmbed.addFields(
        {
          name: '💳 Payment',
          value: `Your payment method has been pre-authorized. You'll be charged when the GM starts each session.\n\nManage your booking on the [game page](${config.PLATFORM_WEB_URL}/games/${gameId})`,
          inline: false
        }
      );

      successEmbed.setTimestamp();
      successEmbed.setFooter({
        text: 'Arcane Circle',
        iconURL: interaction.client.user?.displayAvatarURL()
      });

      await interaction.editReply({ embeds: [successEmbed] });

      logInfo('Successfully created deferred booking', {
        userId: interaction.user.id,
        gameId,
        gameTitle: game.title,
        bookingId: booking?.id
      });

    } catch (error) {
      logError('Join game command failed', error as Error, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Application Failed')
        .setDescription('Unable to submit your application.')
        .addFields(
          {
            name: '❗ Error Details',
            value: `\`${(error as Error).message}\``,
            inline: false
          },
          {
            name: '💡 Try Again',
            value: 'Please try again in a moment. If the issue persists, contact support.',
            inline: false
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
};
