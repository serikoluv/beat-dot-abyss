import { CHARS } from "../data";
import { apiMode, entry, replaceState, save, setSaved, state, toCsv } from "../state";
import { $, escapeAttr, escapeHtml } from "../util";

/* 画像ファイル名: キャラキーのUTF-8バイト列をbase64url化（サーバ側と同一規則） */
function imgName(key: string): string {
  const bytes = new TextEncoder().encode(key);
  let bin = "";
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
let imgBust = 0;   // アップロード直後のキャッシュ回避

const filter = { q: "", rarity: new Set<string>(), stance: new Set<string>(), owned: false };

function matches(c: (typeof CHARS)[number]): boolean {
  if (filter.q && !c.key.includes(filter.q)) return false;
  if (filter.rarity.size && !filter.rarity.has(c.rarity)) return false;
  if (filter.stance.size && !filter.stance.has(c.stance)) return false;
  if (filter.owned && !entry(c.key).o) return false;
  return true;
}

function numCell(key: string, field: "lb" | "bond" | "a1" | "a2" | "a3", min: number, max: number): string {
  const e = entry(key);
  return `<td><input class="num" type="number" min="${min}" max="${max}" value="${e[field]}"
    data-k="${escapeAttr(key)}" data-f="${field}" ${e.o ? "" : "disabled"}></td>`;
}

export function renderRoster(): void {
  const frag: string[] = [];
  for (const c of CHARS) {
    if (!matches(c)) continue;
    const e = entry(c.key);
    const imgSrc = `chars/${imgName(c.key)}.png${imgBust ? "?v=" + imgBust : ""}`;
    frag.push(`<tr class="${e.o ? "" : "unowned"}">
      <td><input type="checkbox" data-k="${escapeAttr(c.key)}" data-f="o" ${e.o ? "checked" : ""}></td>
      <td class="thumb${apiMode ? " up" : ""}" data-imgk="${escapeAttr(c.key)}"
        ${apiMode ? `title="クリックで画像を設定"` : ""}><img src="${imgSrc}" alt="" loading="lazy"
        onerror="this.style.display='none'"></td>
      <td class="name"><span class="t">${escapeHtml(c.title ? "【" + c.title + "】" : "")}</span>${escapeHtml(c.name)}</td>
      <td><span class="pill ${c.rarity}">${c.rarity}</span></td>
      <td>${escapeHtml(c.faction)}</td>
      <td><span class="em ${c.emblem}">${escapeHtml(c.element || "?")}</span></td>
      <td>${escapeHtml(c.stance || "?")}</td>
      ${numCell(c.key, "lb", 0, 9)}${numCell(c.key, "bond", 0, 30)}
      ${numCell(c.key, "a1", 1, 10)}${numCell(c.key, "a2", 1, 10)}${numCell(c.key, "a3", 1, 10)}
      <td class="prop">${escapeHtml(c.prop ? c.prop.desc : "")}</td>
    </tr>`);
  }
  $("rows").innerHTML = frag.join("");
  renderStats();
}

function renderStats(): void {
  let owned = 0, bond = 0, place = 0;
  for (const c of CHARS) {
    const e = state.chars[c.key];
    if (e && e.o) { owned++; bond += e.bond; if (e.bond >= 1) place++; }
  }
  $("stOwned").textContent = owned + "/" + CHARS.length;
  $("stBond").textContent = String(bond);
  $("stPlace").textContent = String(place);
}

async function copyText(text: string, btn: HTMLElement, okLabel: string): Promise<void> {
  const orig = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = okLabel;
  } catch {
    ($("ioBox") as HTMLDetailsElement).open = true;
    ($("ioText") as HTMLTextAreaElement).value = text;
    btn.textContent = "下の欄からコピーしてください";
  }
  setTimeout(() => { btn.textContent = orig; }, 1800);
}

export function initRoster(): void {
  $("rows").addEventListener("change", ev => {
    const t = ev.target as HTMLInputElement;
    const k = t.dataset.k, f = t.dataset.f;
    if (!k || !f) return;
    const e = entry(k);
    if (f === "o") { e.o = t.checked; renderRoster(); }
    else {
      const min = +t.min, max = +t.max;
      let v = Math.round(+t.value || 0);
      v = Math.max(min, Math.min(max, v));
      t.value = String(v);
      (e as any)[f] = v;
      renderStats();
    }
    save();
  });

  $("syncLv").addEventListener("change", ev => {
    const t = ev.target as HTMLInputElement;
    state.sync = Math.max(1, Math.min(120, Math.round(+t.value || 60)));
    t.value = String(state.sync);
    save();
  });
  $("barLv").addEventListener("change", ev => {
    state.bar = +(ev.target as HTMLSelectElement).value;
    save();
  });

  $("filters").addEventListener("click", ev => {
    const b = (ev.target as HTMLElement).closest(".chip") as HTMLElement | null;
    if (!b) return;
    const f = b.dataset.f!, v = b.dataset.v!;
    b.classList.toggle("on");
    if (f === "owned") filter.owned = b.classList.contains("on");
    else {
      const set = f === "rarity" ? filter.rarity : filter.stance;
      b.classList.contains("on") ? set.add(v) : set.delete(v);
    }
    renderRoster();
  });
  $("q").addEventListener("input", ev => {
    filter.q = (ev.target as HTMLInputElement).value.trim();
    renderRoster();
  });

  $("copyCsv").addEventListener("click", ev => {
    const n = toCsv().split("\n").length - 1;
    copyText(toCsv(), ev.target as HTMLElement, `コピーしました（${n}人）`);
  });
  $("copyJson").addEventListener("click", ev =>
    copyText(JSON.stringify(state), ev.target as HTMLElement, "コピーしました"));
  $("showImport").addEventListener("click", () => {
    ($("ioBox") as HTMLDetailsElement).open = true;
    $("ioText").focus();
  });
  $("doImport").addEventListener("click", () => {
    const txt = ($("ioText") as HTMLTextAreaElement).value.trim();
    if (!txt) return;
    try {
      const s = JSON.parse(txt);
      if (!s || typeof s !== "object" || typeof s.chars !== "object") throw new Error();
      replaceState({ sync: s.sync || 60, bar: s.bar || 3, chars: s.chars });
      ($("syncLv") as HTMLInputElement).value = String(state.sync);
      ($("barLv") as HTMLSelectElement).value = String(state.bar);
      renderRoster();
      save();
      setSaved("読み込みました");
    } catch {
      setSaved("読み込み失敗: JSONの形式が不正です");
    }
  });
  $("reset").addEventListener("click", () => {
    if (!confirm("すべての入力を消去します。よろしいですか？")) return;
    replaceState({ sync: 60, bar: 3, chars: {} });
    ($("syncLv") as HTMLInputElement).value = "60";
    ($("barLv") as HTMLSelectElement).value = "3";
    renderRoster();
    save();
  });

  /* ---- ローカルAPIモード限定機能: 画像アップロードとgit同期 ---- */
  if (apiMode) {
    let uploadKey: string | null = null;
    const fileInput = $("imgFile") as HTMLInputElement;
    $("rows").addEventListener("click", ev => {
      const td = (ev.target as HTMLElement).closest(".thumb.up") as HTMLElement | null;
      if (!td) return;
      uploadKey = td.dataset.imgk!;
      fileInput.value = "";
      fileInput.click();
    });
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files?.[0];
      if (!f || !uploadKey) return;
      const buf = await f.arrayBuffer();
      const res = await fetch(`api/image?key=${encodeURIComponent(uploadKey)}`, {
        method: "POST", body: buf,
      });
      if (res.ok) { imgBust = Date.now(); renderRoster(); setSaved("画像を保存しました"); }
      else setSaved("画像の保存に失敗しました");
    });

    const actions = document.querySelector("#pane-roster .actions")!;
    const syncBtn = document.createElement("button");
    syncBtn.className = "act ghost";
    syncBtn.textContent = "Claudeと同期 (git push)";
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = "同期中...";
      try {
        const r = await (await fetch("api/sync", { method: "POST" })).json();
        syncBtn.textContent = r.ok
          ? (r.committed ? "同期しました" : "変更なし(push済み)")
          : "pushに失敗（要ネットワーク/認証）";
      } catch {
        syncBtn.textContent = "同期に失敗しました";
      }
      setTimeout(() => {
        syncBtn.textContent = "Claudeと同期 (git push)";
        syncBtn.disabled = false;
      }, 2500);
    });
    actions.insertBefore(syncBtn, actions.children[1]);
  }

  ($("syncLv") as HTMLInputElement).value = String(state.sync);
  ($("barLv") as HTMLSelectElement).value = String(state.bar);
  renderRoster();
}
