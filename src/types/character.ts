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
