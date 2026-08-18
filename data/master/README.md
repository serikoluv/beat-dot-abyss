# マスターデータ

ゲーム仕様の構造化データ。**自分の所持状況（roster）はここに置かない**（`data/roster.yaml` 予定）。

## ファイル

- `characters.csv` — 全キャラの基本属性。
  出典: [wikiru キャラクター一覧](https://dotabyss.wikiru.jp/?%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC%E4%B8%80%E8%A6%A7)
  （表最終更新 2026-08-12 版を 2026-08-18 に取得）。
  - hp/atk/def は **Lv30+5凸のベース値**（アビリティ・施設補正を除く）。空欄はwiki未記入。
  - emblem は element から導出可能（火水土→情熱、光闇無→衝撃）だが利便のため列を持つ。
  - **未収録**: 2026-08-15 実装【降り注ぐ灼熱の断罪】ヘイリー（wiki側の表が未更新だった）。

## 今後追加予定

- `mana_crystals.yaml` — 全11種（抽出済み、構造化待ち）
- `equipment_weapons.yaml` / `equipment_armor.yaml`（16種抽出済み）/ `equipment_accessories.yaml`（11種抽出済み）
- `skills/` — キャラ別のスキル・アビリティ効果データ（スキーマは docs/design/character-schema.md）
- `events.csv` — イベント開催履歴（14回分抽出済み）
- `contents.yaml` — コンテンツ別の制約・報酬定義
