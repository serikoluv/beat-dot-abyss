import charsJson from "./data/characters.json";

export interface Prop {
  kind: string;
  mark: string;
  n: number;
  bonus: number;
  desc: string;
}

export interface Chara {
  key: string;
  title: string;
  name: string;
  rarity: string;
  faction: string;
  element: string;
  stance: string;
  emblem: string;
  weapon: string;
  prop: Prop | null;
}

export const CHARS = charsJson as Chara[];
export const BY_KEY: Record<string, Chara> = Object.fromEntries(CHARS.map(c => [c.key, c]));

export const SOUL_CAP = 14070;
export const MARKS = ["料理", "接客", "ドリンク"] as const;
export const BAR_TURNS: Record<number, number> = { 1: 2, 2: 4, 3: 5 };
