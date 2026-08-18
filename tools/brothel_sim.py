#!/usr/bin/env python3
"""娼館（酒場）営業シミュレータ & スタッフ編成最適化

仕様の根拠: docs/research/brothel.md（wikiru 施設/娼館 + コメント欄検証）

スコアモデル:
  最終満足度 = Σ_i 初期値_i × (1 + カード%_i + 提案%_i + 評価ボーナス_i)
  初期値 = 200 + 絆Lv×10、評価ボーナス: GOOD(2マーク)=+20%, GREAT(3マーク)=+100%
  「Great以上+50%」系は使用時点の評価で判定（遡及なし）

使い方:
  python tools/brothel_sim.py --roster data/roster_brothel.csv
  python tools/brothel_sim.py --roster data/roster_brothel.csv --sims 2000 --top 5
"""
import argparse
import csv
import itertools
import random
import statistics
from pathlib import Path

MARKS = ["料理", "接客", "ドリンク"]
SOUL_CAP = 14070          # ソウル上限(864)ライン
REPO = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------- data loading

def load_proposals(path):
    props = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            props[row["name"]] = row
    return props


def load_roster(path):
    """CSV: name,bond  (name は brothel_proposals.csv の表記と一致させる)"""
    roster = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            roster.append({"name": row["name"].strip(), "bond": int(row["bond"])})
    return roster


class Staff:
    __slots__ = ("name", "faction", "kind", "mark", "param1", "bonus", "note",
                 "init", "marks", "pct", "used")

    def __init__(self, name, prop, bond):
        self.name = name
        self.faction = prop["faction"]
        self.kind = prop["kind"]
        self.mark = prop["mark"]
        self.param1 = int(prop["param1"]) if prop["param1"] else 0
        self.bonus = float(prop["bonus_pct"]) if prop["bonus_pct"] else 0.0
        self.note = prop["note"]
        self.init = 200 + bond * 10
        self.reset()

    def reset(self):
        self.marks = set()
        self.pct = 0.0
        self.used = False

    def eval_bonus(self):
        n = len(self.marks)
        return 100.0 if n >= 3 else (20.0 if n == 2 else 0.0)

    def final(self):
        return self.init * (1 + (self.pct + self.eval_bonus()) / 100.0)


# ---------------------------------------------------------------- simulation

class Sim:
    def __init__(self, staffs, turns=5, floors=3, rng=None,
                 card_weights=(1.0, 1.0, 1.0), proposal_factor=1.0):
        assert len(staffs) == floors * 3
        self.staffs = staffs
        self.turns = turns
        self.floors = floors
        self.rng = rng or random.Random()
        self.cw = card_weights          # (全体5%, フロア10%, 1か所80%)
        self.pf = proposal_factor       # 提案倍率の補正係数([?]要検証仕様用)
        self.forced_mark = None         # next_card の効果

    # --- カード ---------------------------------------------------------
    def deal_cards(self):
        cards = []
        for _ in range(3):
            kind = self.rng.choices(["all", "floor", "room"], weights=self.cw)[0]
            mark = self.forced_mark or self.rng.choice(MARKS)
            target = None
            if kind == "floor":
                target = self.rng.randrange(self.floors)
            elif kind == "room":
                target = self.rng.randrange(len(self.staffs))
            cards.append((kind, mark, target))
        return cards

    def card_targets(self, card):
        kind, _, target = card
        if kind == "all":
            return list(range(len(self.staffs)))
        if kind == "floor":
            return [target * 3 + k for k in range(3)]
        return [target]

    def card_value(self, card, turns_left):
        """カード選択ヒューリスティック: 即時% + マーク進行の期待評価ボーナス"""
        kind, mark, _ = card
        pct = {"all": 5, "floor": 10, "room": 80}[kind]
        v = 0.0
        for i in self.card_targets(card):
            s = self.staffs[i]
            v += s.init * pct / 100.0
            if mark not in s.marks:
                n = len(s.marks)
                gain = 20.0 if n == 1 else (80.0 if n == 2 else 8.0)
                v += s.init * gain / 100.0 * min(1.0, 0.5 + 0.25 * turns_left)
        return v

    def apply_card(self, card):
        kind, mark, _ = card
        pct = {"all": 5, "floor": 10, "room": 80}[kind]
        for i in self.card_targets(card):
            s = self.staffs[i]
            s.pct += pct
            s.marks.add(mark)

    # --- 提案 -----------------------------------------------------------
    def proposal_value(self, s, is_final_turn, turns_left):
        """提案の即時価値 + 将来価値ヒューリスティック"""
        pf = self.pf
        if s.kind == "buff_all":
            return sum(t.init for t in self.staffs) * s.bonus * pf / 100.0
        if s.kind == "buff_good":
            return sum(t.init for t in self.staffs if len(t.marks) >= 2) * s.bonus * pf / 100.0
        if s.kind == "buff_great":
            return sum(t.init for t in self.staffs if len(t.marks) >= 3) * s.bonus * pf / 100.0
        if s.kind == "buff_scaled":
            v = 0.0
            for t in self.staffs:
                if len(t.marks) >= 3:
                    v += t.init * 50 * pf / 100.0
                elif len(t.marks) == 2:
                    v += t.init * 20 * pf / 100.0
            return v
        if s.kind == "grant_chain":
            src, dst = s.mark.split("→")
            v = 0.0
            for t in self.staffs:
                if src in t.marks and dst not in t.marks:
                    n = len(t.marks)
                    v += t.init * (80.0 if n == 2 else 20.0) / 100.0
            return v
        if s.kind == "grant_faction":
            targets = [t for t in self.staffs if t.faction == s.faction]
            v = 0.0
            picked = 0
            for t in sorted(targets, key=lambda t: -t.init):
                if picked >= s.param1:
                    break
                gain = s.bonus * pf
                if s.mark not in t.marks:
                    n = len(t.marks)
                    gain += (80.0 if n == 2 else 25.0)
                v += t.init * gain / 100.0
                picked += 1
            return v
        if s.kind == "next_card":
            if is_final_turn and (s.bonus == 0):
                return -1.0          # R の next_card は最終ターン無効
            base = sum(t.init for t in self.staffs) * s.bonus * pf / 100.0
            need = sum(1 for t in self.staffs
                       if s.mark not in t.marks and len(t.marks) >= 1)
            return base + need * 120.0 * (0.0 if is_final_turn else 1.0)
        return 0.0

    def apply_proposal(self, s, is_final_turn):
        pf = self.pf
        s.used = True
        if s.kind == "buff_all":
            for t in self.staffs:
                t.pct += s.bonus * pf
        elif s.kind == "buff_good":
            for t in self.staffs:
                if len(t.marks) >= 2:
                    t.pct += s.bonus * pf
        elif s.kind == "buff_great":
            for t in self.staffs:
                if len(t.marks) >= 3:
                    t.pct += s.bonus * pf
        elif s.kind == "buff_scaled":
            for t in self.staffs:
                if len(t.marks) >= 3:
                    t.pct += 50 * pf
                elif len(t.marks) == 2:
                    t.pct += 20 * pf
        elif s.kind == "grant_chain":
            src, dst = s.mark.split("→")
            for t in self.staffs:
                if src in t.marks:
                    t.marks.add(dst)
        elif s.kind == "grant_faction":
            targets = [t for t in self.staffs if t.faction == s.faction]
            self.rng.shuffle(targets)
            for t in targets[: s.param1]:
                t.marks.add(s.mark)
                t.pct += s.bonus * pf
        elif s.kind == "next_card":
            if not is_final_turn:
                self.forced_mark = s.mark
            for t in self.staffs:
                t.pct += s.bonus * pf

    # --- 1営業 ----------------------------------------------------------
    def run(self):
        for s in self.staffs:
            s.reset()
        self.forced_mark = None
        for turn in range(self.turns):
            is_final = turn == self.turns - 1
            turns_left = self.turns - turn - 1
            cards = self.deal_cards()
            self.forced_mark = None      # 効果は配布1回分
            card = max(cards, key=lambda c: self.card_value(c, turns_left))
            self.apply_card(card)
            cands = [s for s in self.staffs if not s.used]
            if cands:
                best = max(cands,
                           key=lambda s: self.proposal_value(s, is_final, turns_left))
                if self.proposal_value(best, is_final, turns_left) > 0:
                    self.apply_proposal(best, is_final)
        return sum(s.final() for s in self.staffs)


# ---------------------------------------------------------------- optimizer

STATIC_WEIGHT = {  # 提案類型の静的評価（候補絞り込み用）
    "grant_chain": 100, "buff_great": 80, "buff_scaled": 90,
    "buff_all": 60, "buff_good": 50, "next_card": 40, "grant_faction": 45,
}


def static_score(prop, bond):
    w = STATIC_WEIGHT.get(prop["kind"], 30)
    bonus = float(prop["bonus_pct"] or 0)
    return w + bonus * 0.8 + bond * 3


def evaluate_deck(staff_list, sims, seed, **kw):
    rng = random.Random(seed)
    sim = Sim(staff_list, rng=rng, **kw)
    scores = [sim.run() for _ in range(sims)]
    scores.sort()
    n = len(scores)
    return {
        "mean": statistics.fmean(scores),
        "p50": scores[n // 2],
        "p10": scores[n // 10],
        "cap_rate": sum(1 for x in scores if x >= SOUL_CAP) / n,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--roster", required=True, help="CSV: name,bond")
    ap.add_argument("--proposals", default=str(REPO / "data/master/brothel_proposals.csv"))
    ap.add_argument("--sims", type=int, default=1000, help="上位デッキの本評価シミュレーション回数")
    ap.add_argument("--screen-sims", type=int, default=120, help="1次スクリーニングの回数")
    ap.add_argument("--pool", type=int, default=14, help="候補プール人数(C(pool,9)を全列挙)")
    ap.add_argument("--top", type=int, default=5)
    ap.add_argument("--turns", type=int, default=5, help="酒場Lv3=5, Lv2=4")
    ap.add_argument("--floors", type=int, default=3, help="酒場Lv3=3, Lv2=2")
    ap.add_argument("--proposal-factor", type=float, default=1.0,
                    help="提案倍率の補正([?]仕様検証用。実測が低めなら0.6等)")
    ap.add_argument("--card-weights", default="1,1,1", help="全体5%%,フロア10%%,1か所80%% の出現重み")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    props = load_proposals(args.proposals)
    roster = load_roster(args.roster)
    cw = tuple(float(x) for x in args.card_weights.split(","))
    n_rooms = args.floors * 3

    staffs_all = []
    for r in roster:
        if r["name"] not in props:
            raise SystemExit(f"未知のキャラ名: {r['name']}（brothel_proposals.csv の表記と一致させてください）")
        staffs_all.append((r["name"], r["bond"]))

    if len(staffs_all) < n_rooms:
        raise SystemExit(f"配置可能スタッフが{len(staffs_all)}人で部屋数{n_rooms}に足りません")

    # 1次: 静的スコアで候補プールを絞る
    ranked = sorted(staffs_all, key=lambda x: -static_score(props[x[0]], x[1]))
    pool = ranked[: max(args.pool, n_rooms)]
    print(f"候補プール({len(pool)}人): " + ", ".join(f"{n}(絆{b})" for n, b in pool))

    kw = dict(turns=args.turns, floors=args.floors,
              card_weights=cw, proposal_factor=args.proposal_factor)

    def build(names_bonds):
        return [Staff(n, props[n], b) for n, b in names_bonds]

    # 2次: プール内の9人組を全列挙して粗評価
    combos = list(itertools.combinations(pool, n_rooms))
    print(f"デッキ候補 {len(combos)} 件を粗評価中(各{args.screen_sims}回)...")
    screened = []
    for idx, combo in enumerate(combos):
        r = evaluate_deck(build(combo), args.screen_sims, args.seed + idx, **kw)
        screened.append((r["mean"], combo))
    screened.sort(key=lambda x: -x[0])

    # 3次: 上位を本評価
    finalists = screened[: max(args.top * 4, 20)]
    print(f"上位{len(finalists)}件を本評価中(各{args.sims}回)...")
    results = []
    for i, (_, combo) in enumerate(finalists):
        r = evaluate_deck(build(combo), args.sims, args.seed + 10_000 + i, **kw)
        results.append((r, combo))
    results.sort(key=lambda x: (-x[0]["cap_rate"], -x[0]["p10"]))

    print("\n=== 推奨スタッフ編成（安定性=ソウル上限14070到達率 順）===")
    for rank, (r, combo) in enumerate(results[: args.top], 1):
        names = ", ".join(f"{n}(絆{b})" for n, b in combo)
        print(f"\n#{rank}  上限到達率 {r['cap_rate']*100:.0f}%  "
              f"中央値 {r['p50']:.0f}  下振れ(P10) {r['p10']:.0f}  平均 {r['mean']:.0f}")
        print(f"    {names}")


if __name__ == "__main__":
    main()
