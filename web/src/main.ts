import "./style.css";
import { hasSaved, loadState, setSaved, storageOk } from "./state";
import { initRouter } from "./router";
import { initRoster } from "./views/roster";
import { initOptimize } from "./views/optimize";
import { initAdvisor } from "./views/advisor";
import { initGuide } from "./views/guide";
import { $ } from "./util";

(async () => {
  await loadState();
  const { apiMode } = await import("./state");
  if (!storageOk && !apiMode) $("storageBanner").style.display = "block";
  initRoster();
  initOptimize();
  initAdvisor();
  initGuide();
  initRouter();
  if (apiMode) setSaved("ローカルファイル同期モード");
  else if (storageOk) setSaved(hasSaved() ? "保存済み" : "未入力");
})();
