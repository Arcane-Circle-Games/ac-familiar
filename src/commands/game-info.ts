import { 
  ChatInputCommandInteraction, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  SlashCommandBuilder
} from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logInfo, logError } from '../utils/logger';
import { config } from '../utils/config';

export const gameInfoCommand: Command = {
  name: 'game-info',
  description: 'Get detailed information about a specific game',
  
  async execute(interaction: ChatInputCommandInteraction) {
    const gameId = interaction.options.getString('id', true);
    
    await interaction.deferReply();
    
    try {
      logInfo('User requesting game info', {
        userId: interaction.user.id,
        username: interaction.user.username,
        gameId,
        guildId: interaction.guildId
      });
      
      // Fetch game details
      const game = await arcaneAPI.games.getGame(gameId);
      
      if (!game) {
        const notFoundEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Game Not Found')
          .setDescription(`No game found with ID: \`${gameId}\``)
          .addFields(
            {
              name: '🔍 Find Games',
              value: 'Use `/games` to browse available games.',
              inline: false
            }
          )
          .setTimestamp();
        
        await interaction.editReply({ embeds: [notFoundEmbed] });
        return;
      }
      
      // Build detailed game embed
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🎮 ${game.title}`)
        .setTimestamp();
      
      // Add game image if available
      if (game.gameImage) {
        embed.setImage(game.gameImage);
      }
      
      // Description
      if (game.description) {
        const description = game.description.length > 2000 
          ? game.description.substring(0, 1997) + '...' 
          : game.description;
        embed.setDescription(description);
      }
      
      // Game details
      const systemName = typeof game.system === 'object' ? 
        game.system.name || game.system.shortName : 
        game.system;
      
      const gmName = typeof game.gm === 'object' ? 
        game.gm.displayName : 
        'Unknown GM';
      
      embed.addFields(
        {
          name: '🎲 System',
          value: systemName,
          inline: true
        },
        {
          name: '👤 Game Master',
          value: gmName,
          inline: true
        },
        {
          name: '📅 Type',
          value: game.gameType,
          inline: true
        }
      );
      
      // Scheduling info
      if (game.startTime) {
        const startDate = new Date(game.startTime);
        embed.addFields({
          name: '🕐 Start Time',
          value: `<t:${Math.floor(startDate.getTime() / 1000)}:F>`,
          inline: true
        });
      }
      
      if (game.duration) {
        embed.addFields({
          name: '⏱️ Duration',
          value: `${game.duration} hours`,
          inline: true
        });
      }
      
      if (game.frequency) {
        embed.addFields({
          name: '🔄 Frequency',
          value: game.frequency,
          inline: true
        });
      }
      
      // Player info
      embed.addFields(
        {
          name: '👥 Players',
          value: `Max: ${game.maxPlayers}`,
          inline: true
        },
        {
          name: '🎯 Experience Level',
          value: game.minExperience || 'Any',
          inline: true
        },
        {
          name: '🔞 Age Requirement',
          value: game.ageRequirement || 'Not specified',
          inline: true
        }
      );
      
      // Pricing
      const price = game.pricePerSession ? 
        `$${game.pricePerSession} ${game.currency || 'USD'} per session` : 
        'Free';
      
      embed.addFields({
        name: '💰 Price',
        value: price,
        inline: true
      });
      
      // Content warnings
      if (game.contentWarnings && game.contentWarnings.length > 0) {
        embed.addFields({
          name: '⚠️ Content Warnings',
          value: game.contentWarnings.join(', '),
          inline: false
        });
      }
      
      // Tags
      if (game.tags && game.tags.length > 0) {
        embed.addFields({
          name: '🏷️ Tags',
          value: game.tags.join(', '),
          inline: false
        });
      }
      
      // Status and approval
      embed.addFields(
        {
          name: '📊 Status',
          value: game.status,
          inline: true
        },
        {
          name: '✅ Approval Required',
          value: game.requiresApproval ? 'Yes' : 'No',
          inline: true
        }
      );
      
      // Action buttons
      const actionRow = new ActionRowBuilder<ButtonBuilder>();
      
      actionRow.addComponents(
        new ButtonBuilder()
          .setLabel('🌐 View on Arcane Circle')
          .setStyle(ButtonStyle.Link)
          .setURL(`${config.PLATFORM_WEB_URL}/games/${game.id}`),
        
        new ButtonBuilder()
          .setLabel('📋 All Games')
          .setStyle(ButtonStyle.Link)
          .setURL(`${config.PLATFORM_WEB_URL}/games`)
      );
      
      // Add booking button if user is linked
      try {
        await arcaneAPI.users.getUserByDiscordId(interaction.user.id);
        
        actionRow.addComponents(
          new ButtonBuilder()
            .setLabel('🎫 Book Session')
            .setStyle(ButtonStyle.Link)
            .setURL(`${config.PLATFORM_WEB_URL}/games/${game.id}/book`)
        );
      } catch (error) {
        // User not linked, don't add booking button
        logInfo('User not linked, skipping booking button', {
          userId: interaction.user.id
        });
      }
      
      embed.setFooter({
        text: `Game ID: ${game.id} • Arcane Circle`,
        iconURL: interaction.client.user?.displayAvatarURL()
      });
      
      await interaction.editReply({ 
        embeds: [embed], 
        components: [actionRow] 
      });
      
      logInfo('Game info command executed successfully', {
        userId: interaction.user.id,
        gameId: game.id,
        gameTitle: game.title
      });
      
    } catch (error) {
      logError('Game info command failed', error as Error, {
        userId: interaction.user.id,
        gameId,
        guildId: interaction.guildId
      });
      
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Error Loading Game')
        .setDescription(`Unable to load game information for ID: \`${gameId}\``)
        .addFields(
          {
            name: '🔗 Direct Link',
            value: `[View game on Arcane Circle](${config.PLATFORM_WEB_URL}/games/${gameId})`,
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

// Export command data for registration
export const gameInfoCommandData = new SlashCommandBuilder()
  .setName('game-info')
  .setDescription('Get detailed information about a specific game')
  .addStringOption(option =>
    option.setName('id')
      .setDescription('The ID of the game to view')
      .setRequired(true)
  );