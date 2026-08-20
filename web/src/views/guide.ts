import guidesJson from "../data/guides.json";
import { BY_KEY } from "../data";
import { $, escapeAttr, escapeHtml } from "../util";

interface Alt { name: string; why: string; }
interface Slot { slot: string; pick: string; why: string; alts: Alt[]; }
interface Op { name: string; why: string; }
interface Guide {
  key: string; updated: string; role: string; engine: string;
  loadout: Slot[]; ops: Op[]; avoid: string; build: string;
  notes: string[]; sources: string[];
}

const GUIDES = guidesJson as Guide[];
let current = GUIDES.length ? GUIDES[0].key : null;

function charChips(key: string): string {
  const c = BY_KEY[key];
  if (!c) return "";
  return `<span class="pill ${c.rarity}">${c.rarity}</span>
    <span class="gchip">${escapeHtml(c.faction)}</span>
    <span class="gchip em ${c.emblem}">${escapeHtml(c.element)}・${escapeHtml(c.emblem)}</span>
    <span class="gchip">${escapeHtml(c.stance)}</span>
    <span class="gchip">${escapeHtml(c.weapon)}</span>`;
}

function renderBody(): void {
  const g = GUIDES.find(x => x.key === current);
  const box = $("guideBody");
  if (!g) { box.innerHTML = ""; return; }
  const loadout = g.loadout.map(s => `
    <tr>
      <th scope="row">${escapeHtml(s.slot)}</th>
      <td class="gpick">${escapeHtml(s.pick)}</td>
      <td>${escapeHtml(s.why)}</td>
    </tr>
    ${s.alts.map(a => `<tr class="galt">
      <td></td><td>代替: ${escapeHtml(a.name)}</td><td>${escapeHtml(a.why)}</td>
    </tr>`).join("")}`).join("");
  const ops = g.ops.map((o, i) => `
    <li><b>${escapeHtml(o.name)}</b><span class="hint" style="margin:0"> — ${escapeHtml(o.why)}</span></li>`).join("");
  box.innerHTML = `
    <div class="panel">
      <div class="gheader">
        <h2 style="margin:0">${escapeHtml(g.key)}</h2>
        ${charChips(g.key)}
        <span class="hint" style="margin-left:auto">更新 ${escapeHtml(g.updated)}</span>
      </div>
      <p class="grole">${escapeHtml(g.role)}</p>
      <p class="hint">${escapeHtml(g.engine)}</p>

      <h3>装備セット</h3>
      <div class="tablebox"><table class="gtable">
        <thead><tr><th style="width:70px">部位</th><th style="width:220px">推奨</th><th>根拠</th></tr></thead>
        <tbody>${loadout}</tbody>
      </table></div>

      <h3>OP（武器第3枠）の優先度</h3>
      <ol class="gops">${ops}</ol>
      <p class="hint">ハズレ: ${escapeHtml(g.avoid)}</p>

      <h3>育成</h3>
      <p>${escapeHtml(g.build)}</p>

      <h3>注意点</h3>
      <ul class="gnotes">${g.notes.map(n => `<li>${escapeHtml(n)}</li>`).join("")}</ul>

      <details><summary>出典</summary>
        <ul class="gnotes">${g.sources.map(s =>
          `<li><a href="${escapeAttr(s)}" target="_blank" rel="noopener">${escapeHtml(s)}</a></li>`).join("")}</ul>
      </details>
    </div>`;
}

export function renderGuidePicker(): void {
  const box = $("guidePicker");
  box.innerHTML = GUIDES.map(g =>
    `<button class="deckbtn ${g.key === current ? "sel" : ""}" data-k="${escapeAttr(g.key)}">${escapeHtml(g.key)}</button>`
  ).join("") + `<span class="hint" style="align-self:center">（他キャラは調査でき次第追加）</span>`;
  renderBody();
}

export function initGuide(): void {
  $("guidePicker").addEventListener("click", ev => {
    const b = (ev.target as HTMLElement).closest(".deckbtn") as HTMLElement | null;
    if (!b) return;
    current = b.dataset.k!;
    renderGuidePicker();
  });
  renderGuidePicker();
}
