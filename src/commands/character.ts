import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  ApplicationCommandOptionType
} from 'discord.js';
import { Command } from '../bot/client';
import { channelContext } from '../services/context/ChannelContext';
import { characterService } from '../services/api/characters';
import { config } from '../utils/config';
import { logInfo, logError, logDebug } from '../utils/logger';

export const characterCommand: Command = {
  name: 'character',
  description: 'View character sheet details',
  options: [
    {
      name: 'view',
      description: 'View a character overview',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'player',
          description: 'View another player\'s character (GM only)',
          type: ApplicationCommandOptionType.User,
          required: false
        }
      ]
    },
    {
      name: 'stats',
      description: 'View ability scores and core stats',
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'skills',
      description: 'View skill list with modifiers',
      type: ApplicationCommandOptionType.Subcommand
    }
  ],

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      const subcommand = interaction.options.getSubcommand();

      // Resolve campaign context
      const ctx = await channelContext.requireCampaignContext(interaction);
      if (!ctx) return;

      // Get target user (defaults to command user)
      const targetUser = interaction.options.getUser('player') || interaction.user;

      // Get character data
      const characterData = await characterService.getVTTDataForUser(ctx.gameId, targetUser.id);

      if (!characterData) {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0xFFAA00)
            .setTitle('⚠️ No Character Found')
            .setDescription(
              targetUser.id === interaction.user.id
                ? `You don't have a character in **${ctx.gameName}**.\n\nCreate one at ${config.PLATFORM_WEB_URL}/dashboard`
                : `${targetUser.username} doesn't have a character in **${ctx.gameName}**.`
            )
          ]
        });
        return;
      }

      const { character, vttData } = characterData;

      switch (subcommand) {
        case 'view':
          await handleView(interaction, character, vttData, ctx);
          break;
        case 'stats':
          await handleStats(interaction, character, vttData);
          break;
        case 'skills':
          await handleSkills(interaction, character, vttData);
          break;
        default:
          await interaction.editReply({ content: 'Unknown subcommand' });
      }

    } catch (error) {
      logError('Error executing character command', error as Error, {
        userId: interaction.user.id
      });

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Character Error')
          .setDescription('An error occurred while fetching character data.')
        ]
      });
    }
  }
};

/**
 * Handle /character view
 */
async function handleView(
  interaction: ChatInputCommandInteraction,
  character: any,
  vttData: any,
  ctx: any
) {
  const levelStr = vttData.level ? `Level ${vttData.level}` : '';
  const typeStr = vttData.characterType || '';

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`🧙 ${character.name}${levelStr ? ` — ${levelStr}` : ''}${typeStr ? ` ${typeStr}` : ''}`)
    .setDescription(`**Campaign:** ${ctx.gameName}`)
    .addFields(
      {
        name: '❤️ HP',
        value: `${vttData.stats.hp.current}/${vttData.stats.hp.max}`,
        inline: true
      },
      {
        name: '🛡️ AC',
        value: vttData.stats.ac.toString(),
        inline: true
      },
      {
        name: '⚡ Speed',
        value: `${vttData.stats.speed}ft`,
        inline: true
      },
      {
        name: '🎯 Initiative',
        value: formatModifier(vttData.stats.initiative),
        inline: true
      },
      {
        name: '✨ Proficiency',
        value: `+${vttData.stats.proficiencyBonus}`,
        inline: true
      },
      {
        name: '\u200b',
        value: '\u200b',
        inline: true
      }
    );

  // Add ability scores (3 per row)
  const abilities = Object.entries(vttData.abilities);
  if (abilities.length > 0) {
    for (let i = 0; i < abilities.length; i += 3) {
      const chunk = abilities.slice(i, i + 3);
      chunk.forEach(([name, data]: [string, any]) => {
        embed.addFields({
          name: name.toUpperCase(),
          value: `${data.score} (${formatModifier(data.mod)})`,
          inline: true
        });
      });
    }
  }

  // Add saving throws
  const saves = Object.entries(vttData.saves);
  if (saves.length > 0) {
    const proficientSaves = saves
      .filter(([, data]: [string, any]) => data.proficient)
      .map(([name, data]: [string, any]) => `${name.toUpperCase()} ${formatModifier(data.mod)}`)
      .join(', ');

    if (proficientSaves) {
      embed.addFields({
        name: '💪 Proficient Saves',
        value: proficientSaves,
        inline: false
      });
    }
  }

  embed.setURL(`${config.PLATFORM_WEB_URL}/dashboard/characters/${character.id}`);
  embed.setFooter({ text: 'View full sheet on Arcane Circle' });

  if (vttData.imageUrl) {
    embed.setThumbnail(vttData.imageUrl);
  }

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Handle /character stats
 */
async function handleStats(interaction: ChatInputCommandInteraction, character: any, vttData: any) {
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`🛡️ ${character.name} — Core Stats`);

  let description = `**HP:** ${vttData.stats.hp.current}/${vttData.stats.hp.max} | `;
  description += `**AC:** ${vttData.stats.ac} | `;
  description += `**Speed:** ${vttData.stats.speed}ft | `;
  description += `**Initiative:** ${formatModifier(vttData.stats.initiative)}\n\n`;

  const abilities = Object.entries(vttData.abilities);
  if (abilities.length > 0) {
    const saves = vttData.saves;
    abilities.forEach(([name, data]: [string, any]) => {
      const isProficient = saves[name]?.proficient;
      description += `  **${name.toUpperCase()}**  ${data.score} (${formatModifier(data.mod)})${isProficient ? ' ★' : ''}    `;
    });
    description += `\n\n★ = Proficient save\n\n`;

    // Show all saves
    description += `**Saving Throws:**\n`;
    Object.entries(saves).forEach(([name, data]: [string, any]) => {
      description += `  ${name.toUpperCase()} ${formatModifier(data.mod)}${data.proficient ? ' ★' : ''}  `;
    });
  }

  embed.setDescription(description);
  embed.setFooter({ text: `Proficiency Bonus: +${vttData.stats.proficiencyBonus}` });

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Handle /character skills
 */
async function handleSkills(interaction: ChatInputCommandInteraction, character: any, vttData: any) {
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`📋 ${character.name} — Skills`);

  const skills = Object.entries(vttData.skills);

  if (skills.length === 0) {
    embed.setDescription('No skill data available for this character.');
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Split into two columns
  const half = Math.ceil(skills.length / 2);
  const leftColumn = skills.slice(0, half);
  const rightColumn = skills.slice(half);

  let leftText = '';
  let rightText = '';

  leftColumn.forEach(([name, data]: [string, any]) => {
    leftText += `${capitalize(name).padEnd(18)} ${formatModifier(data.mod)}${data.proficient ? ' ★' : ''}\n`;
  });

  rightColumn.forEach(([name, data]: [string, any]) => {
    rightText += `${capitalize(name).padEnd(18)} ${formatModifier(data.mod)}${data.proficient ? ' ★' : ''}\n`;
  });

  embed.addFields(
    {
      name: '\u200b',
      value: '```\n' + leftText + '```',
      inline: true
    },
    {
      name: '\u200b',
      value: '```\n' + rightText + '```',
      inline: true
    }
  );

  embed.setFooter({ text: `★ = Proficient  |  Proficiency Bonus: +${vttData.stats.proficiencyBonus}` });

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Format a modifier with sign
 */
function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : mod.toString();
}

/**
 * Capitalize first letter
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
