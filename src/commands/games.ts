import { 
  ChatInputCommandInteraction, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  ComponentType
} from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logInfo, logError } from '../utils/logger';
import { config } from '../utils/config';

export const gamesCommand: Command = {
  name: 'games',
  description: 'Browse available games on Arcane Circle',
  
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    
    try {
      logInfo('User browsing games', {
        userId: interaction.user.id,
        username: interaction.user.username,
        guildId: interaction.guildId
      });
      
      // Fetch games from the platform
      const games = await arcaneAPI.games.listGames({
        status: 'PUBLISHED',
        sort: 'publishedAt',
        order: 'desc'
      });
      
      if (!games || games.length === 0) {
        const noGamesEmbed = new EmbedBuilder()
          .setColor(0xFFAA00)
          .setTitle('🎲 No Games Available')
          .setDescription('There are currently no published games available.')
          .addFields(
            {
              name: '💡 Want to run a game?',
              value: `[Create a game on Arcane Circle](${config.PLATFORM_WEB_URL}/create-game)`,
              inline: false
            }
          )
          .setFooter({
            text: 'Arcane Circle Games',
            iconURL: interaction.client.user?.displayAvatarURL()
          })
          .setTimestamp();
        
        await interaction.editReply({ embeds: [noGamesEmbed] });
        return;
      }
      
      let currentPage = 0;
      const gamesPerPage = 5;
      const totalPages = Math.ceil(games.length / gamesPerPage);
      
      const generateEmbed = (page: number) => {
        const startIndex = page * gamesPerPage;
        const pageGames = games.slice(startIndex, startIndex + gamesPerPage);
        
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🎲 Available Games on Arcane Circle')
          .setDescription(`Found ${games.length} available games`)
          .setFooter({
            text: `Page ${page + 1} of ${totalPages} • Arcane Circle Games`,
            iconURL: interaction.client.user?.displayAvatarURL()
          })
          .setTimestamp();
        
        pageGames.forEach((game: any) => {
          const systemName = typeof game.system === 'object' ? game.system.shortName || game.system.name : game.system;
          const gmName = typeof game.gm === 'object' ? game.gm.displayName : 'Unknown GM';
          const price = game.pricePerSession ? `$${game.pricePerSession}` : 'Free';

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
            .setCustomId('games_prev')
            .setLabel('◀️ Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          
          new ButtonBuilder()
            .setCustomId('games_next')
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
      
      if (totalPages > 1) {
        const collector = response.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 300000 // 5 minutes
        });
        
        collector.on('collect', async (buttonInteraction) => {
          if (buttonInteraction.user.id !== interaction.user.id) {
            await buttonInteraction.reply({
              content: 'You can only control your own game browser.',
              ephemeral: true
            });
            return;
          }
          
          if (buttonInteraction.customId === 'games_prev') {
            currentPage = Math.max(0, currentPage - 1);
          } else if (buttonInteraction.customId === 'games_next') {
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
              .setCustomId('games_prev')
              .setLabel('◀️ Previous')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),
            
            new ButtonBuilder()
              .setCustomId('games_next')
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
      
      logInfo('Games command executed successfully', {
        userId: interaction.user.id,
        gamesCount: games.length,
        totalPages
      });
      
    } catch (error) {
      logError('Games command failed', error as Error, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Error Loading Games')
        .setDescription('Unable to load games from Arcane Circle.')
        .addFields(
          {
            name: '🔗 Direct Link',
            value: `[Browse games on Arcane Circle](${config.PLATFORM_WEB_URL}/games)`,
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