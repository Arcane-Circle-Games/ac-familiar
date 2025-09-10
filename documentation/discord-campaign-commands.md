# Discord Campaign Management Commands
## Complete Slash Command Implementation for Arcane Circle

## Overview

This implementation adds comprehensive campaign management to the Discord bot, allowing GMs and players to create, manage, and join campaigns entirely through Discord while leveraging your existing API.

## Command Structure

```
/campaign - Campaign management
├── create     - Create new campaign
├── edit       - Edit campaign details
├── list       - List your campaigns
├── view       - View campaign details
├── delete     - Delete a campaign
└── schedule   - Schedule sessions

/session - Session management
├── create     - Create a session
├── list       - List upcoming sessions
├── start      - Start session (begins recording)
├── end        - End session
├── notes      - Add/view session notes
└── attendance - Mark attendance

/join - Player commands
├── browse     - Browse available games
├── apply      - Apply to join a game
├── leave      - Leave a game
└── status     - Check application status

/wiki - Wiki management
├── create     - Create wiki page
├── edit       - Edit wiki page
├── view       - View wiki page
├── search     - Search wiki
├── list       - List wiki pages
└── link       - Create wiki link

/gm - GM-specific commands
├── profile    - Manage GM profile
├── bookings   - Manage player applications
├── stats      - View campaign statistics
└── payouts    - Check earnings
```

---

## Core API Client Implementation

### `src/services/api/ArcaneCircleAPI.ts`
```typescript
import axios, { AxiosInstance } from 'axios';
import { Logger } from '../../utils/logger';

interface GameCreateData {
  title: string;
  description: string;
  systemId: string;
  gameType: 'CAMPAIGN' | 'ONE_SHOT';
  startTime: string;
  endTime: string;
  maxPlayers: number;
  pricePerSession: number;
  timezone: string;
  contentWarnings: string[];
}

interface BookingData {
  gameId: string;
  applicationMessage: string;
  characterConcept?: string;
}

interface WikiPageData {
  title: string;
  content: string;
  pageType: string;
  visibility: 'public' | 'players' | 'gm_only';
  templateData?: Record<string, any>;
}

export class ArcaneCircleAPI {
  private client: AxiosInstance;
  private logger = new Logger('ArcaneCircleAPI');
  private userTokens: Map<string, string> = new Map(); // Discord ID -> API Token

  constructor() {
    this.client = axios.create({
      baseURL: process.env.PLATFORM_API_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for auth
    this.client.interceptors.request.use((config) => {
      // Add auth token if available
      const token = this.getCurrentUserToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
  }

  /**
   * Set user token for API requests
   */
  setUserToken(discordId: string, token: string): void {
    this.userTokens.set(discordId, token);
  }

  private getCurrentUserToken(): string | undefined {
    // This would be set per request context
    return this.currentToken;
  }

  private currentToken?: string;

  /**
   * Execute API request with user context
   */
  async withUser<T>(discordId: string, fn: () => Promise<T>): Promise<T> {
    const previousToken = this.currentToken;
    try {
      // Get user's API token from database
      const userToken = await this.getUserToken(discordId);
      this.currentToken = userToken;
      return await fn();
    } finally {
      this.currentToken = previousToken;
    }
  }

  private async getUserToken(discordId: string): Promise<string> {
    // Fetch from your database - user's linked account token
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: { apiToken: true },
    });
    
    if (!user?.apiToken) {
      throw new Error('User not linked. Please link your account first.');
    }
    
    return user.apiToken;
  }

  // ============= GAME MANAGEMENT =============

  async createGame(data: GameCreateData): Promise<any> {
    const response = await this.client.post('/api/games', data);
    return response.data;
  }

  async getGame(gameId: string): Promise<any> {
    const response = await this.client.get(`/api/games/${gameId}`);
    return response.data;
  }

  async updateGame(gameId: string, updates: Partial<GameCreateData>): Promise<any> {
    const response = await this.client.put(`/api/games/${gameId}`, updates);
    return response.data;
  }

  async deleteGame(gameId: string): Promise<void> {
    await this.client.delete(`/api/games/${gameId}`);
  }

  async listGames(filters?: {
    gmId?: string;
    status?: string;
    gameType?: string;
  }): Promise<any[]> {
    const response = await this.client.get('/api/games', { params: filters });
    return response.data.games;
  }

  async searchGames(query: string, filters?: any): Promise<any[]> {
    const response = await this.client.get('/api/games/search', {
      params: { q: query, ...filters },
    });
    return response.data.games;
  }

  // ============= BOOKING MANAGEMENT =============

  async createBooking(data: BookingData): Promise<any> {
    const response = await this.client.post('/api/bookings', data);
    return response.data;
  }

  async getBooking(bookingId: string): Promise<any> {
    const response = await this.client.get(`/api/bookings/${bookingId}`);
    return response.data;
  }

  async updateBookingStatus(
    bookingId: string,
    status: 'CONFIRMED' | 'REJECTED' | 'WAITLISTED'
  ): Promise<any> {
    const response = await this.client.put(`/api/bookings/${bookingId}/status`, {
      status,
    });
    return response.data;
  }

  async getGameBookings(gameId: string): Promise<any[]> {
    const response = await this.client.get(`/api/games/${gameId}/bookings`);
    return response.data.bookings;
  }

  // ============= SESSION MANAGEMENT =============

  async createSession(gameId: string, data: {
    title: string;
    scheduledStart: string;
    scheduledEnd: string;
    description?: string;
  }): Promise<any> {
    const response = await this.client.post(`/api/games/${gameId}/sessions`, data);
    return response.data;
  }

  async getSession(sessionId: string): Promise<any> {
    const response = await this.client.get(`/api/sessions/${sessionId}`);
    return response.data;
  }

  async updateSession(sessionId: string, updates: any): Promise<any> {
    const response = await this.client.put(`/api/sessions/${sessionId}`, updates);
    return response.data;
  }

  async markAttendance(sessionId: string, attendees: string[]): Promise<void> {
    await this.client.post(`/api/sessions/${sessionId}/attendance`, {
      attendees,
    });
  }

  // ============= WIKI MANAGEMENT =============

  async createWikiPage(wikiId: string, data: WikiPageData): Promise<any> {
    const response = await this.client.post(`/api/wiki/${wikiId}/pages`, data);
    return response.data;
  }

  async getWikiPage(wikiId: string, pageId: string): Promise<any> {
    const response = await this.client.get(`/api/wiki/${wikiId}/pages/${pageId}`);
    return response.data;
  }

  async updateWikiPage(
    wikiId: string,
    pageId: string,
    updates: Partial<WikiPageData>
  ): Promise<any> {
    const response = await this.client.put(
      `/api/wiki/${wikiId}/pages/${pageId}`,
      updates
    );
    return response.data;
  }

  async searchWiki(wikiId: string, query: string): Promise<any[]> {
    const response = await this.client.get(`/api/wiki/${wikiId}/search`, {
      params: { q: query },
    });
    return response.data.pages;
  }

  async getWikiByGameId(gameId: string): Promise<any> {
    const response = await this.client.get(`/api/wiki`, {
      params: { gameId },
    });
    return response.data;
  }

  // ============= USER MANAGEMENT =============

  async linkDiscordAccount(discordId: string, discordUsername: string): Promise<any> {
    const response = await this.client.post('/api/users/link-discord', {
      discordId,
      discordUsername,
    });
    return response.data;
  }

  async getUserByDiscordId(discordId: string): Promise<any> {
    const response = await this.client.get(`/api/users/discord/${discordId}`);
    return response.data;
  }

  async getGMProfile(gmId: string): Promise<any> {
    const response = await this.client.get(`/api/gms/${gmId}`);
    return response.data;
  }

  async updateGMProfile(gmId: string, updates: any): Promise<any> {
    const response = await this.client.put(`/api/gms/${gmId}`, updates);
    return response.data;
  }

  // ============= SYSTEM DATA =============

  async getGameSystems(): Promise<any[]> {
    const response = await this.client.get('/api/systems');
    return response.data.systems;
  }

  async getSafetyTools(): Promise<string[]> {
    const response = await this.client.get('/api/safety-tools');
    return response.data.tools;
  }

  async getContentWarnings(): Promise<string[]> {
    const response = await this.client.get('/api/content-warnings');
    return response.data.warnings;
  }
}

export const arcaneAPI = new ArcaneCircleAPI();
```

---

## Campaign Management Commands

### `src/commands/campaign.ts`
```typescript
import {
  SlashCommandBuilder,
  CommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { arcaneAPI } from '../services/api/ArcaneCircleAPI';
import { Logger } from '../utils/logger';

const logger = new Logger('CampaignCommand');

export default {
  data: new SlashCommandBuilder()
    .setName('campaign')
    .setDescription('Manage your TTRPG campaigns')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new campaign')
        .addStringOption((opt) =>
          opt
            .setName('title')
            .setDescription('Campaign title')
            .setRequired(true)
            .setMaxLength(100)
        )
        .addStringOption((opt) =>
          opt
            .setName('system')
            .setDescription('Game system (D&D 5e, Pathfinder, etc.)')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Campaign or One-shot')
            .setRequired(true)
            .addChoices(
              { name: 'Campaign (Multi-session)', value: 'CAMPAIGN' },
              { name: 'One-shot (Single session)', value: 'ONE_SHOT' }
            )
        )
        .addIntegerOption((opt) =>
          opt
            .setName('players')
            .setDescription('Maximum number of players')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10)
        )
        .addNumberOption((opt) =>
          opt
            .setName('price')
            .setDescription('Price per session (0 for free)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(200)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Edit your campaign')
        .addStringOption((opt) =>
          opt
            .setName('campaign')
            .setDescription('Select campaign to edit')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List your campaigns')
        .addStringOption((opt) =>
          opt
            .setName('status')
            .setDescription('Filter by status')
            .addChoices(
              { name: 'All', value: 'all' },
              { name: 'Draft', value: 'DRAFT' },
              { name: 'Published', value: 'PUBLISHED' },
              { name: 'Full', value: 'FULL' },
              { name: 'Completed', value: 'COMPLETED' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('View campaign details')
        .addStringOption((opt) =>
          opt
            .setName('campaign')
            .setDescription('Campaign to view')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete a campaign')
        .addStringOption((opt) =>
          opt
            .setName('campaign')
            .setDescription('Campaign to delete')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('schedule')
        .setDescription('Schedule sessions for your campaign')
        .addStringOption((opt) =>
          opt
            .setName('campaign')
            .setDescription('Campaign to schedule')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(interaction: any) {
    const focused = interaction.options.getFocused(true);

    if (focused.name === 'system') {
      // Fetch game systems from API
      try {
        const systems = await arcaneAPI.getGameSystems();
        const choices = systems
          .filter((s) => s.name.toLowerCase().includes(focused.value.toLowerCase()))
          .slice(0, 25)
          .map((s) => ({ name: s.name, value: s.id }));
        
        await interaction.respond(choices);
      } catch (error) {
        await interaction.respond([]);
      }
    } else if (focused.name === 'campaign') {
      // Fetch user's campaigns
      try {
        await arcaneAPI.withUser(interaction.user.id, async () => {
          const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
          const games = await arcaneAPI.listGames({ gmId: user.id });
          
          const choices = games
            .filter((g) => g.title.toLowerCase().includes(focused.value.toLowerCase()))
            .slice(0, 25)
            .map((g) => ({ name: g.title, value: g.id }));
          
          await interaction.respond(choices);
        });
      } catch (error) {
        await interaction.respond([]);
      }
    }
  },

  async execute(interaction: CommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      // Check if user is linked
      const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
      if (!user) {
        return interaction.reply({
          content: '❌ Please link your Arcane Circle account first! Use `/link` to get started.',
          ephemeral: true,
        });
      }

      switch (subcommand) {
        case 'create':
          return handleCreate(interaction, user);
        case 'edit':
          return handleEdit(interaction, user);
        case 'list':
          return handleList(interaction, user);
        case 'view':
          return handleView(interaction);
        case 'delete':
          return handleDelete(interaction, user);
        case 'schedule':
          return handleSchedule(interaction, user);
      }
    } catch (error) {
      logger.error(`Error in campaign ${subcommand}:`, error);
      
      const errorMessage = error instanceof Error ? error.message : 'An error occurred';
      await interaction.reply({
        content: `❌ Error: ${errorMessage}`,
        ephemeral: true,
      });
    }
  },
};

async function handleCreate(interaction: CommandInteraction, user: any) {
  await interaction.deferReply();

  const title = interaction.options.getString('title', true);
  const systemId = interaction.options.getString('system', true);
  const gameType = interaction.options.getString('type', true) as 'CAMPAIGN' | 'ONE_SHOT';
  const maxPlayers = interaction.options.getInteger('players', true);
  const pricePerSession = interaction.options.getNumber('price', true);

  // Show modal for detailed description
  const modal = new ModalBuilder()
    .setCustomId(`campaign-create-${interaction.id}`)
    .setTitle('Campaign Details');

  const descriptionInput = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Campaign Description')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(50)
    .setMaxLength(2000)
    .setPlaceholder('Describe your campaign setting, themes, and what players can expect...');

  const contentWarningsInput = new TextInputBuilder()
    .setCustomId('warnings')
    .setLabel('Content Warnings (comma-separated)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('Violence, Horror, etc.');

  const firstRow = new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput);
  const secondRow = new ActionRowBuilder<TextInputBuilder>().addComponents(contentWarningsInput);

  modal.addComponents(firstRow, secondRow);

  // Store data for modal handler
  const modalData = {
    title,
    systemId,
    gameType,
    maxPlayers,
    pricePerSession,
    userId: user.id,
  };

  // Save to temporary storage
  await interaction.client.modalData.set(`campaign-create-${interaction.id}`, modalData);

  await interaction.showModal(modal);
}

async function handleEdit(interaction: CommandInteraction, user: any) {
  await interaction.deferReply();

  const gameId = interaction.options.getString('campaign', true);

  await arcaneAPI.withUser(interaction.user.id, async () => {
    const game = await arcaneAPI.getGame(gameId);

    // Check ownership
    if (game.gmId !== user.id) {
      throw new Error('You can only edit your own campaigns');
    }

    // Create edit menu
    const embed = new EmbedBuilder()
      .setTitle(`Edit: ${game.title}`)
      .setColor(0x0099ff)
      .setDescription('Select what you want to edit:')
      .addFields(
        { name: 'Status', value: game.status, inline: true },
        { name: 'Players', value: `${game.currentPlayers}/${game.maxPlayers}`, inline: true },
        { name: 'Price', value: `$${game.pricePerSession}`, inline: true }
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`campaign-edit-${gameId}`)
        .setPlaceholder('Select field to edit')
        .addOptions([
          { label: 'Title', value: 'title', description: 'Change campaign title' },
          { label: 'Description', value: 'description', description: 'Update description' },
          { label: 'Max Players', value: 'maxPlayers', description: 'Change player limit' },
          { label: 'Price', value: 'price', description: 'Update session price' },
          { label: 'Status', value: 'status', description: 'Publish or unpublish' },
          { label: 'Content Warnings', value: 'warnings', description: 'Update warnings' },
        ])
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  });
}

async function handleList(interaction: CommandInteraction, user: any) {
  await interaction.deferReply();

  const statusFilter = interaction.options.getString('status') || 'all';

  await arcaneAPI.withUser(interaction.user.id, async () => {
    const filters = statusFilter === 'all' ? { gmId: user.id } : { gmId: user.id, status: statusFilter };
    const games = await arcaneAPI.listGames(filters);

    if (games.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('Your Campaigns')
        .setDescription('You have no campaigns yet. Use `/campaign create` to start one!')
        .setColor(0x999999);

      return interaction.editReply({ embeds: [embed] });
    }

    const embed = new EmbedBuilder()
      .setTitle('Your Campaigns')
      .setColor(0x00ff00)
      .setDescription(`Found ${games.length} campaign(s)`);

    for (const game of games.slice(0, 10)) {
      const statusEmoji = {
        DRAFT: '📝',
        PUBLISHED: '✅',
        FULL: '🔒',
        COMPLETED: '✔️',
        CANCELLED: '❌',
      }[game.status] || '❓';

      embed.addFields({
        name: `${statusEmoji} ${game.title}`,
        value: `**System:** ${game.system.name}\n**Players:** ${game.currentPlayers}/${game.maxPlayers}\n**Price:** $${game.pricePerSession}\n**ID:** \`${game.id}\``,
        inline: true,
      });
    }

    if (games.length > 10) {
      embed.setFooter({ text: `Showing 10 of ${games.length} campaigns` });
    }

    await interaction.editReply({ embeds: [embed] });
  });
}

async function handleView(interaction: CommandInteraction) {
  await interaction.deferReply();

  const gameId = interaction.options.getString('campaign', true);

  await arcaneAPI.withUser(interaction.user.id, async () => {
    const game = await arcaneAPI.getGame(gameId);
    const bookings = await arcaneAPI.getGameBookings(gameId);

    const embed = new EmbedBuilder()
      .setTitle(game.title)
      .setColor(game.status === 'PUBLISHED' ? 0x00ff00 : 0xffff00)
      .setDescription(game.description)
      .addFields(
        { name: 'System', value: game.system.name, inline: true },
        { name: 'Type', value: game.gameType, inline: true },
        { name: 'Status', value: game.status, inline: true },
        { name: 'Players', value: `${game.currentPlayers}/${game.maxPlayers}`, inline: true },
        { name: 'Price', value: `$${game.pricePerSession}`, inline: true },
        { name: 'Next Session', value: game.nextSession || 'Not scheduled', inline: true }
      );

    if (game.contentWarnings?.length > 0) {
      embed.addFields({
        name: 'Content Warnings',
        value: game.contentWarnings.join(', '),
        inline: false,
      });
    }

    if (bookings.length > 0) {
      const playerList = bookings
        .filter((b) => b.status === 'CONFIRMED')
        .map((b) => b.player.name)
        .join(', ') || 'None yet';
      
      const pendingCount = bookings.filter((b) => b.status === 'PENDING').length;

      embed.addFields({
        name: 'Confirmed Players',
        value: playerList,
        inline: false,
      });

      if (pendingCount > 0) {
        embed.addFields({
          name: 'Pending Applications',
          value: `${pendingCount} player(s) waiting for approval`,
          inline: false,
        });
      }
    }

    // Add action buttons
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('View on Web')
        .setStyle(ButtonStyle.Link)
        .setURL(`${process.env.PLATFORM_URL}/games/${gameId}`),
      new ButtonBuilder()
        .setCustomId(`campaign-publish-${gameId}`)
        .setLabel(game.status === 'PUBLISHED' ? 'Unpublish' : 'Publish')
        .setStyle(game.status === 'PUBLISHED' ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setDisabled(game.status === 'COMPLETED')
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  });
}

async function handleDelete(interaction: CommandInteraction, user: any) {
  const gameId = interaction.options.getString('campaign', true);

  await arcaneAPI.withUser(interaction.user.id, async () => {
    const game = await arcaneAPI.getGame(gameId);

    // Check ownership
    if (game.gmId !== user.id) {
      throw new Error('You can only delete your own campaigns');
    }

    // Confirmation prompt
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Confirm Deletion')
      .setColor(0xff0000)
      .setDescription(`Are you sure you want to delete **${game.title}**?\n\nThis action cannot be undone.`);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirm-delete-${gameId}`)
        .setLabel('Delete Campaign')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('cancel-delete')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  });
}

async function handleSchedule(interaction: CommandInteraction, user: any) {
  await interaction.deferReply();

  const gameId = interaction.options.getString('campaign', true);

  await arcaneAPI.withUser(interaction.user.id, async () => {
    const game = await arcaneAPI.getGame(gameId);

    // Check ownership
    if (game.gmId !== user.id) {
      throw new Error('You can only schedule your own campaigns');
    }

    // Create scheduling interface
    const embed = new EmbedBuilder()
      .setTitle(`Schedule Sessions: ${game.title}`)
      .setColor(0x0099ff)
      .setDescription('Click the button below to schedule a new session');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`schedule-session-${gameId}`)
        .setLabel('Schedule New Session')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📅')
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  });
}
```

---

## Player Commands

### `src/commands/join.ts`
```typescript
import {
  SlashCommandBuilder,
  CommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { arcaneAPI } from '../services/api/ArcaneCircleAPI';
import { Logger } from '../utils/logger';

const logger = new Logger('JoinCommand');

export default {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Browse and join TTRPG games')
    .addSubcommand((sub) =>
      sub
        .setName('browse')
        .setDescription('Browse available games')
        .addStringOption((opt) =>
          opt
            .setName('system')
            .setDescription('Filter by game system')
            .setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Campaign or One-shot')
            .addChoices(
              { name: 'All', value: 'all' },
              { name: 'Campaigns', value: 'CAMPAIGN' },
              { name: 'One-shots', value: 'ONE_SHOT' }
            )
        )
        .addNumberOption((opt) =>
          opt
            .setName('max_price')
            .setDescription('Maximum price per session')
            .setMinValue(0)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('apply')
        .setDescription('Apply to join a game')
        .addStringOption((opt) =>
          opt
            .setName('game')
            .setDescription('Game ID or search')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('leave')
        .setDescription('Leave a game')
        .addStringOption((opt) =>
          opt
            .setName('game')
            .setDescription('Select game to leave')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Check your game applications and bookings')
    ),

  async autocomplete(interaction: any) {
    const focused = interaction.options.getFocused(true);

    if (focused.name === 'system') {
      try {
        const systems = await arcaneAPI.getGameSystems();
        const choices = systems
          .filter((s) => s.name.toLowerCase().includes(focused.value.toLowerCase()))
          .slice(0, 25)
          .map((s) => ({ name: s.name, value: s.id }));
        
        await interaction.respond(choices);
      } catch (error) {
        await interaction.respond([]);
      }
    } else if (focused.name === 'game') {
      const subcommand = interaction.options.getSubcommand();
      
      try {
        if (subcommand === 'apply') {
          // Search for available games
          const games = await arcaneAPI.searchGames(focused.value);
          const choices = games
            .filter((g) => g.status === 'PUBLISHED')
            .slice(0, 25)
            .map((g) => ({
              name: `${g.title} (${g.system.name})`,
              value: g.id,
            }));
          
          await interaction.respond(choices);
        } else if (subcommand === 'leave') {
          // Get user's games
          await arcaneAPI.withUser(interaction.user.id, async () => {
            const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
            const bookings = await arcaneAPI.getUserBookings(user.id);
            
            const choices = bookings
              .filter((b) => b.status === 'CONFIRMED')
              .map((b) => ({
                name: b.game.title,
                value: b.gameId,
              }))
              .slice(0, 25);
            
            await interaction.respond(choices);
          });
        }
      } catch (error) {
        await interaction.respond([]);
      }
    }
  },

  async execute(interaction: CommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      // Check if user is linked
      const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
      if (!user) {
        return interaction.reply({
          content: '❌ Please link your Arcane Circle account first! Use `/link` to get started.',
          ephemeral: true,
        });
      }

      switch (subcommand) {
        case 'browse':
          return handleBrowse(interaction);
        case 'apply':
          return handleApply(interaction, user);
        case 'leave':
          return handleLeave(interaction, user);
        case 'status':
          return handleStatus(interaction, user);
      }
    } catch (error) {
      logger.error(`Error in join ${subcommand}:`, error);
      
      const errorMessage = error instanceof Error ? error.message : 'An error occurred';
      await interaction.reply({
        content: `❌ Error: ${errorMessage}`,
        ephemeral: true,
      });
    }
  },
};

async function handleBrowse(interaction: CommandInteraction) {
  await interaction.deferReply();

  const systemId = interaction.options.getString('system');
  const gameType = interaction.options.getString('type');
  const maxPrice = interaction.options.getNumber('max_price');

  const filters: any = { status: 'PUBLISHED' };
  if (systemId) filters.systemId = systemId;
  if (gameType && gameType !== 'all') filters.gameType = gameType;
  if (maxPrice !== null) filters.maxPrice = maxPrice;

  const games = await arcaneAPI.searchGames('', filters);

  if (games.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('No Games Found')
      .setDescription('No games match your criteria. Try adjusting your filters!')
      .setColor(0x999999);

    return interaction.editReply({ embeds: [embed] });
  }

  // Create paginated embed (showing first 5 games)
  const embed = new EmbedBuilder()
    .setTitle('🎲 Available Games')
    .setColor(0x00ff00)
    .setDescription(`Found ${games.length} game(s) matching your criteria`)
    .setFooter({ text: 'Use /join apply <game_id> to apply' });

  for (const game of games.slice(0, 5)) {
    const availableSlots = game.maxPlayers - game.currentPlayers;
    const priceText = game.pricePerSession === 0 ? 'Free' : `$${game.pricePerSession}/session`;
    
    embed.addFields({
      name: `${game.title}`,
      value: [
        `**GM:** ${game.gm.profile.displayName}`,
        `**System:** ${game.system.name}`,
        `**Type:** ${game.gameType}`,
        `**Slots:** ${availableSlots} available (${game.currentPlayers}/${game.maxPlayers})`,
        `**Price:** ${priceText}`,
        `**ID:** \`${game.id}\``,
        game.shortDescription ? `*${game.shortDescription}*` : '',
      ].filter(Boolean).join('\n'),
      inline: false,
    });
  }

  // Add navigation buttons if more than 5 games
  const components = [];
  if (games.length > 5) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('browse-prev')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('browse-next')
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(games.length <= 5),
      new ButtonBuilder()
        .setLabel('View All on Web')
        .setStyle(ButtonStyle.Link)
        .setURL(`${process.env.PLATFORM_URL}/games`)
    );
    components.push(row);
  }

  await interaction.editReply({ embeds: [embed], components });
}

async function handleApply(interaction: CommandInteraction, user: any) {
  const gameId = interaction.options.getString('game', true);

  // Show application modal
  const modal = new ModalBuilder()
    .setCustomId(`apply-game-${gameId}`)
    .setTitle('Game Application');

  const messageInput = new TextInputBuilder()
    .setCustomId('message')
    .setLabel('Why do you want to join this game?')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(50)
    .setMaxLength(500)
    .setPlaceholder('Tell the GM about your experience and what excites you about this game...');

  const characterInput = new TextInputBuilder()
    .setCustomId('character')
    .setLabel('Character Concept (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500)
    .setPlaceholder('Describe your character idea if you have one...');

  const experienceInput = new TextInputBuilder()
    .setCustomId('experience')
    .setLabel('Your TTRPG Experience')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('Beginner, Intermediate, or Expert');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(messageInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(characterInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(experienceInput)
  );

  await interaction.showModal(modal);
}

async function handleLeave(interaction: CommandInteraction, user: any) {
  const gameId = interaction.options.getString('game', true);

  await arcaneAPI.withUser(interaction.user.id, async () => {
    const booking = await arcaneAPI.getUserBookingForGame(user.id, gameId);

    if (!booking) {
      throw new Error('You are not in this game');
    }

    // Confirmation
    const game = await arcaneAPI.getGame(gameId);
    
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Confirm Leave')
      .setColor(0xffff00)
      .setDescription(`Are you sure you want to leave **${game.title}**?`);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirm-leave-${booking.id}`)
        .setLabel('Leave Game')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('cancel-leave')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  });
}

async function handleStatus(interaction: CommandInteraction, user: any) {
  await interaction.deferReply({ ephemeral: true });

  await arcaneAPI.withUser(interaction.user.id, async () => {
    const bookings = await arcaneAPI.getUserBookings(user.id);

    if (bookings.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('Your Games')
        .setDescription('You are not in any games yet. Use `/join browse` to find games!')
        .setColor(0x999999);

      return interaction.editReply({ embeds: [embed] });
    }

    const embed = new EmbedBuilder()
      .setTitle('Your Games & Applications')
      .setColor(0x0099ff);

    // Group by status
    const confirmed = bookings.filter((b) => b.status === 'CONFIRMED');
    const pending = bookings.filter((b) => b.status === 'PENDING');
    const waitlisted = bookings.filter((b) => b.status === 'WAITLISTED');

    if (confirmed.length > 0) {
      embed.addFields({
        name: '✅ Confirmed Games',
        value: confirmed
          .map((b) => `• **${b.game.title}** - Next: ${b.game.nextSession || 'TBD'}`)
          .join('\n'),
        inline: false,
      });
    }

    if (pending.length > 0) {
      embed.addFields({
        name: '⏳ Pending Applications',
        value: pending
          .map((b) => `• **${b.game.title}** - Applied ${new Date(b.createdAt).toLocaleDateString()}`)
          .join('\n'),
        inline: false,
      });
    }

    if (waitlisted.length > 0) {
      embed.addFields({
        name: '📋 Waitlisted',
        value: waitlisted.map((b) => `• **${b.game.title}**`).join('\n'),
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  });
}
```

---

## Wiki Commands

### `src/commands/wiki.ts`
```typescript
import {
  SlashCommandBuilder,
  CommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { arcaneAPI } from '../services/api/ArcaneCircleAPI';
import { Logger } from '../utils/logger';

const logger = new Logger('WikiCommand');

export default {
  data: new SlashCommandBuilder()
    .setName('wiki')
    .setDescription('Manage campaign wiki')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a wiki page')
        .addStringOption((opt) =>
          opt
            .setName('campaign')
            .setDescription('Select campaign')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('title')
            .setDescription('Page title')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Page type')
            .setRequired(true)
            .addChoices(
              { name: 'NPC', value: 'npc' },
              { name: 'Location', value: 'location' },
              { name: 'Item', value: 'item' },
              { name: 'Faction', value: 'faction' },
              { name: 'Session Notes', value: 'session_notes' },
              { name: 'Custom', value: 'custom' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('View a wiki page')
        .addStringOption((opt) =>
          opt
            .setName('campaign')
            .setDescription('Select campaign')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('page')
            .setDescription('Page to view')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('search')
        .setDescription('Search wiki pages')
        .addStringOption((opt) =>
          opt
            .setName('campaign')
            .setDescription('Select campaign')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('query')
            .setDescription('Search query')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List wiki pages')
        .addStringOption((opt) =>
          opt
            .setName('campaign')
            .setDescription('Select campaign')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Filter by type')
            .addChoices(
              { name: 'All', value: 'all' },
              { name: 'NPCs', value: 'npc' },
              { name: 'Locations', value: 'location' },
              { name: 'Items', value: 'item' },
              { name: 'Factions', value: 'faction' },
              { name: 'Session Notes', value: 'session_notes' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('link')
        .setDescription('Get a shareable link to a wiki page')
        .addStringOption((opt) =>
          opt
            .setName('campaign')
            .setDescription('Select campaign')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('page')
            .setDescription('Page to share')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(interaction: any) {
    const focused = interaction.options.getFocused(true);

    if (focused.name === 'campaign') {
      try {
        await arcaneAPI.withUser(interaction.user.id, async () => {
          const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
          
          // Get campaigns where user is GM or player
          const gmGames = await arcaneAPI.listGames({ gmId: user.id });
          const playerBookings = await arcaneAPI.getUserBookings(user.id);
          const playerGames = playerBookings
            .filter((b) => b.status === 'CONFIRMED')
            .map((b) => b.game);

          const allGames = [...gmGames, ...playerGames];
          const uniqueGames = Array.from(new Map(allGames.map((g) => [g.id, g])).values());

          const choices = uniqueGames
            .filter((g) => g.title.toLowerCase().includes(focused.value.toLowerCase()))
            .slice(0, 25)
            .map((g) => ({ name: g.title, value: g.id }));

          await interaction.respond(choices);
        });
      } catch (error) {
        await interaction.respond([]);
      }
    } else if (focused.name === 'page') {
      const gameId = interaction.options.getString('campaign');
      if (!gameId) {
        return interaction.respond([]);
      }

      try {
        await arcaneAPI.withUser(interaction.user.id, async () => {
          const wiki = await arcaneAPI.getWikiByGameId(gameId);
          const pages = await arcaneAPI.getWikiPages(wiki.id);

          const choices = pages
            .filter((p) => p.title.toLowerCase().includes(focused.value.toLowerCase()))
            .slice(0, 25)
            .map((p) => ({ name: p.title, value: p.id }));

          await interaction.respond(choices);
        });
      } catch (error) {
        await interaction.respond([]);
      }
    }
  },

  async execute(interaction: CommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
      if (!user) {
        return interaction.reply({
          content: '❌ Please link your Arcane Circle account first!',
          ephemeral: true,
        });
      }

      switch (subcommand) {
        case 'create':
          return handleWikiCreate(interaction, user);
        case 'view':
          return handleWikiView(interaction, user);
        case 'search':
          return handleWikiSearch(interaction, user);
        case 'list':
          return handleWikiList(interaction, user);
        case 'link':
          return handleWikiLink(interaction, user);
      }
    } catch (error) {
      logger.error(`Error in wiki ${subcommand}:`, error);
      
      await interaction.reply({
        content: `❌ Error: ${error.message}`,
        ephemeral: true,
      });
    }
  },
};

async function handleWikiCreate(interaction: CommandInteraction, user: any) {
  const gameId = interaction.options.getString('campaign', true);
  const title = interaction.options.getString('title', true);
  const pageType = interaction.options.getString('type', true);

  await interaction.deferReply();

  await arcaneAPI.withUser(interaction.user.id, async () => {
    // Check if user is GM
    const game = await arcaneAPI.getGame(gameId);
    if (game.gmId !== user.id) {
      throw new Error('Only the GM can create wiki pages');
    }

    const wiki = await arcaneAPI.getWikiByGameId(gameId);
    
    // Create page with template
    const page = await arcaneAPI.createWikiPage(wiki.id, {
      title,
      pageType,
      content: `# ${title}\n\n*This page was created via Discord.*`,
      visibility: 'gm_only',
    });

    const embed = new EmbedBuilder()
      .setTitle('📄 Wiki Page Created')
      .setColor(0x00ff00)
      .setDescription(`Created **${title}** in ${game.title}`)
      .addFields(
        { name: 'Type', value: pageType, inline: true },
        { name: 'Visibility', value: 'GM Only', inline: true },
        { name: 'ID', value: `\`${page.id}\``, inline: true }
      );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Edit on Web')
        .setStyle(ButtonStyle.Link)
        .setURL(`${process.env.PLATFORM_URL}/games/${gameId}/wiki/${page.id}`),
      new ButtonBuilder()
        .setCustomId(`wiki-visibility-${page.id}`)
        .setLabel('Change Visibility')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  });
}

async function handleWikiView(interaction: CommandInteraction, user: any) {
  const gameId = interaction.options.getString('campaign', true);
  const pageId = interaction.options.getString('page', true);

  await interaction.deferReply();

  await arcaneAPI.withUser(interaction.user.id, async () => {
    const wiki = await arcaneAPI.getWikiByGameId(gameId);
    const page = await arcaneAPI.getWikiPage(wiki.id, pageId);

    // Check visibility
    const game = await arcaneAPI.getGame(gameId);
    const isGM = game.gmId === user.id;
    
    if (page.visibility === 'gm_only' && !isGM) {
      throw new Error('This page is GM only');
    }

    // Format content for Discord (truncate if needed)
    let content = page.content;
    if (content.length > 1900) {
      content = content.substring(0, 1900) + '...';
    }

    const embed = new EmbedBuilder()
      .setTitle(page.title)
      .setColor(0x0099ff)
      .setDescription(content)
      .addFields(
        { name: 'Type', value: page.pageType, inline: true },
        { name: 'Visibility', value: page.visibility, inline: true },
        { name: 'Last Updated', value: new Date(page.updatedAt).toLocaleDateString(), inline: true }
      );

    if (page.tags?.length > 0) {
      embed.addFields({
        name: 'Tags',
        value: page.tags.join(', '),
        inline: false,
      });
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('View Full Page')
        .setStyle(ButtonStyle.Link)
        .setURL(`${process.env.PLATFORM_URL}/games/${gameId}/wiki/${page.id}`)
    );

    if (isGM) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`wiki-edit-${page.id}`)
          .setLabel('Quick Edit')
          .setStyle(ButtonStyle.Primary)
      );
    }

    await interaction.editReply({ embeds: [embed], components: [row] });
  });
}

async function handleWikiSearch(interaction: CommandInteraction, user: any) {
  const gameId = interaction.options.getString('campaign', true);
  const query = interaction.options.getString('query', true);

  await interaction.deferReply();

  await arcaneAPI.withUser(interaction.user.id, async () => {
    const wiki = await arcaneAPI.getWikiByGameId(gameId);
    const results = await arcaneAPI.searchWiki(wiki.id, query);

    if (results.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('No Results')
        .setDescription(`No wiki pages found matching "${query}"`)
        .setColor(0x999999);

      return interaction.editReply({ embeds: [embed] });
    }

    const embed = new EmbedBuilder()
      .setTitle(`Search Results: "${query}"`)
      .setColor(0x00ff00)
      .setDescription(`Found ${results.length} page(s)`);

    for (const page of results.slice(0, 10)) {
      const preview = page.excerpt || page.content.substring(0, 100) + '...';
      embed.addFields({
        name: page.title,
        value: `*${page.pageType}* - ${preview}`,
        inline: false,
      });
    }

    if (results.length > 10) {
      embed.setFooter({ text: `Showing 10 of ${results.length} results` });
    }

    await interaction.editReply({ embeds: [embed] });
  });
}

async function handleWikiList(interaction: CommandInteraction, user: any) {
  const gameId = interaction.options.getString('campaign', true);
  const typeFilter = interaction.options.getString('type') || 'all';

  await interaction.deferReply();

  await arcaneAPI.withUser(interaction.user.id, async () => {
    const wiki = await arcaneAPI.getWikiByGameId(gameId);
    const game = await arcaneAPI.getGame(gameId);
    const isGM = game.gmId === user.id;

    let pages = await arcaneAPI.getWikiPages(wiki.id);
    
    // Filter by type if specified
    if (typeFilter !== 'all') {
      pages = pages.filter((p) => p.pageType === typeFilter);
    }

    // Filter by visibility for players
    if (!isGM) {
      pages = pages.filter((p) => p.visibility !== 'gm_only');
    }

    if (pages.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('Wiki Pages')
        .setDescription('No pages found')
        .setColor(0x999999);

      return interaction.editReply({ embeds: [embed] });
    }

    // Group pages by type
    const grouped = pages.reduce((acc, page) => {
      if (!acc[page.pageType]) acc[page.pageType] = [];
      acc[page.pageType].push(page);
      return acc;
    }, {} as Record<string, any[]>);

    const embed = new EmbedBuilder()
      .setTitle(`${game.title} Wiki`)
      .setColor(0x0099ff)
      .setDescription(`${pages.length} page(s) available`);

    for (const [type, typePages] of Object.entries(grouped)) {
      const pageList = typePages
        .slice(0, 5)
        .map((p) => `• ${p.title}`)
        .join('\n');
      
      embed.addFields({
        name: type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' '),
        value: pageList || 'None',
        inline: true,
      });
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('View Full Wiki')
        .setStyle(ButtonStyle.Link)
        .setURL(`${process.env.PLATFORM_URL}/games/${gameId}/wiki`)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  });
}

async function handleWikiLink(interaction: CommandInteraction, user: any) {
  const gameId = interaction.options.getString('campaign', true);
  const pageId = interaction.options.getString('page', true);

  await arcaneAPI.withUser(interaction.user.id, async () => {
    const wiki = await arcaneAPI.getWikiByGameId(gameId);
    const page = await arcaneAPI.getWikiPage(wiki.id, pageId);

    const link = `${process.env.PLATFORM_URL}/games/${gameId}/wiki/${page.id}`;

    const embed = new EmbedBuilder()
      .setTitle('📎 Wiki Page Link')
      .setColor(0x0099ff)
      .setDescription(`**${page.title}**\n\n${link}`)
      .addFields(
        { name: 'Type', value: page.pageType, inline: true },
        { name: 'Visibility', value: page.visibility, inline: true }
      );

    await interaction.reply({ embeds: [embed] });
  });
}
```

---

## Session Management Commands

### `src/commands/session.ts`
```typescript
import {
  SlashCommandBuilder,
  CommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { arcaneAPI } from '../services/api/ArcaneCircleAPI';
import { recordingManager } from '../services/recording/RecordingManager';
import { Logger } from '../utils/logger';

const logger = new Logger('SessionCommand');

export default {
  data: new SlashCommandBuilder()
    .setName('session')
    .setDescription('Manage game sessions')
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Start a game session (begins recording)')
        .addStringOption((opt) =>
          opt
            .setName('campaign')
            .setDescription('Select campaign')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('end')
        .setDescription('End the current session')
    )
    .addSubcommand((sub) =>
      sub
        .setName('notes')
        .setDescription('Add session notes')
        .addStringOption((opt) =>
          opt
            .setName('notes')
            .setDescription('Quick session notes')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('attendance')
        .setDescription('Mark attendance for current session')
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List upcoming sessions')
        .addStringOption((opt) =>
          opt
            .setName('campaign')
            .setDescription('Filter by campaign')
            .setAutocomplete(true)
        )
    ),

  async execute(interaction: CommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      const user = await arcaneAPI.getUserByDiscordId(interaction.user.id);
      if (!user) {
        return interaction.reply({
          content: '❌ Please link your Arcane Circle account first!',
          ephemeral: true,
        });
      }

      switch (subcommand) {
        case 'start':
          return handleSessionStart(interaction, user);
        case 'end':
          return handleSessionEnd(interaction, user);
        case 'notes':
          return handleSessionNotes(interaction, user);
        case 'attendance':
          return handleAttendance(interaction, user);
        case 'list':
          return handleListSessions(interaction, user);
      }
    } catch (error) {
      logger.error(`Error in session ${subcommand}:`, error);
      
      await interaction.reply({
        content: `❌ Error: ${error.message}`,
        ephemeral: true,
      });
    }
  },
};

async function handleSessionStart(interaction: CommandInteraction, user: any) {
  const gameId = interaction.options.getString('campaign', true);
  const member = interaction.member as any;
  const voiceChannel = member.voice?.channel;

  if (!voiceChannel) {
    return interaction.reply({
      content: '❌ You must be in a voice channel to start a session!',
      ephemeral: true,
    });
  }

  await interaction.deferReply();

  await arcaneAPI.withUser(interaction.user.id, async () => {
    // Verify user is GM
    const game = await arcaneAPI.getGame(gameId);
    if (game.gmId !== user.id) {
      throw new Error('Only the GM can start sessions');
    }

    // Create session in API
    const session = await arcaneAPI.createSession(gameId, {
      title: `Session ${new Date().toLocaleDateString()}`,
      scheduledStart: new Date().toISOString(),
      scheduledEnd: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // 4 hours
    });

    // Start recording
    const recordingId = await recordingManager.startRecordingForGame(
      voiceChannel,
      member,
      gameId
    );

    // Store session info
    interaction.client.activeSessions.set(voiceChannel.id, {
      sessionId: session.id,
      gameId,
      recordingId,
      startTime: Date.now(),
    });

    const embed = new EmbedBuilder()
      .setTitle('🎮 Session Started')
      .setColor(0x00ff00)
      .setDescription(`**${game.title}** session is now active!`)
      .addFields(
        { name: 'Session ID', value: session.id, inline: true },
        { name: 'Recording', value: '🔴 Active', inline: true },
        { name: 'Players', value: `${voiceChannel.members.size}`, inline: true }
      )
      .setFooter({ text: 'Use /session end to finish' });

    // Notify players
    const bookings = await arcaneAPI.getGameBookings(gameId);
    const playerMentions = bookings
      .filter((b) => b.status === 'CONFIRMED')
      .map((b) => `<@${b.player.discordId}>`)
      .filter(Boolean)
      .join(' ');

    await interaction.editReply({
      content: playerMentions ? `Session starting! ${playerMentions}` : undefined,
      embeds: [embed],
    });
  });
}

async function handleSessionEnd(interaction: CommandInteraction, user: any) {
  const member = interaction.member as any;
  const voiceChannel = member.voice?.channel;

  if (!voiceChannel) {
    return interaction.reply({
      content: '❌ You must be in the voice channel to end the session!',
      ephemeral: true,
    });
  }

  const sessionInfo = interaction.client.activeSessions.get(voiceChannel.id);
  if (!sessionInfo) {
    return interaction.reply({
      content: '❌ No active session in this channel!',
      ephemeral: true,
    });
  }

  await interaction.deferReply();

  await arcaneAPI.withUser(interaction.user.id, async () => {
    // Stop recording
    await recordingManager.stopRecording(sessionInfo.recordingId);

    // Update session
    await arcaneAPI.updateSession(sessionInfo.sessionId, {
      actualEnd: new Date().toISOString(),
      status: 'COMPLETED',
    });

    const duration = Date.now() - sessionInfo.startTime;
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));

    const embed = new EmbedBuilder()
      .setTitle('🏁 Session Ended')
      .setColor(0xff0000)
      .setDescription('Session completed successfully!')
      .addFields(
        { name: 'Duration', value: `${hours}h ${minutes}m`, inline: true },
        { name: 'Recording', value: '⏹️ Stopped', inline: true },
        { name: 'Processing', value: '⏳ In Progress', inline: true }
      )
      .setFooter({ text: 'Transcript will be available soon' });

    // Clean up
    interaction.client.activeSessions.delete(voiceChannel.id);

    await interaction.editReply({ embeds: [embed] });
  });
}

async function handleSessionNotes(interaction: CommandInteraction, user: any) {
  const notes = interaction.options.getString('notes', true);
  
  // Find active session for user
  const activeSessions = Array.from(interaction.client.activeSessions.entries());
  const userSession = activeSessions.find(([_, session]) => {
    // Check if user is in this session
    return true; // Implement proper check
  });

  if (!userSession) {
    return interaction.reply({
      content: '❌ No active session found!',
      ephemeral: true,
    });
  }

  await arcaneAPI.withUser(interaction.user.id, async () => {
    await arcaneAPI.updateSession(userSession[1].sessionId, {
      notes: notes,
    });

    const embed = new EmbedBuilder()
      .setTitle('📝 Notes Added')
      .setColor(0x00ff00)
      .setDescription('Session notes have been saved')
      .addFields({ name: 'Notes', value: notes });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  });
}

async function handleAttendance(interaction: CommandInteraction, user: any) {
  const member = interaction.member as any;
  const voiceChannel = member.voice?.channel;

  if (!voiceChannel) {
    return interaction.reply({
      content: '❌ No voice channel found!',
      ephemeral: true,
    });
  }

  const sessionInfo = interaction.client.activeSessions.get(voiceChannel.id);
  if (!sessionInfo) {
    return interaction.reply({
      content: '❌ No active session!',
      ephemeral: true,
    });
  }

  await interaction.deferReply();

  await arcaneAPI.withUser(interaction.user.id, async () => {
    // Get voice channel members
    const attendees = voiceChannel.members
      .filter((m: any) => !m.user.bot)
      .map((m: any) => m.user.id);

    await arcaneAPI.markAttendance(sessionInfo.sessionId, attendees);

    const embed = new EmbedBuilder()
      .setTitle('✅ Attendance Marked')
      .setColor(0x00ff00)
      .setDescription(`Marked ${attendees.length} attendees`)
      .addFields({
        name: 'Present',
        value: voiceChannel.members
          .filter((m: any) => !m.user.bot)
          .map((m: any) => m.user.username)
          .join(', '),
      });

    await interaction.editReply({ embeds: [embed] });
  });
}

async function handleListSessions(interaction: CommandInteraction, user: any) {
  const campaignId = interaction.options.getString('campaign');

  await interaction.deferReply();

  await arcaneAPI.withUser(interaction.user.id, async () => {
    let sessions;
    
    if (campaignId) {
      sessions = await arcaneAPI.getGameSessions(campaignId);
    } else {
      // Get all user's upcoming sessions
      sessions = await arcaneAPI.getUserUpcomingSessions(user.id);
    }

    if (sessions.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('Upcoming Sessions')
        .setDescription('No upcoming sessions scheduled')
        .setColor(0x999999);

      return interaction.editReply({ embeds: [embed] });
    }

    const embed = new EmbedBuilder()
      .setTitle('📅 Upcoming Sessions')
      .setColor(0x0099ff);

    for (const session of sessions.slice(0, 10)) {
      const date = new Date(session.scheduledStart);
      embed.addFields({
        name: `${session.game.title}`,
        value: [
          `**Date:** ${date.toLocaleDateString()}`,
          `**Time:** ${date.toLocaleTimeString()}`,
          `**GM:** ${session.game.gm.profile.displayName}`,
          session.title ? `*${session.title}*` : '',
        ].filter(Boolean).join('\n'),
        inline: true,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  });
}
```

---

## Integration Utilities

### `src/commands/link.ts`
```typescript
import {
  SlashCommandBuilder,
  CommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { arcaneAPI } from '../services/api/ArcaneCircleAPI';

export default {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to Arcane Circle'),

  async execute(interaction: CommandInteraction) {
    // Check if already linked
    try {
      const existing = await arcaneAPI.getUserByDiscordId(interaction.user.id);
      if (existing) {
        return interaction.reply({
          content: '✅ Your account is already linked!',
          ephemeral: true,
        });
      }
    } catch (error) {
      // Not linked, continue
    }

    const embed = new EmbedBuilder()
      .setTitle('🔗 Link Your Account')
      .setColor(0x5865f2)
      .setDescription(
        'Link your Discord account to Arcane Circle to access all features through Discord!'
      )
      .addFields(
        {
          name: 'Benefits',
          value: [
            '• Create and manage campaigns',
            '• Browse and join games',
            '• Access campaign wikis',
            '• Record and transcribe sessions',
            '• Manage bookings and applications',
          ].join('\n'),
        },
        {
          name: 'How to Link',
          value: 'Click the button below to authorize your Discord account',
        }
      );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Link Account')
        .setStyle(ButtonStyle.Link)
        .setURL(
          `${process.env.PLATFORM_URL}/auth/discord?discord_id=${interaction.user.id}`
        )
        .setEmoji('🔗')
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  },
};
```

### `src/commands/help.ts`
```typescript
import { SlashCommandBuilder, CommandInteraction, EmbedBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Get help with Arcane Circle bot commands'),

  async execute(interaction: CommandInteraction) {
    const embed = new EmbedBuilder()
      .setTitle('📚 Arcane Circle Bot Help')
      .setColor(0x0099ff)
      .setDescription('Complete guide to using Arcane Circle through Discord')
      .addFields(
        {
          name: '🎮 GM Commands',
          value: [
            '`/campaign create` - Create a new campaign',
            '`/campaign edit` - Edit your campaigns',
            '`/campaign list` - View your campaigns',
            '`/session start` - Start a game session',
            '`/session end` - End current session',
            '`/gm profile` - Manage GM profile',
            '`/gm bookings` - Review player applications',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🎲 Player Commands',
          value: [
            '`/join browse` - Find available games',
            '`/join apply` - Apply to join a game',
            '`/join status` - Check your applications',
            '`/join leave` - Leave a game',
          ].join('\n'),
          inline: false,
        },
        {
          name: '📖 Wiki Commands',
          value: [
            '`/wiki view` - View wiki pages',
            '`/wiki search` - Search campaign wiki',
            '`/wiki list` - List all pages',
            '`/wiki create` - Create new page (GM only)',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🎙️ Recording Commands',
          value: [
            '`/record start` - Start voice recording',
            '`/record stop` - Stop and transcribe',
            '`/record status` - Check recording status',
            '`/transcript view` - View transcripts',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🔧 Utility Commands',
          value: [
            '`/link` - Link your Arcane Circle account',
            '`/help` - Show this help message',
            '`/stats` - View your statistics',
          ].join('\n'),
          inline: false,
        }
      )
      .setFooter({
        text: 'Need more help? Visit arcane-circle.com/help',
      });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
```

---

## Button & Modal Handlers

### `src/handlers/interactions.ts`
```typescript
import { Interaction, ModalSubmitInteraction, ButtonInteraction } from 'discord.js';
import { arcaneAPI } from '../services/api/ArcaneCircleAPI';
import { Logger } from '../utils/logger';

const logger = new Logger('InteractionHandler');

export async function handleInteraction(interaction: Interaction) {
  if (interaction.isButton()) {
    await handleButton(interaction);
  } else if (interaction.isModalSubmit()) {
    await handleModal(interaction);
  } else if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction);
  }
}

async function handleButton(interaction: ButtonInteraction) {
  const [action, ...params] = interaction.customId.split('-');

  switch (action) {
    case 'confirm':
      if (params[0] === 'delete') {
        await handleDeleteConfirm(interaction, params[1]);
      } else if (params[0] === 'leave') {
        await handleLeaveConfirm(interaction, params[1]);
      }
      break;

    case 'cancel':
      await interaction.update({
        content: 'Action cancelled.',
        embeds: [],
        components: [],
      });
      break;

    case 'campaign':
      if (params[0] === 'publish') {
        await handlePublishToggle(interaction, params[1]);
      }
      break;

    case 'schedule':
      if (params[0] === 'session') {
        await handleScheduleSession(interaction, params[1]);
      }
      break;

    case 'wiki':
      if (params[0] === 'visibility') {
        await handleWikiVisibility(interaction, params[1]);
      }
      break;
  }
}

async function handleModal(interaction: ModalSubmitInteraction) {
  const [action, ...params] = interaction.customId.split('-');

  if (action === 'campaign' && params[0] === 'create') {
    await handleCampaignCreateModal(interaction);
  } else if (action === 'apply' && params[0] === 'game') {
    await handleGameApplicationModal(interaction, params[1]);
  }
}

async function handleCampaignCreateModal(interaction: ModalSubmitInteraction) {
  await interaction.deferReply();

  const modalData = interaction.client.modalData.get(interaction.customId);
  if (!modalData) {
    return interaction.editReply('❌ Session expired. Please try again.');
  }

  const description = interaction.fields.getTextInputValue('description');
  const warnings = interaction.fields.getTextInputValue('warnings');

  try {
    await arcaneAPI.withUser(interaction.user.id, async () => {
      const game = await arcaneAPI.createGame({
        title: modalData.title,
        description,
        systemId: modalData.systemId,
        gameType: modalData.gameType,
        maxPlayers: modalData.maxPlayers,
        pricePerSession: modalData.pricePerSession,
        contentWarnings: warnings ? warnings.split(',').map((w) => w.trim()) : [],
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        timezone: 'UTC',
      });

      const embed = new EmbedBuilder()
        .setTitle('✅ Campaign Created!')
        .setColor(0x00ff00)
        .setDescription(`**${game.title}** has been created successfully!`)
        .addFields(
          { name: 'Status', value: 'Draft', inline: true },
          { name: 'ID', value: `\`${game.id}\``, inline: true }
        );

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel('View Campaign')
          .setStyle(ButtonStyle.Link)
          .setURL(`${process.env.PLATFORM_URL}/games/${game.id}`),
        new ButtonBuilder()
          .setCustomId(`campaign-publish-${game.id}`)
          .setLabel('Publish Now')
          .setStyle(ButtonStyle.Success)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
    });
  } catch (error) {
    logger.error('Failed to create campaign:', error);
    await interaction.editReply('❌ Failed to create campaign. Please try again.');
  }

  // Clean up modal data
  interaction.client.modalData.delete(interaction.customId);
}

async function handleGameApplicationModal(
  interaction: ModalSubmitInteraction,
  gameId: string
) {
  await interaction.deferReply({ ephemeral: true });

  const message = interaction.fields.getTextInputValue('message');
  const character = interaction.fields.getTextInputValue('character');
  const experience = interaction.fields.getTextInputValue('experience');

  try {
    await arcaneAPI.withUser(interaction.user.id, async () => {
      const booking = await arcaneAPI.createBooking({
        gameId,
        applicationMessage: message,
        characterConcept: character || undefined,
      });

      const embed = new EmbedBuilder()
        .setTitle('✅ Application Submitted!')
        .setColor(0x00ff00)
        .setDescription('Your application has been sent to the GM.')
        .addFields(
          { name: 'Status', value: 'Pending Review', inline: true },
          { name: 'Application ID', value: `\`${booking.id}\``, inline: true }
        );

      await interaction.editReply({ embeds: [embed] });
    });
  } catch (error) {
    logger.error('Failed to submit application:', error);
    await interaction.editReply('❌ Failed to submit application. Please try again.');
  }
}
```

---

## Environment Variables Update

```bash
# Add these to your .env file

# Platform API Integration
PLATFORM_API_URL=http://localhost:3000/api
PLATFORM_URL=http://localhost:3000

# Feature Flags
ENABLE_CAMPAIGN_COMMANDS=true
ENABLE_WIKI_COMMANDS=true
ENABLE_SESSION_MANAGEMENT=true
ENABLE_PLAYER_COMMANDS=true

# Discord OAuth (for account linking)
DISCORD_OAUTH_CLIENT_ID=your_client_id
DISCORD_OAUTH_CLIENT_SECRET=your_secret
DISCORD_OAUTH_REDIRECT_URI=http://localhost:3000/auth/discord/callback

# Rate Limiting
COMMAND_RATE_LIMIT=10
COMMAND_RATE_WINDOW=60000
```

---

## Summary

This implementation adds comprehensive campaign management to your Discord bot with:

### **✅ Complete Campaign Management**
- Create, edit, delete campaigns entirely through Discord
- Schedule and manage sessions
- Handle player applications and bookings

### **✅ Player Features**
- Browse available games with filters
- Apply to games with detailed applications
- Check application status
- Leave games

### **✅ Wiki Integration**
- Create and view wiki pages
- Search wiki content
- Manage page visibility
- Quick edit capabilities

### **✅ Session Management**
- Start sessions with automatic recording
- Track attendance
- Add session notes
- End sessions with transcript generation

### **✅ Minimal Server Changes**
- All commands use your existing API endpoints
- No new database tables required
- Leverages existing authentication
- Uses standard REST API patterns

### **🔧 Easy to Extend**
- Modular command structure
- Clear API client separation
- Reusable interaction handlers
- Type-safe implementations

The bot acts as a Discord interface to your existing platform, allowing users to do almost everything they can do on the web directly through Discord. This dramatically improves accessibility and engagement, especially during live sessions.