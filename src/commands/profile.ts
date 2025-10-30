import {
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logInfo, logError } from '../utils/logger';
import { config } from '../utils/config';

export const profileCommand: Command = {
  name: 'profile',
  description: 'View your Arcane Circle profile',
  options: [],

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const discordUserId = interaction.user.id;

      logInfo('User requesting profile', {
        userId: discordUserId,
        username: interaction.user.username
      });

      // Fetch user by Discord ID
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

      // Log the full user object to understand the API response structure
      logInfo('User API response structure', {
        userId: discordUserId,
        userObject: JSON.stringify(user, null, 2)
      });

      // Determine display name
      const displayName = (user as any).displayName
        || (user.profile?.firstName && user.profile?.lastName
          ? `${user.profile.firstName} ${user.profile.lastName}`
          : user.profile?.firstName || user.profile?.lastName)
        || user.username;

      // Build profile embed
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('👤 Your Arcane Circle Profile')
        .setTimestamp()
        .setFooter({
          text: 'Arcane Circle',
          iconURL: interaction.client.user?.displayAvatarURL()
        });

      // Add avatar if available
      if (user.profile?.avatarUrl) {
        embed.setThumbnail(user.profile.avatarUrl);
      }

      // Basic info
      const basicInfo = [
        `**Username:** ${displayName}`,
        `**Email:** ${user.email}`
      ];

      if (user.tier) {
        basicInfo.push(`**Tier:** ${user.tier}`);
      }

      embed.addFields({
        name: '📋 Basic Info',
        value: basicInfo.join('\n'),
        inline: false
      });

      // Profile details if available
      if (user.profile) {
        const profileInfo = [];

        if (user.profile.firstName || user.profile.lastName) {
          const fullName = [user.profile.firstName, user.profile.lastName]
            .filter(Boolean)
            .join(' ');
          profileInfo.push(`**Name:** ${fullName}`);
        }

        if (user.profile.bio) {
          profileInfo.push(`**Bio:** ${user.profile.bio}`);
        }

        if (profileInfo.length > 0) {
          embed.addFields({
            name: '✨ Profile Details',
            value: profileInfo.join('\n'),
            inline: false
          });
        }
      }

      // Discord connection
      embed.addFields({
        name: '💬 Discord',
        value: [
          `**Connected:** ✅`,
          `**Discord ID:** \`${user.discordId || discordUserId}\``,
          user.discordUsername ? `**Username:** ${user.discordUsername}` : ''
        ].filter(Boolean).join('\n'),
        inline: false
      });

      // Games info if available
      if (user.gamesAsGM && user.gamesAsGM.length > 0) {
        const activeGames = user.gamesAsGM.filter(g => g.status === 'published' || g.status === 'active');
        if (activeGames.length > 0) {
          embed.addFields({
            name: '🎲 Games as GM',
            value: `You're running **${activeGames.length}** active game${activeGames.length === 1 ? '' : 's'}`,
            inline: true
          });
        }
      }

      // Add link to web profile
      embed.addFields({
        name: '🔗 Manage Profile',
        value: `[Edit your profile on Arcane Circle](${config.PLATFORM_WEB_URL}/dashboard/settings/account)`,
        inline: false
      });

      await interaction.editReply({ embeds: [embed] });

      logInfo('Successfully displayed user profile', {
        userId: discordUserId,
        username: user.username
      });

    } catch (error) {
      logError('Profile command failed', error as Error, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      const errorMessage = (error as any).message || 'Unknown error';

      // Handle specific error cases
      if (errorMessage.toLowerCase().includes('not linked') || errorMessage.toLowerCase().includes('not found')) {
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

      // Generic error
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Failed to Load Profile')
        .setDescription('Unable to retrieve your profile at this time.')
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
