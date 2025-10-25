import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  ComponentType,
  ApplicationCommandOptionType
} from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logError } from '../utils/logger';

export const gmBookingsCommand: Command = {
  name: 'gm-bookings',
  description: 'Manage player applications for your games',
  options: [
    {
      name: 'list',
      description: 'View player applications',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'game',
          description: 'Game to view applications for',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        },
        {
          name: 'status',
          description: 'Filter by status',
          type: ApplicationCommandOptionType.String,
          required: false,
          choices: [
            { name: 'All', value: 'all' },
            { name: 'Pending', value: 'PENDING' },
            { name: 'Confirmed', value: 'CONFIRMED' },
            { name: 'Rejected', value: 'REJECTED' },
            { name: 'Waitlisted', value: 'WAITLISTED' }
          ]
        }
      ]
    },
    {
      name: 'accept',
      description: 'Accept a player application',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'booking-id',
          description: 'Booking ID to accept',
          type: ApplicationCommandOptionType.String,
          required: true
        },
        {
          name: 'message',
          description: 'Message to player',
          type: ApplicationCommandOptionType.String,
          required: false
        }
      ]
    },
    {
      name: 'reject',
      description: 'Reject a player application',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'booking-id',
          description: 'Booking ID to reject',
          type: ApplicationCommandOptionType.String,
          required: true
        },
        {
          name: 'reason',
          description: 'Rejection reason',
          type: ApplicationCommandOptionType.String,
          required: false
        }
      ]
    }
  ],

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      // Authenticate user first
      await arcaneAPI.authenticateWithDiscord(interaction.user.id);

      switch (subcommand) {
        case 'list':
          await handleApplications(interaction);
          break;
        case 'accept':
          await handleAcceptApplication(interaction);
          break;
        case 'reject':
          await handleRejectApplication(interaction);
          break;
      }

    } catch (error) {
      logError('GM bookings command failed', error as Error, {
        userId: interaction.user.id,
        subcommand
      });

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: '❌ Failed to execute command. Please ensure you are linked to Arcane Circle.',
        });
      } else {
        await interaction.reply({
          content: '❌ Failed to execute command. Please ensure you are linked to Arcane Circle.',
          ephemeral: true
        });
      }
    }
  },

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === 'game') {
      try {
        await arcaneAPI.authenticateWithDiscord(interaction.user.id);
        const user = await arcaneAPI.users.getUserByDiscordId(interaction.user.id);
        const games = await arcaneAPI.games.listGames({ gmId: user.id });

        const filtered = games
          .filter(game => game.title.toLowerCase().includes(focusedOption.value.toLowerCase()))
          .slice(0, 25)
          .map(game => ({ name: game.title, value: game.id }));

        await interaction.respond(filtered);
      } catch (error) {
        await interaction.respond([]);
      }
    }
  }
};

async function handleApplications(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const gameId = interaction.options.getString('game', true);
  const statusFilter = interaction.options.getString('status') || 'all';

  try {
    const params: any = {};
    if (statusFilter !== 'all') params.status = statusFilter;

    const bookings = await arcaneAPI.bookings.getGameBookings(gameId, params);

    if (!bookings || bookings.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('📝 No Applications Found')
        .setDescription('This game has no applications yet.')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📋 Player Applications')
      .setDescription(`Found ${bookings.length} application(s)`)
      .setTimestamp();

    bookings.forEach((booking: any, index: number) => {
      const statusEmoji = getApplicationStatusEmoji(booking.status);
      const playerName = typeof booking.player === 'object' ? booking.player.username : booking.player;

      embed.addFields({
        name: `${statusEmoji} Application ${index + 1}`,
        value: `**Player:** ${playerName}\n**Status:** ${booking.status}\n**Applied:** ${new Date(booking.createdAt).toLocaleDateString()}\n**ID:** ${booking.id}`,
        inline: true
      });
    });

    // Add action buttons for pending applications
    const pendingBookings = bookings.filter((b: any) => b.status === 'PENDING');
    if (pendingBookings.length > 0) {
      const row = new ActionRowBuilder<ButtonBuilder>();

      row.addComponents(
        new ButtonBuilder()
          .setCustomId('accept_first')
          .setLabel('✅ Accept First')
          .setStyle(ButtonStyle.Success)
          .setDisabled(pendingBookings.length === 0),

        new ButtonBuilder()
          .setCustomId('reject_first')
          .setLabel('❌ Reject First')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(pendingBookings.length === 0)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });

      // Handle button interactions
      const filter = (buttonInteraction: ButtonInteraction) =>
        buttonInteraction.user.id === interaction.user.id;

      try {
        const firstBooking = pendingBookings[0];
        if (!firstBooking) {
          return;
        }

        const message = await interaction.fetchReply();
        const buttonInteraction = await message.awaitMessageComponent({
          filter,
          time: 60000,
          componentType: ComponentType.Button
        });

        if (buttonInteraction.customId === 'accept_first') {
          await arcaneAPI.bookings.updateBookingStatus(firstBooking.id, 'CONFIRMED', interaction.user.id);
          await buttonInteraction.reply({
            content: `✅ Accepted application from ${typeof firstBooking.player === 'object' ? firstBooking.player.username : firstBooking.player}`,
            ephemeral: true
          });
        } else if (buttonInteraction.customId === 'reject_first') {
          await arcaneAPI.bookings.updateBookingStatus(firstBooking.id, 'REJECTED', interaction.user.id);
          await buttonInteraction.reply({
            content: `❌ Rejected application from ${typeof firstBooking.player === 'object' ? firstBooking.player.username : firstBooking.player}`,
            ephemeral: true
          });
        }
      } catch (error) {
        // Button interaction timed out
      }
    } else {
      await interaction.editReply({ embeds: [embed] });
    }

  } catch (error) {
    await interaction.editReply({
      content: '❌ Failed to retrieve applications. Please try again later.'
    });
  }
}

async function handleAcceptApplication(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const bookingId = interaction.options.getString('booking-id', true);
  const message = interaction.options.getString('message');

  try {
    await arcaneAPI.bookings.updateBookingStatus(bookingId, 'CONFIRMED', interaction.user.id, { message });

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('✅ Application Accepted')
      .setDescription(`Successfully accepted application ${bookingId}`)
      .setTimestamp();

    if (message) {
      embed.addFields({
        name: '💬 Message Sent',
        value: message,
        inline: false
      });
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    await interaction.editReply({
      content: '❌ Failed to accept application. Please check the booking ID and try again.'
    });
  }
}

async function handleRejectApplication(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const bookingId = interaction.options.getString('booking-id', true);
  const reason = interaction.options.getString('reason');

  try {
    await arcaneAPI.bookings.updateBookingStatus(bookingId, 'REJECTED', interaction.user.id, { reason });

    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('❌ Application Rejected')
      .setDescription(`Successfully rejected application ${bookingId}`)
      .setTimestamp();

    if (reason) {
      embed.addFields({
        name: '📝 Reason',
        value: reason,
        inline: false
      });
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    await interaction.editReply({
      content: '❌ Failed to reject application. Please check the booking ID and try again.'
    });
  }
}

function getApplicationStatusEmoji(status: string): string {
  const statusEmojis: Record<string, string> = {
    'PENDING': '⏳',
    'CONFIRMED': '✅',
    'REJECTED': '❌',
    'WAITLISTED': '📝'
  };
  return statusEmojis[status] || '❔';
}
