import { CHARS } from "./data";
import { $ } from "./util";

export interface Entry { o: boolean; lb: number; bond: number; a1: number; a2: number; a3: number; }
export interface AppState { sync: number; bar: number; chars: Record<string, Entry>; }

const LS_KEY = "dotabyss-roster-v1";

export let storageOk = true;
try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); }
catch { storageOk = false; }

export const defaultEntry = (): Entry => ({ o: false, lb: 0, bond: 0, a1: 1, a2: 1, a3: 1 });

export let state: AppState = { sync: 60, bar: 3, chars: {} };

/* ローカルAPI（vite.config.tsのlocalApiプラグイン）が生えている環境では
   data/roster.json を正とし、無い環境（Artifact/file://）ではlocalStorageで動く */
export let apiMode = false;

export async function loadState(): Promise<void> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch("api/roster", { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok && (res.headers.get("content-type") || "").includes("json")) {
      const s = await res.json();
      if (s && typeof s.chars === "object") {
        apiMode = true;
        state = { sync: s.sync || 60, bar: s.bar || 3, chars: s.chars };
        return;
      }
    }
  } catch { /* API無し → localStorageへフォールバック */ }
  if (!storageOk) return;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && typeof s === "object") {
        state = Object.assign(state, s);
        state.chars = s.chars || {};
      }
    }
  } catch { /* 壊れた保存データは無視 */ }
}

export function replaceState(s: AppState): void { state = s; }

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function save(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (storageOk) localStorage.setItem(LS_KEY, JSON.stringify(state));
    if (apiMode) {
      fetch("api/roster", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(state),
      }).then(r => setSaved(r.ok ? "保存済み(ファイル)" : "ファイル保存失敗"))
        .catch(() => setSaved("ファイル保存失敗"));
    } else if (storageOk) {
      setSaved("保存済み");
    } else {
      setSaved("手動バックアップ推奨");
    }
  }, 300);
}

export function setSaved(t: string): void {
  const el = $("saveState");
  el.textContent = t;
  el.classList.add("saved");
}

export function hasSaved(): boolean {
  return storageOk && localStorage.getItem(LS_KEY) !== null;
}

export function entry(key: string): Entry {
  if (!state.chars[key]) state.chars[key] = defaultEntry();
  return state.chars[key];
}

export function ownedPlaceable(): { key: string; bond: number }[] {
  const out: { key: string; bond: number }[] = [];
  for (const c of CHARS) {
    const e = state.chars[c.key];
    if (e && e.o && e.bond >= 1) out.push({ key: c.key, bond: e.bond });
  }
  return out;
}

export function toCsv(): string {
  const lines = ["name,bond"];
  for (const c of CHARS) {
    const e = state.chars[c.key];
    if (e && e.o && e.bond >= 1) lines.push(`${c.key},${e.bond}`);
  }
  return lines.join("\n");
}
