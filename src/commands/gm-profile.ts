import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  ApplicationCommandOptionType
} from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logError } from '../utils/logger';
import { config } from '../utils/config';

export const gmProfileCommand: Command = {
  name: 'gm-profile',
  description: 'View and edit your GM profile',
  options: [
    {
      name: 'field',
      description: 'Field to edit (leave blank to view profile)',
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: 'Bio', value: 'bio' },
        { name: 'Experience', value: 'experience' },
        { name: 'Timezone', value: 'timezone' },
        { name: 'Systems', value: 'systems' }
      ]
    },
    {
      name: 'value',
      description: 'New value for the field',
      type: ApplicationCommandOptionType.String,
      required: false
    }
  ],

  async execute(interaction: ChatInputCommandInteraction) {
    const field = interaction.options.getString('field');
    const value = interaction.options.getString('value');

    await interaction.deferReply();

    try {
      // Authenticate user first
      await arcaneAPI.authenticateWithDiscord(interaction.user.id);

      if (field && value) {
        // Edit mode
        await handleProfileEdit(interaction, field, value);
      } else if (field && !value) {
        // User provided field but no value
        await interaction.editReply({
          content: '❌ Please provide a value when editing a field.'
        });
      } else {
        // View mode
        await handleProfileView(interaction);
      }

    } catch (error) {
      logError('GM profile command failed', error as Error, {
        userId: interaction.user.id
      });

      await interaction.editReply({
        content: '❌ Failed to execute command. Please ensure you are linked to Arcane Circle and have a GM profile.',
      });
    }
  }
};

async function handleProfileView(interaction: ChatInputCommandInteraction) {
  try {
    const user = await arcaneAPI.users.getUserByDiscordId(interaction.user.id);
    const gmProfile = await arcaneAPI.gms.getProfile(user.id);

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`🎲 GM Profile - ${gmProfile.displayName}`)
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields(
        { name: '📝 Bio', value: gmProfile.bio || '*No bio set*', inline: false },
        { name: '⭐ Experience', value: gmProfile.experience, inline: true },
        { name: '🌍 Timezone', value: gmProfile.timezone, inline: true },
        { name: '🎮 Systems', value: gmProfile.systems.join(', ') || '*None set*', inline: false }
      )
      .setFooter({
        text: 'Use /gm-profile field:{field} value:{value} to edit',
        iconURL: interaction.client.user?.displayAvatarURL()
      })
      .setTimestamp();

    if (gmProfile.rating) {
      embed.addFields({ name: '⭐ Rating', value: `${gmProfile.rating}/5.0`, inline: true });
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('❌ GM Profile Not Found')
      .setDescription('You don\'t have a GM profile yet. Create one on the Arcane Circle platform.')
      .addFields({
        name: '🔗 Get Started',
        value: `[Create GM Profile](${config.PLATFORM_WEB_URL}/become-gm)`,
        inline: false
      });

    await interaction.editReply({ embeds: [embed] });
  }
}

async function handleProfileEdit(interaction: ChatInputCommandInteraction, field: string, value: string) {
  try {
    const user = await arcaneAPI.users.getUserByDiscordId(interaction.user.id);

    let updateData: any = {};

    if (field === 'systems') {
      updateData.systems = value.split(',').map(s => s.trim());
    } else {
      updateData[field] = value;
    }

    await arcaneAPI.gms.updateProfile(user.id, updateData);

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('✅ Profile Updated')
      .setDescription(`Successfully updated your ${field}.`)
      .addFields({
        name: `📝 ${field.charAt(0).toUpperCase() + field.slice(1)}`,
        value: field === 'systems' ? updateData.systems.join(', ') : value,
        inline: false
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    await interaction.editReply({
      content: `❌ Failed to update ${field}. Please check your input and try again.`
    });
  }
}
