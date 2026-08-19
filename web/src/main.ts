import "./style.css";
import { hasSaved, loadState, setSaved, storageOk } from "./state";
import { initRouter } from "./router";
import { initRoster } from "./views/roster";
import { initOptimize } from "./views/optimize";
import { initAdvisor } from "./views/advisor";
import { $ } from "./util";

if (!storageOk) $("storageBanner").style.display = "block";

loadState();
initRoster();
initOptimize();
initAdvisor();
initRouter();

if (storageOk) setSaved(hasSaved() ? "保存済み" : "未入力");
