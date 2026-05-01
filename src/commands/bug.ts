import {
  ChatInputCommandInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { createBugIssue } from '../services/github';
import { logInfo, logError } from '../utils/logger';
import { config } from '../utils/config';

const BUG_MODAL_ID = 'bug-report-modal';
const FIELD_TITLE = 'bug-title';
const FIELD_DESCRIPTION = 'bug-description';
const FIELD_STEPS = 'bug-steps';

async function lookupLinkedUser(discordId: string) {
  try {
    return await arcaneAPI.getUserByDiscordId(discordId);
  } catch {
    return null;
  }
}

export const bugCommand: Command = {
  name: 'bug',
  description: 'Report a bug to the Arcane Circle developers',

  async execute(interaction: ChatInputCommandInteraction) {
    // Gate: only linked AC accounts can file bugs.
    // Check before opening the modal so the user doesn't waste effort typing.
    const user = await lookupLinkedUser(interaction.user.id);

    if (!user) {
      await interaction.reply({
        content:
          'You need a linked Arcane Circle account to file bugs.\n\n' +
          '• If you already have an account, run `/link` to connect Discord.\n' +
          `• If you don't, sign up at ${config.PLATFORM_WEB_URL}`,
        ephemeral: true
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(BUG_MODAL_ID)
      .setTitle('Report a Bug');

    const titleInput = new TextInputBuilder()
      .setCustomId(FIELD_TITLE)
      .setLabel('Title')
      .setStyle(TextInputStyle.Short)
      .setMinLength(5)
      .setMaxLength(120)
      .setPlaceholder('Short summary of the bug')
      .setRequired(true);

    const descriptionInput = new TextInputBuilder()
      .setCustomId(FIELD_DESCRIPTION)
      .setLabel('What happened?')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(2000)
      .setPlaceholder('Describe what went wrong, what you expected, and any relevant context.')
      .setRequired(true);

    const stepsInput = new TextInputBuilder()
      .setCustomId(FIELD_STEPS)
      .setLabel('Steps to reproduce (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1000)
      .setPlaceholder('1. ...\n2. ...\n3. ...')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(stepsInput)
    );

    await interaction.showModal(modal);

    logInfo('Bug report modal opened', {
      userId: user.id,
      discordId: interaction.user.id
    });
  }
};

/**
 * Module-level customId so the bot's interaction router can match modals
 * without importing implementation details.
 */
export const BUG_REPORT_MODAL_ID = BUG_MODAL_ID;

export async function handleBugReportSubmission(
  interaction: ModalSubmitInteraction
) {
  await interaction.deferReply({ ephemeral: true });

  // Defense in depth: re-verify linked account at submission time.
  const user = await lookupLinkedUser(interaction.user.id);
  if (!user) {
    await interaction.editReply({
      content:
        'Bug report rejected: your Discord account is not linked to Arcane Circle. ' +
        'Run `/link` to connect it, then try again.'
    });
    return;
  }

  const title = interaction.fields.getTextInputValue(FIELD_TITLE).trim();
  const description = interaction.fields
    .getTextInputValue(FIELD_DESCRIPTION)
    .trim();
  const steps = interaction.fields.getTextInputValue(FIELD_STEPS).trim();

  if (!title || !description) {
    await interaction.editReply({
      content: 'Title and description are required.'
    });
    return;
  }

  const reporterDisplay =
    user.username || user.discordUsername || interaction.user.username;
  const guildContext = interaction.guildId
    ? `Guild \`${interaction.guildId}\``
    : 'DM';

  const body = [
    `**Reporter:** ${reporterDisplay} (AC user \`${user.id}\`)`,
    `**Discord:** ${interaction.user.username} (\`${interaction.user.id}\`)`,
    `**Source:** ${guildContext}`,
    '',
    '## What happened?',
    description,
    ...(steps ? ['', '## Steps to reproduce', steps] : []),
    '',
    '---',
    '_Filed via `/bug` from the Arcane Circle Discord bot._'
  ].join('\n');

  try {
    const issue = await createBugIssue({
      title: `[Bug] ${title}`,
      body,
      labels: ['bug', 'discord-report']
    });

    logInfo('Bug report filed', {
      userId: user.id,
      discordId: interaction.user.id,
      issueNumber: issue.number,
      issueUrl: issue.html_url
    });

    await interaction.editReply({
      content:
        `Bug report filed: [#${issue.number}](${issue.html_url})\n` +
        'Thanks. The team will take a look.'
    });
  } catch (error) {
    logError('Bug report submission failed', error as Error, {
      userId: user.id,
      discordId: interaction.user.id
    });

    await interaction.editReply({
      content:
        'Failed to file the bug report (GitHub API error). ' +
        'Try again in a minute, or reach out to a moderator if it keeps failing.'
    });
  }
}
