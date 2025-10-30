import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ApplicationCommandOptionType,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logError, logInfo } from '../utils/logger';

/**
 * /set-game-channel command
 * Allows GMs to configure a Discord channel to receive game notifications
 */
export const setGameChannelCommand: Command = {
  name: 'set-game-channel',
  description: 'Configure Discord channel for game notifications',
  options: [
    {
      name: 'game',
      description: 'Select one of your games',
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    },
    {
      name: 'channel',
      description: 'Channel to receive notifications',
      type: ApplicationCommandOptionType.Channel,
      required: true,
      channelTypes: [ChannelType.GuildText],
    },
    {
      name: 'mode',
      description: 'Notification mode',
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: 'Channel only', value: 'CHANNEL_ONLY' },
        { name: 'Channel + DMs', value: 'BOTH' },
      ],
    },
  ],

  async autocomplete(interaction: AutocompleteInteraction) {
    try {
      const focusedOption = interaction.options.getFocused(true);

      if (focusedOption.name === 'game') {
        // Get user's linked account
        const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
        if (!user) {
          return interaction.respond([
            { name: 'Link your Discord account first (/link)', value: 'not_linked' },
          ]);
        }

        // Fetch games where user is GM
        const games = await arcaneAPI.games.listGames({
          gmId: user.id,
          status: 'PUBLISHED',
        });

        if (!games || games.length === 0) {
          return interaction.respond([
            { name: 'No published games found', value: 'no_games' },
          ]);
        }

        // Return autocomplete choices (max 25)
        const choices = games
          .map((game) => ({
            name: game.title.substring(0, 100),
            value: game.id,
          }))
          .slice(0, 25);

        return interaction.respond(choices);
      }
    } catch (error) {
      logError('Autocomplete error in set-game-channel', error as Error, {
        userId: interaction.user.id,
      });
      return interaction.respond([]);
    }
  },

  async execute(interaction: ChatInputCommandInteraction) {
    // Verify command is used in a guild
    if (!interaction.guild) {
      await interaction.reply({
        content: '❌ This command must be used in a Discord server',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const gameId = interaction.options.getString('game', true);
      const channel = interaction.options.getChannel('channel', true);
      const mode = interaction.options.getString('mode') || 'CHANNEL_ONLY';

      // Handle special autocomplete values
      if (gameId === 'not_linked' || gameId === 'no_games') {
        await interaction.editReply({
          content:
            gameId === 'not_linked'
              ? '❌ You need to link your Discord account first. Use `/link`'
              : '❌ You don\'t have any published games. Create a game on the platform first.',
        });
        return;
      }

      // Verify user is linked
      const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
      if (!user) {
        await interaction.editReply({
          content: '❌ You need to link your Discord account first. Use `/link`',
        });
        return;
      }

      logInfo('Setting Discord channel for game', {
        gameId,
        channelId: channel.id,
        serverId: interaction.guild.id,
        userId: user.id,
        mode,
      });

      // Save configuration via API
      await arcaneAPI.games.setDiscordChannel(
        gameId,
        {
          discordServerId: interaction.guild.id,
          discordChannelId: channel.id,
          notificationMode: mode as 'DM_ONLY' | 'CHANNEL_ONLY' | 'BOTH',
        },
        interaction.user.id
      );

      // Success response
      const embed = new EmbedBuilder()
        .setColor(0x00d4aa)
        .setTitle('✅ Channel Configured')
        .setDescription('Game notifications will be posted to the selected channel')
        .addFields([
          {
            name: '📢 Channel',
            value: `<#${channel.id}>`,
            inline: true,
          },
          {
            name: '📋 Mode',
            value: mode === 'BOTH' ? 'Channel + DMs' : 'Channel only',
            inline: true,
          },
        ])
        .setFooter({ text: 'Arcane Circle • Notification Settings' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      logInfo('Discord channel configured successfully', {
        gameId,
        channelId: channel.id,
      });
    } catch (error) {
      logError('Failed to set game channel', error as Error, {
        userId: interaction.user.id,
        guildId: interaction.guild?.id,
      });

      await interaction.editReply({
        content:
          '❌ Failed to configure channel. Make sure you\'re the GM of this game and try again.',
      });
    }
  },
};
