import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ApplicationCommandOptionType,
  AutocompleteInteraction
} from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logInfo, logError } from '../utils/logger';

export const attendanceCommand: Command = {
  name: 'attendance',
  description: 'View and manage session attendance',
  options: [
    {
      name: 'game',
      description: 'Select a game',
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true
    },
    {
      name: 'session',
      description: 'Select a session from the game',
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true
    }
  ],

  async autocomplete(interaction: AutocompleteInteraction) {
    const focusedOption = interaction.options.getFocused(true);

    try {
      // Get user
      const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
      if (!user) {
        return interaction.respond([
          { name: 'Link your Discord account first (/link)', value: 'not_linked' }
        ]);
      }

      // STEP 1: Game autocomplete - show both player games and GM games
      if (focusedOption.name === 'game') {
        const allGames: Array<{ id: string; title: string; role: 'player' | 'gm' }> = [];

        // Get player bookings
        const bookings = await arcaneAPI.bookings.getMyBookings(interaction.user.id);
        for (const booking of bookings) {
          allGames.push({
            id: booking.game.id,
            title: booking.game.title,
            role: 'player'
          });
        }

        // Get GM games
        const gmGames = await arcaneAPI.games.listGames({
          gmId: user.id,
          status: 'PUBLISHED'
        });

        for (const game of gmGames) {
          // Don't duplicate if already in player games
          if (!allGames.find(g => g.id === game.id)) {
            allGames.push({
              id: game.id,
              title: game.title,
              role: 'gm'
            });
          }
        }

        if (allGames.length === 0) {
          return interaction.respond([
            { name: 'No games found', value: 'no_games' }
          ]);
        }

        const choices = allGames
          .filter(game =>
            game.title.toLowerCase().includes(focusedOption.value.toLowerCase())
          )
          .slice(0, 25)
          .map(game => ({
            name: `${game.title}${game.role === 'gm' ? ' (You\'re GM)' : ''}`,
            value: game.id
          }));

        return interaction.respond(choices);
      }

      // STEP 2: Session autocomplete
      if (focusedOption.name === 'session') {
        const selectedGameId = interaction.options.getString('game');

        if (!selectedGameId) {
          return interaction.respond([
            { name: 'Select a game first', value: 'no_game' }
          ]);
        }

        const sessions = await arcaneAPI.sessions.getGameSessions(
          selectedGameId,
          interaction.user.id
        );

        logInfo('Fetched sessions for autocomplete', {
          userId: interaction.user.id,
          gameId: selectedGameId,
          sessionsCount: sessions.length,
          sampleSession: sessions[0] ? JSON.stringify(sessions[0], null, 2) : 'none'
        });

        if (sessions.length === 0) {
          return interaction.respond([
            { name: 'No sessions found for this game', value: 'no_sessions' }
          ]);
        }

        const choices = sessions
          .map(session => {
            // API returns scheduledTime field
            const scheduledDate = (session as any).scheduledTime || session.scheduledFor;
            const date = scheduledDate ? new Date(scheduledDate).toLocaleDateString() : 'TBD';
            const sessionNum = session.sessionNumber || '?';
            const status = session.status || 'scheduled';

            return {
              name: `Session ${sessionNum} - ${date} (${status})`.substring(0, 100),
              value: session.id
            };
          })
          .filter(choice =>
            choice.name.toLowerCase().includes(focusedOption.value.toLowerCase())
          )
          .slice(0, 25);

        return interaction.respond(choices);
      }

    } catch (error) {
      logError('Attendance autocomplete failed', error as Error, {
        userId: interaction.user.id
      });
      await interaction.respond([]);
    }
  },

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const discordUserId = interaction.user.id;
      const gameId = interaction.options.getString('game', true);
      const sessionId = interaction.options.getString('session', true);

      logInfo('User requesting attendance', {
        userId: discordUserId,
        username: interaction.user.username,
        gameId,
        sessionId
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

      // Get game info
      const game = await arcaneAPI.games.getGame(gameId);
      const gameTitle = game.title;

      // Check if user is GM
      const isGM = game.gmId === user.id;

      // Get session details with attendances included
      const gameSessions = await arcaneAPI.sessions.getGameSessions(gameId, discordUserId, true);

      logInfo('Retrieved game sessions for attendance', {
        userId: discordUserId,
        gameId,
        sessionsCount: gameSessions.length,
        sessionIds: gameSessions.map((s: any) => s.id),
        sampleSession: gameSessions[0] ? JSON.stringify(gameSessions[0], null, 2) : 'none'
      });

      const session = gameSessions.find((s: any) => s.id === sessionId);

      if (!session) {
        const noSessionEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Session Not Found')
          .setDescription('Could not find this session.')
          .setTimestamp();

        await interaction.editReply({ embeds: [noSessionEmbed] });
        return;
      }

      // API returns scheduledTime field
      const scheduledDate = (session as any).scheduledTime || session.scheduledFor;
      const sessionTime = scheduledDate ? new Date(scheduledDate) : null;

      // Get attendances from session data
      const attendances = (session as any).attendances || [];
      const attendanceCount = (session as any)._count?.attendances || attendances.length || 0;

      logInfo('Retrieved session for attendance', {
        userId: discordUserId,
        sessionId,
        attendanceCount,
        hasAttendancesArray: Array.isArray(attendances),
        sampleAttendance: attendances[0] ? JSON.stringify(attendances[0]) : 'none'
      });

      // Build session description
      let sessionDescription = '';
      if (sessionTime) {
        sessionDescription = `**Session ${session.sessionNumber || '?'}:** ${sessionTime.toLocaleString()}`;
      } else {
        sessionDescription = `**Session ${session.sessionNumber || '?'}**`;
      }

      if (isGM) {
        sessionDescription += '\n*You\'re the GM for this session*';
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`📋 Attendance: ${gameTitle}`)
        .setDescription(sessionDescription)
        .setTimestamp()
        .setFooter({
          text: 'Arcane Circle',
          iconURL: interaction.client.user?.displayAvatarURL()
        });

      // Build attendance lists if we have the data
      if (attendances.length > 0) {
        const confirmed = attendances.filter((a: any) => a.status === 'confirmed' || a.status === 'attended');
        const declined = attendances.filter((a: any) => a.status === 'declined' || a.status === 'absent');
        const pending = attendances.filter((a: any) => a.status === 'maybe' || !a.status);

        if (confirmed.length > 0) {
          embed.addFields({
            name: `✅ Attending (${confirmed.length})`,
            value: confirmed.map((a: any) => {
              const username = a.user?.displayName || a.user?.username || 'Unknown';
              return `• ${username}`;
            }).join('\n') || '*None*',
            inline: false
          });
        }

        if (declined.length > 0) {
          embed.addFields({
            name: `❌ Can't Make It (${declined.length})`,
            value: declined.map((a: any) => {
              const username = a.user?.displayName || a.user?.username || 'Unknown';
              return `• ${username}`;
            }).join('\n') || '*None*',
            inline: false
          });
        }

        if (pending.length > 0) {
          embed.addFields({
            name: `❓ No Response (${pending.length})`,
            value: pending.map((a: any) => {
              const username = a.user?.displayName || a.user?.username || 'Unknown';
              return `• ${username}`;
            }).join('\n') || '*None*',
            inline: false
          });
        }
      } else if (attendanceCount > 0) {
        // We have a count but no attendances array - show count only
        embed.addFields({
          name: '👥 Attendance',
          value: `${attendanceCount} ${attendanceCount === 1 ? 'person has' : 'people have'} marked attendance`,
          inline: false
        });
      } else {
        // No attendance at all
        embed.addFields({
          name: '👥 Attendance',
          value: '*No attendance recorded yet*',
          inline: false
        });
      }

      // Add interactive buttons for players (not GMs)
      const components: ActionRowBuilder<ButtonBuilder>[] = [];

      if (!isGM) {
        const row = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('attendance_confirm')
              .setLabel('Mark as Attending')
              .setStyle(ButtonStyle.Success)
              .setEmoji('✅'),
            new ButtonBuilder()
              .setCustomId('attendance_decline')
              .setLabel('Mark as Absent')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('❌')
          );

        components.push(row);
      }

      const messageOptions: any = { embeds: [embed] };
      if (components.length > 0) {
        messageOptions.components = components;
      }
      const message = await interaction.editReply(messageOptions);

      // Handle button interactions (only for players)
      if (!isGM) {
        const collector = message.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 300000 // 5 minutes
        });

        collector.on('collect', async (buttonInteraction) => {
          if (buttonInteraction.user.id !== interaction.user.id) {
            await buttonInteraction.reply({
              content: '❌ These buttons are not for you!',
              ephemeral: true
            });
            return;
          }

          await buttonInteraction.deferUpdate();

          try {
            const [, action] = buttonInteraction.customId.split('_');
            const status = action === 'confirm' ? 'confirmed' : 'declined';

            // Mark attendance
            await arcaneAPI.sessions.markAttendance(sessionId, status, discordUserId);

            // Update embed with success message
            const statusText = status === 'confirmed' ? 'attending' : 'not attending';
            const statusEmoji = status === 'confirmed' ? '✅' : '❌';

            const updatedEmbed = new EmbedBuilder()
              .setColor(status === 'confirmed' ? 0x00ff00 : 0xff0000)
              .setTitle(`📋 Attendance: ${gameTitle}`)
              .setDescription(sessionDescription)
              .setTimestamp()
              .setFooter({
                text: 'Arcane Circle',
                iconURL: interaction.client.user?.displayAvatarURL()
              });

            updatedEmbed.addFields({
              name: '📌 Your Status',
              value: `${statusEmoji} You've marked yourself as **${statusText}**`,
              inline: false
            });

            // Update buttons
            const updatedRow = new ActionRowBuilder<ButtonBuilder>()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId('attendance_confirm')
                  .setLabel(status === 'confirmed' ? '✓ Attending' : 'Mark as Attending')
                  .setStyle(status === 'confirmed' ? ButtonStyle.Success : ButtonStyle.Primary)
                  .setEmoji('✅'),
                new ButtonBuilder()
                  .setCustomId('attendance_decline')
                  .setLabel(status === 'declined' ? '✓ Can\'t Make It' : 'Mark as Absent')
                  .setStyle(status === 'declined' ? ButtonStyle.Danger : ButtonStyle.Secondary)
                  .setEmoji('❌')
              );

            await buttonInteraction.editReply({
              embeds: [updatedEmbed],
              components: [updatedRow]
            });

            logInfo('User marked attendance', {
              userId: discordUserId,
              sessionId,
              status
            });

          } catch (error) {
            logError('Failed to mark attendance', error as Error, {
              userId: discordUserId,
              sessionId
            });

            await buttonInteraction.followUp({
              content: '❌ Failed to update attendance. Please try again.',
              ephemeral: true
            });
          }
        });

        collector.on('end', () => {
          // Disable buttons after timeout
          const disabledRow = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
              new ButtonBuilder()
                .setCustomId('attendance_confirm_disabled')
                .setLabel('Mark as Attending')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✅')
                .setDisabled(true),
              new ButtonBuilder()
                .setCustomId('attendance_decline_disabled')
                .setLabel('Mark as Absent')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('❌')
                .setDisabled(true)
            );

          interaction.editReply({ components: [disabledRow] }).catch(() => {});
        });
      }

    } catch (error) {
      logError('Attendance command failed', error as Error, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      const errorMessage = (error as any).message || 'Unknown error';

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Failed to Load Attendance')
        .setDescription('Unable to retrieve attendance at this time.')
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
