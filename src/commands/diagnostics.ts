import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logInfo, logError } from '../utils/logger';

export const diagnosticsCommand: Command = {
  name: 'diagnostics',
  description: 'Check bot connection and API status',

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      logInfo('Testing API connection', {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🔍 Bot Diagnostics')
        .setTimestamp();
      
      // Test basic health check
      const healthCheck = await arcaneAPI.healthCheck();

      if (healthCheck) {
        embed.addFields({
          name: '✅ Health Check',
          value: 'API is responding',
          inline: true
        });
      } else {
        embed.addFields({
          name: '❌ Health Check',
          value: 'API is not responding',
          inline: true
        });
      }

      // Test authentication
      try {
        const authResult = await arcaneAPI.authenticateWithDiscord(interaction.user.id);
        if (authResult.success && authResult.data) {
          const user = authResult.data;
          embed.addFields({
            name: '🔐 Discord Auth',
            value: `✅ Authenticated as **${user.displayName || user.email}**${user.isGM ? ' (GM)' : ''}`,
            inline: true
          });
        } else {
          embed.addFields({
            name: '🔐 Discord Auth',
            value: 'Authentication failed',
            inline: true
          });
        }
      } catch (error) {
        embed.addFields({
          name: '🔐 Discord Auth',
          value: `Error: ${(error as Error).message}`,
          inline: true
        });
      }

      // Test fetching games (campaigns)
      try {
        const games = await arcaneAPI.games.listGames({ limit: 5 });
        embed.addFields({
          name: '🎲 Games Test',
          value: `Found ${games.length} games`,
          inline: true
        });
      } catch (error) {
        embed.addFields({
          name: '🎲 Games Test',
          value: `Error: ${(error as Error).message}`,
          inline: true
        });
      }
      
      embed.setFooter({
        text: 'Diagnostics Complete',
        iconURL: interaction.client.user?.displayAvatarURL()
      });

      await interaction.editReply({ embeds: [embed] });

      logInfo('Diagnostics completed', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        healthCheck
      });
      
    } catch (error) {
      logError('Diagnostics command failed', error as Error, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Diagnostics Failed')
        .setDescription(`An error occurred while running diagnostics:\n\`\`\`${(error as Error).message}\`\`\``)
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
};