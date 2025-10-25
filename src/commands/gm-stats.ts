import {
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logError } from '../utils/logger';

export const gmStatsCommand: Command = {
  name: 'gm-stats',
  description: 'View your GM statistics and earnings',
  options: [],

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      // Authenticate user first
      await arcaneAPI.authenticateWithDiscord(interaction.user.id);

      const user = await arcaneAPI.users.getUserByDiscordId(interaction.user.id);
      const [stats, earnings] = await Promise.all([
        arcaneAPI.gms.getStats(user.id),
        arcaneAPI.gms.getEarnings(user.id)
      ]);

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📊 Your GM Statistics')
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
          { name: '🎲 Total Games Run', value: stats.totalGamesRun.toString(), inline: true },
          { name: '🔄 Active Campaigns', value: stats.activeCampaigns.toString(), inline: true },
          { name: '👥 Total Players', value: stats.totalPlayers.toString(), inline: true },
          { name: '⭐ Average Rating', value: `${stats.averageRating.toFixed(1)}/5.0`, inline: true },
          { name: '💰 This Month', value: `$${earnings.thisMonth.toFixed(2)}`, inline: true },
          { name: '💵 Total Earnings', value: `$${earnings.totalEarnings.toFixed(2)}`, inline: true }
        )
        .setFooter({
          text: 'Statistics updated daily',
          iconURL: interaction.client.user?.displayAvatarURL()
        })
        .setTimestamp();

      if (earnings.pendingPayouts > 0) {
        embed.addFields({
          name: '⏳ Pending Payouts',
          value: `$${earnings.pendingPayouts.toFixed(2)}`,
          inline: true
        });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logError('GM stats command failed', error as Error, {
        userId: interaction.user.id
      });

      await interaction.editReply({
        content: '❌ Failed to retrieve your statistics. Please ensure you have a GM profile.'
      });
    }
  }
};
