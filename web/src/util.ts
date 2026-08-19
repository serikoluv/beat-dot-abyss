export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
export const tick = () => new Promise<void>(r => setTimeout(r, 0));
export const $ = (id: string) => document.getElementById(id)!;
