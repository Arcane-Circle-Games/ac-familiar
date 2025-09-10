import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logInfo, logError } from '../utils/logger';

export const testApiCommand: Command = {
  name: 'test-api',
  description: 'Test connection to Arcane Circle API',
  
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    
    try {
      logInfo('Testing API connection', {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🔍 API Connection Test')
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
      
      // Test API info
      try {
        const apiInfo = await arcaneAPI.getApiInfo();
        embed.addFields({
          name: '📊 API Info',
          value: `Status: ${apiInfo.success ? 'Connected' : 'Error'}`,
          inline: true
        });
      } catch (error) {
        embed.addFields({
          name: '📊 API Info',
          value: 'Failed to fetch info',
          inline: true
        });
      }
      
      // Test authentication
      try {
        const authResult = await arcaneAPI.authenticateWithDiscord(interaction.user.id);
        embed.addFields({
          name: '🔐 Discord Auth',
          value: authResult.success ? 'Authentication successful' : 'Authentication failed',
          inline: true
        });
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
      
      // Test basic API info
      try {
        const apiInfo = await arcaneAPI.getApiInfo();
        embed.addFields({
          name: '📊 API Info Test',
          value: apiInfo.success ? 'API responding' : 'API error',
          inline: true
        });
      } catch (error) {
        embed.addFields({
          name: '📊 API Info Test',
          value: `Error: ${(error as Error).message}`,
          inline: true
        });
      }
      
      // Test user lookup
      try {
        const user = await arcaneAPI.users.getUserByDiscordId(interaction.user.id);
        embed.addFields({
          name: '👤 User Lookup Test',
          value: user ? `Found user: ${user.username}` : 'User not found',
          inline: true
        });
      } catch (error) {
        embed.addFields({
          name: '👤 User Lookup Test',
          value: `Error: ${(error as Error).message}`,
          inline: true
        });
      }
      
      embed.setFooter({
        text: 'Arcane Circle API Test Complete',
        iconURL: interaction.client.user?.displayAvatarURL()
      });
      
      await interaction.editReply({ embeds: [embed] });
      
      logInfo('API test completed', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        healthCheck
      });
      
    } catch (error) {
      logError('API test command failed', error as Error, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ API Test Failed')
        .setDescription(`An error occurred while testing the API connection:\n\`\`\`${(error as Error).message}\`\`\``)
        .setTimestamp();
      
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
};