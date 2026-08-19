#!/usr/bin/env python3
"""data/master/*.csv から web/src/data/characters.json を生成する。

マスターデータの単一ソースは data/master/。webの表示・計算用データは
必ずこのスクリプト経由で再生成する:  python3 tools/build_web_data.py
"""
import csv
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "web/src/data/characters.json"

DESC = {
    "grant_chain": lambda r: f"連鎖: {r['mark']}",
    "grant_faction": lambda r: f"{r['faction']}{r['param1']}体に{r['mark']}+{r['bonus_pct']}%",
    "buff_all": lambda r: f"全体+{r['bonus_pct']}%",
    "buff_good": lambda r: f"Good以上+{r['bonus_pct']}%",
    "buff_great": lambda r: f"Great以上+{r['bonus_pct']}%",
    "buff_scaled": lambda r: "評価比例+20/50%",
    "next_card": lambda r: f"次カード{r['mark']}固定+{r['bonus_pct']}%",
}


def main():
    chars = {}
    with open(REPO / "data/master/characters.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            key = f"【{r['title']}】{r['name']}"
            chars[key] = {
                "key": key, "title": r["title"], "name": r["name"],
                "rarity": r["rarity"], "faction": r["faction"],
                "element": r["element"], "stance": r["stance"],
                "emblem": r["emblem"], "weapon": r["weapon_type"],
            }

    merged, seen = [], set()
    with open(REPO / "data/master/brothel_proposals.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            name = r["name"]
            base = chars.get(name, {
                "key": name, "title": "", "name": name,
                "rarity": r["rarity"], "faction": r["faction"],
                "element": "", "stance": "", "emblem": "", "weapon": "",
            })
            base["prop"] = {
                "kind": r["kind"], "mark": r["mark"],
                "n": int(r["param1"]) if r["param1"] else 0,
                "bonus": float(r["bonus_pct"]) if r["bonus_pct"] else 0.0,
                "desc": DESC[r["kind"]](r),
            }
            merged.append(base)
            seen.add(name)

    for key, c in chars.items():
        if key not in seen:
            c["prop"] = None
            merged.append(c)

    order = {"SSR": 0, "SR": 1, "R": 2}
    merged.sort(key=lambda c: (order[c["rarity"]], c["key"]))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(merged, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    missing = [c["key"] for c in merged if not c.get("prop")]
    print(f"wrote {OUT} ({len(merged)} chars)" + (f", 提案なし: {missing}" if missing else ""))


if __name__ == "__main__":
    main()
