import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  AutocompleteInteraction,
  ApplicationCommandOptionType
} from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logInfo, logError } from '../utils/logger';
import { config } from '../utils/config';

// Cache game systems to reduce API calls
let cachedSystems: Array<{ id: string; name: string }> | null = null;

async function getGameSystems() {
  if (!cachedSystems) {
    try {
      const systems = await arcaneAPI.systems.getGameSystems();
      cachedSystems = systems.map(s => ({ id: s.id, name: s.name }));
    } catch (error) {
      logError('Failed to fetch game systems for autocomplete', error as Error);
      cachedSystems = [];
    }
  }
  return cachedSystems;
}

export const searchGamesCommand: Command = {
  name: 'search-games',
  description: 'Search for games on Arcane Circle with filters',
  options: [
    {
      name: 'query',
      description: 'Keywords to search for (game title, description) - optional',
      type: ApplicationCommandOptionType.String,
      required: false
    },
    {
      name: 'game-system',
      description: 'Filter by game system (e.g., "D&D 5e", "Pathfinder 2e")',
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: true
    },
    {
      name: 'max-price',
      description: 'Maximum price per session (in dollars)',
      type: ApplicationCommandOptionType.Number,
      required: false,
      min_value: 0
    }
  ],

  async autocomplete(interaction: AutocompleteInteraction) {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === 'game-system') {
      const systems = await getGameSystems();
      const userInput = focusedOption.value.toLowerCase();

      // Filter systems by user input
      const filtered = systems
        .filter(s => s.name.toLowerCase().includes(userInput))
        .slice(0, 25); // Discord limit

      await interaction.respond(
        filtered.map(s => ({
          name: s.name,
          value: s.name
        }))
      );
    }
  },

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      const query = interaction.options.getString('query'); // Now optional
      const gameSystem = interaction.options.getString('game-system');
      const maxPrice = interaction.options.getNumber('max-price');

      // Require at least one search criterion
      if (!query && !gameSystem && maxPrice === null) {
        await interaction.editReply({
          content: '❌ Please provide at least one search criterion:\n• `query` - Keywords to search\n• `game-system` - Filter by system (e.g., "D&D 5e")\n• `max-price` - Maximum price per session'
        });
        return;
      }

      logInfo('User searching for games', {
        userId: interaction.user.id,
        username: interaction.user.username,
        query,
        gameSystem,
        maxPrice,
        guildId: interaction.guildId
      });

      // Build filters object for the /games endpoint
      // The API uses 'search' query param for keyword searching
      const filters: any = {
        status: 'PUBLISHED'
      };

      if (query) {
        filters.search = query; // Keyword search via 'search' query param
      }

      if (gameSystem) {
        filters.system = gameSystem;
      }

      if (maxPrice !== null) {
        filters.maxPrice = maxPrice;
      }

      // Use listGames (GET /games) which supports search query param
      const games = await arcaneAPI.games.listGames(filters);

      // Handle no results
      if (!games || games.length === 0) {
        const noResultsEmbed = new EmbedBuilder()
          .setColor(0xFFAA00)
          .setTitle('🔍 No Games Found')
          .setDescription(`No games found matching your search criteria.`)
          .addFields(
            {
              name: '🔎 Search Terms',
              value: [
                query ? `**Keywords:** ${query}` : null,
                gameSystem ? `**System:** ${gameSystem}` : null,
                maxPrice !== null ? `**Max Price:** $${maxPrice}` : null
              ].filter(Boolean).join('\n'),
              inline: false
            },
            {
              name: '💡 Suggestions',
              value: '• Try different keywords\n• Remove filters to broaden search\n• Check for typos',
              inline: false
            },
            {
              name: '🌐 Browse All Games',
              value: `Use \`/games\` to browse all available games\n[View on website](${config.PLATFORM_WEB_URL}/games)`,
              inline: false
            }
          )
          .setFooter({
            text: 'Arcane Circle Game Search',
            iconURL: interaction.client.user?.displayAvatarURL()
          })
          .setTimestamp();

        await interaction.editReply({ embeds: [noResultsEmbed] });
        return;
      }

      // Display results with pagination (same as /games command)
      let currentPage = 0;
      const gamesPerPage = 5;
      const totalPages = Math.ceil(games.length / gamesPerPage);

      const generateEmbed = (page: number) => {
        const startIndex = page * gamesPerPage;
        const pageGames = games.slice(startIndex, startIndex + gamesPerPage);

        // Build search criteria string
        const criteria = [
          query ? `"${query}"` : null,
          gameSystem ? `System: ${gameSystem}` : null,
          maxPrice !== null ? `Max: $${maxPrice}` : null
        ].filter(Boolean).join(' • ');

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🔍 Game Search Results')
          .setDescription(`Found ${games.length} game(s) matching: **${criteria}**`)
          .setFooter({
            text: `Page ${page + 1} of ${totalPages} • Arcane Circle Search`,
            iconURL: interaction.client.user?.displayAvatarURL()
          })
          .setTimestamp();

        pageGames.forEach((game: any) => {
          const systemName = typeof game.system === 'object' ? game.system.shortName || game.system.name : game.system;
          const gmName = typeof game.gm === 'object' ? game.gm.displayName : 'Unknown GM';
          const price = game.pricePerSession ? `$${game.pricePerSession}${game.currency ? '/' + game.currency : ''}` : 'Free';

          let gameValue = '';
          gameValue += `**System:** ${systemName}\n`;
          gameValue += `**GM:** ${gmName}\n`;
          gameValue += `**Type:** ${game.gameType}\n`;
          gameValue += `**Price:** ${price} per session\n`;
          gameValue += `**Players:** ${game.maxPlayers} max\n`;

          if (game.shortDescription) {
            const description = game.shortDescription.length > 100
              ? game.shortDescription.substring(0, 100) + '...'
              : game.shortDescription;
            gameValue += `\n*${description}*\n`;
          }

          gameValue += `\n\n💬 **Join:** \`/join-game game-id:${game.id}\``;
          gameValue += `\n🌐 [View Details](${config.PLATFORM_WEB_URL}/games/${game.id}) • [Book on Web](${config.PLATFORM_WEB_URL}/games/${game.id}/book)`;

          embed.addFields({
            name: `🎮 ${game.title}`,
            value: gameValue,
            inline: false
          });
        });

        return embed;
      };

      const generateButtons = (page: number) => {
        const row = new ActionRowBuilder<ButtonBuilder>();

        row.addComponents(
          new ButtonBuilder()
            .setCustomId('search_prev')
            .setLabel('◀️ Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),

          new ButtonBuilder()
            .setCustomId('search_next')
            .setLabel('Next ▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === totalPages - 1),

          new ButtonBuilder()
            .setLabel('🌐 View All Games')
            .setStyle(ButtonStyle.Link)
            .setURL(`${config.PLATFORM_WEB_URL}/games`)
        );

        return row;
      };

      const embed = generateEmbed(currentPage);
      const buttons = totalPages > 1 ? generateButtons(currentPage) : null;

      const response = await interaction.editReply({
        embeds: [embed],
        components: buttons ? [buttons] : []
      });

      // Set up pagination collector if multiple pages
      if (totalPages > 1) {
        const collector = response.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 300000 // 5 minutes
        });

        collector.on('collect', async (buttonInteraction) => {
          if (buttonInteraction.user.id !== interaction.user.id) {
            await buttonInteraction.reply({
              content: 'You can only control your own search results.',
              ephemeral: true
            });
            return;
          }

          if (buttonInteraction.customId === 'search_prev') {
            currentPage = Math.max(0, currentPage - 1);
          } else if (buttonInteraction.customId === 'search_next') {
            currentPage = Math.min(totalPages - 1, currentPage + 1);
          }

          const newEmbed = generateEmbed(currentPage);
          const newButtons = generateButtons(currentPage);

          await buttonInteraction.update({
            embeds: [newEmbed],
            components: [newButtons]
          });
        });

        collector.on('end', () => {
          // Disable buttons after collector expires
          const disabledButtons = new ActionRowBuilder<ButtonBuilder>();
          disabledButtons.addComponents(
            new ButtonBuilder()
              .setCustomId('search_prev')
              .setLabel('◀️ Previous')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),

            new ButtonBuilder()
              .setCustomId('search_next')
              .setLabel('Next ▶️')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),

            new ButtonBuilder()
              .setLabel('🌐 View All Games')
              .setStyle(ButtonStyle.Link)
              .setURL(`${config.PLATFORM_WEB_URL}/games`)
          );

          interaction.editReply({ components: [disabledButtons] }).catch(() => {
            // Ignore errors if message was already deleted
          });
        });
      }

      logInfo('Search games command executed successfully', {
        userId: interaction.user.id,
        query,
        gamesFound: games.length,
        totalPages
      });

    } catch (error) {
      logError('Search games command failed', error as Error, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Search Error')
        .setDescription('Unable to search games on Arcane Circle.')
        .addFields(
          {
            name: '🔗 Direct Link',
            value: `[Search on website](${config.PLATFORM_WEB_URL}/games)`,
            inline: false
          },
          {
            name: '❗ Error Details',
            value: `\`${(error as Error).message}\``,
            inline: false
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
};
