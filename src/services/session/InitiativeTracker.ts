import { logInfo, logDebug } from '../../utils/logger';

export interface Combatant {
  name: string;
  initiative: number;
  dexMod: number;
  hp?: number;
  maxHp?: number;
  isPlayer: boolean;
  discordUserId?: string;
  conditions?: string[];
}

export interface Encounter {
  channelId: string;
  combatants: Combatant[];
  currentIndex: number;
  round: number;
  startedAt: number;
  messageId?: string;
}

class InitiativeTrackerService {
  private encounters = new Map<string, Encounter>();

  /**
   * Start a new encounter for a channel
   */
  startEncounter(channelId: string): Encounter {
    const encounter: Encounter = {
      channelId,
      combatants: [],
      currentIndex: -1,
      round: 0,
      startedAt: Date.now()
    };

    this.encounters.set(channelId, encounter);
    logInfo('Encounter started', { channelId });
    return encounter;
  }

  /**
   * End and remove an encounter
   */
  endEncounter(channelId: string): Encounter | null {
    const encounter = this.encounters.get(channelId);
    if (!encounter) return null;

    this.encounters.delete(channelId);
    logInfo('Encounter ended', { channelId, rounds: encounter.round });
    return encounter;
  }

  /**
   * Get active encounter for a channel
   */
  getEncounter(channelId: string): Encounter | null {
    return this.encounters.get(channelId) || null;
  }

  /**
   * Add a combatant and re-sort
   */
  addCombatant(channelId: string, combatant: Combatant): void {
    const encounter = this.encounters.get(channelId);
    if (!encounter) throw new Error('No active encounter');

    const exists = encounter.combatants.some(
      c => c.name.toLowerCase() === combatant.name.toLowerCase()
    );
    if (exists) {
      throw new Error(`"${combatant.name}" is already in the initiative order`);
    }

    encounter.combatants.push(combatant);
    this.sortCombatants(encounter);

    logDebug('Combatant added', { channelId, name: combatant.name, initiative: combatant.initiative });
  }

  /**
   * Remove a combatant by name
   */
  removeCombatant(channelId: string, name: string): Combatant {
    const encounter = this.encounters.get(channelId);
    if (!encounter) throw new Error('No active encounter');

    const idx = encounter.combatants.findIndex(
      c => c.name.toLowerCase() === name.toLowerCase()
    );
    if (idx === -1) {
      throw new Error(`No combatant named "${name}" in the current encounter`);
    }

    const [removed] = encounter.combatants.splice(idx, 1);

    if (encounter.currentIndex >= encounter.combatants.length) {
      encounter.currentIndex = Math.max(0, encounter.combatants.length - 1);
    } else if (idx < encounter.currentIndex) {
      encounter.currentIndex--;
    }

    logDebug('Combatant removed', { channelId, name: removed.name });
    return removed;
  }

  /**
   * Advance to next combatant's turn
   */
  nextTurn(channelId: string): { combatant: Combatant; round: number } {
    const encounter = this.encounters.get(channelId);
    if (!encounter) throw new Error('No active encounter');
    if (encounter.combatants.length === 0) throw new Error('No combatants in encounter');

    encounter.currentIndex++;

    if (encounter.currentIndex >= encounter.combatants.length) {
      encounter.currentIndex = 0;
      encounter.round++;
    }

    if (encounter.round === 0) {
      encounter.round = 1;
    }

    const combatant = encounter.combatants[encounter.currentIndex];
    return { combatant, round: encounter.round };
  }

  /**
   * Go back to previous combatant's turn
   */
  prevTurn(channelId: string): { combatant: Combatant; round: number } {
    const encounter = this.encounters.get(channelId);
    if (!encounter) throw new Error('No active encounter');
    if (encounter.combatants.length === 0) throw new Error('No combatants in encounter');

    encounter.currentIndex--;

    if (encounter.currentIndex < 0) {
      encounter.currentIndex = encounter.combatants.length - 1;
      encounter.round = Math.max(1, encounter.round - 1);
    }

    const combatant = encounter.combatants[encounter.currentIndex];
    return { combatant, round: encounter.round };
  }

  /**
   * Apply damage to a combatant (negative to heal)
   */
  applyDamage(channelId: string, name: string, amount: number): Combatant {
    const encounter = this.encounters.get(channelId);
    if (!encounter) throw new Error('No active encounter');

    const combatant = this.findCombatant(encounter, name);
    if (combatant.hp === undefined) {
      throw new Error(`${combatant.name} doesn't have HP set. Use \`/init hp ${combatant.name} {current} {max}\` first.`);
    }

    combatant.hp = Math.max(0, combatant.hp - amount);
    if (combatant.maxHp !== undefined) {
      combatant.hp = Math.min(combatant.hp, combatant.maxHp);
    }

    logDebug('Damage applied', { channelId, name: combatant.name, amount, newHp: combatant.hp });
    return combatant;
  }

  /**
   * Set HP for a combatant
   */
  setHP(channelId: string, name: string, current: number, max?: number): Combatant {
    const encounter = this.encounters.get(channelId);
    if (!encounter) throw new Error('No active encounter');

    const combatant = this.findCombatant(encounter, name);
    combatant.hp = current;
    if (max !== undefined) {
      combatant.maxHp = max;
    }

    logDebug('HP set', { channelId, name: combatant.name, hp: combatant.hp, maxHp: combatant.maxHp });
    return combatant;
  }

  /**
   * Get sorted combatants for an encounter
   */
  getSortedCombatants(channelId: string): Combatant[] {
    const encounter = this.encounters.get(channelId);
    if (!encounter) return [];
    return [...encounter.combatants];
  }

  /**
   * Set the pinned tracker message ID
   */
  setMessageId(channelId: string, messageId: string): void {
    const encounter = this.encounters.get(channelId);
    if (encounter) {
      encounter.messageId = messageId;
    }
  }

  // ── Private ──────────────────────────────────────────

  private sortCombatants(encounter: Encounter): void {
    encounter.combatants.sort((a, b) => {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      if (b.dexMod !== a.dexMod) return b.dexMod - a.dexMod;
      return 0;
    });
  }

  private findCombatant(encounter: Encounter, name: string): Combatant {
    const found = encounter.combatants.find(
      c => c.name.toLowerCase() === name.toLowerCase()
    );
    if (!found) {
      throw new Error(`No combatant named "${name}" in the current encounter`);
    }
    return found;
  }
}

export const initiativeTracker = new InitiativeTrackerService();
