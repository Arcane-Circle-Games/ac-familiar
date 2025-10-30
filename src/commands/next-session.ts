import {
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logInfo, logError } from '../utils/logger';
import { config } from '../utils/config';

export const nextSessionCommand: Command = {
  name: 'next-session',
  description: 'See your next upcoming session across all games',
  options: [],

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const discordUserId = interaction.user.id;

      logInfo('User requesting next session', {
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

      // Fetch user's bookings (games they're playing in)
      const bookings = await arcaneAPI.bookings.getMyBookings(discordUserId);

      logInfo('Retrieved user bookings for next session', {
        userId: discordUserId,
        bookingsCount: bookings.length
      });

      // Also check games where the user is the GM
      let gmGames: any[] = [];
      try {
        logInfo('Fetching GM games with filters', {
          userId: discordUserId,
          userIdForFilter: user.id,
          filters: { gmId: user.id }
        });

        const allGmGames = await arcaneAPI.games.listGames({ gmId: user.id });

        logInfo('Raw GM games API response', {
          userId: discordUserId,
          totalGamesReturned: allGmGames.length,
          allGames: JSON.stringify(allGmGames, null, 2)
        });

        gmGames = allGmGames.filter((g: any) => g.status === 'PUBLISHED');

        logInfo('Filtered GM games for next session', {
          userId: discordUserId,
          totalGames: allGmGames.length,
          publishedGamesCount: gmGames.length,
          allGameStatuses: allGmGames.map((g: any) => ({ id: g.id, title: g.title, status: g.status })),
          publishedGames: gmGames.map((g: any) => ({ id: g.id, title: g.title, status: g.status }))
        });
      } catch (error) {
        logError('Failed to fetch GM games', error as Error, { userId: discordUserId });
      }

      // No active games at all
      if (bookings.length === 0 && gmGames.length === 0) {
        const noGamesEmbed = new EmbedBuilder()
          .setColor(0xFFA500)
          .setTitle('⏰ Next Session')
          .setDescription('You\'re not currently in any games or running any games.')
          .addFields({
            name: '🔍 Find a Game',
            value: `Use \`/games\` to browse available games or visit [Arcane Circle](${config.PLATFORM_WEB_URL}/games)`,
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

      // Find the next upcoming session across all games
      let nextSession: {
        game: typeof bookings[0]['game'];
        sessionTime: Date;
        sessionNumber?: number;
        role: 'player' | 'gm';
      } | null = null;

      const now = new Date();

      // Check player bookings
      for (const booking of bookings) {
        const game = booking.game;
        let sessionTime: Date | null = null;
        let sessionNumber: number | undefined;

        // Check if there's a next session scheduled
        if (game.nextSession?.scheduledTime) {
          sessionTime = new Date(game.nextSession.scheduledTime);
          sessionNumber = game.nextSession.sessionNumber;
        } else if (game.startTime) {
          // Fall back to game start time if no next session
          const startTime = new Date(game.startTime);
          if (startTime > now) {
            sessionTime = startTime;
          }
        }

        // Update next session if this one is sooner
        if (sessionTime && sessionTime > now) {
          if (!nextSession || sessionTime < nextSession.sessionTime) {
            nextSession = {
              game,
              sessionTime,
              role: 'player',
              ...(sessionNumber !== undefined && { sessionNumber })
            };
          }
        }
      }

      // Check GM games
      for (const gmGame of gmGames) {
        try {
          // Check if the game has nextSessionTime directly
          if (gmGame.nextSessionTime) {
            const sessionTime = new Date(gmGame.nextSessionTime);
            if (sessionTime > now) {
              if (!nextSession || sessionTime < nextSession.sessionTime) {
                // Get display name for the GM
                const displayName = (user as any).displayName
                  || (user.profile?.firstName && user.profile?.lastName
                    ? `${user.profile.firstName} ${user.profile.lastName}`
                    : user.profile?.firstName || user.profile?.lastName)
                  || user.username;

                // Create a game object that matches the booking structure
                nextSession = {
                  game: {
                    id: gmGame.id,
                    title: gmGame.title,
                    vanitySlug: gmGame.vanitySlug,
                    gameType: gmGame.gameType,
                    isRecurring: gmGame.isRecurring || false,
                    frequency: gmGame.frequency,
                    startTime: gmGame.nextSessionTime,
                    system: gmGame.system || { name: 'Unknown', shortName: 'Unknown' },
                    gm: {
                      displayName: displayName,
                      vanitySlug: (user as any).vanitySlug || user.id
                    },
                    nextSession: {
                      sessionNumber: 1, // We don't have this info from the game object
                      scheduledTime: gmGame.nextSessionTime
                    }
                  } as any,
                  sessionTime,
                  role: 'gm'
                };

                logInfo('Found next session as GM (from game.nextSessionTime)', {
                  userId: discordUserId,
                  gameId: gmGame.id,
                  gameTitle: gmGame.title,
                  sessionTime: sessionTime.toISOString()
                });
              }
            }
          }
        } catch (error) {
          logError('Failed to process GM game session time', error as Error, {
            userId: discordUserId,
            gameId: gmGame.id,
            gameTitle: gmGame.title
          });
          // Continue checking other games
        }
      }

      // No upcoming sessions
      if (!nextSession) {
        const noSessionsEmbed = new EmbedBuilder()
          .setColor(0xFFA500)
          .setTitle('⏰ Next Session')
          .setDescription('You don\'t have any upcoming sessions scheduled.')
          .addFields({
            name: '📚 Your Games',
            value: `Use \`/my-games\` to see all your active games`,
            inline: false
          })
          .setTimestamp()
          .setFooter({
            text: 'Arcane Circle',
            iconURL: interaction.client.user?.displayAvatarURL()
          });

        await interaction.editReply({ embeds: [noSessionsEmbed] });
        return;
      }

      // Build embed with next session info
      const game = nextSession.game;
      const gameUrl = `${config.PLATFORM_WEB_URL}/games/${game.vanitySlug || game.id}`;
      const timeStr = `<t:${Math.floor(nextSession.sessionTime.getTime() / 1000)}:F>`;
      const relativeTimeStr = `<t:${Math.floor(nextSession.sessionTime.getTime() / 1000)}:R>`;

      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('⏰ Your Next Session')
        .setDescription(`**${game.title}**${nextSession.role === 'gm' ? ' *(You\'re the GM)*' : ''}`)
        .addFields(
          {
            name: '🎮 Game Details',
            value: [
              nextSession.role === 'player' ? `**GM:** ${game.gm.displayName}` : `**Role:** Game Master`,
              `**System:** ${game.system.shortName || game.system.name}`,
              `**Type:** ${game.gameType}`
            ].join('\n'),
            inline: true
          },
          {
            name: '📅 When',
            value: [
              timeStr,
              relativeTimeStr
            ].join('\n'),
            inline: true
          }
        );

      // Add session number if available
      if (nextSession.sessionNumber) {
        embed.addFields({
          name: '📊 Session',
          value: `Session #${nextSession.sessionNumber}`,
          inline: true
        });
      }

      // Add frequency for recurring games
      if (game.isRecurring && game.frequency) {
        embed.addFields({
          name: '🔁 Schedule',
          value: game.frequency,
          inline: true
        });
      }

      // Add game link
      embed.addFields({
        name: '🔗 Links',
        value: `[View Game Details](${gameUrl})`,
        inline: false
      });

      embed.setTimestamp();
      embed.setFooter({
        text: 'Arcane Circle',
        iconURL: interaction.client.user?.displayAvatarURL()
      });

      await interaction.editReply({ embeds: [embed] });

      logInfo('Successfully displayed next session', {
        userId: discordUserId,
        gameId: game.id,
        gameTitle: game.title,
        sessionTime: nextSession.sessionTime.toISOString(),
        role: nextSession.role
      });

    } catch (error) {
      logError('Next session command failed', error as Error, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      const errorMessage = (error as any).message || 'Unknown error';

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Failed to Load Next Session')
        .setDescription('Unable to retrieve your next session at this time.')
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
