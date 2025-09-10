import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../bot/client';
import { logInfo } from '../utils/logger';

export const pingCommand: Command = {
  name: 'ping',
  description: 'Replies with Pong! and bot latency information',
  
  async execute(interaction: ChatInputCommandInteraction) {
    const sent = await interaction.reply({ 
      content: 'Pinging...', 
      fetchReply: true 
    });
    
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = Math.round(interaction.client.ws.ping);
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🏓 Pong!')
      .setDescription('Arcane Circle Discord Bot is online and responsive!')
      .addFields(
        {
          name: '📡 Bot Latency',
          value: `${latency}ms`,
          inline: true
        },
        {
          name: '🌐 API Latency',
          value: `${apiLatency}ms`,
          inline: true
        },
        {
          name: '⚡ Status',
          value: apiLatency < 100 ? '🟢 Excellent' : apiLatency < 200 ? '🟡 Good' : '🔴 Poor',
          inline: true
        }
      )
      .setFooter({
        text: 'Arcane Circle Discord Bot',
        iconURL: interaction.client.user?.displayAvatarURL()
      })
      .setTimestamp();
    
    await interaction.editReply({
      content: '',
      embeds: [embed]
    });
    
    logInfo('Ping command executed', {
      userId: interaction.user.id,
      username: interaction.user.username,
      botLatency: latency,
      apiLatency: apiLatency,
      guildId: interaction.guildId
    });
  }
};