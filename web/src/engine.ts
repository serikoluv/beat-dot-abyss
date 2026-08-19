/* 娼館営業シミュレーションエンジン（tools/brothel_sim.py と同一モデル）
   スコア = Σ 初期値×(1 + カード% + 提案% + 評価ボーナス)
   初期値 = 200+絆×10 / GOOD(2マーク)=+20% / GREAT(3マーク)=+100% */
import { BY_KEY, MARKS, SOUL_CAP, type Prop } from "./data";

export interface SimStaff {
  key: string;
  name: string;
  faction: string;
  prop: Prop;
  init: number;
  marks: Set<string>;
  pct: number;
  used: boolean;
}
export interface Card { kind: "all" | "floor" | "room"; mark: string; target: number | null; }
export interface SimState {
  staffs: SimStaff[];
  turns: number;
  floors: number;
  cw: [number, number, number];
  pf: number;
  policy: "greedy" | "simple";
  forcedMark: string | null;
}
export interface SimConfig {
  turns: number;
  floors: number;
  cw?: [number, number, number];
  pf?: number;
  policy?: "greedy" | "simple";
}
export interface DeckStats { mean: number; p50: number; p10: number; cap: number; }

const KIND_PCT: Record<Card["kind"], number> = { all: 5, floor: 10, room: 80 };

export function makeStaff(key: string, bond: number): SimStaff {
  const c = BY_KEY[key];
  return {
    key, name: c.key, faction: c.faction, prop: c.prop!,
    init: 200 + bond * 10, marks: new Set(), pct: 0, used: false,
  };
}
export function makeState(deckKeys: string[], bonds: Record<string, number>, cfg: SimConfig): SimState {
  return {
    staffs: deckKeys.map(k => makeStaff(k, bonds[k] || 0)),
    turns: cfg.turns, floors: cfg.floors, cw: cfg.cw ?? [1, 1, 1],
    pf: cfg.pf ?? 1, policy: cfg.policy ?? "greedy", forcedMark: null,
  };
}
function resetStaff(s: SimStaff): void { s.marks = new Set(); s.pct = 0; s.used = false; }
export function evalBonus(s: SimStaff): number {
  const n = s.marks.size;
  return n >= 3 ? 100 : n === 2 ? 20 : 0;
}
export function finalOf(s: SimStaff): number { return s.init * (1 + (s.pct + evalBonus(s)) / 100); }
export function totalScore(staffs: SimStaff[]): number {
  let t = 0;
  for (const s of staffs) t += finalOf(s);
  return t;
}

/* ---- 状態の保存/復元（アドバイザの先読み用） ---- */
interface Snap { staffs: { m: string[]; p: number; u: boolean }[]; fm: string | null; }
export function snapshot(st: SimState): Snap {
  return { staffs: st.staffs.map(s => ({ m: [...s.marks], p: s.pct, u: s.used })), fm: st.forcedMark };
}
export function restore(st: SimState, snap: Snap): void {
  st.staffs.forEach((s, i) => {
    const x = snap.staffs[i];
    s.marks = new Set(x.m); s.pct = x.p; s.used = x.u;
  });
  st.forcedMark = snap.fm;
}

/* ---- カード ---- */
export function dealCards(st: SimState): Card[] {
  const cards: Card[] = [];
  const [w0, w1, w2] = st.cw, wsum = w0 + w1 + w2;
  for (let i = 0; i < 3; i++) {
    const r = Math.random() * wsum;
    const kind: Card["kind"] = r < w0 ? "all" : r < w0 + w1 ? "floor" : "room";
    const mark = st.forcedMark || MARKS[Math.floor(Math.random() * 3)];
    let target: number | null = null;
    if (kind === "floor") target = Math.floor(Math.random() * st.floors);
    else if (kind === "room") target = Math.floor(Math.random() * st.staffs.length);
    cards.push({ kind, mark, target });
  }
  return cards;
}
export function cardTargets(st: SimState, card: Card): number[] {
  if (card.kind === "all") return st.staffs.map((_, i) => i);
  if (card.kind === "floor") return [card.target! * 3, card.target! * 3 + 1, card.target! * 3 + 2];
  return [card.target!];
}
function cardValue(st: SimState, card: Card, turnsLeft: number): number {
  const pct = KIND_PCT[card.kind];
  let v = 0;
  for (const i of cardTargets(st, card)) {
    const s = st.staffs[i];
    v += s.init * pct / 100;
    if (!s.marks.has(card.mark)) {
      const n = s.marks.size;
      const gain = n === 1 ? 20 : n === 2 ? 80 : 8;
      v += s.init * gain / 100 * Math.min(1, 0.5 + 0.25 * turnsLeft);
    }
  }
  return v;
}
function cardValueSimple(st: SimState, card: Card): number {
  const kindRank = { all: 300, room: 200, floor: 100 }[card.kind];
  let reach = 0, fresh = 0;
  for (const i of cardTargets(st, card)) {
    const s = st.staffs[i];
    if (!s.marks.has(card.mark)) { fresh++; if (s.marks.size === 2) reach++; }
  }
  return kindRank + reach * 10 + fresh;
}
export function applyCard(st: SimState, card: Card): void {
  const pct = KIND_PCT[card.kind];
  for (const i of cardTargets(st, card)) {
    const s = st.staffs[i];
    s.pct += pct;
    s.marks.add(card.mark);
  }
}

/* ---- 提案 ---- */
export function propValue(st: SimState, s: SimStaff, isFinal: boolean, turnsLeft: number): number {
  const p = s.prop, pf = st.pf, staffs = st.staffs;
  if (!p) return 0;
  if (p.kind === "buff_all") return staffs.reduce((a, t) => a + t.init, 0) * p.bonus * pf / 100;
  if (p.kind === "buff_good") return staffs.reduce((a, t) => a + (t.marks.size >= 2 ? t.init : 0), 0) * p.bonus * pf / 100;
  if (p.kind === "buff_great") return staffs.reduce((a, t) => a + (t.marks.size >= 3 ? t.init : 0), 0) * p.bonus * pf / 100;
  if (p.kind === "buff_scaled") {
    let v = 0;
    for (const t of staffs) {
      if (t.marks.size >= 3) v += t.init * 50 * pf / 100;
      else if (t.marks.size === 2) v += t.init * 20 * pf / 100;
    }
    return v;
  }
  if (p.kind === "grant_chain") {
    const [src, dst] = p.mark.split("→");
    let v = 0;
    for (const t of staffs) {
      if (t.marks.has(src) && !t.marks.has(dst)) v += t.init * (t.marks.size === 2 ? 80 : 20) / 100;
    }
    return v;
  }
  if (p.kind === "grant_faction") {
    const targets = staffs.filter(t => t.faction === s.faction)
      .sort((a, b) => b.init - a.init);
    let v = 0;
    for (let i = 0; i < Math.min(p.n, targets.length); i++) {
      const t = targets[i];
      let gain = p.bonus * pf;
      if (!t.marks.has(p.mark)) gain += t.marks.size === 2 ? 80 : 25;
      v += t.init * gain / 100;
    }
    return v;
  }
  if (p.kind === "next_card") {
    if (isFinal && p.bonus === 0) return -1; // R の next_card は最終ターン無効
    const base = staffs.reduce((a, t) => a + t.init, 0) * p.bonus * pf / 100;
    const need = staffs.filter(t => !t.marks.has(p.mark) && t.marks.size >= 1).length;
    return base + need * 120 * (isFinal ? 0 : 1);
  }
  return 0;
}
function propValueSimple(st: SimState, s: SimStaff, isFinal: boolean, turnsLeft: number): number {
  const p = s.prop;
  if (!p) return 0;
  const setup = turnsLeft >= 2;
  if (["grant_chain", "grant_faction", "next_card"].includes(p.kind)) {
    if (p.kind === "next_card" && isFinal && p.bonus === 0) return -1;
    const rank = ({ grant_chain: 30, grant_faction: 20, next_card: 10 } as Record<string, number>)[p.kind];
    return (setup ? 1000 + rank : 100) + propValue(st, s, isFinal, turnsLeft) * 0.001;
  }
  const rank = ({ buff_great: 40, buff_scaled: 30, buff_all: 20, buff_good: 10 } as Record<string, number>)[p.kind] || 0;
  const gain = propValue(st, s, isFinal, turnsLeft);
  if (gain <= 0) return 0;
  return (setup ? 100 : 1000) + rank + gain * 0.001;
}
export function applyProposal(st: SimState, s: SimStaff, isFinal: boolean, forcedTargets: SimStaff[] | null): void {
  const p = s.prop, pf = st.pf, staffs = st.staffs;
  s.used = true;
  if (p.kind === "buff_all") staffs.forEach(t => { t.pct += p.bonus * pf; });
  else if (p.kind === "buff_good") staffs.forEach(t => { if (t.marks.size >= 2) t.pct += p.bonus * pf; });
  else if (p.kind === "buff_great") staffs.forEach(t => { if (t.marks.size >= 3) t.pct += p.bonus * pf; });
  else if (p.kind === "buff_scaled") staffs.forEach(t => {
    if (t.marks.size >= 3) t.pct += 50 * pf;
    else if (t.marks.size === 2) t.pct += 20 * pf;
  });
  else if (p.kind === "grant_chain") {
    const [src, dst] = p.mark.split("→");
    staffs.forEach(t => { if (t.marks.has(src)) t.marks.add(dst); });
  }
  else if (p.kind === "grant_faction") {
    let targets: SimStaff[];
    if (forcedTargets) targets = forcedTargets;
    else {
      targets = staffs.filter(t => t.faction === s.faction);
      for (let i = targets.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [targets[i], targets[j]] = [targets[j], targets[i]];
      }
      targets = targets.slice(0, p.n);
    }
    targets.forEach(t => { t.marks.add(p.mark); t.pct += p.bonus * pf; });
  }
  else if (p.kind === "next_card") {
    if (!isFinal) st.forcedMark = p.mark;
    staffs.forEach(t => { t.pct += p.bonus * pf; });
  }
}

/* ---- 方針プレイ ---- */
export function chooseCard(st: SimState, cards: Card[], turnsLeft: number): Card {
  const vf = st.policy === "simple"
    ? (c: Card) => cardValueSimple(st, c)
    : (c: Card) => cardValue(st, c, turnsLeft);
  let best = cards[0], bv = -Infinity;
  for (const c of cards) {
    const v = vf(c);
    if (v > bv) { bv = v; best = c; }
  }
  return best;
}
export function chooseProposal(st: SimState, isFinal: boolean, turnsLeft: number): SimStaff | null {
  const vf = st.policy === "simple" ? propValueSimple : propValue;
  let best: SimStaff | null = null, bv = 0;
  for (const s of st.staffs) {
    if (s.used) continue;
    const v = vf(st, s, isFinal, turnsLeft);
    if (v > bv) { bv = v; best = s; }
  }
  return best;
}
export function runOne(st: SimState): number {
  st.staffs.forEach(resetStaff);
  st.forcedMark = null;
  for (let turn = 0; turn < st.turns; turn++) {
    const isFinal = turn === st.turns - 1, tl = st.turns - turn - 1;
    const cards = dealCards(st);
    st.forcedMark = null; // next_card の効果は配布1回分
    applyCard(st, chooseCard(st, cards, tl));
    const best = chooseProposal(st, isFinal, tl);
    if (best) applyProposal(st, best, isFinal, null);
  }
  return totalScore(st.staffs);
}
export function evalDeck(deckKeys: string[], bonds: Record<string, number>, cfg: SimConfig, sims: number): DeckStats {
  const st = makeState(deckKeys, bonds, cfg);
  const scores: number[] = [];
  for (let i = 0; i < sims; i++) scores.push(runOne(st));
  scores.sort((a, b) => a - b);
  const n = scores.length;
  return {
    mean: scores.reduce((a, b) => a + b, 0) / n,
    p50: scores[Math.floor(n / 2)],
    p10: scores[Math.floor(n / 10)],
    cap: scores.filter(x => x >= SOUL_CAP).length / n,
  };
}

/* ---- 最適化用ユーティリティ ---- */
const STATIC_WEIGHT: Record<string, number> = {
  grant_chain: 100, buff_scaled: 90, buff_great: 80,
  buff_all: 60, buff_good: 50, grant_faction: 45, next_card: 40,
};
export function staticScore(prop: Prop | null, bond: number): number {
  const w = prop ? (STATIC_WEIGHT[prop.kind] || 30) : 0;
  return w + (prop ? prop.bonus * 0.8 : 0) + bond * 3;
}
export function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map(i => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === arr.length - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}
