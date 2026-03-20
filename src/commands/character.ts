import {
  ChatInputCommandInteraction,
  ApplicationCommandOptionType,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../bot/client';
import { channelContext } from '../services/context/ChannelContext';
import { characterService } from '../services/api/characters';
import { arcaneAPI } from '../services/api';
import { logInfo, logError } from '../utils/logger';
import { config } from '../utils/config';
import { VTTData } from '../types/character';

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
          description: "View another player's character (GM only)",
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
    },
    {
      name: 'spells',
      description: 'View spell list',
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'inventory',
      description: 'View equipment and items',
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'features',
      description: 'View class features and racial traits',
      type: ApplicationCommandOptionType.Subcommand
    }
  ],

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      const subcommand = interaction.options.getSubcommand();

      logInfo('Character command executed', {
        userId: interaction.user.id,
        subcommand
      });

      const ctx = await channelContext.requireCampaignContext(interaction);
      if (!ctx) return;

      // Resolve target user
      const targetUser = interaction.options.getUser('player');
      const targetDiscordId = targetUser?.id || interaction.user.id;

      // If targeting another user, verify GM status
      if (targetUser && targetUser.id !== interaction.user.id) {
        const requestingUser = await arcaneAPI.getUserByDiscordId(interaction.user.id);
        if (!requestingUser || requestingUser.id !== ctx.gmId) {
          await interaction.editReply({
            embeds: [new EmbedBuilder()
              .setColor(0xFFAA00)
              .setTitle('⚠️ Permission Denied')
              .setDescription("You can only view your own character. GMs can view any player's character.")
            ]
          });
          return;
        }
      }

      // Resolve character + VTT data
      const charData = await characterService.getVTTDataForUser(ctx.gameId, targetDiscordId);
      if (!charData) {
        const targetLabel = targetUser ? targetUser.username : 'you';
        const webUrl = `${config.PLATFORM_WEB_URL}/dashboard/games/${ctx.gameId}`;
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0xFFAA00)
            .setTitle('⚠️ No Character Found')
            .setDescription(
              `No approved character found for ${targetLabel} in ${ctx.gameName}.\n` +
              `[Create one on Arcane Circle](${webUrl})`
            )
          ]
        });
        return;
      }

      const { character, vttData } = charData;

      switch (subcommand) {
        case 'view':
          await handleView(interaction, character.name, vttData, ctx.gameName, character.id);
          break;
        case 'stats':
          await handleStats(interaction, character.name, vttData);
          break;
        case 'skills':
          await handleSkills(interaction, character.name, vttData);
          break;
        case 'spells':
          await handleSpells(interaction, character.name, vttData);
          break;
        case 'inventory':
          await handleInventory(interaction, character.name, vttData);
          break;
        case 'features':
          await handleFeatures(interaction, character.name, vttData);
          break;
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

// ── Subcommand handlers ────────────────────────────────────

async function handleView(
  interaction: ChatInputCommandInteraction,
  name: string,
  vtt: VTTData,
  campaignName: string,
  characterId: string
): Promise<void> {
  const level = vtt.level ? `Level ${vtt.level}` : '';
  const charType = vtt.characterType || '';
  const titleParts = [name, level, charType].filter(Boolean);
  const hp = vtt.stats?.hp;
  const ac = vtt.stats?.ac ?? '?';
  const speed = vtt.stats?.speed ?? '?';
  const init = vtt.stats?.initiative ?? 0;
  const profBonus = vtt.stats?.proficiencyBonus ?? 0;

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`🧙 ${titleParts.join(' — ')}`)
    .setDescription(`Campaign: ${campaignName}`);

  const statLine = [
    hp ? `HP: ${hp.current}/${hp.max}` : null,
    `AC: ${ac}`,
    `Speed: ${speed}ft`,
    `Initiative: ${formatMod(init)}`
  ].filter(Boolean).join(' | ');
  embed.addFields({ name: 'Combat Stats', value: statLine, inline: false });

  // Ability scores
  const abilities = vtt.abilities || {};
  const abilityNames = Object.keys(abilities);
  if (abilityNames.length > 0) {
    const row1: string[] = [];
    const row2: string[] = [];
    abilityNames.forEach((ab, i) => {
      const entry = abilities[ab]!;
      const line = `**${ab.toUpperCase()}** ${entry.score} (${formatMod(entry.mod)})`;
      if (i < 3) row1.push(line);
      else row2.push(line);
    });

    if (row1.length > 0) embed.addFields({ name: '\u200b', value: row1.join('    '), inline: false });
    if (row2.length > 0) embed.addFields({ name: '\u200b', value: row2.join('    '), inline: false });
  }

  // Saving throws
  const saves = vtt.saves || {};
  const profSaves = Object.entries(saves)
    .filter(([, v]) => v.proficient)
    .map(([k, v]) => `${k.toUpperCase()} ${formatMod(v.mod)}`)
    .join(', ');

  if (profSaves) {
    embed.addFields({
      name: 'Saving Throws',
      value: `${profSaves}  |  Proficiency Bonus: +${profBonus}`,
      inline: false
    });
  }

  if (vtt.imageUrl) embed.setThumbnail(vtt.imageUrl);

  const webUrl = `${config.PLATFORM_WEB_URL}/dashboard/characters/${characterId}`;
  embed.addFields({ name: '\u200b', value: `[🔗 View full sheet on Arcane Circle](${webUrl})`, inline: false });
  embed.setFooter({ text: campaignName });

  await interaction.editReply({ embeds: [embed] });
}

async function handleStats(
  interaction: ChatInputCommandInteraction,
  name: string,
  vtt: VTTData
): Promise<void> {
  const hp = vtt.stats?.hp;
  const ac = vtt.stats?.ac ?? '?';
  const speed = vtt.stats?.speed ?? '?';
  const init = vtt.stats?.initiative ?? 0;

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`🛡️ ${name} — Core Stats`);

  const statLine = [
    hp ? `HP: ${hp.current}/${hp.max}` : null,
    `AC: ${ac}`,
    `Speed: ${speed}ft`,
    `Initiative: ${formatMod(init)}`
  ].filter(Boolean).join(' | ');
  embed.addFields({ name: 'Combat', value: statLine, inline: false });

  const abilities = vtt.abilities || {};
  const saves = vtt.saves || {};
  const lines: string[] = [];

  for (const [ab, entry] of Object.entries(abilities)) {
    const saveProficient = saves[ab]?.proficient;
    const marker = saveProficient ? ' ★' : '';
    lines.push(`**${ab.toUpperCase()}** ${padNum(entry.score)} (${formatMod(entry.mod)})${marker}`);
  }

  if (lines.length > 0) {
    const mid = Math.ceil(lines.length / 2);
    embed.addFields({ name: 'Abilities', value: lines.slice(0, mid).join('    '), inline: false });
    if (lines.length > mid) {
      embed.addFields({ name: '\u200b', value: lines.slice(mid).join('    '), inline: false });
    }
    embed.addFields({ name: '\u200b', value: '★ = Proficient save', inline: false });
  }

  const saveLines: string[] = [];
  for (const [ab, entry] of Object.entries(saves)) {
    const marker = entry.proficient ? ' ★' : '';
    saveLines.push(`${ab.toUpperCase()} ${formatMod(entry.mod)}${marker}`);
  }
  if (saveLines.length > 0) {
    embed.addFields({ name: 'Saving Throws', value: saveLines.join('  |  '), inline: false });
  }

  embed.setFooter({ text: 'Arcane Circle' });
  await interaction.editReply({ embeds: [embed] });
}

async function handleSkills(
  interaction: ChatInputCommandInteraction,
  name: string,
  vtt: VTTData
): Promise<void> {
  const skills = vtt.skills || {};
  const profBonus = vtt.stats?.proficiencyBonus ?? 0;

  if (Object.keys(skills).length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle(`📋 ${name} — Skills`)
        .setDescription(`ℹ️ No skills found on ${name}'s sheet.`)
      ]
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`📋 ${name} — Skills`);

  const sorted = Object.entries(skills).sort(([a], [b]) => a.localeCompare(b));
  const mid = Math.ceil(sorted.length / 2);
  const leftCol = sorted.slice(0, mid);
  const rightCol = sorted.slice(mid);

  const formatSkillCol = (entries: [string, { mod: number; proficient: boolean }][]) => {
    return entries.map(([skill, data]) => {
      const marker = data.proficient ? ' ★' : '';
      return `${capitalize(skill).padEnd(20)} ${formatMod(data.mod)}${marker}`;
    }).join('\n');
  };

  embed.addFields(
    { name: 'Skills', value: '```\n' + formatSkillCol(leftCol) + '\n```', inline: true },
    { name: '\u200b', value: '```\n' + formatSkillCol(rightCol) + '\n```', inline: true }
  );

  embed.addFields({
    name: '\u200b',
    value: `★ = Proficient  |  Proficiency Bonus: +${profBonus}`,
    inline: false
  });

  embed.setFooter({ text: 'Arcane Circle' });
  await interaction.editReply({ embeds: [embed] });
}

async function handleSpells(
  interaction: ChatInputCommandInteraction,
  name: string,
  vtt: VTTData
): Promise<void> {
  const raw = vtt as any;
  const spells = raw.spells || raw.spellcasting;

  if (!spells) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle(`✨ ${name} — Spells`)
        .setDescription(`ℹ️ No spells found on ${name}'s sheet.`)
      ]
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`✨ ${name} — Spells${vtt.characterType ? ` (${vtt.characterType})` : ''}`);

  const metaLines: string[] = [];
  if (spells.spellSaveDC) metaLines.push(`Spell Save DC: ${spells.spellSaveDC}`);
  if (spells.spellAttack) metaLines.push(`Spell Attack: ${formatMod(spells.spellAttack)}`);

  if (spells.slots) {
    const slotStrs: string[] = [];
    for (const [level, data] of Object.entries(spells.slots as Record<string, any>)) {
      const used = data.used ?? 0;
      const max = data.max ?? data.total ?? 0;
      const filled = '●'.repeat(Math.max(0, max - used));
      const empty = '○'.repeat(used);
      slotStrs.push(`${level}: ${filled}${empty}`);
    }
    if (slotStrs.length > 0) metaLines.push(`Slots: ${slotStrs.join(' | ')}`);
  }

  if (metaLines.length > 0) embed.setDescription(metaLines.join('  |  '));

  if (spells.cantrips?.length > 0) {
    embed.addFields({ name: 'Cantrips', value: spells.cantrips.join(', '), inline: false });
  }

  const levels = spells.levels || spells.spellsByLevel;
  if (levels) {
    for (const [level, spellList] of Object.entries(levels as Record<string, any>)) {
      const names = Array.isArray(spellList) ? spellList : spellList?.spells || [];
      if (names.length > 0) {
        embed.addFields({ name: `${ordinal(parseInt(level, 10))} Level`, value: names.join(', '), inline: false });
      }
    }
  }

  if (!levels && !spells.cantrips && Array.isArray(spells.list)) {
    embed.addFields({ name: 'Spells', value: spells.list.join(', '), inline: false });
  }

  embed.setFooter({ text: 'Arcane Circle' });
  await interaction.editReply({ embeds: [embed] });
}

async function handleInventory(
  interaction: ChatInputCommandInteraction,
  name: string,
  vtt: VTTData
): Promise<void> {
  const raw = vtt as any;
  const inventory = raw.inventory || raw.equipment;

  if (!inventory) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle(`🎒 ${name} — Inventory`)
        .setDescription(`ℹ️ No inventory data found on ${name}'s sheet.`)
      ]
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`🎒 ${name} — Inventory`);

  const equipped = inventory.equipped || inventory.weapons || [];
  if (equipped.length > 0) {
    const lines = equipped.map((item: any) => {
      if (typeof item === 'string') return `• ${item}`;
      const dmg = item.damage ? ` (${item.damage})` : '';
      return `• ${item.name}${dmg}`;
    });
    embed.addFields({ name: 'Equipped', value: lines.join('\n'), inline: false });
  }

  const carried = inventory.carried || inventory.items || [];
  if (carried.length > 0) {
    const lines = carried.map((item: any) => {
      if (typeof item === 'string') return `• ${item}`;
      const qty = item.quantity && item.quantity > 1 ? ` x${item.quantity}` : '';
      return `• ${item.name}${qty}`;
    });
    embed.addFields({ name: 'Carried', value: lines.join('\n'), inline: false });
  }

  const currency = inventory.currency || inventory.gold;
  if (currency) {
    const parts: string[] = [];
    if (typeof currency === 'number') {
      parts.push(`${currency} gp`);
    } else {
      if (currency.pp) parts.push(`${currency.pp} pp`);
      if (currency.gp) parts.push(`${currency.gp} gp`);
      if (currency.ep) parts.push(`${currency.ep} ep`);
      if (currency.sp) parts.push(`${currency.sp} sp`);
      if (currency.cp) parts.push(`${currency.cp} cp`);
    }
    if (parts.length > 0) {
      embed.addFields({ name: 'Currency', value: parts.join(', '), inline: false });
    }
  }

  if (equipped.length === 0 && carried.length === 0 && !currency) {
    if (Array.isArray(inventory)) {
      const lines = inventory.map((item: any) =>
        typeof item === 'string' ? `• ${item}` : `• ${item.name || item}`
      );
      embed.setDescription(lines.join('\n'));
    } else {
      embed.setDescription('*No items found*');
    }
  }

  embed.setFooter({ text: 'Arcane Circle' });
  await interaction.editReply({ embeds: [embed] });
}

async function handleFeatures(
  interaction: ChatInputCommandInteraction,
  name: string,
  vtt: VTTData
): Promise<void> {
  const raw = vtt as any;
  const features = raw.features || raw.traits;

  if (!features) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle(`⚡ ${name} — Features & Traits`)
        .setDescription(`ℹ️ No features data found on ${name}'s sheet.`)
      ]
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`⚡ ${name} — Features & Traits`);

  const raceFeatures = features.race || features.racial || [];
  if (raceFeatures.length > 0 || features.raceName) {
    const raceName = features.raceName || 'Race';
    const lines = (Array.isArray(raceFeatures) ? raceFeatures : []).map((f: any) =>
      typeof f === 'string' ? `• ${f}` : `• **${f.name}**${f.description ? ` — ${f.description}` : ''}`
    );
    embed.addFields({
      name: `Race: ${raceName}`,
      value: lines.length > 0 ? lines.join('\n') : '*None listed*',
      inline: false
    });
  }

  const classFeatures = features.class || features.classFeatures || [];
  if (classFeatures.length > 0 || features.className) {
    const className = features.className || vtt.characterType || 'Class';
    const level = vtt.level ? ` ${vtt.level}` : '';
    const lines = (Array.isArray(classFeatures) ? classFeatures : []).map((f: any) =>
      typeof f === 'string' ? `• ${f}` : `• **${f.name}**${f.description ? ` — ${f.description}` : ''}`
    );
    embed.addFields({
      name: `Class: ${className}${level}`,
      value: lines.length > 0 ? lines.join('\n') : '*None listed*',
      inline: false
    });
  }

  if (Array.isArray(features)) {
    const lines = features.map((f: any) =>
      typeof f === 'string' ? `• ${f}` : `• **${f.name}**${f.description ? ` — ${f.description}` : ''}`
    );
    embed.setDescription(lines.join('\n'));
  }

  embed.setFooter({ text: 'Arcane Circle' });
  await interaction.editReply({ embeds: [embed] });
}

// ── Helpers ────────────────────────────────────────────────

function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

function padNum(n: number): string {
  return n.toString().padStart(2, ' ');
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function ordinal(n: number): string {
  const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
  const suffix = suffixes[n] || 'th';
  return `${n}${suffix}`;
}
