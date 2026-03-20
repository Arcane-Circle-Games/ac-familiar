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
  wikiId?: string;
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
