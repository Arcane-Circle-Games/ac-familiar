import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../bot/client';
import { config } from '../utils/config';
import { logInfo } from '../utils/logger';

export const acInfoCommand: Command = {
  name: 'ac-info',
  description: 'Learn about Arcane Circle and this guild\'s games',
  options: [],
  execute: async (interaction: ChatInputCommandInteraction) => {
    logInfo('AC info command executed', {
      userId: interaction.user.id,
      guildId: interaction.guildId,
    });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎲 Arcane Circle')
      .setDescription(
        'Arcane Circle is a premium marketplace for finding and playing tabletop RPGs with professional GMs.'
      )
      .addFields([
        {
          name: '🌐 Platform',
          value: `[Browse Games](${config.PLATFORM_WEB_URL})`,
          inline: true,
        },
        {
          name: '💬 Community',
          value: '[Join AC Discord](https://discord.gg/arcanecircle)',
          inline: true,
        },
      ])
      .setFooter({
        text: 'Game announcements from this guild appear in this server automatically',
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: false });
  },
};
