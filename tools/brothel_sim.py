#!/usr/bin/env python3
"""娼館（酒場）営業シミュレータ / スタッフ編成最適化 / 対話型アドバイザ

仕様の根拠: docs/research/brothel.md（wikiru 施設/娼館 + コメント欄検証）

スコアモデル:
  最終満足度 = Σ_i 初期値_i × (1 + カード%_i + 提案%_i + 評価ボーナス_i)
  初期値 = 200 + 絆Lv×10、評価ボーナス: GOOD(2マーク)=+20%, GREAT(3マーク)=+100%
  「Great以上+50%」系は使用時点の評価で判定（遡及なし）

使い方:
  # 手持ちから9人の推奨編成を導出（greedy/simple両方針で評価）
  python tools/brothel_sim.py optimize --roster data/roster_brothel.csv

  # 営業中にターンごとの最適手を提示（配られたカードを入力する）
  python tools/brothel_sim.py advise --roster data/roster_brothel.csv \
      --deck "【清流の祈り手】ヒナギ,【作られし愛娘】ウェンディ,..."  # 9人

方針(policy):
  greedy : 各ターンでヒューリスティック評価が最大の手を選ぶ（上手いプレイの近似）
  simple : 人間が暗記できる固定ルール（下記）。編成評価はこちらも表示する
    [カード] 全体5% > 1か所80% > フロア10%。同種なら「あと1種でGREATになる人が多い色」
    [提案]   前半: 連鎖付与・勢力付与・カード操作でマークを揃える
             後半: Great+50% → シルヴィア → 全体+20% → Good+20% の順に撃つ
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

    def snapshot(self):
        return (set(self.marks), self.pct, self.used)

    def restore(self, snap):
        self.marks, self.pct, self.used = set(snap[0]), snap[1], snap[2]


# ---------------------------------------------------------------- simulation

class Sim:
    def __init__(self, staffs, turns=5, floors=3, rng=None,
                 card_weights=(1.0, 1.0, 1.0), proposal_factor=1.0,
                 policy="greedy"):
        assert len(staffs) == floors * 3
        self.staffs = staffs
        self.turns = turns
        self.floors = floors
        self.rng = rng or random.Random()
        self.cw = card_weights          # (全体5%, フロア10%, 1か所80%)
        self.pf = proposal_factor       # 提案倍率の補正係数([?]要検証仕様用)
        self.policy = policy
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

    def card_value_simple(self, card):
        """固定ルール: 全体 > 1か所80 > フロア。同種は『リーチの人が多い色』"""
        kind, mark, _ = card
        kind_rank = {"all": 300, "room": 200, "floor": 100}[kind]
        reach = sum(1 for i in self.card_targets(card)
                    if mark not in self.staffs[i].marks
                    and len(self.staffs[i].marks) == 2)
        fresh = sum(1 for i in self.card_targets(card)
                    if mark not in self.staffs[i].marks)
        return kind_rank + reach * 10 + fresh

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

    def proposal_value_simple(self, s, is_final_turn, turns_left):
        """固定ルール: 前半=マーク作り、後半=バフ撃ち。人間が再現できる優先度"""
        setup_phase = turns_left >= 2   # 残り3ターン以上を「前半」とする
        if s.kind in ("grant_chain", "grant_faction", "next_card"):
            if s.kind == "next_card" and is_final_turn and s.bonus == 0:
                return -1.0
            rank = {"grant_chain": 30, "grant_faction": 20, "next_card": 10}[s.kind]
            gain = self.proposal_value(s, is_final_turn, turns_left)
            return (1000 + rank if setup_phase else 100) + gain * 0.001
        rank = {"buff_great": 40, "buff_scaled": 30, "buff_all": 20,
                "buff_good": 10}.get(s.kind, 0)
        gain = self.proposal_value(s, is_final_turn, turns_left)
        if gain <= 0:
            return 0.0
        return (100 if setup_phase else 1000) + rank + gain * 0.001

    def apply_proposal(self, s, is_final_turn, forced_targets=None):
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
            if forced_targets is not None:
                targets = forced_targets
            else:
                targets = [t for t in self.staffs if t.faction == s.faction]
                self.rng.shuffle(targets)
                targets = targets[: s.param1]
            for t in targets:
                t.marks.add(s.mark)
                t.pct += s.bonus * pf
        elif s.kind == "next_card":
            if not is_final_turn:
                self.forced_mark = s.mark
            for t in self.staffs:
                t.pct += s.bonus * pf

    # --- 1営業 ----------------------------------------------------------
    def choose_card(self, cards, turns_left):
        if self.policy == "simple":
            return max(cards, key=self.card_value_simple)
        return max(cards, key=lambda c: self.card_value(c, turns_left))

    def choose_proposal(self, is_final, turns_left):
        cands = [s for s in self.staffs if not s.used]
        if not cands:
            return None
        vf = (self.proposal_value_simple if self.policy == "simple"
              else self.proposal_value)
        best = max(cands, key=lambda s: vf(s, is_final, turns_left))
        return best if vf(best, is_final, turns_left) > 0 else None

    def run(self):
        for s in self.staffs:
            s.reset()
        self.forced_mark = None
        for turn in range(self.turns):
            is_final = turn == self.turns - 1
            turns_left = self.turns - turn - 1
            cards = self.deal_cards()
            self.forced_mark = None      # 効果は配布1回分
            self.apply_card(self.choose_card(cards, turns_left))
            best = self.choose_proposal(is_final, turns_left)
            if best is not None:
                self.apply_proposal(best, is_final)
        return sum(s.final() for s in self.staffs)

    # --- 状態の保存/復元（アドバイザのロールアウト用）-------------------
    def snapshot(self):
        return ([s.snapshot() for s in self.staffs], self.forced_mark)

    def restore(self, snap):
        for s, sn in zip(self.staffs, snap[0]):
            s.restore(sn)
        self.forced_mark = snap[1]

    def rollout(self, turns_left):
        """現状態から残りターンを方針プレイで消化し最終スコアを返す"""
        for k in range(turns_left):
            is_final = k == turns_left - 1
            tl = turns_left - k - 1
            cards = self.deal_cards()
            self.forced_mark = None
            self.apply_card(self.choose_card(cards, tl))
            best = self.choose_proposal(is_final, tl)
            if best is not None:
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


def evaluate_deck(staff_list, sims, seed, policy="greedy", **kw):
    rng = random.Random(seed)
    sim = Sim(staff_list, rng=rng, policy=policy, **kw)
    scores = [sim.run() for _ in range(sims)]
    scores.sort()
    n = len(scores)
    return {
        "mean": statistics.fmean(scores),
        "p50": scores[n // 2],
        "p10": scores[n // 10],
        "cap_rate": sum(1 for x in scores if x >= SOUL_CAP) / n,
    }


def cmd_optimize(args, props):
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

    ranked = sorted(staffs_all, key=lambda x: -static_score(props[x[0]], x[1]))
    pool = ranked[: max(args.pool, n_rooms)]
    print(f"候補プール({len(pool)}人): " + ", ".join(f"{n}(絆{b})" for n, b in pool))

    kw = dict(turns=args.turns, floors=args.floors,
              card_weights=cw, proposal_factor=args.proposal_factor)

    def build(names_bonds):
        return [Staff(n, props[n], b) for n, b in names_bonds]

    combos = list(itertools.combinations(pool, n_rooms))
    print(f"デッキ候補 {len(combos)} 件を粗評価中(各{args.screen_sims}回)...")
    screened = []
    for idx, combo in enumerate(combos):
        r = evaluate_deck(build(combo), args.screen_sims, args.seed + idx, **kw)
        screened.append((r["mean"], combo))
    screened.sort(key=lambda x: -x[0])

    finalists = screened[: max(args.top * 4, 20)]
    print(f"上位{len(finalists)}件を本評価中(各{args.sims}回 × greedy/simple)...")
    results = []
    for i, (_, combo) in enumerate(finalists):
        rg = evaluate_deck(build(combo), args.sims, args.seed + 10_000 + i,
                           policy="greedy", **kw)
        rs = evaluate_deck(build(combo), args.sims, args.seed + 20_000 + i,
                           policy="simple", **kw)
        results.append((rg, rs, combo))
    # 「固定ルールでも出る成績」を主基準にする（プレイ精度への頑健性重視）
    results.sort(key=lambda x: (-x[1]["cap_rate"], -x[1]["p10"], -x[0]["p10"]))

    print("\n=== 推奨スタッフ編成（simple=固定ルールプレイの成績を主基準）===")
    print(f"  ソウル上限ライン: {SOUL_CAP}")
    for rank, (rg, rs, combo) in enumerate(results[: args.top], 1):
        names = ", ".join(f"{n}(絆{b})" for n, b in combo)
        print(f"\n#{rank}")
        print(f"  simple : 上限到達率 {rs['cap_rate']*100:.0f}%  中央値 {rs['p50']:.0f}  下振れP10 {rs['p10']:.0f}")
        print(f"  greedy : 上限到達率 {rg['cap_rate']*100:.0f}%  中央値 {rg['p50']:.0f}  下振れP10 {rg['p10']:.0f}")
        print(f"  {names}")
    print("\n[simpleルール] カード: 全体5% > 1か所80% > フロア10%（同種なら残り1種でGREATの人が多い色）")
    print("[simpleルール] 提案: 前半=連鎖付与→勢力付与→カード操作 / 後半=Great+50%→シルヴィア→全体+20%→Good+20%")


# ---------------------------------------------------------------- advisor

KIND_KEY = {"z": "all", "f": "floor", "h": "room",
            "全": "all", "フ": "floor", "1": "room"}
MARK_KEY = {"r": "料理", "s": "接客", "d": "ドリンク",
            "り": "料理", "せ": "接客", "ど": "ドリンク"}


def parse_card(text, floors, n_rooms):
    """入力例: 'z r' (全体5%料理) / 'f s 2' (フロア2に接客10%) / 'h d 5' (部屋5にドリンク80%)"""
    parts = text.strip().split()
    if len(parts) < 2:
        raise ValueError("形式: 種類 マーク [対象番号]  例: z r / f s 2 / h d 5")
    kind = KIND_KEY.get(parts[0][0])
    mark = MARK_KEY.get(parts[1][0])
    if kind is None or mark is None:
        raise ValueError("種類=z(全体)/f(フロア)/h(1か所)、マーク=r(料理)/s(接客)/d(ドリンク)")
    target = None
    if kind == "floor":
        target = int(parts[2]) - 1
        if not (0 <= target < floors):
            raise ValueError(f"フロア番号は1〜{floors}")
    elif kind == "room":
        target = int(parts[2]) - 1
        if not (0 <= target < n_rooms):
            raise ValueError(f"部屋番号は1〜{n_rooms}")
    return (kind, mark, target)


def expectimax_choice(sim, cards, turns_left, is_final, rollouts):
    """(カード, 提案)の全ペアをロールアウト平均で評価して最良手を返す"""
    base = sim.snapshot()
    best = None
    for card in cards:
        sim.restore(base)
        sim.apply_card(card)
        after_card = sim.snapshot()
        cands = [s for s in sim.staffs if not s.used] + [None]
        for prop in cands:
            sim.restore(after_card)
            if prop is not None:
                if sim.proposal_value(prop, is_final, turns_left) <= 0 and prop.kind != "next_card":
                    continue
                sim.apply_proposal(prop, is_final)
            state = sim.snapshot()
            if turns_left == 0:
                avg = sum(s.final() for s in sim.staffs)
            else:
                total = 0.0
                for _ in range(rollouts):
                    sim.restore(state)
                    total += sim.rollout(turns_left)
                avg = total / rollouts
            if best is None or avg > best[0]:
                best = (avg, card, prop)
    sim.restore(base)
    return best


def fmt_card(card, staffs):
    kind, mark, target = card
    if kind == "all":
        return f"全体5% [{mark}]"
    if kind == "floor":
        return f"フロア{target+1}に10% [{mark}]"
    return f"部屋{target+1}({staffs[target].name})に80% [{mark}]"


def cmd_advise(args, props):
    roster = {r["name"]: r["bond"] for r in load_roster(args.roster)}
    deck_names = [n.strip() for n in args.deck.split(",")]
    n_rooms = args.floors * 3
    if len(deck_names) != n_rooms:
        raise SystemExit(f"--deck には{n_rooms}人をカンマ区切りで指定してください（現在{len(deck_names)}人）")
    staffs = []
    for n in deck_names:
        if n not in props:
            raise SystemExit(f"未知のキャラ名: {n}")
        if n not in roster:
            raise SystemExit(f"ロスターに絆Lvがありません: {n}")
        staffs.append(Staff(n, props[n], roster[n]))

    cw = tuple(float(x) for x in args.card_weights.split(","))
    sim = Sim(staffs, turns=args.turns, floors=args.floors,
              card_weights=cw, proposal_factor=args.proposal_factor,
              rng=random.Random(args.seed))

    print("=== 娼館アドバイザ ===")
    print("部屋割り（フロアはこの並びで1-3, 4-6, 7-9）:")
    for i, s in enumerate(staffs):
        print(f"  部屋{i+1}: {s.name}（初期{s.init:.0f} / {s.faction}）")
    print("\nカード入力: 種類 マーク [対象]  例: 'z r'=全体5%料理, 'f s 2'=フロア2接客, 'h d 5'=部屋5ドリンク")

    for turn in range(args.turns):
        is_final = turn == args.turns - 1
        turns_left = args.turns - turn - 1
        print(f"\n----- ターン {turn+1}/{args.turns} -----")
        cards = []
        while len(cards) < 3:
            try:
                text = input(f"配られたカード{len(cards)+1}: ")
                cards.append(parse_card(text, args.floors, n_rooms))
            except (ValueError, IndexError) as e:
                print(f"  ! {e}")
        sim.forced_mark = None
        avg, card, prop = expectimax_choice(sim, cards, turns_left, is_final,
                                            args.rollouts)
        print(f"\n>>> 推奨カード: {fmt_card(card, staffs)}")
        if prop is not None:
            desc = {
                "grant_chain": f"連鎖付与 {prop.mark}",
                "grant_faction": f"{prop.faction}最大{prop.param1}体に{prop.mark}付与+{prop.bonus:.0f}%",
                "buff_all": f"全スタッフ+{prop.bonus:.0f}%",
                "buff_good": f"Good以上+{prop.bonus:.0f}%",
                "buff_great": f"Great以上+{prop.bonus:.0f}%",
                "buff_scaled": "評価に応じ+20/50%",
                "next_card": f"次カードを{prop.mark}に固定+{prop.bonus:.0f}%",
            }.get(prop.kind, prop.kind)
            print(f">>> 推奨提案  : {prop.name}（{desc}）")
        else:
            print(">>> 推奨提案  : 温存（有効な提案なし）")
        print(f"    期待最終スコア ≈ {avg:.0f}")

        sim.apply_card(card)
        if prop is not None:
            forced = None
            if prop.kind == "grant_faction":
                eligible = [t for t in sim.staffs if t.faction == prop.faction]
                if len(eligible) > prop.param1:
                    print(f"    ※{prop.faction}のスタッフが{len(eligible)}人いるため付与先はランダムです。")
                    nums = input(f"    実際に付与された部屋番号を空白区切りで（最大{prop.param1}件、Enterでランダム扱い）: ").split()
                    if nums:
                        forced = [sim.staffs[int(x) - 1] for x in nums]
            sim.apply_proposal(prop, is_final, forced_targets=forced)

        cur = sum(s.final() for s in sim.staffs)
        greats = sum(1 for s in sim.staffs if len(s.marks) >= 3)
        goods = sum(1 for s in sim.staffs if len(s.marks) == 2)
        print(f"    現況: スコア(確定分) {cur:.0f} / GREAT {greats}人 / GOOD {goods}人")

    final = sum(s.final() for s in sim.staffs)
    print(f"\n=== 最終スコア(モデル値): {final:.0f}  {'★ソウル上限達成' if final >= SOUL_CAP else ''} ===")


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")

    def common(p):
        p.add_argument("--roster", required=True, help="CSV: name,bond")
        p.add_argument("--proposals", default=str(REPO / "data/master/brothel_proposals.csv"))
        p.add_argument("--turns", type=int, default=5, help="酒場Lv3=5, Lv2=4")
        p.add_argument("--floors", type=int, default=3, help="酒場Lv3=3, Lv2=2")
        p.add_argument("--proposal-factor", type=float, default=1.0,
                       help="提案倍率の補正([?]仕様検証用。実測が低めなら0.6等)")
        p.add_argument("--card-weights", default="1,1,1",
                       help="全体5%%,フロア10%%,1か所80%% の出現重み")
        p.add_argument("--seed", type=int, default=42)

    po = sub.add_parser("optimize", help="手持ちから推奨9人編成を導出")
    common(po)
    po.add_argument("--sims", type=int, default=1000)
    po.add_argument("--screen-sims", type=int, default=120)
    po.add_argument("--pool", type=int, default=14)
    po.add_argument("--top", type=int, default=5)

    pa = sub.add_parser("advise", help="営業中のターンごとに最適手を提示（対話型）")
    common(pa)
    pa.add_argument("--deck", required=True, help="配置9人をカンマ区切り（部屋1〜9の順）")
    pa.add_argument("--rollouts", type=int, default=300,
                    help="1手あたりの先読みロールアウト数")

    args = ap.parse_args()
    if args.cmd is None:
        ap.print_help()
        raise SystemExit(1)
    props = load_proposals(args.proposals)
    if args.cmd == "optimize":
        cmd_optimize(args, props)
    else:
        cmd_advise(args, props)


if __name__ == "__main__":
    main()
