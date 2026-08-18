# キャラクターデータ設計 v1.0

2026-08-18 確定。一次ソース（wikiru の実ページ構造・全キャラ一覧・個別キャラページ雛形）の
検証に基づく。v0.1 ドラフトからの主な変更: 紋章の二重構造化、スキル/アビリティの
レベル段階テーブルの実仕様反映、存在しない概念（潜在等）の削除。

## 設計原則（再確認）

1. **マスターデータと所持状態（roster）の分離**
2. 効果は「wiki原文（正規化済み）」＋「機械可読 effects」の二本立て。パース済みか
   どうかを `parsed` で明示
3. 全レコードに `source` / `as_of`。効果値は**テキスト由来**であり実挙動と乖離しうる
   （バグ多発ゲー）ため、実測検証済みの値には `verified: true` を付ける
4. レベル段階で変わる値は段階テーブルで持つ

## キャラクター（data/master/characters/<id>.yaml）

```yaml
id: nina_maid                  # ローマ字スラッグ。別衣装は別ID（別キャラとして扱う）
name: ニナ
title: 渚のメイド              # 【】内。同名別衣装の区別に必須
rarity: SSR                    # SSR | SR | R
faction: ペルディオン           # 5勢力。勢力クエスト/深淵ミッション縛りに使用
element: 無                    # 火|水|土|光|闇|無
emblem: 衝撃                   # element から導出（火水土→情熱、光闇無→衝撃）。検証用に保持
stance: バック                 # フロント|バック|アシスト
weapon_type: 弓                # 8種。スタンスと対応
armor_type: マント             # 鎧|マント|作業着|服
release_date: 2026-07-31
obtain: ピックアップガチャ      # 恒常/PU限定/交換所/クリア報酬/初心者ミッション
birthday: 08-08                # 誕生日イベント等の将来用（任意）
base_stats:                    # キャラ一覧の Lv30+5凸 ベース値
  hp: 3266
  atk: 1912                    # 魔導書キャラは回復性能を意味する
  def: 1242
detail_stats: null             # 15項目×(初期/最大)×(ベース/アビリティ補正)。wiki未記入のため
                               # 当面 null。ゲーム内実測で埋める枠（会心率/会心ダメ/連撃率/
                               # 回避率/弱点特攻/チャージ効率/耐性6種）

abilities:                     # 必ず3つ
  - name: バブルショット
    text: "【発動条件】通常攻撃を2回 【効果】次回の通常攻撃が【5HIT/合計{dmg}%】ダメージ　喪失【{dur}秒/成功率:30%】を付与　自身に紋章:衝撃を【1】付与に変化"
    levels:                    # Lv1〜10 の可変値のみ持つ（text 中の {} に対応）
      dmg: [80, 83.3, 86.6, 90, 96.6, 100, 103.3, 110, 113.3, 120]
      dur: [10, 10.4, 10.8, 11.2, 12, 12.5, 12.9, 13.7, 14.1, 15]
    awakenings:                # SSRのみ。凸段階がキー
      - lb: 1
        text: "自身の攻撃力と防御力と最大HPが【5%】上昇"
      - lb: 3
        text: "自身の攻撃力と防御力と最大HPが【9.5%】上昇"
    effects: []                # 機械可読表現（effects DSL、下記）。未パースなら空
    parsed: false

skill:                         # 必ず1つ
  name: ハイドロ・プレシジョン
  charge: 50                   # スキルゲージコスト
  text: "HPが最も高い敵1体に【1HIT/合計{dmg}%】ダメージ　喪失耐性DOWN【15%/{debuff_dur}秒】を付与　自身に紋章:衝撃を【1】付与"
  fc_text: "対象に喪失【{fc_dur}秒/成功率:50%】を付与　紋章:衝撃を5消費し、味方バック全体に喪失状態の敵に対して与ダメージUP【{fc_up}%/15秒】を付与"
  stages:                      # Lv1〜5 ＋ マナ覚醒1〜5（=5〜9凸）の10段階
    dmg:        [250, 297.6, 345.2, 392.8, 440.4, 452.3, 464.2, 476.1, 488, 500]
    debuff_dur: [7.5, 8.9, 10.3, 11.7, 13.1, 13.4, 13.7, 14, 14.3, 15]
    fc_dur:     [7.5, 8.9, 10.3, 11.7, 13.1, 13.4, 13.7, 14, 14.3, 15]
    fc_up:      [20, 23.8, 27.6, 31.4, 35.2, 36.1, 37, 37.9, 38.8, 40]
  effects: []
  fc_effects: []
  parsed: false

meta:
  sources:
    - https://dotabyss.wikiru.jp/?【渚のメイド】ニナ
  as_of: 2026-08-18
  notes: ""                    # 実測との乖離・バグ情報など
```

### 設計判断のポイント

- **可変値テンプレート方式**: wiki は各レベルの全文を10回繰り返すが、可変値だけ配列で
  持ち text 側に `{}` プレースホルダを置く。原文再現と機械処理を両立し、転記ミスを検出
  しやすい（配列は単調増加のはず）。
- **FC追加効果はスキルの従属フィールド**（`fc_text`/`fc_effects`）。FC評価はマナクリスタル
  ×参加者×紋章条件の合成なので、キャラ側は「参加時に何が起きるか」だけ持つ。
- **紋章は2箇所**: `emblem`（静的分類）と、effects 内の紋章操作（付与/消費/条件）。
- **評価・Tier はキャラファイルに書かない** → `docs/research/meta-environment.md` 側で
  日付付きで管理（陳腐化の速度が違うため）。

## effects DSL（最小セット、v1）

実際に観測された効果型のみ定義。増えたら追記:

```yaml
- {type: damage, target: <selector>, hits: 5, total_pct: 120, verified: false}
- {type: heal, target: <selector>, pct: 100}           # 攻撃力基準%
- {type: buff, target: <selector>, stat: atk, pct: 10, duration: 15, stack_max: 50}  # stack_max省略=累積不明
- {type: debuff, target: <selector>, stat: def, pct: 20, duration: 20}
- {type: status, target: <selector>, status: 喪失, duration: 7.5, success_pct: 50}
- {type: emblem_grant, target: <selector>, emblem: 衝撃, amount: 1, element_filter: [光,闇,無]}
- {type: emblem_consume, amount: 5}
- {type: mana_charge, amount: 2}
- {type: summon_token, hp_pct: 120, duration: 60}
- {type: trigger, on: <normal_attack_n|evade|interval_sec|fc_activate|emblem_ge|emblem_consume|heal_received|crit|kill>, value: ..., effects: [...]}
```

- `<selector>`: self / ally_all / ally_front / ally_back / ally_assist / enemy_one_maxhp /
  enemy_front_all / enemy_all / random_ally など、観測に合わせて追加
- **累積・時間延長の挙動はテキストから判別不能**（一次ソースで確認済みの罠）。
  `stack_max` 明記以外は `stacking: unknown` を既定とし、実測で更新する。

## roster（data/roster.yaml）

```yaml
sync_level: 66                 # レベルはシンクロで全体共有
commander:
  mana_crystals: {front: null, back: 情熱のマナクリスタル【崩壊】, assist: マナクリスタル【回復】}
  crystal_rank: 9              # 研究所の強化状況
characters:
  - id: nina_maid
    owned: true
    limit_break: 2             # 0〜9
    ability_levels: [10, 5, 5] # アビリティ1/2/3
    bond_level: 4
    bond_alloc: {hp: 0, atk: 5, def: 0, crit: 2}   # スタンスで許可項目が変わる
    awakening_alloc: {炎上耐性: 1}
    affection: 5               # 好感度（5で全アビリティ解放）
    equipment: {weapon: kokuoku_bow, armor: forest_mantle, accessory: kiga_monument}
```

## 編成評価に必要な周辺マスター

| ファイル | 内容 | 状態 |
|---|---|---|
| mana_crystals.yaml | 11種の効果・条件・オート発動条件 | 抽出済み・構造化待ち |
| equipment_*.yaml | 武器/防具16種/アクセ11種＋エンチャント | 同上 |
| contents.yaml | コンテンツ別制約（厄災の有効属性、クリスタルハントのアシスト限定等） | 同上 |
| events.csv | 開催履歴・形式・期間・限定装備 | 同上 |

## 次のステップ

1. 周辺マスター4種の構造化（抽出レポートから転記）
2. キャラ個別データの入力: まず環境コアの5体（ミルティーユ/メリッサ/シャノン/ヒナギ/
   エレクトラ）で effects DSL の表現力を検証 → 全キャラ展開
3. スコアラー実装（FC回転数×紋章条件充足×バフ累積の近似モデル）
4. roster 入力（ユーザーの所持状況ヒアリング）
