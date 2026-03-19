import { ChatInputCommandInteraction, EmbedBuilder, ApplicationCommandOptionType } from 'discord.js';
import { DiceRoller } from '@dice-roller/rpg-dice-roller';
import { Command } from '../bot/client';
import { channelContext } from '../services/context/ChannelContext';
import { characterService } from '../services/api/characters';
import { logInfo, logError, logDebug } from '../utils/logger';

const roller = new DiceRoller();

export const rollCommand: Command = {
  name: 'roll',
  description: 'Roll dice with standard notation',
  options: [
    {
      name: 'dice',
      description: 'Dice expression (e.g., 2d6+3, 1d20 advantage, check strength)',
      type: ApplicationCommandOptionType.String,
      required: true
    },
    {
      name: 'label',
      description: 'Label for the roll (e.g., "fireball", "attack")',
      type: ApplicationCommandOptionType.String,
      required: false
    },
    {
      name: 'secret',
      description: 'Send result only to you (GM secret roll)',
      type: ApplicationCommandOptionType.Boolean,
      required: false
    }
  ],

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: interaction.options.getBoolean('secret') || false });

    try {
      const diceInput = interaction.options.getString('dice', true);
      const label = interaction.options.getString('label') || null;
      const isSecret = interaction.options.getBoolean('secret') || false;

      logInfo('Roll command executed', {
        userId: interaction.user.id,
        diceInput,
        label,
        isSecret
      });

      // Try to parse as character-integrated roll first
      const characterRoll = await tryCharacterRoll(interaction, diceInput);
      if (characterRoll) {
        const embed = buildRollEmbed(characterRoll, label, isSecret);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Fall back to standard dice parsing
      const standardRoll = parseStandardRoll(diceInput);
      if (!standardRoll) {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Invalid Dice Expression')
            .setDescription(
              `Couldn't parse "${diceInput}". Try something like:\n` +
              `• \`2d6+3\` — roll 2 six-sided dice and add 3\n` +
              `• \`1d20 advantage\` — roll with advantage\n` +
              `• \`check strength\` — character ability check`
            )
          ]
        });
        return;
      }

      const embed = buildRollEmbed(standardRoll, label, isSecret);
      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logError('Error executing roll command', error as Error, {
        userId: interaction.user.id
      });

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Roll Failed')
          .setDescription('An error occurred while processing your roll.')
        ]
      });
    }
  }
};

interface RollResult {
  notation: string;
  rolls: number[];
  modifier: number;
  total: number;
  characterName?: string;
  rollType?: string;
}

/**
 * Try to parse as a character-integrated roll (check/save/skill)
 */
async function tryCharacterRoll(
  interaction: ChatInputCommandInteraction,
  input: string
): Promise<RollResult | null> {
  const lower = input.toLowerCase().trim();

  // Check for character-integrated keywords
  const checkMatch = lower.match(/^check\s+(\w+)(\s+advantage|\s+disadvantage)?$/);
  const saveMatch = lower.match(/^save\s+(\w+)(\s+advantage|\s+disadvantage)?$/);
  const skillMatch = lower.match(/^skill\s+([\w\s]+?)(\s+advantage|\s+disadvantage)?$/);

  if (!checkMatch && !saveMatch && !skillMatch) {
    return null; // Not a character-integrated roll
  }

  // Resolve campaign context
  const ctx = await channelContext.resolveCampaignFromInteraction(interaction);
  if (!ctx) {
    // No context - fall back to standard parsing
    return null;
  }

  // Get character VTT data
  const characterData = await characterService.getVTTDataForUser(ctx.gameId, interaction.user.id);
  if (!characterData) {
    logDebug('No character found for user in game - falling back to standard roll', {
      userId: interaction.user.id,
      gameId: ctx.gameId
    });
    return null;
  }

  const { character, vttData } = characterData;

  // Extract ability/skill and advantage/disadvantage
  let abilityOrSkill: string;
  let rollType: string;
  let modifier: number | undefined;

  if (checkMatch) {
    abilityOrSkill = checkMatch[1];
    rollType = 'Ability Check';
    modifier = vttData.abilities[abilityOrSkill]?.mod;
  } else if (saveMatch) {
    abilityOrSkill = saveMatch[1];
    rollType = 'Saving Throw';
    modifier = vttData.saves[abilityOrSkill]?.mod;
  } else if (skillMatch) {
    abilityOrSkill = skillMatch[1].trim();
    rollType = 'Skill Check';
    modifier = vttData.skills[abilityOrSkill]?.mod;
  } else {
    return null;
  }

  if (modifier === undefined) {
    // Ability/skill not found on character sheet
    logDebug('Ability/skill not found on character', {
      abilityOrSkill,
      characterId: character.id
    });
    return null;
  }

  const hasAdvantage = lower.includes('advantage');
  const hasDisadvantage = lower.includes('disadvantage');

  // Build dice notation
  let notation: string;
  if (hasAdvantage) {
    notation = `2d20kh1${modifier >= 0 ? '+' : ''}${modifier}`;
    rollType += ' (Advantage)';
  } else if (hasDisadvantage) {
    notation = `2d20kl1${modifier >= 0 ? '+' : ''}${modifier}`;
    rollType += ' (Disadvantage)';
  } else {
    notation = `1d20${modifier >= 0 ? '+' : ''}${modifier}`;
  }

  // Roll the dice
  const result = roller.roll(notation);
  const rolls = extractRolls(result.output);

  return {
    notation,
    rolls,
    modifier,
    total: result.total,
    characterName: character.name,
    rollType: `${rollType} — ${capitalize(abilityOrSkill)}`
  };
}

/**
 * Parse standard dice notation (non-character-integrated)
 */
function parseStandardRoll(input: string): RollResult | null {
  try {
    const lower = input.toLowerCase().trim();

    // Handle "advantage" / "disadvantage" shorthand
    let notation = input;
    if (lower.includes('advantage')) {
      notation = lower.replace(/\s*advantage\s*/g, '').trim();
      if (!notation.includes('2d20kh1')) {
        // Add advantage notation if not already present
        const modMatch = notation.match(/([+-]\d+)$/);
        const mod = modMatch ? modMatch[1] : '';
        notation = `2d20kh1${mod}`;
      }
    } else if (lower.includes('disadvantage')) {
      notation = lower.replace(/\s*disadvantage\s*/g, '').trim();
      if (!notation.includes('2d20kl1')) {
        const modMatch = notation.match(/([+-]\d+)$/);
        const mod = modMatch ? modMatch[1] : '';
        notation = `2d20kl1${mod}`;
      }
    }

    // Roll the dice
    const result = roller.roll(notation);
    const rolls = extractRolls(result.output);

    // Extract modifier from notation
    const modMatch = notation.match(/([+-]\d+)$/);
    const modifier = modMatch ? parseInt(modMatch[1], 10) : 0;

    return {
      notation,
      rolls,
      modifier,
      total: result.total
    };
  } catch (error) {
    logError('Failed to parse dice notation', error as Error, { input });
    return null;
  }
}

/**
 * Extract individual die rolls from dice roller output
 */
function extractRolls(output: string): number[] {
  // Output format: "[4, 2] + 3 = 9" or similar
  const match = output.match(/\[([^\]]+)\]/);
  if (match) {
    return match[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  }
  return [];
}

/**
 * Build the roll result embed
 */
function buildRollEmbed(result: RollResult, label: string | null, isSecret: boolean): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(0xe74c3c); // Red color for dice

  let description = '🎲 ';
  if (result.characterName && result.rollType) {
    description += `**${result.rollType}** — ${result.characterName}\n`;
  } else if (label) {
    description += `**${label}**\n`;
  } else {
    description += `**Roll: ${result.notation}**\n`;
  }

  // Show individual rolls in brackets
  if (result.rolls.length > 0) {
    const rollsStr = result.rolls.map(r => `[${r}]`).join(' ');
    description += `${rollsStr}`;
    if (result.modifier !== 0) {
      description += ` ${result.modifier >= 0 ? '+' : ''}${result.modifier}`;
    }
    description += ` = **${result.total}**`;
  } else {
    description += `**${result.total}**`;
  }

  embed.setDescription(description);

  if (isSecret) {
    embed.setFooter({ text: '🔒 Secret Roll — Only you can see this' });
  } else {
    embed.setFooter({ text: 'Arcane Circle' });
  }

  return embed;
}

/**
 * Capitalize first letter
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
