import { BAR_TURNS, BY_KEY, MARKS, SOUL_CAP } from "../data";
import {
  applyCard, applyProposal, chooseCard, chooseProposal, dealCards, finalOf,
  makeState, propValue, restore, snapshot, totalScore,
  type Card, type SimStaff, type SimState,
} from "../engine";
import { ownedPlaceable, state } from "../state";
import { $, escapeAttr, escapeHtml, tick } from "../util";

let advDeck: string[] = [];
interface AdvSession { st: SimState; turn: number; cards: Card[] | null; }
let adv: AdvSession | null = null;

export function setAdvisorDeck(keys: string[]): void {
  advDeck = keys;
  renderAdvPicker();
}

export function renderAdvPicker(): void {
  const nRooms = +state.bar * 3;
  const box = $("advPicker");
  const avail = ownedPlaceable();
  advDeck = advDeck.filter(k => avail.some(a => a.key === k)).slice(0, nRooms);
  box.innerHTML = avail.map(a => {
    const sel = advDeck.includes(a.key);
    const ord = sel ? advDeck.indexOf(a.key) + 1 : "";
    return `<button class="deckbtn ${sel ? "sel" : ""}" data-k="${escapeAttr(a.key)}">${ord ? ord + ". " : ""}${escapeHtml(a.key)} 絆${a.bond}</button>`;
  }).join("") || `<span class="hint">名簿タブで「所持」と「絆Lv1以上」を入力するとここに表示されます。</span>`;
  $("advPickMsg").textContent = `${advDeck.length}/${nRooms}人選択中（クリックで部屋順に追加）`;
  ($("advStart") as HTMLButtonElement).disabled = advDeck.length !== nRooms;
}

function cardLabel(card: Card): string {
  if (card.kind === "all") return `全体5% [${card.mark}]`;
  if (card.kind === "floor") return `フロア${card.target! + 1}に10% [${card.mark}]`;
  return `部屋${card.target! + 1}(${adv!.st.staffs[card.target!].name})に80% [${card.mark}]`;
}

function renderAdvTurn(): void {
  const st = adv!.st;
  $("advTurnTitle").textContent = `ターン ${adv!.turn + 1} / ${st.turns}`;
  const roomOpts = st.staffs.map((s, i) => `<option value="${i}">部屋${i + 1} ${escapeHtml(s.name)}</option>`).join("");
  const floorOpts = Array.from({ length: st.floors }, (_, i) => `<option value="${i}">フロア${i + 1}</option>`).join("");
  $("advCardInputs").innerHTML = [0, 1, 2].map(i => `
    <div class="cardrow" id="cardrow${i}">
      <span class="lbl">カード${i + 1}</span>
      <select class="cKind" data-i="${i}">
        <option value="all">全体+5%</option><option value="floor">フロア+10%</option><option value="room">1か所+80%</option>
      </select>
      <select class="cMark" data-i="${i}">
        <option>料理</option><option>接客</option><option>ドリンク</option>
      </select>
      <select class="cTgtFloor" data-i="${i}" style="display:none">${floorOpts}</select>
      <select class="cTgtRoom" data-i="${i}" style="display:none">${roomOpts}</select>
    </div>`).join("");
  document.querySelectorAll<HTMLSelectElement>(".cKind").forEach(sel =>
    sel.addEventListener("change", ev => {
      const t = ev.target as HTMLSelectElement;
      const i = t.dataset.i!, v = t.value;
      (document.querySelector(`.cTgtFloor[data-i="${i}"]`) as HTMLElement).style.display = v === "floor" ? "" : "none";
      (document.querySelector(`.cTgtRoom[data-i="${i}"]`) as HTMLElement).style.display = v === "room" ? "" : "none";
    }));
  $("advRec").style.display = "none";
  $("advApplyRow").style.display = "none";
  $("advGrantFix").style.display = "none";
  $("advBar").style.width = "0%";
  renderAdvState();
}

function readCards(): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i < 3; i++) {
    const kind = (document.querySelector(`.cKind[data-i="${i}"]`) as HTMLSelectElement).value as Card["kind"];
    const mark = (document.querySelector(`.cMark[data-i="${i}"]`) as HTMLSelectElement).value;
    let target: number | null = null;
    if (kind === "floor") target = +(document.querySelector(`.cTgtFloor[data-i="${i}"]`) as HTMLSelectElement).value;
    if (kind === "room") target = +(document.querySelector(`.cTgtRoom[data-i="${i}"]`) as HTMLSelectElement).value;
    cards.push({ kind, mark, target });
  }
  return cards;
}

interface Best { avg: number; ci: number; propKey: string | null; }
async function expectimax(st: SimState, cards: Card[], turnsLeft: number, isFinal: boolean,
                          rollouts: number, progressCb: (f: number) => void): Promise<Best> {
  const base = snapshot(st);
  let best: Best | null = null;
  const cands: { ci: number; propKey: string | null; state: ReturnType<typeof snapshot> }[] = [];
  for (let ci = 0; ci < 3; ci++) {
    restore(st, base);
    applyCard(st, cards[ci]);
    const afterCard = snapshot(st);
    const props: (SimStaff | null)[] = st.staffs.filter(s => !s.used);
    props.push(null);
    for (const p of props) {
      restore(st, afterCard);
      if (p !== null) {
        if (propValue(st, p, isFinal, turnsLeft) <= 0 && p.prop.kind !== "next_card") continue;
        applyProposal(st, p, isFinal, null);
      }
      cands.push({ ci, propKey: p ? p.key : null, state: snapshot(st) });
    }
  }
  let done = 0;
  for (const cand of cands) {
    let avg: number;
    if (turnsLeft === 0) {
      restore(st, cand.state);
      avg = totalScore(st.staffs);
    } else {
      let total = 0;
      for (let r = 0; r < rollouts; r++) {
        restore(st, cand.state);
        for (let k = 0; k < turnsLeft; k++) {
          const isF = k === turnsLeft - 1, tl = turnsLeft - k - 1;
          const cs = dealCards(st);
          st.forcedMark = null;
          applyCard(st, chooseCard(st, cs, tl));
          const b = chooseProposal(st, isF, tl);
          if (b) applyProposal(st, b, isF, null);
        }
        total += totalScore(st.staffs);
      }
      avg = total / rollouts;
    }
    if (!best || avg > best.avg) best = { avg, ci: cand.ci, propKey: cand.propKey };
    done++;
    progressCb(done / cands.length);
    await tick();
  }
  restore(st, base);
  return best!;
}

function renderAdvState(): void {
  if (!adv) return;
  const st = adv.st;
  $("advStateRows").innerHTML = st.staffs.map((s, i) => {
    const marks = MARKS.map(m => `<span class="markdot ${s.marks.has(m) ? "on" + m : ""}">${m[0]}</span>`).join("");
    return `<tr><td>${i + 1}</td><td>${escapeHtml(s.name)}</td><td>${marks}</td>
      <td>+${Math.round(s.pct)}%</td><td>${Math.round(finalOf(s))}</td>
      <td class="prop">${s.used ? "使用済み" : escapeHtml(s.prop.desc)}</td></tr>`;
  }).join("");
  const sc = totalScore(st.staffs);
  $("advScore").textContent = String(Math.round(sc));
  const cap = $("advCap");
  cap.classList.toggle("ok", sc >= SOUL_CAP);
  cap.textContent = sc >= SOUL_CAP ? "ソウル上限達成!" : `/ ${SOUL_CAP} (ソウル上限)`;
}

function advanceTurn(): void {
  const st = adv!.st;
  adv!.turn++;
  adv!.cards = null;
  if (adv!.turn >= st.turns) {
    renderAdvState();
    const sc = totalScore(st.staffs);
    $("advTurnTitle").textContent = "営業終了";
    $("advCardInputs").innerHTML = "";
    $("advRec").style.display = "block";
    $("advRec").innerHTML = `<b>最終スコア(モデル値): ${Math.round(sc)}</b>${sc >= SOUL_CAP ? " ★ソウル上限達成" : ""}`;
    $("advApplyRow").style.display = "none";
    $("advCalc").style.display = "none";
    return;
  }
  $("advCalc").style.display = "";
  renderAdvTurn();
}

export function initAdvisor(): void {
  $("advPicker").addEventListener("click", ev => {
    const b = (ev.target as HTMLElement).closest(".deckbtn") as HTMLElement | null;
    if (!b) return;
    const k = b.dataset.k!, nRooms = +state.bar * 3;
    const i = advDeck.indexOf(k);
    if (i >= 0) advDeck.splice(i, 1);
    else if (advDeck.length < nRooms) advDeck.push(k);
    renderAdvPicker();
  });

  $("advStart").addEventListener("click", () => {
    const bar = +state.bar;
    const bonds: Record<string, number> = {};
    ownedPlaceable().forEach(a => { bonds[a.key] = a.bond; });
    adv = {
      st: makeState(advDeck, bonds, { turns: BAR_TURNS[bar], floors: bar, policy: "greedy" }),
      turn: 0, cards: null,
    };
    $("advSetup").style.display = "none";
    $("advGame").style.display = "block";
    renderAdvTurn();
  });

  $("advQuit").addEventListener("click", () => {
    adv = null;
    $("advGame").style.display = "none";
    $("advSetup").style.display = "block";
    $("advCalc").style.display = "";
    renderAdvPicker();
  });

  $("advCalc").addEventListener("click", async ev => {
    if (!adv) return;
    const btn = ev.target as HTMLButtonElement;
    btn.disabled = true;
    const st = adv.st;
    const cards = readCards();
    adv.cards = cards;
    const isFinal = adv.turn === st.turns - 1, tl = st.turns - adv.turn - 1;
    st.forcedMark = null;
    const barEl = $("advBar");
    const best = await expectimax(st, cards, tl, isFinal, 200, f => { barEl.style.width = (f * 100) + "%"; });
    const rec = $("advRec");
    const propName = best.propKey ?? "温存（使わない）";
    const propDesc = best.propKey ? BY_KEY[best.propKey].prop!.desc : "";
    rec.style.display = "block";
    rec.innerHTML = `<b>推奨:</b> カード${best.ci + 1}「${escapeHtml(cardLabel(cards[best.ci]))}」 →
      提案「${escapeHtml(propName)}${propDesc ? " / " + escapeHtml(propDesc) : ""}」
      <div class="hint">期待最終スコア ≈ ${Math.round(best.avg)}${best.avg >= SOUL_CAP ? "（上限圏内）" : ""}</div>`;
    [0, 1, 2].forEach(i => $("cardrow" + i).classList.toggle("recommended", i === best.ci));
    const cardSel = $("advCardSel") as HTMLSelectElement;
    cardSel.innerHTML = cards.map((c, i) =>
      `<option value="${i}" ${i === best.ci ? "selected" : ""}>カード${i + 1} ${escapeHtml(cardLabel(c))}</option>`).join("");
    const propSel = $("advPropSel") as HTMLSelectElement;
    const unused = st.staffs.filter(s => !s.used);
    propSel.innerHTML = `<option value="">温存（使わない）</option>` + unused.map(s =>
      `<option value="${escapeAttr(s.key)}" ${s.key === best.propKey ? "selected" : ""}>${escapeHtml(s.key)} / ${escapeHtml(s.prop.desc)}</option>`).join("");
    $("advApplyRow").style.display = "flex";
    btn.disabled = false;
  });

  $("advApply").addEventListener("click", () => {
    if (!adv || !adv.cards) return;
    const st = adv.st;
    const isFinal = adv.turn === st.turns - 1;
    const card = adv.cards[+($("advCardSel") as HTMLSelectElement).value];
    const propKey = ($("advPropSel") as HTMLSelectElement).value || null;
    st.forcedMark = null;
    applyCard(st, card);
    if (propKey) {
      const s = st.staffs.find(x => x.key === propKey)!;
      const p = s.prop;
      if (p.kind === "grant_faction") {
        const eligible = st.staffs.filter(t => t.faction === s.faction);
        if (eligible.length > p.n) {
          const fix = $("advGrantFix");
          fix.style.display = "block";
          fix.className = "recbox";
          fix.innerHTML = `<b>${escapeHtml(s.faction)}のスタッフが${eligible.length}人いるため付与先はゲーム内でランダムに決まります。</b><br>
            実際に${escapeHtml(p.mark)}が付与されたスタッフにチェック（最大${p.n}人）:<br>` +
            eligible.map(t => {
              const i = st.staffs.indexOf(t);
              return `<label style="margin-right:10px"><input type="checkbox" class="gfx" value="${i}"> 部屋${i + 1} ${escapeHtml(t.name)}</label>`;
            }).join("") + `<div class="actions"><button class="act" id="gfxDone">確定</button></div>`;
          $("gfxDone").addEventListener("click", () => {
            const targets = [...fix.querySelectorAll<HTMLInputElement>(".gfx:checked")]
              .slice(0, p.n).map(el => st.staffs[+el.value]);
            applyProposal(st, s, isFinal, targets.length ? targets : null);
            fix.style.display = "none";
            advanceTurn();
          });
          return; // 確定待ち
        }
      }
      applyProposal(st, s, isFinal, null);
    }
    advanceTurn();
  });
}
