import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType
} from 'discord.js';
import { arcaneAPI } from '../services/api';
import { transcriptionStorage } from '../services/storage/TranscriptionStorage';
import { logger } from '../utils/logger';

export const postSummaryCommand = {
  name: 'post-summary',
  description: 'Post a session summary to a campaign wiki',
  options: [
    {
      name: 'session-id',
      description: 'Session ID of the summary to post',
      type: 3, // STRING
      required: true
    }
  ],

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      const sessionId = interaction.options.getString('session-id', true);
      const discordUserId = interaction.user.id;

      // Step 1: Verify Discord account is linked
      const user = await arcaneAPI.users.getUserByDiscordId(discordUserId);
      if (!user) {
        await interaction.editReply({
          content: '❌ Your Discord account is not linked to Arcane Circle. Please link your account first using the `/link` command.'
        });
        return;
      }

      // Step 2: Load the session summary
      logger.info(`Loading summary for session ${sessionId}`);
      const recordingsDir = './recordings';
      const summary = await transcriptionStorage.loadTranscript(sessionId, recordingsDir);

      if (!summary) {
        await interaction.editReply({
          content: `❌ No summary found for session \`${sessionId}\`.\n\nMake sure the session has a summary file.`
        });
        return;
      }

      // Step 3: Get user's games where they are GM
      logger.info(`Fetching games for GM ${user.id}`);
      const games = await arcaneAPI.games.listGames({ gmId: user.id });

      if (!games || games.length === 0) {
        await interaction.editReply({
          content: '❌ You are not the GM of any games. Only GMs can post session summaries to campaign wikis.'
        });
        return;
      }

      // Step 4: Present game selection menu
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select-game')
        .setPlaceholder('Select a campaign to post the session summary to')
        .addOptions(
          games.slice(0, 25).map((game: any) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(game.title || game.name)
              .setDescription(`ID: ${game.id} | ${game.gameType || 'Campaign'}`)
              .setValue(game.id)
          )
        );

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

      const summaryInfo = new EmbedBuilder()
        .setTitle('📝 Post Session Summary to Wiki')
        .setDescription(`**Session:** \`${sessionId}\`\n\nSelect the campaign where you want to post this session summary.`)
        .setColor(0x0099ff)
        .addFields(
          { name: 'Word Count', value: summary.wordCount.toString(), inline: true },
          { name: 'Participants', value: summary.participantCount.toString(), inline: true },
          { name: 'Duration', value: formatDuration(summary.duration), inline: true }
        )
        .setTimestamp();

      const response = await interaction.editReply({
        embeds: [summaryInfo],
        components: [row]
      });

      // Step 5: Wait for game selection
      try {
        const collector = response.createMessageComponentCollector({
          componentType: ComponentType.StringSelect,
          time: 60_000 // 1 minute timeout
        });

        collector.on('collect', async (selectInteraction) => {
          if (selectInteraction.user.id !== interaction.user.id) {
            await selectInteraction.reply({
              content: '❌ This menu is not for you.',
              ephemeral: true
            });
            return;
          }

          await selectInteraction.deferUpdate();

          const gameId = selectInteraction.values[0];

          // Step 6: Get wiki for the selected game
          if (!gameId) {
            await interaction.editReply({
              content: '❌ No game selected.',
              embeds: [],
              components: []
            });
            return;
          }

          logger.info(`User selected game`, {
            gameId,
            selectedGame: games.find((g: any) => g.id === gameId)?.title || games.find((g: any) => g.id === gameId)?.name
          });
          logger.info(`Getting wiki for game ${gameId}`);
          const wiki = await arcaneAPI.wiki.getWikiByGameId(gameId, discordUserId);

          if (!wiki) {
            await interaction.editReply({
              content: `❌ No wiki found for this game.\n\nPlease create a wiki for your campaign on the Arcane Circle website first, then try posting the session summary again.`,
              embeds: [],
              components: []
            });
            return;
          }

          // Step 7: Get sessions for this game
          logger.info(`Fetching sessions for game ${gameId}`);
          const sessions = await arcaneAPI.sessions.getGameSessions(gameId, discordUserId);

          if (!sessions || sessions.length === 0) {
            await interaction.editReply({
              content: `❌ No sessions found for this game.\n\nPlease create a session for your campaign on the Arcane Circle website first, then try posting the session summary again.`,
              embeds: [],
              components: []
            });
            return;
          }

          // Step 8: Present session selection menu
          const sessionSelectMenu = new StringSelectMenuBuilder()
            .setCustomId('select-session')
            .setPlaceholder('Select the session this summary belongs to')
            .addOptions(
              sessions.slice(0, 25).map((session: any) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(session.title || session.name || `Session #${session.sessionNumber}`)
                  .setDescription(`Date: ${new Date(session.scheduledFor || session.createdAt).toLocaleDateString()}`)
                  .setValue(session.id)
              )
            );

          const sessionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sessionSelectMenu);

          const sessionResponse = await interaction.editReply({
            content: `✅ Wiki found! Now select which session this summary belongs to:`,
            embeds: [],
            components: [sessionRow]
          });

          // Stop the game collector to prevent it from catching session selection
          collector.stop('session-menu-shown');

          // Step 9: Wait for session selection
          const sessionCollector = sessionResponse.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            time: 60_000 // 1 minute timeout
          });

          sessionCollector.on('collect', async (sessionSelectInteraction) => {
            if (sessionSelectInteraction.user.id !== interaction.user.id) {
              await sessionSelectInteraction.reply({
                content: '❌ This menu is not for you.',
                ephemeral: true
              });
              return;
            }

            await sessionSelectInteraction.deferUpdate();

            const selectedSessionId = sessionSelectInteraction.values[0];
            if (!selectedSessionId) {
              await interaction.editReply({
                content: '❌ No session selected.',
                embeds: [],
                components: []
              });
              return;
            }

            // Step 10: Format and post the session summary
            logger.info(`Posting session summary to wiki ${wiki.id} for session ${selectedSessionId}`);
            const formattedSummary = transcriptionStorage.generateFormattedTranscript(summary);

            try {
              const pageResult = await arcaneAPI.wiki.postSessionTranscript(
                wiki.id,
                selectedSessionId, // Use the sessionId selected by the user
                formattedSummary,  // This is the markdown summary string
                discordUserId
              );

              logger.info('Wiki post result', {
                hasSuccess: 'success' in pageResult,
                success: pageResult.success,
                hasData: 'data' in pageResult,
                hasPage: !!pageResult.data,
                pageId: pageResult.data?.id
              });

              if (pageResult.success && pageResult.data) {
              const successEmbed = new EmbedBuilder()
                .setTitle('✅ Session Summary Posted Successfully')
                .setDescription(`The session summary has been posted to the campaign wiki!`)
                .setColor(0x00ff00)
                .addFields(
                  { name: 'Page Title', value: pageResult.data.title, inline: false },
                  { name: 'Wiki ID', value: wiki.id, inline: true },
                  { name: 'Page ID', value: pageResult.data.id, inline: true }
                )
                .setTimestamp();

              await interaction.editReply({
                embeds: [successEmbed],
                components: []
              });

              logger.info(`Successfully posted session summary to wiki page ${pageResult.data.id}`);
            } else {
              await interaction.editReply({
                content: `❌ Failed to create wiki page: ${pageResult.error || 'Unknown error'}`,
                embeds: [],
                components: []
              });
            }
            } catch (postError) {
              logger.error('Failed to post session summary to wiki:', postError);
              await interaction.editReply({
                content: `❌ Failed to post summary: ${postError instanceof Error ? postError.message : 'Unknown error'}`,
                embeds: [],
                components: []
              });
            }
          });

          sessionCollector.on('end', (collected) => {
            if (collected.size === 0) {
              interaction.editReply({
                content: '⏱️ Session selection timed out. Please run the command again.',
                embeds: [],
                components: []
              }).catch(() => {});
            }
          });
        });

        collector.on('end', (collected) => {
          if (collected.size === 0) {
            interaction.editReply({
              content: '⏱️ Selection timed out. Please run the command again.',
              embeds: [],
              components: []
            }).catch(() => {});
          }
        });

      } catch (collectorError) {
        logger.error('Collector error:', collectorError);
        await interaction.editReply({
          content: '❌ An error occurred while waiting for your selection.',
          embeds: [],
          components: []
        });
      }

    } catch (error) {
      logger.error('Error in post-summary command:', error);

      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: `❌ **Error:** ${errorMessage}`,
          embeds: [],
          components: []
        });
      } else {
        await interaction.reply({
          content: `❌ **Error:** ${errorMessage}`,
          ephemeral: true
        });
      }
    }
  }
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}
