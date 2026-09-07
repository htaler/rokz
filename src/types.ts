/** Shapes of the JSON produced by tools/extract.ts and tools/pack.ts. */

export interface LevelParams {
  slow?: number;
  medium?: number;
  fast?: number;
  gravOn?: boolean;
  /** Gravity levels: the player falls and can only climb on a rope. */
  sideways?: boolean;
  oneMove?: boolean;
  gravRate?: number;
  evapoRate?: number;
  genFactor?: number;
  bonus?: number;
  replacement?: number;
  floorPattern?: boolean;
  fastPC?: boolean;
  lavaFlow?: boolean;
  lavaRate?: number;
  treeRate?: number;
  magicEWalls?: boolean;
  hideStairs?: boolean;
  hideMBlock?: boolean;
  hideGems?: boolean;
  hideCreate?: boolean;
  hideOpenWall?: boolean;
  hideLevel?: boolean;
  hideRock?: boolean;
  hideTrap?: boolean;
  /** Set at runtime by level 71's tablet: its blocks stop being invisible. */
  revealBlocks?: boolean;
  makeFloor?: { tile: number; cf1: number; cf2: number; bf1: number; bf2: number };
  foundSet?: number[];
}

export interface RenderOverride {
  tiles: number[];
  source: string;
}

export type Level =
  | {
      n: number;
      kind: 'drawn';
      rows: string[];
      params: LevelParams;
      renderOverrides?: RenderOverride[];
      notes?: string[];
    }
  | {
      n: number;
      kind: 'scattered';
      counts: Record<string, number>;
      params: LevelParams;
      renderOverrides?: RenderOverride[];
      warnings?: string[];
    };

export interface LevelsDoc {
  meta: { game: string; width: number; height: number; levelCount: number };
  levels: Level[];
}

export interface TilesDoc {
  fallback: string;
  monsters: { tile: number; variable: string; default: number; frames: number[] }[];
  mapChars: { char: string; byte: number; tile: number }[];
  tiles: { id: number; name: string; cp437: number | null; visible: boolean; mapChars: string[] }[];
}

export interface AtlasDoc {
  meta: { tileSize: number; cols: number; rows: number; image: string; credit: string };
  sources: string[];
  tiles: Record<string, { frames?: number[]; pick?: 'level'; text?: string }>;
  player: { frames: number[] };
}
