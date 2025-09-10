import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logInfo, logError } from '../utils/logger';
import { config } from '../utils/config';

export const linkCommand: Command = {
  name: 'link',
  description: 'Link your Discord account to your Arcane Circle platform account',
  
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      logInfo('User attempting to link Discord account', {
        userId: interaction.user.id,
        username: interaction.user.username,
        guildId: interaction.guildId
      });
      
      // Check if user is already linked
      try {
        const existingUser = await arcaneAPI.users.getUserByDiscordId(interaction.user.id);
        
        if (existingUser) {
          const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Already Linked')
            .setDescription(`Your Discord account is already linked to **${existingUser.username}** on Arcane Circle.`)
            .addFields(
              {
                name: '👤 Platform Username',
                value: existingUser.username,
                inline: true
              },
              {
                name: '📧 Email',
                value: existingUser.email || 'Not provided',
                inline: true
              }
            )
            .addFields(
              {
                name: '🌐 Profile',
                value: `[View on Arcane Circle](${config.PLATFORM_WEB_URL}/profile/${existingUser.id})`,
                inline: false
              }
            )
            .setFooter({
              text: 'Account already linked',
              iconURL: interaction.client.user?.displayAvatarURL()
            })
            .setTimestamp();
          
          await interaction.editReply({ embeds: [embed] });
          return;
        }
      } catch (error) {
        // User not found, continue with linking process
        logInfo('User not found in platform, proceeding with linking', {
          userId: interaction.user.id
        });
      }
      
      // Attempt to link the account
      try {
        const linkResult = await arcaneAPI.users.linkDiscordAccount(
          interaction.user.id,
          interaction.user.username
        );
        
        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('✅ Account Linked Successfully!')
          .setDescription('Your Discord account has been linked to Arcane Circle.')
          .addFields(
            {
              name: '🔗 What\'s Next?',
              value: 'You can now use Discord commands to interact with your Arcane Circle games and bookings.',
              inline: false
            },
            {
              name: '🎮 Available Commands',
              value: '• `/games` - Browse available games\n• `/game-info <id>` - Get details about a specific game\n• `/test-api` - Test your connection',
              inline: false
            }
          )
          .addFields(
            {
              name: '🌐 Platform',
              value: `[Visit Arcane Circle](${config.PLATFORM_WEB_URL})`,
              inline: false
            }
          )
          .setFooter({
            text: 'Arcane Circle Discord Bot',
            iconURL: interaction.client.user?.displayAvatarURL()
          })
          .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
        
        logInfo('Discord account linked successfully', {
          userId: interaction.user.id,
          username: interaction.user.username,
          linkResult
        });
        
      } catch (linkError) {
        logError('Failed to link Discord account', linkError as Error, {
          userId: interaction.user.id,
          username: interaction.user.username
        });
        
        const errorMessage = (linkError as any)?.message || 'Unknown error occurred';
        
        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Linking Failed')
          .setDescription('Unable to link your Discord account to Arcane Circle.')
          .addFields(
            {
              name: '🔍 Possible Reasons',
              value: '• You need to create an account on Arcane Circle first\n• API connection issue\n• Your account may already be linked to another Discord user',
              inline: false
            },
            {
              name: '💡 Solutions',
              value: `• [Create an account on Arcane Circle](${config.PLATFORM_WEB_URL}/signup)\n• Contact support if you continue to have issues\n• Try again in a few minutes`,
              inline: false
            }
          )
          .addFields(
            {
              name: '❗ Error Details',
              value: `\`${errorMessage}\``,
              inline: false
            }
          )
          .setFooter({
            text: 'Arcane Circle Discord Bot',
            iconURL: interaction.client.user?.displayAvatarURL()
          })
          .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
      }
      
    } catch (error) {
      logError('Link command failed', error as Error, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Command Error')
        .setDescription('An unexpected error occurred while processing your request.')
        .addFields(
          {
            name: '🔧 Try Again',
            value: 'Please try the `/link` command again in a few moments.',
            inline: false
          }
        )
        .setTimestamp();
      
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
};