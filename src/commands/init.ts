import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ApplicationCommandOptionType,
  EmbedBuilder,
  GuildMember
} from 'discord.js';
import { Command } from '../bot/client';
import { channelContext } from '../services/context/ChannelContext';
import { characterService } from '../services/api/characters';
import { initiativeTracker, Encounter } from '../services/session/InitiativeTracker';
import { DiceRoller } from '@dice-roller/rpg-dice-roller';
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
      name: 'roll',
      description: 'Auto-roll initiative for all linked characters in voice',
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'next',
      description: "Advance to next combatant's turn",
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'prev',
      description: "Go back to previous combatant's turn",
      type: ApplicationCommandOptionType.Subcommand
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
      description: 'Apply damage to a combatant (NPC HP tracking)',
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
      const channelId = interaction.channelId;

      logInfo('Init command executed', {
        userId: interaction.user.id,
        subcommand,
        channelId
      });

      switch (subcommand) {
        case 'start':
          await handleStart(interaction, channelId);
          break;
        case 'add':
          await handleAdd(interaction, channelId);
          break;
        case 'roll':
          await handleRoll(interaction, channelId);
          break;
        case 'next':
          await handleNext(interaction, channelId);
          break;
        case 'prev':
          await handlePrev(interaction, channelId);
          break;
        case 'remove':
          await handleRemove(interaction, channelId);
          break;
        case 'list':
          await handleList(interaction, channelId);
          break;
        case 'end':
          await handleEnd(interaction, channelId);
          break;
        case 'damage':
          await handleDamage(interaction, channelId);
          break;
        case 'hp':
          await handleHP(interaction, channelId);
          break;
      }
    } catch (error) {
      logError('Error executing init command', error as Error, {
        userId: interaction.user.id
      });

      const errorMsg = (error as Error).message;
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Initiative Error')
          .setDescription(errorMsg || 'An error occurred.')
        ]
      });
    }
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    const encounter = initiativeTracker.getEncounter(interaction.channelId);
    if (!encounter) return interaction.respond([]);

    const focused = interaction.options.getFocused();
    const choices = encounter.combatants
      .filter(c => c.name.toLowerCase().includes(focused.toLowerCase()))
      .slice(0, 25)
      .map(c => ({ name: c.name, value: c.name }));

    return interaction.respond(choices);
  }
};

// ── Subcommand handlers ────────────────────────────────────

async function handleStart(
  interaction: ChatInputCommandInteraction,
  channelId: string
): Promise<void> {
  const existing = initiativeTracker.getEncounter(channelId);
  if (existing) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ Encounter Active')
        .setDescription('An encounter is already active in this channel. Run `/init end` to finish it first.')
      ]
    });
    return;
  }

  const encounter = initiativeTracker.startEncounter(channelId);
  const embed = buildTrackerEmbed(encounter);
  await interaction.editReply({ embeds: [embed] });
}

async function handleAdd(
  interaction: ChatInputCommandInteraction,
  channelId: string
): Promise<void> {
  requireEncounter(channelId);

  const name = interaction.options.getString('name', true);
  const initRoll = interaction.options.getInteger('roll', true);
  const dex = interaction.options.getInteger('dex') ?? 0;

  try {
    initiativeTracker.addCombatant(channelId, {
      name,
      initiative: initRoll,
      dexMod: dex,
      isPlayer: false
    });
  } catch (err) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ Duplicate Combatant')
        .setDescription(`"${name}" is already in the initiative order.`)
      ]
    });
    return;
  }

  const embed = buildTrackerEmbed(initiativeTracker.getEncounter(channelId)!);
  await interaction.editReply({ embeds: [embed] });
}

async function handleRoll(
  interaction: ChatInputCommandInteraction,
  channelId: string
): Promise<void> {
  const encounter = requireEncounter(channelId);

  const ctx = await channelContext.resolveCampaignFromInteraction(interaction);
  if (!ctx) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ No Campaign Context')
        .setDescription('This channel isn\'t linked to a campaign. Add combatants manually with `/init add`.')
      ]
    });
    return;
  }

  // Find voice channel members
  const member = interaction.member as GuildMember;
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ No Voice Channel')
        .setDescription('No players with linked characters found in voice. Add combatants manually with `/init add`.')
      ]
    });
    return;
  }

  const voiceMembers = voiceChannel.members.filter(m => !m.user.bot);
  let added = 0;
  const rollResults: string[] = [];

  for (const [, voiceMember] of voiceMembers) {
    try {
      const charData = await characterService.getVTTDataForUser(ctx.gameId, voiceMember.id);
      if (!charData) continue;

      const { character, vttData } = charData;
      const initMod = vttData.stats?.initiative ?? 0;
      const dexMod = vttData.abilities?.['dex']?.mod ?? vttData.abilities?.['dexterity']?.mod ?? 0;

      // Roll initiative
      const notation = `1d20${initMod >= 0 ? '+' : ''}${initMod}`;
      const result = roller.roll(notation) as { total: number; output: string };

      // Check if already in encounter
      const existing = encounter.combatants.find(
        c => c.name.toLowerCase() === character.name.toLowerCase()
      );
      if (existing) continue;

      initiativeTracker.addCombatant(channelId, {
        name: character.name,
        initiative: result.total,
        dexMod,
        isPlayer: true,
        discordUserId: voiceMember.id
      });

      rollResults.push(`**${character.name}**: ${result.total} (${notation} = ${result.output})`);
      added++;
    } catch (err) {
      logDebug('Failed to roll initiative for voice member', {
        memberId: voiceMember.id,
        error: (err as Error).message
      });
    }
  }

  if (added === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ No Characters Found')
        .setDescription('No players with linked characters found in voice. Add combatants manually with `/init add`.')
      ]
    });
    return;
  }

  const updatedEncounter = initiativeTracker.getEncounter(channelId)!;
  const embed = buildTrackerEmbed(updatedEncounter);
  embed.addFields({
    name: '🎲 Initiative Rolls',
    value: rollResults.join('\n'),
    inline: false
  });

  await interaction.editReply({ embeds: [embed] });
}

async function handleNext(
  interaction: ChatInputCommandInteraction,
  channelId: string
): Promise<void> {
  requireEncounter(channelId);

  const { combatant, round } = initiativeTracker.nextTurn(channelId);
  const encounter = initiativeTracker.getEncounter(channelId)!;

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

async function handlePrev(
  interaction: ChatInputCommandInteraction,
  channelId: string
): Promise<void> {
  requireEncounter(channelId);

  const { combatant, round } = initiativeTracker.prevTurn(channelId);
  const encounter = initiativeTracker.getEncounter(channelId)!;

  const embed = buildTrackerEmbed(encounter);
  await interaction.editReply({ embeds: [embed] });

  await interaction.followUp({
    content: `⚔️ **Round ${round}** — Back to **${combatant.name}**'s turn.`
  });
}

async function handleRemove(
  interaction: ChatInputCommandInteraction,
  channelId: string
): Promise<void> {
  requireEncounter(channelId);

  const name = interaction.options.getString('name', true);

  try {
    initiativeTracker.removeCombatant(channelId, name);
  } catch (err) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ Not Found')
        .setDescription(`No combatant named "${name}" in the current encounter.`)
      ]
    });
    return;
  }

  const encounter = initiativeTracker.getEncounter(channelId)!;
  const embed = buildTrackerEmbed(encounter);
  await interaction.editReply({ embeds: [embed] });
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  channelId: string
): Promise<void> {
  const encounter = requireEncounter(channelId);
  const embed = buildTrackerEmbed(encounter);
  await interaction.editReply({ embeds: [embed] });
}

async function handleEnd(
  interaction: ChatInputCommandInteraction,
  channelId: string
): Promise<void> {
  const encounter = initiativeTracker.endEncounter(channelId);

  if (!encounter) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ No Active Encounter')
        .setDescription('No active encounter. Start one with `/init start`.')
      ]
    });
    return;
  }

  const durationMs = Date.now() - encounter.startedAt;
  const durationMins = Math.floor(durationMs / 60000);
  const durationStr = durationMins > 60
    ? `${Math.floor(durationMins / 60)}h ${durationMins % 60}m`
    : `${durationMins}m`;

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle('⚔️ Encounter Ended')
      .setDescription(
        `Encounter ended after ${encounter.round} rounds (${durationStr}).`
      )
      .setFooter({ text: 'Arcane Circle' })
    ]
  });
}

async function handleDamage(
  interaction: ChatInputCommandInteraction,
  channelId: string
): Promise<void> {
  requireEncounter(channelId);

  const name = interaction.options.getString('name', true);
  const amount = interaction.options.getInteger('amount', true);

  try {
    const combatant = initiativeTracker.applyDamage(channelId, name, amount);
    const encounter = initiativeTracker.getEncounter(channelId)!;
    const embed = buildTrackerEmbed(encounter);

    const action = amount > 0 ? `took ${amount} damage` : `healed ${Math.abs(amount)} HP`;
    embed.addFields({
      name: '💥 Damage',
      value: `**${combatant.name}** ${action} → ${combatant.hp}/${combatant.maxHp || '?'} HP`,
      inline: false
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ Error')
        .setDescription((err as Error).message)
      ]
    });
  }
}

async function handleHP(
  interaction: ChatInputCommandInteraction,
  channelId: string
): Promise<void> {
  requireEncounter(channelId);

  const name = interaction.options.getString('name', true);
  const current = interaction.options.getInteger('current', true);
  const max = interaction.options.getInteger('max') ?? undefined;

  try {
    const combatant = initiativeTracker.setHP(channelId, name, current, max);
    const encounter = initiativeTracker.getEncounter(channelId)!;
    const embed = buildTrackerEmbed(encounter);

    embed.addFields({
      name: '❤️ HP Set',
      value: `**${combatant.name}**: ${combatant.hp}/${combatant.maxHp || '?'} HP`,
      inline: false
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ Error')
        .setDescription((err as Error).message)
      ]
    });
  }
}

// ── Helpers ────────────────────────────────────────────────

function requireEncounter(channelId: string): Encounter {
  const encounter = initiativeTracker.getEncounter(channelId);
  if (!encounter) {
    throw new Error('No active encounter. Start one with `/init start`.');
  }
  return encounter;
}

function buildTrackerEmbed(encounter: Encounter): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0xf39c12);

  const roundLabel = encounter.round > 0 ? `Round ${encounter.round}` : 'Waiting for combatants';
  embed.setTitle(`⚔️ Initiative — ${roundLabel}`);

  if (encounter.combatants.length === 0) {
    embed.setDescription('No combatants yet. Use `/init add` or `/init roll` to add combatants.');
  } else {
    const lines: string[] = [];

    for (let i = 0; i < encounter.combatants.length; i++) {
      const c = encounter.combatants[i]!;
      const isCurrent = i === encounter.currentIndex && encounter.round > 0;
      const marker = isCurrent ? '➤' : ' ';
      const initStr = c.initiative.toString().padStart(3, ' ');

      let hpStr = '';
      if (c.hp !== undefined) {
        if (c.hp <= 0) {
          hpStr = `  ~~${c.hp}/${c.maxHp || '?'} HP~~ 💀`;
        } else {
          hpStr = `  ${c.hp}/${c.maxHp || '?'} HP`;
        }
      }

      const nameStr = c.hp !== undefined && c.hp <= 0
        ? `~~${c.name}~~`
        : c.name;

      lines.push(`\`${marker} ${initStr}\`  ${nameStr}${hpStr}`);
    }

    embed.setDescription(lines.join('\n'));
  }

  // Footer with encounter info
  const durationMs = Date.now() - encounter.startedAt;
  const durationMins = Math.floor(durationMs / 60000);
  const combatantCount = encounter.combatants.length;

  const footerParts = [];
  if (encounter.round > 0) footerParts.push(`Round ${encounter.round}`);
  footerParts.push(`${combatantCount} combatants`);
  if (durationMins > 0) footerParts.push(`Started ${durationMins} min ago`);

  embed.setFooter({ text: footerParts.join(' · ') });

  return embed;
}
