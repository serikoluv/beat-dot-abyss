import { BAR_TURNS, CHARS, BY_KEY } from "../data";
import { combinations, evalDeck, staticScore, type DeckStats } from "../engine";
import { state } from "../state";
import { $, escapeAttr, escapeHtml, tick } from "../util";
import { setAdvisorDeck } from "./advisor";
import { go } from "../router";

let running = false;

async function run(): Promise<void> {
  if (running) return;
  const bar = +state.bar, nRooms = bar * 3, turns = BAR_TURNS[bar];
  const bonds: Record<string, number> = {};
  const avail: string[] = [];
  for (const c of CHARS) {
    const e = state.chars[c.key];
    if (e && e.o && e.bond >= 1) { bonds[c.key] = e.bond; avail.push(c.key); }
  }
  const msg = $("optMsg");
  if (avail.length < nRooms) {
    msg.textContent = `所持かつ絆Lv1以上のキャラが${avail.length}人しかいません（${nRooms}人必要）。名簿タブで入力してください。`;
    return;
  }
  running = true;
  const btn = $("optRun") as HTMLButtonElement;
  btn.disabled = true;
  const barEl = $("optBar");
  const sims = Math.max(100, Math.min(5000, +($("optSims") as HTMLInputElement).value || 600));
  const poolN = Math.max(nRooms, Math.min(18, +($("optPool") as HTMLInputElement).value || 14));
  const cfgBase = { turns, floors: bar };

  const ranked = [...avail].sort((a, b) =>
    staticScore(BY_KEY[b].prop, bonds[b]) - staticScore(BY_KEY[a].prop, bonds[a]));
  const pool = ranked.slice(0, poolN);
  const combos = [...combinations(pool, nRooms)];
  msg.textContent = `候補${combos.length}件を粗評価中...`;
  const t0 = performance.now();

  const screened: [number, string[]][] = [];
  for (let i = 0; i < combos.length; i++) {
    const r = evalDeck(combos[i], bonds, { ...cfgBase, policy: "greedy" }, 60);
    screened.push([r.mean, combos[i]]);
    if (i % 25 === 0) {
      barEl.style.width = (i / combos.length * 70) + "%";
      await tick();
    }
  }
  screened.sort((a, b) => b[0] - a[0]);

  const finalists = screened.slice(0, 20);
  const results: { deck: string[]; rg: DeckStats; rs: DeckStats }[] = [];
  for (let i = 0; i < finalists.length; i++) {
    msg.textContent = `上位${finalists.length}件を本評価中 (${i + 1}/${finalists.length})...`;
    const deck = finalists[i][1];
    const rg = evalDeck(deck, bonds, { ...cfgBase, policy: "greedy" }, sims);
    const rs = evalDeck(deck, bonds, { ...cfgBase, policy: "simple" }, sims);
    results.push({ deck, rg, rs });
    barEl.style.width = (70 + (i + 1) / finalists.length * 30) + "%";
    await tick();
  }
  results.sort((a, b) => b.rs.cap - a.rs.cap || b.rs.p10 - a.rs.p10 || b.rg.p10 - a.rg.p10);
  msg.textContent = `完了（${((performance.now() - t0) / 1000).toFixed(1)}秒）`;

  const box = $("optResults");
  box.innerHTML = results.slice(0, 5).map((r, i) => `
    <div class="result">
      <div class="head">
        <span class="rank">#${i + 1}</span>
        <span class="metric">固定ルール: 上限到達 <b>${Math.round(r.rs.cap * 100)}%</b> ・中央値 <b>${Math.round(r.rs.p50)}</b> ・下振れP10 <b>${Math.round(r.rs.p10)}</b></span>
        <span class="metric">上手いプレイ: 上限到達 <b>${Math.round(r.rg.cap * 100)}%</b> ・中央値 <b>${Math.round(r.rg.p50)}</b></span>
        <button class="act ghost" data-deck="${escapeAttr(r.deck.join("||"))}">アドバイザで使う</button>
      </div>
      <div class="members">${r.deck.map(k => `${escapeHtml(k)}(絆${bonds[k]})`).join("、 ")}</div>
    </div>`).join("");
  box.querySelectorAll<HTMLButtonElement>("button[data-deck]").forEach(b =>
    b.addEventListener("click", () => {
      setAdvisorDeck(b.dataset.deck!.split("||"));
      go("adv");
    }));
  barEl.style.width = "100%";
  btn.disabled = false;
  running = false;
}

export function initOptimize(): void {
  $("optRun").addEventListener("click", () => { void run(); });
}
