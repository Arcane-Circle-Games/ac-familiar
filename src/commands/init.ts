import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  ApplicationCommandOptionType,
  AutocompleteInteraction
} from 'discord.js';
import { DiceRoller } from '@dice-roller/rpg-dice-roller';
import { Command } from '../bot/client';
import { initiativeTracker, Combatant } from '../services/session/InitiativeTracker';
import { channelContext } from '../services/context/ChannelContext';
import { characterService } from '../services/api/characters';
import { logInfo, logError, logDebug } from '../utils/logger';

const roller = new DiceRoller();

export const initCommand: Command = {
  name: 'init',
  description: 'Track combat initiative order',
  options: [
    {
      name: 'start',
      description: 'Start a new encounter',
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'add',
      description: 'Add a combatant',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'name',
          description: 'Combatant name',
          type: ApplicationCommandOptionType.String,
          required: true
        },
        {
          name: 'roll',
          description: 'Initiative roll result',
          type: ApplicationCommandOptionType.Integer,
          required: true
        },
        {
          name: 'dex',
          description: 'DEX modifier for tiebreaking',
          type: ApplicationCommandOptionType.Integer,
          required: false
        }
      ]
    },
    {
      name: 'remove',
      description: 'Remove a combatant',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'name',
          description: 'Combatant to remove',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        }
      ]
    },
    {
      name: 'next',
      description: 'Advance to next combatant\'s turn',
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'prev',
      description: 'Go back to previous combatant\'s turn',
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'list',
      description: 'Show current initiative order',
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'end',
      description: 'End the current encounter',
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'damage',
      description: 'Apply damage to a combatant',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'name',
          description: 'Combatant name',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        },
        {
          name: 'amount',
          description: 'Damage amount (negative to heal)',
          type: ApplicationCommandOptionType.Integer,
          required: true
        }
      ]
    },
    {
      name: 'hp',
      description: 'Set HP for a combatant',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'name',
          description: 'Combatant name',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        },
        {
          name: 'current',
          description: 'Current HP',
          type: ApplicationCommandOptionType.Integer,
          required: true
        },
        {
          name: 'max',
          description: 'Max HP',
          type: ApplicationCommandOptionType.Integer,
          required: false
        }
      ]
    }
  ],

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'start':
          await handleStart(interaction);
          break;
        case 'add':
          await handleAdd(interaction);
          break;
        case 'remove':
          await handleRemove(interaction);
          break;
        case 'next':
          await handleNext(interaction);
          break;
        case 'prev':
          await handlePrev(interaction);
          break;
        case 'list':
          await handleList(interaction);
          break;
        case 'end':
          await handleEnd(interaction);
          break;
        case 'damage':
          await handleDamage(interaction);
          break;
        case 'hp':
          await handleHP(interaction);
          break;
        default:
          await interaction.editReply({ content: 'Unknown subcommand' });
      }

    } catch (error: any) {
      logError('Error executing init command', error as Error, {
        userId: interaction.user.id,
        channelId: interaction.channelId
      });

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Initiative Error')
          .setDescription(error.message || 'An error occurred.')
        ]
      });
    }
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    try {
      if (!interaction.channelId) {
        await interaction.respond([]);
        return;
      }

      const encounter = initiativeTracker.getEncounter(interaction.channelId);
      if (!encounter) {
        await interaction.respond([]);
        return;
      }

      const focused = interaction.options.getFocused();
      const choices = encounter.combatants
        .filter(c => c.name.toLowerCase().includes(focused.toLowerCase()))
        .slice(0, 25)
        .map(c => ({ name: c.name, value: c.name }));

      await interaction.respond(choices);
    } catch (error) {
      logError('Error in init autocomplete', error as Error);
      await interaction.respond([]);
    }
  }
};

/**
 * Handle /init start
 */
async function handleStart(interaction: ChatInputCommandInteraction) {
  if (!interaction.channelId) {
    await interaction.editReply({ content: 'This command can only be used in a channel.' });
    return;
  }

  const existing = initiativeTracker.getEncounter(interaction.channelId);
  if (existing) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ Encounter Already Active')
        .setDescription('An encounter is already active in this channel. Run `/init end` to finish it first.')
      ]
    });
    return;
  }

  const encounter = initiativeTracker.startEncounter(interaction.channelId);

  const embed = buildTrackerEmbed(encounter);
  await interaction.editReply({ embeds: [embed] });

  logInfo('Initiative encounter started', {
    userId: interaction.user.id,
    channelId: interaction.channelId
  });
}

/**
 * Handle /init add
 */
async function handleAdd(interaction: ChatInputCommandInteraction) {
  if (!interaction.channelId) {
    await interaction.editReply({ content: 'This command can only be used in a channel.' });
    return;
  }

  const encounter = initiativeTracker.getEncounter(interaction.channelId);
  if (!encounter) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ No Active Encounter')
        .setDescription('Start an encounter first with `/init start`.')
      ]
    });
    return;
  }

  const name = interaction.options.getString('name', true);
  const initiative = interaction.options.getInteger('roll', true);
  const dexMod = interaction.options.getInteger('dex') || 0;

  // Check for duplicate
  if (encounter.combatants.find(c => c.name.toLowerCase() === name.toLowerCase())) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ Duplicate Name')
        .setDescription(`"${name}" is already in the initiative order.`)
      ]
    });
    return;
  }

  const combatant: Combatant = {
    name,
    initiative,
    dexMod,
    isPlayer: false
  };

  initiativeTracker.addCombatant(interaction.channelId, combatant);

  const embed = buildTrackerEmbed(encounter);
  await interaction.editReply({
    content: `✅ Added **${name}** to initiative (${initiative}).`,
    embeds: [embed]
  });
}

/**
 * Handle /init remove
 */
async function handleRemove(interaction: ChatInputCommandInteraction) {
  if (!interaction.channelId) return;

  const name = interaction.options.getString('name', true);
  initiativeTracker.removeCombatant(interaction.channelId, name);

  const encounter = initiativeTracker.getEncounter(interaction.channelId);
  if (!encounter) {
    await interaction.editReply({ content: `✅ Removed **${name}** from initiative.` });
    return;
  }

  const embed = buildTrackerEmbed(encounter);
  await interaction.editReply({
    content: `✅ Removed **${name}** from initiative.`,
    embeds: [embed]
  });
}

/**
 * Handle /init next
 */
async function handleNext(interaction: ChatInputCommandInteraction) {
  if (!interaction.channelId) return;

  const { combatant, round } = initiativeTracker.nextTurn(interaction.channelId);
  const encounter = initiativeTracker.getEncounter(interaction.channelId);

  if (!encounter) return;

  const embed = buildTrackerEmbed(encounter);
  await interaction.editReply({ embeds: [embed] });

  // Announce turn
  const announcement = `⚔️ **Round ${round}** — It's **${combatant.name}**'s turn!`;
  if (combatant.discordUserId) {
    await interaction.followUp({
      content: `${announcement}\n<@${combatant.discordUserId}>`,
      allowedMentions: { users: [combatant.discordUserId] }
    });
  } else {
    await interaction.followUp({ content: announcement });
  }
}

/**
 * Handle /init prev
 */
async function handlePrev(interaction: ChatInputCommandInteraction) {
  if (!interaction.channelId) return;

  const { combatant, round } = initiativeTracker.prevTurn(interaction.channelId);
  const encounter = initiativeTracker.getEncounter(interaction.channelId);

  if (!encounter) return;

  const embed = buildTrackerEmbed(encounter);
  await interaction.editReply({ embeds: [embed] });

  // Announce turn
  const announcement = `⚔️ **Round ${round}** — It's **${combatant.name}**'s turn!`;
  if (combatant.discordUserId) {
    await interaction.followUp({
      content: `${announcement}\n<@${combatant.discordUserId}>`,
      allowedMentions: { users: [combatant.discordUserId] }
    });
  } else {
    await interaction.followUp({ content: announcement });
  }
}

/**
 * Handle /init list
 */
async function handleList(interaction: ChatInputCommandInteraction) {
  if (!interaction.channelId) return;

  const encounter = initiativeTracker.getEncounter(interaction.channelId);
  if (!encounter) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ No Active Encounter')
        .setDescription('No encounter is currently active.')
      ]
    });
    return;
  }

  const embed = buildTrackerEmbed(encounter);
  await interaction.editReply({ embeds: [embed] });
}

/**
 * Handle /init end
 */
async function handleEnd(interaction: ChatInputCommandInteraction) {
  if (!interaction.channelId) return;

  const encounter = initiativeTracker.getEncounter(interaction.channelId);
  if (!encounter) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ No Active Encounter')
        .setDescription('No encounter is currently active.')
      ]
    });
    return;
  }

  const duration = formatDuration(Date.now() - encounter.startedAt);
  initiativeTracker.endEncounter(interaction.channelId);

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle('⚔️ Encounter Ended')
      .setDescription(`Encounter ended after **${encounter.round}** round${encounter.round !== 1 ? 's' : ''} (${duration}).`)
    ]
  });
}

/**
 * Handle /init damage
 */
async function handleDamage(interaction: ChatInputCommandInteraction) {
  if (!interaction.channelId) return;

  const name = interaction.options.getString('name', true);
  const amount = interaction.options.getInteger('amount', true);

  const combatant = initiativeTracker.applyDamage(interaction.channelId, name, amount);
  const encounter = initiativeTracker.getEncounter(interaction.channelId);

  if (!encounter) return;

  const embed = buildTrackerEmbed(encounter);
  const message = amount >= 0
    ? `💥 **${name}** takes ${amount} damage. Now at ${combatant.hp}/${combatant.maxHp} HP.`
    : `💚 **${name}** healed for ${Math.abs(amount)}. Now at ${combatant.hp}/${combatant.maxHp} HP.`;

  await interaction.editReply({
    content: message,
    embeds: [embed]
  });
}

/**
 * Handle /init hp
 */
async function handleHP(interaction: ChatInputCommandInteraction) {
  if (!interaction.channelId) return;

  const name = interaction.options.getString('name', true);
  const current = interaction.options.getInteger('current', true);
  const max = interaction.options.getInteger('max') || undefined;

  initiativeTracker.setHP(interaction.channelId, name, current, max);
  const encounter = initiativeTracker.getEncounter(interaction.channelId);

  if (!encounter) return;

  const embed = buildTrackerEmbed(encounter);
  await interaction.editReply({
    content: `✅ Set HP for **${name}**: ${current}${max !== undefined ? `/${max}` : ''} HP.`,
    embeds: [embed]
  });
}

/**
 * Build the initiative tracker embed
 */
function buildTrackerEmbed(encounter: any): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle(`⚔️ Initiative — Round ${encounter.round}`);

  if (encounter.combatants.length === 0) {
    embed.setDescription('No combatants yet. Add combatants with `/init add`.');
    return embed;
  }

  let description = '';
  encounter.combatants.forEach((c: Combatant, idx: number) => {
    const isCurrent = idx === encounter.currentIndex;
    const marker = isCurrent ? '➤' : ' ';

    let hpStr = '';
    if (c.hp !== undefined) {
      if (c.hp === 0) {
        hpStr = ` ~~${c.hp}/${c.maxHp} HP~~ 💀`;
      } else {
        hpStr = ` ${c.hp}/${c.maxHp} HP`;
      }
    }

    description += `${marker} **${c.initiative}**  ${c.name}${hpStr}\n`;
  });

  embed.setDescription(description);

  const duration = formatDuration(Date.now() - encounter.startedAt);
  embed.setFooter({
    text: `Round ${encounter.round} · ${encounter.combatants.length} combatant${encounter.combatants.length !== 1 ? 's' : ''} · Started ${duration} ago`
  });

  return embed;
}

/**
 * Format duration in minutes/seconds
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}
