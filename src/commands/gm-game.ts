import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
  ButtonInteraction,
  ComponentType,
  ApplicationCommandOptionType
} from 'discord.js';
import { Command } from '../bot/client';
import { arcaneAPI } from '../services/api';
import { logError } from '../utils/logger';

export const gmGameCommand: Command = {
  name: 'gm-game',
  description: 'Manage your game listings',
  options: [
    {
      name: 'create',
      description: 'Create a new game listing',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'title',
          description: 'Game title (max 100 characters)',
          type: ApplicationCommandOptionType.String,
          required: true,
          max_length: 100
        },
        {
          name: 'system',
          description: 'Game system',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        },
        {
          name: 'type',
          description: 'Game type',
          type: ApplicationCommandOptionType.String,
          required: true,
          choices: [
            { name: 'Campaign', value: 'CAMPAIGN' },
            { name: 'One-Shot', value: 'ONE_SHOT' }
          ]
        },
        {
          name: 'max-players',
          description: 'Maximum number of players',
          type: ApplicationCommandOptionType.Integer,
          required: true,
          min_value: 1,
          max_value: 10
        },
        {
          name: 'price',
          description: 'Price per session in USD',
          type: ApplicationCommandOptionType.Number,
          required: true,
          min_value: 0,
          max_value: 200
        },
        {
          name: 'timezone',
          description: 'Your timezone',
          type: ApplicationCommandOptionType.String,
          required: true,
          choices: [
            { name: 'EST (UTC-5)', value: 'EST' },
            { name: 'CST (UTC-6)', value: 'CST' },
            { name: 'MST (UTC-7)', value: 'MST' },
            { name: 'PST (UTC-8)', value: 'PST' },
            { name: 'GMT (UTC+0)', value: 'GMT' },
            { name: 'CET (UTC+1)', value: 'CET' }
          ]
        },
        {
          name: 'short-description',
          description: 'Brief description (max 200 characters)',
          type: ApplicationCommandOptionType.String,
          required: true,
          max_length: 200
        },
        {
          name: 'content-warnings',
          description: 'Content warnings (comma-separated)',
          type: ApplicationCommandOptionType.String,
          required: false
        }
      ]
    },
    {
      name: 'list',
      description: 'List your games',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'status',
          description: 'Filter by status',
          type: ApplicationCommandOptionType.String,
          required: false,
          choices: [
            { name: 'All', value: 'all' },
            { name: 'Draft', value: 'DRAFT' },
            { name: 'Published', value: 'PUBLISHED' },
            { name: 'Full', value: 'FULL' },
            { name: 'Completed', value: 'COMPLETED' }
          ]
        },
        {
          name: 'type',
          description: 'Filter by type',
          type: ApplicationCommandOptionType.String,
          required: false,
          choices: [
            { name: 'All', value: 'all' },
            { name: 'Campaign', value: 'CAMPAIGN' },
            { name: 'One-Shot', value: 'ONE_SHOT' }
          ]
        }
      ]
    },
    {
      name: 'edit',
      description: 'Edit an existing game',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'game',
          description: 'Game to edit',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        },
        {
          name: 'field',
          description: 'Field to edit',
          type: ApplicationCommandOptionType.String,
          required: true,
          choices: [
            { name: 'Title', value: 'title' },
            { name: 'Description', value: 'description' },
            { name: 'Max Players', value: 'max-players' },
            { name: 'Price', value: 'price' },
            { name: 'Status', value: 'status' },
            { name: 'Content Warnings', value: 'content-warnings' }
          ]
        },
        {
          name: 'value',
          description: 'New value',
          type: ApplicationCommandOptionType.String,
          required: true
        }
      ]
    },
    {
      name: 'publish',
      description: 'Publish or unpublish a game',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'game',
          description: 'Game to publish/unpublish',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        },
        {
          name: 'action',
          description: 'Action to take',
          type: ApplicationCommandOptionType.String,
          required: true,
          choices: [
            { name: 'Publish', value: 'publish' },
            { name: 'Unpublish', value: 'unpublish' }
          ]
        }
      ]
    },
    {
      name: 'delete',
      description: 'Delete a game listing',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'game',
          description: 'Game to delete',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        }
      ]
    }
  ],

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      // Authenticate user first
      await arcaneAPI.authenticateWithDiscord(interaction.user.id);

      switch (subcommand) {
        case 'create':
          await handleGameCreate(interaction);
          break;
        case 'list':
          await handleGameList(interaction);
          break;
        case 'edit':
          await handleGameEdit(interaction);
          break;
        case 'publish':
          await handlePublishGame(interaction);
          break;
        case 'delete':
          await handleDeleteGame(interaction);
          break;
      }

    } catch (error) {
      logError('GM game command failed', error as Error, {
        userId: interaction.user.id,
        subcommand
      });

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: '❌ Failed to execute command. Please ensure you are linked to Arcane Circle.',
        });
      } else {
        await interaction.reply({
          content: '❌ Failed to execute command. Please ensure you are linked to Arcane Circle.',
          ephemeral: true
        });
      }
    }
  },

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === 'system') {
      try {
        const systems = await arcaneAPI.systems.listSystems();
        const filtered = systems
          .filter(system => system.name.toLowerCase().includes(focusedOption.value.toLowerCase()))
          .slice(0, 25)
          .map(system => ({ name: system.name, value: system.id }));

        await interaction.respond(filtered);
      } catch (error) {
        await interaction.respond([]);
      }
    } else if (focusedOption.name === 'game') {
      try {
        await arcaneAPI.authenticateWithDiscord(interaction.user.id);
        const user = await arcaneAPI.users.getUserByDiscordId(interaction.user.id);
        const games = await arcaneAPI.games.listGames({ gmId: user.id });

        const filtered = games
          .filter(game => game.title.toLowerCase().includes(focusedOption.value.toLowerCase()))
          .slice(0, 25)
          .map(game => ({ name: game.title, value: game.id }));

        await interaction.respond(filtered);
      } catch (error) {
        await interaction.respond([]);
      }
    }
  }
};

async function handleGameCreate(interaction: ChatInputCommandInteraction) {
  const title = interaction.options.getString('title', true);
  const systemId = interaction.options.getString('system', true);
  const type = interaction.options.getString('type', true);
  const maxPlayers = interaction.options.getInteger('max-players', true);
  const price = interaction.options.getNumber('price', true);
  const timezone = interaction.options.getString('timezone', true);
  const shortDescription = interaction.options.getString('short-description', true);
  const contentWarnings = interaction.options.getString('content-warnings');

  // Show modal for full description
  const modal = new ModalBuilder()
    .setCustomId(`game_create_${interaction.user.id}`)
    .setTitle('Create New Game - Full Description');

  const descriptionInput = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Full Game Description')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(100)
    .setMaxLength(2000)
    .setPlaceholder('Provide a detailed description of your game...')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput));

  await interaction.showModal(modal);

  // Store the initial data for when modal is submitted
  const gameData = {
    title,
    systemId,
    gameType: type,
    maxPlayers,
    pricePerSession: price,
    timezone,
    shortDescription,
    contentWarnings: contentWarnings ? contentWarnings.split(',').map(w => w.trim()) : undefined
  };

  // Listen for modal submission
  const filter = (modalInteraction: ModalSubmitInteraction) =>
    modalInteraction.customId === `game_create_${interaction.user.id}`;

  try {
    const modalSubmission = await interaction.awaitModalSubmit({ filter, time: 600000 });
    const fullDescription = modalSubmission.fields.getTextInputValue('description');

    await modalSubmission.deferReply();

    const user = await arcaneAPI.users.getUserByDiscordId(interaction.user.id);

    const createData: any = {
      title: gameData.title,
      systemId: gameData.systemId,
      gameType: gameData.gameType,
      maxPlayers: gameData.maxPlayers,
      pricePerSession: gameData.pricePerSession,
      timezone: gameData.timezone,
      shortDescription: gameData.shortDescription,
      description: fullDescription,
      gmId: user.id
    };

    // Only add contentWarnings if defined
    if (gameData.contentWarnings !== undefined) {
      createData.contentWarnings = gameData.contentWarnings;
    }

    const newGame = await arcaneAPI.games.createGame(createData, interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('✅ Game Created Successfully!')
      .setDescription(`**${newGame.title}** has been created as a draft.`)
      .addFields(
        { name: '🎮 System', value: systemId, inline: true },
        { name: '👥 Max Players', value: maxPlayers.toString(), inline: true },
        { name: '💰 Price', value: `$${price}`, inline: true },
        { name: '📝 Description', value: shortDescription, inline: false }
      )
      .addFields({
        name: '🚀 Next Steps',
        value: `Use \`/gm-game publish\` to make it visible to players, or edit it first with \`/gm-game edit\`.`,
        inline: false
      })
      .setTimestamp();

    await modalSubmission.editReply({ embeds: [embed] });

  } catch (error) {
    logError('Game creation failed', error as Error, { userId: interaction.user.id });
  }
}

async function handleGameList(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const statusFilter = interaction.options.getString('status') || 'all';
  const typeFilter = interaction.options.getString('type') || 'all';

  try {
    const user = await arcaneAPI.users.getUserByDiscordId(interaction.user.id);
    const params: any = { gmId: user.id };

    if (statusFilter !== 'all') params.status = statusFilter;
    if (typeFilter !== 'all') params.gameType = typeFilter;

    const games = await arcaneAPI.games.listGames(params);

    if (!games || games.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('📝 No Games Found')
        .setDescription('You haven\'t created any games yet.')
        .addFields({
          name: '🎲 Create Your First Game',
          value: 'Use `/gm-game create` to create a new game listing.',
          inline: false
        });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎲 Your Games')
      .setDescription(`Found ${games.length} game(s)`)
      .setTimestamp();

    games.forEach((game: any) => {
      const systemName = typeof game.system === 'object' ? game.system.name : game.system;
      const statusEmoji = getStatusEmoji(game.status);

      embed.addFields({
        name: `${statusEmoji} ${game.title}`,
        value: `**System:** ${systemName}\n**Type:** ${game.gameType}\n**Status:** ${game.status}\n**Players:** ${game.currentPlayers || 0}/${game.maxPlayers}`,
        inline: true
      });
    });

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    await interaction.editReply({
      content: '❌ Failed to retrieve your games. Please try again later.'
    });
  }
}

async function handleGameEdit(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const gameId = interaction.options.getString('game', true);
  const field = interaction.options.getString('field', true);
  const value = interaction.options.getString('value', true);

  try {
    // Verify user is authenticated
    await arcaneAPI.users.getUserByDiscordId(interaction.user.id);

    let updateData: any = {};

    if (field === 'max-players') {
      updateData.maxPlayers = parseInt(value);
    } else if (field === 'price') {
      updateData.pricePerSession = parseFloat(value);
    } else if (field === 'content-warnings') {
      updateData.contentWarnings = value.split(',').map(w => w.trim());
    } else {
      updateData[field] = value;
    }

    await arcaneAPI.games.updateGame(gameId, updateData, interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('✅ Game Updated')
      .setDescription(`Successfully updated ${field}.`)
      .addFields({
        name: `📝 ${field.charAt(0).toUpperCase() + field.slice(1)}`,
        value: value,
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

async function handlePublishGame(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const gameId = interaction.options.getString('game', true);
  const action = interaction.options.getString('action', true);

  try {
    const status = action === 'publish' ? 'PUBLISHED' : 'DRAFT';
    await arcaneAPI.games.updateGameStatus(gameId, status, interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(action === 'publish' ? 0x00FF00 : 0xFFAA00)
      .setTitle(action === 'publish' ? '🚀 Game Published' : '📝 Game Unpublished')
      .setDescription(`Successfully ${action === 'publish' ? 'published' : 'unpublished'} your game.`)
      .setTimestamp();

    if (action === 'publish') {
      embed.addFields({
        name: '✨ Game is now visible',
        value: 'Players can now find and apply to your game.',
        inline: false
      });
    } else {
      embed.addFields({
        name: '👁️ Game is now hidden',
        value: 'Players can no longer see or apply to your game.',
        inline: false
      });
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    await interaction.editReply({
      content: `❌ Failed to ${action} game. Please try again later.`
    });
  }
}

async function handleDeleteGame(interaction: ChatInputCommandInteraction) {
  const gameId = interaction.options.getString('game', true);

  // Show confirmation button
  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('⚠️ Confirm Game Deletion')
    .setDescription('Are you sure you want to delete this game? This action cannot be undone.')
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('confirm_delete')
      .setLabel('🗑️ Yes, Delete')
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId('cancel_delete')
      .setLabel('❌ Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({ embeds: [embed], components: [row] });

  const filter = (buttonInteraction: ButtonInteraction) =>
    buttonInteraction.user.id === interaction.user.id;

  try {
    const message = await interaction.fetchReply();
    const buttonInteraction = await message.awaitMessageComponent({
      filter,
      time: 30000,
      componentType: ComponentType.Button
    });

    if (buttonInteraction.customId === 'confirm_delete') {
      try {
        await arcaneAPI.games.deleteGame(gameId, interaction.user.id);

        const successEmbed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('✅ Game Deleted')
          .setDescription('Your game has been successfully deleted.')
          .setTimestamp();

        await buttonInteraction.update({ embeds: [successEmbed], components: [] });
      } catch (error) {
        await buttonInteraction.update({
          content: '❌ Failed to delete game. Please try again later.',
          embeds: [],
          components: []
        });
      }
    } else {
      const cancelEmbed = new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('❌ Deletion Cancelled')
        .setDescription('Your game was not deleted.')
        .setTimestamp();

      await buttonInteraction.update({ embeds: [cancelEmbed], components: [] });
    }
  } catch (error) {
    // Button interaction timed out
    await interaction.editReply({
      content: '❌ Confirmation timed out. Game was not deleted.',
      components: []
    });
  }
}

function getStatusEmoji(status: string): string {
  const statusEmojis: Record<string, string> = {
    'DRAFT': '📝',
    'PUBLISHED': '🟢',
    'FULL': '🔴',
    'COMPLETED': '✅',
    'CANCELLED': '❌'
  };
  return statusEmojis[status] || '❔';
}
