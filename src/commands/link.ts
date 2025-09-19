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
      logInfo('User requesting account linking information', {
        userId: interaction.user.id,
        username: interaction.user.username,
        guildId: interaction.guildId
      });

      // Check if user is already linked
      try {
        const authResult = await arcaneAPI.authenticateWithDiscord(interaction.user.id);

        if (authResult.success && authResult.data) {
          const existingUser = authResult.data;
          const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Already Linked')
            .setDescription(`Your Discord account is already linked to your Arcane Circle account.`)
            .addFields(
              {
                name: '👤 Display Name',
                value: existingUser.displayName || 'Not set',
                inline: true
              },
              {
                name: '📧 Email',
                value: existingUser.email || 'Not provided',
                inline: true
              },
              {
                name: '🎭 GM Status',
                value: existingUser.isGM ? '✅ Game Master' : '❌ Player Only',
                inline: true
              },
              {
                name: '🆔 User ID',
                value: existingUser.id,
                inline: true
              },
              {
                name: '🎮 Discord Username',
                value: existingUser.discordUsername || 'Not set',
                inline: true
              },
              {
                name: '🔗 Discord ID',
                value: existingUser.discordId || 'Not set',
                inline: true
              }
            )
            .addFields(
              {
                name: '⚙️ Account Settings',
                value: `[Manage Account Settings](${config.PLATFORM_WEB_URL}/dashboard/settings/login)`,
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
        // User not found, show linking instructions
        logInfo('User not found in platform, showing linking instructions', {
          userId: interaction.user.id
        });
      }

      // User not linked - direct them to the settings page
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🔗 Link Your Discord Account')
        .setDescription('To link your Discord account to Arcane Circle, visit the account settings page.')
        .addFields(
          {
            name: '📋 Steps to Link',
            value: '1. Go to the Arcane Circle settings page\n2. Log in to your account (or create one if needed)\n3. Connect your Discord account in the login settings',
            inline: false
          },
          {
            name: '🌐 Link Your Account',
            value: `**[Go to Account Settings](${config.PLATFORM_WEB_URL}/dashboard/settings/login)**`,
            inline: false
          },
          {
            name: '🎮 After Linking',
            value: 'Once linked, you can use Discord commands like:\n• `/games` - Browse available games\n• `/game-info <id>` - Get game details\n• `/test-api` - Test your connection',
            inline: false
          }
        )
        .setFooter({
          text: 'Arcane Circle Discord Bot',
          iconURL: interaction.client.user?.displayAvatarURL()
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logError('Link command failed', error as Error, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Command Error')
        .setDescription('An error occurred while checking your account status.')
        .addFields(
          {
            name: '🔗 Direct Link',
            value: `You can still visit the settings page directly:\n**[Account Settings](${config.PLATFORM_WEB_URL}/dashboard/settings/login)**`,
            inline: false
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
};