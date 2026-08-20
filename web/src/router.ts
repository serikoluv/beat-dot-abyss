import { renderAdvPicker } from "./views/advisor";

const TABS = ["roster", "opt", "adv", "guide"] as const;
type Tab = (typeof TABS)[number];

function activate(tab: Tab): void {
  document.querySelectorAll<HTMLElement>(".tab").forEach(t =>
    t.classList.toggle("on", t.dataset.tab === tab));
  document.querySelectorAll<HTMLElement>(".tabpane").forEach(p =>
    p.classList.toggle("on", p.id === "pane-" + tab));
  if (tab === "adv") renderAdvPicker();
}

function fromHash(): Tab {
  const h = location.hash.replace(/^#\/?/, "");
  return (TABS as readonly string[]).includes(h) ? (h as Tab) : "roster";
}

export function go(tab: Tab): void {
  location.hash = "#/" + tab;
}

export function initRouter(): void {
  document.querySelector(".tabs")!.addEventListener("click", ev => {
    const b = (ev.target as HTMLElement).closest(".tab") as HTMLElement | null;
    if (!b) return;
    go(b.dataset.tab as Tab);
  });
  window.addEventListener("hashchange", () => activate(fromHash()));
  activate(fromHash());
}
