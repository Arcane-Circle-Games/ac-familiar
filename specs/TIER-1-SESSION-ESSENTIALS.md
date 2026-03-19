# Tier 1 — Session Essentials: Implementation Spec

## Scope

Four new command groups, one message listener, plus shared infrastructure:
1. **Channel-Campaign Context** — shared resolution layer
2. **`/roll`** — dice roller with character integration
3. **`/wiki`** — wiki quick reference
4. **`/character`** — character sheet lookup
5. **`/init`** — initiative tracker
6. **`[[Wiki Link]]` detection** — ambient wiki reference in chat messages

All depend on the context layer. Build that first, then commands can be built in parallel.

---

## Authentication & User Identity

The bot uses **service account authentication** — all API calls are made with a static `BOT_API_KEY` (Bearer token). Discord users are mapped to platform users via `GET /users/discord/{discordId}`, which returns the linked platform user (or 404 if unlinked).

**Existing pattern (follow exactly):**
- `src/services/api/client.ts` — request interceptor adds `Authorization: Bearer {BOT_API_KEY}` to every request
- `authenticateWithDiscord(discordId)` performs user lookup and caches for 5 minutes (30-second negative cache)
- For user-specific endpoints, the `discordId` is passed as a query parameter (e.g., `GET /bookings/me?discordId={id}`)
- Services call `authenticateWithDiscord()` before mutations to verify the user is linked

**Auth failure handling (already implemented in client.ts):**
| Status | Behavior |
|---|---|
| 404 | "Discord account not linked to Arcane Circle. Use `/link` to link your account." |
| 401 | "Authentication failed. Please try linking your account again with `/link`." |
| Network error | "Cannot connect to Arcane Circle API. Please try again later." |

**New services follow the same pattern.** Every service method that acts on behalf of a user accepts `discordUserId: string` and passes it to the API client. No new auth infrastructure needed — all new commands plug into the existing `authenticateWithDiscord` flow and tier-based access control (`src/utils/tier-auth.ts`).

---

## 0. Channel-Campaign Context Resolution

### Purpose

Most new commands need to know which campaign the user is operating in. This service resolves that from channel, user, or explicit input — and caches the result.

### New File: `src/services/context/ChannelContext.ts`

```typescript
interface CampaignContext {
  gameId: string;
  gameName: string;
  wikiId: string;
  gmId: string;
  discordChannelId: string;
  discordServerId: string;
}
```

### Resolution Logic

```
resolveCampaign(interaction) → CampaignContext | null
```

Context resolution is **strictly channel-based**. The channel-to-game binding is set by `/set-game-channel` (which calls `PATCH /games/{id}/discord-channel` on the platform). The bot maintains a local cache populated from two sources:

1. **Check channel binding cache**: Look up `interaction.channelId` in the in-memory cache. If found, return the cached `CampaignContext`.
2. **Query API**: Fetch the user's games via `GET /bookings/me?discordId={discordUserId}`, then check which (if any) game has `discordChannelId` matching the current channel. If found, cache and return.
3. **No match**: Return `null`. The caller shows the "channel not linked" error.

There is no user-based fallback (no "pick from your campaigns" flow). If the channel isn't bound, the command fails with a clear message directing the GM to run `/set-game-channel`. This keeps behavior deterministic and avoids the ambiguity of guessing which campaign a user means.

**Note on `GET /games?discordChannelId`:** The platform stores `discordChannelId` on the game record (set via PATCH), but there is currently no query filter to look up games by channel ID. The resolution path above works around this by checking the user's games. If this query filter is added to the platform API later, it can be used as a faster path.

### Cache

- In-memory `Map<string, CampaignContext>` keyed by `channelId`.
- TTL: 10 minutes. Invalidated when `/set-game-channel` is run.

### Helper: `requireCampaignContext(interaction)`

Utility that wraps `resolveCampaign` and handles the "no context" case:

```typescript
async function requireCampaignContext(
  interaction: ChatInputCommandInteraction
): Promise<CampaignContext | null> {
  const ctx = await resolveCampaign(interaction);
  if (!ctx) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⚠️ Campaign Not Found')
        .setDescription(
          'This channel isn\'t linked to a campaign. ' +
          'Ask your GM to run `/set-game-channel` here.'
        )
      ]
    });
    return null;
  }
  return ctx;
}
```

### Integration with `/set-game-channel`

When `/set-game-channel` succeeds, call `channelContext.invalidate(channelId)` to clear the cache for that channel.

### Files to Modify

- `src/commands/set-game-channel.ts` — add cache invalidation call after successful API response
- `src/bot/index.ts` — no changes needed; context is resolved per-command, not globally

---

## 1. Dice Roller (`/roll`)

### Command Registration

```typescript
export const rollCommand: Command = {
  name: 'roll',
  description: 'Roll dice with standard notation',
  options: [
    {
      name: 'dice',
      description: 'Dice expression (e.g., 2d6+3, 1d20 advantage, 4d6kh3)',
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
  ]
};
```

### New File: `src/commands/roll.ts`

### Execution Flow

1. Parse `dice` string.
2. If the expression is a character-integrated keyword (`check`, `save`, `skill`, `attack`), resolve character data via campaign context + VTT data endpoint.
3. Roll the dice.
4. Format result as embed.
5. If `secret` is true, reply ephemeral. Otherwise, reply public.

### Dice Parser

**Dependency**: Add `@dice-roller/rpg-dice-roller` to `package.json`.

This handles standard notation out of the box:
- `NdX` — roll N dice with X sides
- `+`, `-` — modifiers
- `kh`, `kl` — keep highest/lowest
- `!` — exploding dice
- `r` — reroll
- `>`, `<` — count successes

**Custom handling needed for**:
- `advantage` / `disadvantage` — transform to `2d20kh1+MOD` / `2d20kl1+MOD`
- Character-integrated rolls (see below)

### Character-Integrated Rolls

When the `dice` string starts with a keyword, intercept before the dice parser:

| Input | Resolution | Roll |
|---|---|---|
| `check strength` | Fetch character VTT data → `abilities.strength.modifier` | `1d20+{mod}` |
| `save dexterity` | Fetch character VTT data → `saves.dexterity.modifier` | `1d20+{mod}` |
| `skill perception` | Fetch character VTT data → `skills.perception.modifier` | `1d20+{mod}` |
| `check strength advantage` | Same as above | `2d20kh1+{mod}` |

**Character resolution**:
1. Get campaign context via `requireCampaignContext(interaction)`.
2. `GET /characters?gameId={gameId}` — find character belonging to this user in this campaign.
3. `GET /characters/{characterId}/vtt-data` — get formatted stat block.
4. Cache VTT data for 5 minutes (keyed by `characterId`).

If no character found, fall back to treating the input as raw dice notation. If that also fails, return an error.

**New service needed**: `src/services/api/characters.ts`

```typescript
class CharacterService {
  async getCharactersByGame(gameId: string, discordUserId: string): Promise<Character[]>
  async getCharacter(characterId: string, discordUserId: string): Promise<Character>
  async getVTTData(characterId: string, discordUserId: string): Promise<VTTData>
}
```

The VTT data endpoint (`GET /characters/{id}/vtt-data`) normalizes character data across game systems. The platform handles D&D 5e, Pathfinder 2e, Pathfinder 1e natively, with a generic fallback for other systems. The bot receives a consistent shape regardless of system:

```typescript
interface VTTData {
  id: string;
  name: string;
  system: string;             // "dnd5e-2014", "pf2e", "burning_wheel", etc.
  characterType: string | null;
  imageUrl: string | null;
  level: number | null;
  stats: {
    hp: { current: number, max: number, temp: number };
    ac: number;
    speed: number;
    initiative: number;
    proficiencyBonus: number;
  };
  abilities: Record<string, { score: number, mod: number }>;
  skills: Record<string, { mod: number, proficient: boolean }>;
  saves: Record<string, { mod: number, proficient: boolean }>;
}
```

**Multi-system behavior:** For non-D20 systems (Burning Wheel, PbtA, Fate, etc.), the `abilities`, `skills`, and `saves` objects may be empty or sparse — the platform's generic fallback extracts what it can from `systemData`. Character-integrated rolls (`/roll check`, `/roll save`, `/roll skill`) require at least the relevant ability/skill to exist in the VTT data. If the requested stat isn't present, fall back to treating the input as raw dice notation and show: `⚠️ "{ability}" not found on your character sheet. This system may not support integrated rolls. Use dice notation instead (e.g., \`2d6+3\`).`

### Embed Format

**Standard roll** — public, compact:
```
🎲 Roll: 2d6+3
[4] [2] + 3 = 9
```

**Character-integrated roll**:
```
🎲 Perception Check — Thorin Ironforge
1d20+5 [14] + 5 = 19
```

**Advantage roll**:
```
🎲 Attack Roll (Advantage) — Thorin Ironforge
2d20kh1+7 [14] [8] + 7 = 21
```

**Embed properties**:
- Color: `0xe74c3c` (red — matches design doc color coding for dice)
- No title field — use description for compactness
- Show individual die results in brackets
- Show total prominently
- Footer: label if provided, otherwise "Arcane Circle"
- Ephemeral if `secret: true`

### Error Cases

| Case | Response |
|---|---|
| Invalid dice notation | `❌ Couldn't parse that dice expression. Try something like \`2d6+3\` or \`1d20 advantage\`.` |
| Character keyword but no campaign context | Fall back to raw parse, or show context error |
| Character keyword but no character in campaign | `⚠️ No character found for you in {campaign name}. Create one on the web first.` |
| Skill/ability not found on character | `⚠️ Couldn't find "{ability}" on your character sheet.` |

---

## 2. Wiki Quick Reference (`/wiki`)

### Command Registration

```typescript
export const wikiCommand: Command = {
  name: 'wiki',
  description: 'Look up campaign wiki pages',
  options: [
    {
      name: 'search',
      description: 'Search the campaign wiki',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'query',
          description: 'Search terms',
          type: ApplicationCommandOptionType.String,
          required: true
        }
      ]
    },
    {
      name: 'page',
      description: 'View a specific wiki page',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'name',
          description: 'Page name or slug',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        }
      ]
    },
    {
      name: 'npc',
      description: 'Look up an NPC',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'name',
          description: 'NPC name',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        }
      ]
    },
    {
      name: 'location',
      description: 'Look up a location',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'name',
          description: 'Location name',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        }
      ]
    },
    {
      name: 'item',
      description: 'Look up an item',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'name',
          description: 'Item name',
          type: ApplicationCommandOptionType.String,
          required: true,
          autocomplete: true
        }
      ]
    },
    {
      name: 'recent',
      description: 'Show recently edited pages',
      type: ApplicationCommandOptionType.Subcommand
    }
  ]
};
```

### New File: `src/commands/wiki.ts`

### Subcommand: `search`

**Flow**:
1. Resolve campaign context.
2. `GET /api/wiki/{wikiId}/search?q={query}` — full-text search.
3. Format results as paginated embed (use existing button collector pattern from `/games`).

**Embed format per result**:
```
📖 Lord Varik  ·  NPC  ·  #villain #nobility
Human noble, leader of the Northern Coalition. Known for his ruthless...
🔗 View on Arcane Circle
```

**Fields per result**:
- `name`: emoji + page title + page type badge + tags
- `value`: excerpt (first ~200 chars, stripped of HTML) + web link

**Pagination**: 5 results per page. Same button pattern as `/games`.

**Empty results**:
```typescript
if (results.pages.length === 0) {
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0xFFAA00)
      .setTitle('📖 No Results')
      .setDescription(`No pages found matching "${query}". Try different search terms.`)
    ]
  });
}
```

**No autocomplete on search**: The `search` subcommand intentionally omits `autocomplete: true` — it's free-form full-text search. Use `/wiki npc`, `/wiki location`, etc. for autocomplete-assisted typed lookups.

### Subcommand: `page`

**Flow**:
1. Resolve campaign context.
2. Look up page by ID (from autocomplete) or by slug/title search.
3. `GET /api/wiki/{wikiId}/pages/{pageId}` — full page data.
4. Apply content filtering (see below).
5. Format as single-page embed.

**Content filtering**:
- Determine user's role: GM, Co-GM, Player, or None.
- GM/Co-GM: show all content.
- Player: strip `secret-block` elements, strip unrevealed `reveal-block` elements.
- None: show only `public` visibility pages.

**Implementation**: The platform has a comprehensive filter at `src/lib/wiki-content-filter.ts` (ac-mvp) using `htmlparser2` SAX parser with fail-closed security. The bot needs a **lightweight port** that:
1. Strips `<div data-type="secret-block">...</div>` sections for non-GMs.
2. Filters `<div data-type="reveal-block" data-reveal-players="id1,id2">` — keep only if the user's **platform userId** is in the comma-separated list. Note: this requires mapping Discord ID → platform user ID via `authenticateWithDiscord()` first.
3. Strips remaining HTML tags to plain text (for Discord embeds).
4. Handles images: strip `<img>` tags, replace with `[Image: {alt}]` if alt text exists.
5. Handles malformed/unclosed blocks: **fail closed** — if a secret or reveal block is unclosed, suppress all trailing content (match platform behavior).

**Reveal block targeting**: Reveal blocks use `data-reveal-players` containing comma-separated **platform user IDs** (not Discord IDs, not character IDs). The bot must resolve the Discord user to a platform user first, then check if their platform `userId` appears in the target list.

**New utility**: `src/utils/wiki-content.ts`
```typescript
function filterWikiContent(html: string, platformUserId: string, isGM: boolean): string
function stripHtmlToPlain(html: string): string
function truncate(text: string, maxLength: number): string
```

**Note on dual FTS vectors**: The platform search API maintains separate search indexes for GMs and players (secret content is stripped from the player index at the database level). The bot gets pre-filtered search results based on the authenticated user's role. Client-side filtering in the bot is a defense-in-depth measure for the full page view, not the primary security gate.

**Embed format**:
```
📖 Lord Varik
Type: NPC  ·  Tags: #villain #nobility
Last edited: 3 days ago

Human noble, leader of the Northern Coalition. Varik rose to power
through a combination of political marriages and strategic betrayals.
He currently controls the northern trade routes and maintains an
uneasy alliance with the Crown...

[Read more →](https://arcanecircle.games/dashboard/wikis/{wikiId}#lord-varik)
```

- Color: `0x3498db` (blue)
- Title: page title
- Fields: type, tags, last edited
- Description: filtered content, truncated to ~500 chars
- Link button to full page on web

### Subcommands: `npc`, `location`, `item`

Same as `search`, but with `pageType` filter:
- `npc` → `GET /api/wiki/{wikiId}/search?q={name}&type=npc`
- `location` → `GET /api/wiki/{wikiId}/search?q={name}&type=location`
- `item` → `GET /api/wiki/{wikiId}/search?q={name}&type=item`

If exactly one result, show the full page view (same as `page` subcommand). If multiple, show search results.

### Subcommand: `recent`

**Flow**:
1. Resolve campaign context.
2. `GET /api/wiki/{wikiId}/recent` — recently viewed/edited pages.
3. Format as list embed.

**Embed**: List of up to 10 pages with title, type, and "edited X ago" timestamp.

### Autocomplete Handler

For `page`, `npc`, `location`, `item` subcommands:

```typescript
async autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);

  try {
    const ctx = await resolveCampaign(interaction);
    if (!ctx) return interaction.respond([]);

    // Use suggest endpoint for fast autocomplete
    const results = await arcaneAPI.wiki.searchSuggest(ctx.wikiId, focused.value);

    const choices = results
      .slice(0, 25)
      .map(page => ({
        name: `${page.title} (${page.pageType})`,
        value: page.id
      }));

    return interaction.respond(choices);
  } catch {
    return interaction.respond([]);
  }
}
```

### Wiki Service Additions

The existing `src/services/api/wiki.ts` needs these methods added:

```typescript
// New methods
async searchPages(wikiId: string, query: string, options?: {
  pageType?: string;
  limit?: number;
  offset?: number;
}): Promise<{ pages: WikiPage[]; total: number }>

async searchSuggest(wikiId: string, query: string): Promise<WikiPageSuggestion[]>

async getRecentPages(wikiId: string, discordUserId: string): Promise<WikiPage[]>
```

These map to existing platform endpoints:
- `GET /api/wiki/{wikiId}/search?q={query}&type={type}&limit={limit}&offset={offset}`
- `GET /api/wiki/{wikiId}/search/suggest?q={query}&limit={limit}`
- `GET /api/wiki/{wikiId}/recent?limit={limit}`

### Visibility Enforcement

Before returning any page data, check visibility:

```typescript
function canUserSeePage(page: WikiPage, userRole: 'gm' | 'co-gm' | 'player' | 'none'): boolean {
  switch (page.visibility) {
    case 'public': return true;
    case 'players': return ['gm', 'co-gm', 'player'].includes(userRole);
    case 'gm_only': return ['gm', 'co-gm'].includes(userRole);
    case 'private': return false; // Only visible to creator — bot can't verify this
    default: return false;
  }
}
```

The platform API should handle this server-side (bot authenticates as the user), but the bot should also filter client-side as a safety net.

### Error Cases

| Case | Response |
|---|---|
| No campaign context | Standard "channel not linked" message |
| No wiki for this campaign | `⚠️ This campaign doesn't have a wiki yet. Create one on the web.` |
| Page not found | `⚠️ No page found matching '{name}'.` |
| Page visibility blocked | `⚠️ You don't have access to that page.` (same as "not found" to avoid leaking existence) |
| API error | Standard red error embed |

---

## 3. Character Quick Reference (`/character`)

### Command Registration

```typescript
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
  ]
};
```

### New File: `src/commands/character.ts`

### Character Resolution

```
resolveCharacter(interaction, targetUserId?) → Character | null
```

1. Resolve campaign context.
2. Check character resolution cache (`Map<{discordUserId}:{gameId}, Character>`, 5-min TTL). If cached, skip to step 5.
3. `GET /characters?gameId={gameId}` — list characters in this campaign.
4. Filter to characters belonging to the target user (by platform userId via `authenticateWithDiscord`). Filter to `status: APPROVED` characters only.
5. If `targetUserId` is provided (GM viewing another player's character):
   - Verify requesting user is GM of this campaign.
   - Find character belonging to `targetUserId`.
6. Otherwise, find character belonging to `interaction.user.id`.
7. **Multi-character handling**: If multiple characters found for the user in this campaign, use the first APPROVED character. Phase 1 does not support character selection — multi-character disambiguation is a future enhancement.
8. If no character found, return null with appropriate message.
9. Cache the resolved character (keyed by `{discordUserId}:{gameId}`, 5-min TTL).

### Subcommand: `view`

**Flow**:
1. Resolve character.
2. `GET /characters/{id}/vtt-data` for formatted stats.
3. Build overview embed.

**Embed**:
```
🧙 Thorin Ironforge — Level 5 Fighter
Campaign: Shadows of the North

HP: 44/44 | AC: 18 | Speed: 25ft | Initiative: +1

STR  16 (+3)    DEX  12 (+1)    CON  14 (+2)
INT  10 (+0)    WIS  13 (+1)    CHA   8 (-1)

Saving Throws: STR +6, CON +5  |  Proficiency Bonus: +3

🔗 View full sheet on Arcane Circle
```

- Color: `0x2ecc71` (green)
- Title: character name + level + class
- Inline fields for ability scores (3 per row)
- Footer with campaign name
- Link button to character page

### Subcommand: `stats`

Focused view — just ability scores, AC, HP, speed, saves:

```
🛡️ Thorin Ironforge — Core Stats

HP: 44/44 | AC: 18 | Speed: 25ft | Initiative: +1

  STR  16 (+3) ★    DEX  12 (+1)      CON  14 (+2) ★
  INT  10 (+0)      WIS  13 (+1)      CHA   8 (-1)

★ = Proficient save

Saving Throws:
  STR +6 ★  |  DEX +1  |  CON +5 ★
  INT +0    |  WIS +1  |  CHA -1
```

### Subcommand: `skills`

```
📋 Thorin Ironforge — Skills

  Acrobatics      +1     Animal Handling  +1
  Arcana          +0     Athletics        +6 ★
  Deception       -1     History          +0
  Insight         +1     Intimidation     +2 ★
  Investigation   +0     Medicine         +1
  Nature          +0     Perception       +4 ★
  Performance     -1     Persuasion       -1
  Religion        +0     Sleight of Hand  +1
  Stealth         +1     Survival         +4 ★

★ = Proficient  |  Proficiency Bonus: +3
```

Use two inline fields (left column / right column) to keep it compact. D&D 5e has 18 skills, which fits comfortably. If a non-standard system has 20+ skills, split into multiple embeds or truncate with a "View full sheet" link.

### Subcommand: `spells`

```
✨ Elara Moonwhisper — Spells (Wizard 7)

Spell Save DC: 15  |  Spell Attack: +7
Slots: 1st ●●●● | 2nd ●●● | 3rd ●● | 4th ●

Cantrips: Fire Bolt, Mage Hand, Prestidigitation, Minor Illusion

1st Level: Magic Missile, Shield, Detect Magic, Mage Armor
2nd Level: Misty Step, Scorching Ray, Hold Person
3rd Level: Fireball, Counterspell
4th Level: Greater Invisibility
```

Pull from `character.spells` JSON field. Format varies by system — handle D&D 5e as the primary case, with a generic fallback that just lists spell names.

### Subcommand: `inventory`

```
🎒 Thorin Ironforge — Inventory

Equipped:
  ⚔️ Longsword +1 (1d8+4 slashing)
  🛡️ Shield (+2 AC)
  🧥 Chain Mail (AC 16)

Carried:
  • Backpack, Rope (50ft), Torches (5)
  • Healing Potion x2
  • 47 gp, 12 sp
```

Pull from `character.inventory` JSON field. Format as equipped items (weapons/armor) and carried items.

### Subcommand: `features`

```
⚡ Thorin Ironforge — Features & Traits

Race: Mountain Dwarf
  • Darkvision (60ft)
  • Dwarven Resilience (advantage vs. poison)
  • Stonecunning

Class: Fighter 5
  • Fighting Style: Defense (+1 AC in armor)
  • Second Wind (1d10+5 HP, 1/short rest)
  • Action Surge (1/short rest)
  • Extra Attack
  • Martial Archetype: Champion
    • Improved Critical (crit on 19-20)
```

Pull from `character.features` JSON field.

### Permission Model

| Scenario | Access |
|---|---|
| Player views own character | Always allowed |
| GM views any character in their campaign | Allowed |
| Player views another player's character | Allowed only if character is shared with them via `CharacterShare` |
| Character in DRAFT status | Only visible to owner and campaign GM |
| Character NEEDS_REVISION | Visible to owner and GM |

The platform API handles this — the bot authenticates as the requesting user, so the API enforces permissions. But handle 403/404 responses gracefully.

### New Service: `src/services/api/characters.ts`

```typescript
class CharacterService {
  async listByGame(gameId: string, discordUserId: string): Promise<Character[]> {
    return this.client.get(`/characters?gameId=${gameId}`, discordUserId);
  }

  async getCharacter(id: string, discordUserId: string): Promise<Character> {
    return this.client.get(`/characters/${id}`, discordUserId);
  }

  async getVTTData(id: string, discordUserId: string): Promise<VTTData> {
    return this.client.get(`/characters/${id}/vtt-data`, discordUserId);
  }
}
```

Register in `src/services/api/index.ts` alongside existing services.

### Resolution + VTT Data Cache

Two-layer cache to avoid hammering the API on repeated `/roll` and `/character` commands:

**Layer 1 — Character resolution** (`Map<{discordUserId}:{gameId}, { characterId: string; expiry: number }>`):
Caches which character belongs to a user in a given campaign. 5-minute TTL. This means repeated `/roll` commands skip the "list characters by game" API call entirely.

**Layer 2 — VTT data** (`Map<characterId, { data: VTTData; expiry: number }>`):
Caches the formatted VTT data for a resolved character. 5-minute TTL.

```typescript
// Combined resolution: campaign → character → VTT data
// On cache hit for both layers, zero API calls.
async getVTTDataForUser(gameId: string, discordUserId: string): Promise<{ character: Character; vttData: VTTData } | null> {
  // Layer 1: resolve character (cached)
  const charCacheKey = `${discordUserId}:${gameId}`;
  let characterId = this.characterResolutionCache.get(charCacheKey)?.characterId;

  if (!characterId) {
    const chars = await this.listByGame(gameId, discordUserId);
    const mine = chars.filter(c => c.status === 'APPROVED');
    if (mine.length === 0) return null;
    characterId = mine[0].id; // First approved character
    this.characterResolutionCache.set(charCacheKey, { characterId, expiry: Date.now() + 300000 });
  }

  // Layer 2: get VTT data (cached)
  const vttCached = this.vttCache.get(characterId);
  if (vttCached && vttCached.expiry > Date.now()) {
    return { character: vttCached.character, vttData: vttCached.data };
  }

  const [character, vttData] = await Promise.all([
    this.getCharacter(characterId, discordUserId),
    this.getVTTData(characterId, discordUserId)
  ]);
  this.vttCache.set(characterId, { character, data: vttData, expiry: Date.now() + 300000 });
  return { character, vttData };
}
```

### Error Cases

| Case | Response |
|---|---|
| No campaign context | Standard "channel not linked" message |
| No character in campaign | `⚠️ No character found for you in {campaign}. Create one at {link}.` |
| GM targets player with no character | `⚠️ {player} doesn't have a character in {campaign}.` |
| Non-GM tries to view another's character | `⚠️ You can only view your own character. GMs can view any player's character.` |
| Character data missing (e.g., no spells for a fighter) | `ℹ️ No spells found on {character name}'s sheet.` |
| API 403 | Treat as "not found" |

---

## 4. Initiative Tracker (`/init`)

### Command Registration

```typescript
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
      description: 'Advance to next combatant\'s turn',
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'prev',
      description: 'Go back to previous combatant\'s turn',
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
  ]
};
```

### New Files

- `src/commands/init.ts` — command handler
- `src/services/session/InitiativeTracker.ts` — state management

### State Model

```typescript
interface Combatant {
  name: string;
  initiative: number;
  dexMod: number;        // for tiebreaking
  hp?: number;           // optional HP tracking
  maxHp?: number;
  isPlayer: boolean;     // true if linked to a platform character
  discordUserId?: string;
  conditions?: string[]; // stretch goal
}

interface Encounter {
  channelId: string;
  combatants: Combatant[];
  currentIndex: number;
  round: number;
  startedAt: number;
  messageId?: string;    // pinned tracker message
}
```

### New Service: `src/services/session/InitiativeTracker.ts`

```typescript
class InitiativeTracker {
  private encounters = new Map<string, Encounter>();  // keyed by channelId

  startEncounter(channelId: string): Encounter
  endEncounter(channelId: string): void
  getEncounter(channelId: string): Encounter | null

  addCombatant(channelId: string, combatant: Combatant): void
  removeCombatant(channelId: string, name: string): void

  nextTurn(channelId: string): { combatant: Combatant; round: number }
  prevTurn(channelId: string): { combatant: Combatant; round: number }

  applyDamage(channelId: string, name: string, amount: number): Combatant
  setHP(channelId: string, name: string, current: number, max?: number): Combatant

  getSortedCombatants(channelId: string): Combatant[]
}
```

**Sorting**: Descending by initiative. Ties broken by DEX modifier (higher first). If still tied, maintain insertion order.

### Subcommand: `start`

1. Check if encounter already exists for this channel.
   - If yes: `⚠️ An encounter is already active in this channel. Run \`/init end\` to finish it first.`
2. Create new encounter.
3. Post tracker embed (empty, waiting for combatants).

### Subcommand: `add`

1. Get encounter for channel.
2. Check for duplicate name (case-insensitive).
3. Add combatant, re-sort.
4. Update tracker embed.

### Subcommand: `roll`

1. Get encounter and campaign context.
2. Check who's in the voice channel (if in a guild with voice).
3. For each voice member with a linked character:
   - Get character's initiative modifier from VTT data.
   - Roll `1d20 + initiative modifier`.
   - Add as combatant with `isPlayer: true`.
4. Report results and update tracker.

If no voice channel or no linked characters, return: `⚠️ No players with linked characters found in voice. Add combatants manually with \`/init add\`.`

### Subcommand: `next` / `prev`

1. Advance/retreat `currentIndex`.
2. Handle wrap-around (increment `round` when wrapping past the end).
3. Update tracker embed.
4. Announce: `⚔️ **Round {round}** — It's **{name}**'s turn!`

### Subcommand: `list`

Post the full tracker embed (same as the persistent one, but as a fresh message).

### Subcommand: `end`

1. Post final summary:
   ```
   ⚔️ Encounter ended after {rounds} rounds ({duration}).
   ```
2. Remove encounter from memory.
3. Edit the pinned tracker message to show "Encounter ended" (don't delete it).

### Subcommand: `damage`

1. Find combatant by name.
2. If no HP set, prompt: `⚠️ {name} doesn't have HP set. Use \`/init hp {name} {current} {max}\` first.`
3. Apply damage (subtract). Negative values heal.
4. Clamp to 0 and maxHp.
5. Update tracker embed.
6. If HP reaches 0: add visual indicator (strikethrough or 💀).

### Subcommand: `hp`

1. Find combatant by name.
2. Set current and max HP.
3. Update tracker embed.

### Tracker Embed

The persistent embed that shows the full initiative order:

```
⚔️ Initiative — Round 2

  ➤ 22  Thorin Ironforge        44/44 HP
    19  Goblin Archer #1        ~~0/12 HP~~ 💀
    17  Elara Moonwhisper       31/38 HP
    15  Goblin Captain          28/45 HP
    12  Goblin Grunt #1
    12  Goblin Grunt #2
     8  Brom the Bard           22/22 HP

Round 2 · 6 combatants · Started 12 min ago
```

- Color: `0xf39c12` (gold — session info color)
- `➤` marks current turn
- HP shown if set, omitted if not
- Strikethrough + 💀 for 0 HP combatants
- Round number and duration in footer
- Initiative values right-aligned for readability

### Autocomplete (for `remove`, `damage`, `hp`)

```typescript
async autocomplete(interaction: AutocompleteInteraction) {
  const encounter = tracker.getEncounter(interaction.channelId);
  if (!encounter) return interaction.respond([]);

  const focused = interaction.options.getFocused();
  const choices = encounter.combatants
    .filter(c => c.name.toLowerCase().includes(focused.toLowerCase()))
    .slice(0, 25)
    .map(c => ({ name: c.name, value: c.name }));

  return interaction.respond(choices);
}
```

### Error Cases

| Case | Response |
|---|---|
| No active encounter (for any subcommand except `start`) | `⚠️ No active encounter. Start one with \`/init start\`.` |
| Encounter already active (for `start`) | `⚠️ Encounter already active. End it first with \`/init end\`.` |
| Duplicate combatant name | `⚠️ "{name}" is already in the initiative order.` |
| Combatant not found (for `remove`, `damage`, `hp`) | `⚠️ No combatant named "{name}" in the current encounter.` |

### Turn Announcements

When `/init next` or `/init prev` advances the turn:

```typescript
// Update the tracker embed with the new state
await interaction.editReply({
  embeds: [buildTrackerEmbed(encounter)]
});

// Announce the turn change publicly
const announcement = `⚔️ **Round ${encounter.round}** — It's **${combatant.name}**'s turn!`;
if (combatant.discordUserId) {
  // Ping the player if it's a linked character
  await interaction.followUp({
    content: `${announcement}\n<@${combatant.discordUserId}>`,
    allowedMentions: { users: [combatant.discordUserId] }
  });
} else {
  await interaction.followUp({ content: announcement });
}
```

### Limitations

**No persistence:** Encounters are stored in memory only. Bot restarts clear all active encounters. This is acceptable for Phase 1 — encounters are typically 30-60 minutes, and bot uptime is high. Future enhancement: persist to Redis or SQLite with auto-recovery on startup.

### Guild-Only

Initiative tracker should be guild-only (no DMs). Add to the `guildOnlyCommands` list in bot registration.

---

## 5. Wiki Link Detection (`[[...]]`)

### Purpose

When a user types `[[Something]]` in a message, the bot detects it and posts a compact wiki embed for that page — no slash command needed. This is the single highest-value ambient feature: players and GMs reference wiki content constantly in chat, and this makes it zero-friction.

### New File: `src/listeners/wikiLinks.ts`

### Registration

Register as a `messageCreate` listener in `src/bot/index.ts`:

```typescript
import { handleWikiLinks } from '../listeners/wikiLinks';

client.on('messageCreate', handleWikiLinks);
```

### Detection Logic

```typescript
const WIKI_LINK_REGEX = /\[\[([^\]]{2,100})\]\]/g;

async function handleWikiLinks(message: Message): Promise<void> {
  // Skip bot messages, DMs, and messages with no matches
  if (message.author.bot) return;
  if (!message.guild) return;

  const matches = [...message.content.matchAll(WIKI_LINK_REGEX)];
  if (matches.length === 0) return;

  // Resolve campaign context from channel
  const ctx = await resolveCampaignFromChannel(message.channelId);
  if (!ctx) return; // Channel not bound — silently ignore

  // Cap at 3 links per message to avoid spam
  const terms = [...new Set(matches.map(m => m[1]).slice(0, 3))];

  const embeds: EmbedBuilder[] = [];
  for (const term of terms) {
    const result = await lookupWikiPage(ctx.wikiId, term, message.author.id);
    if (result) {
      embeds.push(buildCompactWikiEmbed(result));
    }
  }

  if (embeds.length > 0) {
    await message.reply({ embeds, allowedMentions: { repliedUser: false } });
  }
}
```

### Lookup Logic

```typescript
async function lookupWikiPage(
  wikiId: string,
  term: string,
  discordUserId: string
): Promise<WikiSearchResult | null> {
  // 1. Try exact title match first
  const exact = await arcaneAPI.wiki.searchPages(wikiId, term, {
    limit: 1
  });
  if (exact.pages.length === 1 && exact.pages[0].title.toLowerCase() === term.toLowerCase()) {
    return exact.pages[0];
  }

  // 2. Fall back to search — take top result only if high confidence
  const search = await arcaneAPI.wiki.searchPages(wikiId, term, { limit: 3 });
  if (search.pages.length === 1) return search.pages[0];
  if (search.pages.length > 1 && search.pages[0].title.toLowerCase().startsWith(term.toLowerCase())) {
    return search.pages[0];
  }

  // 3. No confident match — return null (don't post anything)
  return null;
}
```

### Compact Embed Format

Wiki link embeds should be smaller than `/wiki page` results — these are inline references, not full lookups.

```
📖 Lord Varik  ·  NPC
Human noble, leader of the Northern Coalition. Known for his ruthless...
🔗 View on Arcane Circle
```

```typescript
function buildCompactWikiEmbed(page: WikiSearchResult): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📖 ${page.title}  ·  ${page.pageType}`)
    .setDescription(truncate(page.excerpt, 200))
    .setURL(`https://arcanecircle.games/dashboard/wikis/${page.wikiId}#${page.slug}`);
}
```

- Color: `0x3498db` (blue — matches wiki color)
- No fields — just title + short description + link
- No footer or timestamp — keep it minimal
- Max 200 chars excerpt
- **URL format confirmed**: The web app uses fragment-based routing — `https://arcanecircle.games/dashboard/wikis/{wikiId}#{slug}` is correct. Verified in ac-mvp frontend routing.

### Context Resolution Variant

The `messageCreate` listener doesn't have an `interaction`, so it needs a channel-only resolution path:

```typescript
async function resolveCampaignFromChannel(channelId: string): Promise<CampaignContext | null> {
  // Check cache only — don't do user-based fallback
  // If the channel isn't explicitly bound, return null
  return channelContextCache.get(channelId) ?? null;
}
```

This is intentionally conservative. `[[Wiki Links]]` only work in channels that have been bound via `/set-game-channel`. No guessing.

### Rate Limiting / Anti-Spam

- Max 3 links per message
- Deduplicate terms within the same message
- Failed lookups (no match) are cached for 2 minutes to avoid re-querying the same unknown term
- Only fires in channels with a bound campaign
- **Per-user cooldown**: 5-second minimum between wiki link responses per user. Prevents rapid-fire spam while allowing normal conversational use:

```typescript
private userCooldowns = new Map<string, number>(); // userId → last response timestamp

// Before processing wiki links:
const lastResponse = this.userCooldowns.get(message.author.id) ?? 0;
if (Date.now() - lastResponse < 5000) return; // Silently ignore
// After successful response:
this.userCooldowns.set(message.author.id, Date.now());
```

### Toggle

The feature is **on by default** for bound channels. Can be disabled per-channel later if needed (via a flag in the channel binding), but don't build the toggle for Phase 1 — just ship it on.

### Visibility

Same rules as `/wiki page`: filter secret blocks for non-GMs, respect page visibility. Since this uses the same wiki search API and the bot authenticates per-user, the platform enforces access control.

### Error Handling

This listener should **never** throw or post error messages. It's ambient — if something goes wrong, silently skip:

```typescript
try {
  // ... detection, lookup, embed
} catch (err) {
  // Log for debugging, but don't post anything to the channel
  console.error('[wiki-links] Error processing wiki link:', err);
}
```

### Files Modified

| File | Change |
|---|---|
| `src/bot/index.ts` | Register `messageCreate` listener |

---

## Shared: New Types

### New File: `src/types/character.ts`

```typescript
export interface Character {
  id: string;
  userId: string;
  name: string;
  system: string;
  characterType: string;
  level?: number;
  imageUrl?: string;
  gameId?: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'NEEDS_REVISION';
}

export interface VTTData {
  id: string;
  name: string;
  system: string;              // "dnd5e-2014", "pf2e", "burning_wheel", etc.
  characterType: string | null;
  imageUrl: string | null;
  level: number | null;
  stats: {
    hp: { current: number; max: number; temp: number };
    ac: number;
    speed: number;
    initiative: number;
    proficiencyBonus: number;
  };
  abilities: Record<string, {  // may be empty for non-D20 systems
    score: number;
    mod: number;
  }>;
  skills: Record<string, {     // may be empty for non-D20 systems
    mod: number;
    proficient: boolean;
  }>;
  saves: Record<string, {      // may be empty for non-D20 systems
    mod: number;
    proficient: boolean;
  }>;
}
```

### New File: `src/types/wiki.ts`

```typescript
export interface WikiSearchResult {
  id: string;
  title: string;
  slug: string;
  pageType: WikiPageType;
  excerpt: string;
  tags: string[];
  visibility: WikiVisibility;
  updatedAt: string;
  score: number;
  matchType: 'title' | 'content';
}

export interface WikiPageSuggestion {
  id: string;
  title: string;
  slug: string;
  pageType: WikiPageType;
  visibility: WikiVisibility;
}

export type WikiPageType = 'npc' | 'location' | 'adventure_arc' | 'session_notes' | 'item' | 'faction' | 'timeline' | 'custom';
export type WikiVisibility = 'public' | 'players' | 'gm_only' | 'private';
```

---

## Dependencies

### New npm dependency

```json
{
  "@dice-roller/rpg-dice-roller": "^5.x"
}
```

No other new dependencies.

### Platform API endpoints used

All endpoints below have been verified against the platform codebase (ac-mvp):

| Endpoint | Used By | Status |
|---|---|---|
| `GET /bookings/me?discordId={id}` | Context resolution | ✅ Confirmed — supports bot API key + discordId query param |
| `GET /wiki/{id}/search?q={query}&type={type}` | Wiki search | ✅ Confirmed — supports `type`, `tags`, `visibility`, `author`, `dateFrom`, `dateTo` filters |
| `GET /wiki/{id}/search/suggest?q={query}` | Wiki autocomplete | ✅ Confirmed — returns `{ suggestions: [{ id, title, slug, pageType, visibility }] }` |
| `GET /wiki/{id}/pages/{pageId}` | Wiki page view | ✅ Confirmed — content filtered server-side by user role |
| `GET /wiki/{id}/recent` | Wiki recent | ✅ Confirmed — returns `{ recentPages: [{ pageId, viewedAt, page: {...} }] }` |
| `GET /characters?gameId={id}` | Character resolution | ✅ Confirmed — supports `gameId`, `system`, `tag`, `search`, `includeShared` filters |
| `GET /characters/{id}` | Character detail | ✅ Confirmed |
| `GET /characters/{id}/vtt-data` | Character stats/dice rolls | ✅ Confirmed — normalizes across D&D 5e, PF2e, PF1e, generic |

**Not available (changed from original spec):**
- `GET /games?discordChannelId={channelId}` — this query filter does **not** exist. The `discordChannelId` is stored on the game record via PATCH, but there's no reverse lookup by channel. Context resolution uses `GET /bookings/me` and matches locally instead (see Section 0).

---

## File Summary

### New Files (12)

| File | Purpose |
|---|---|
| `src/services/context/ChannelContext.ts` | Campaign context resolution + cache |
| `src/services/api/characters.ts` | Character API service |
| `src/services/session/InitiativeTracker.ts` | In-memory initiative state |
| `src/services/dice/DiceRoller.ts` | Dice parsing wrapper around rpg-dice-roller |
| `src/commands/roll.ts` | `/roll` command |
| `src/commands/wiki.ts` | `/wiki` command |
| `src/commands/character.ts` | `/character` command |
| `src/commands/init.ts` | `/init` command |
| `src/listeners/wikiLinks.ts` | `[[Wiki Link]]` message listener |
| `src/types/character.ts` | Character + VTT data types |
| `src/types/wiki.ts` | Wiki search/page types |
| `src/utils/wiki-content.ts` | HTML stripping + secret block filtering |

### Modified Files (5)

| File | Change |
|---|---|
| `src/services/api/wiki.ts` | Add `searchPages`, `searchSuggest`, `getRecentPages` methods |
| `src/services/api/index.ts` | Export new character service |
| `src/bot/index.ts` | Register 4 new commands + `messageCreate` listener, add `init` to guild-only list |
| `src/commands/set-game-channel.ts` | Add context cache invalidation |
| `package.json` | Add `@dice-roller/rpg-dice-roller` dependency |

---

## Build Order

1. **Context resolution** — everything else depends on this
2. **Character service** — `/roll` and `/character` both need it
3. **Wiki content utilities** — `/wiki` and `[[Wiki Link]]` both need HTML stripping
4. **`/roll`** — can build once context + character service exist
5. **`/wiki`** — can build once context + wiki content utils exist
6. **`/character`** — can build once context + character service exist
7. **`/init`** — independent of API services, just needs context for `/init roll`
8. **`[[Wiki Link]]` listener** — needs context resolution + wiki search + wiki content utils

Steps 4-8 can be built in parallel once 1-3 are done. The wiki link listener is the simplest — it reuses the wiki search and content utilities built for `/wiki`.
