# 情報ソース一覧と参照ポリシー

## 参照優先度

| 優先度 | 種別 | サイト | 備考 |
|---|---|---|---|
| ★★★ | 個人・非商用 | [ドットアビスX攻略 Wiki (wikiru)](https://dotabyss.wikiru.jp/) | 最重要ソース。**現状セッション環境からアクセス不可（要ネットワーク許可）** |
| ★★★ | 個人・非商用 | [醜女氏の note](https://note.com/brave_coyote40/) | 考察の質が高い。ユニーク装備・深淵・キャラ雑感の記事あり。**アクセス不可** |
| ★★☆ | 個人・非商用 | [ドットアビス攻略wiki (wikiwiki.jp/gget)](https://wikiwiki.jp/gget/%E3%83%89%E3%83%83%E3%83%88%E3%82%A2%E3%83%93%E3%82%B9%E6%94%BB%E7%95%A5wiki) | **アクセス不可** |
| ★★☆ | 個人・非商用 | [kirisamehare.com 攻略メモ](https://kirisamehare.com/dot_abyss-memo/) | シンクロLv効率メモなどあり。**アクセス不可** |
| ★☆☆ | 商業 | [GameWith](https://gamewith.jp/dotabyss/), [Gamerch](https://gamerch.com/dotabyss/) | 網羅性は高いが参照度は下げる。個人サイトと矛盾したら個人サイト優先で要検証 |

## 醜女氏 note の既知記事

- [サービス開始時実装キャラ雑感](https://note.com/brave_coyote40/n/n9cc7d4d87148)
- [育成が進んだうえでの一部キャラ雑感](https://note.com/brave_coyote40/n/n3daa0156c6ec)
- [ユニーク装備のあれこれ](https://note.com/brave_coyote40/n/n8f0896a6e6af)
- [深淵のあれこれ](https://note.com/brave_coyote40/n/nb6db1f01a32f)

## 環境上の制約（重要）

このリポジトリを扱う Claude Code リモートセッションは、ネットワークポリシーにより
`dotabyss.wikiru.jp` / `note.com` / `wikiwiki.jp` / `kirisamehare.com` / `seesaawiki.jp` /
`gamewith.jp` / `gamerch.com` への直接アクセスがブロックされている（2026-08-18 時点）。
現状は Web 検索の要約経由でのみ情報収集可能。

**対処**: claude.ai の環境設定（ネットワークポリシー）で上記ドメインを許可すると、
一次ソースの直接読み込み・突合ができるようになる。それまで本リポジトリの仕様メモは
「検索経由の二次情報」であり、確度ラベル付きで管理する。

## 確度ラベルの運用

仕様メモ・データには以下のラベルを付ける:

- `[確]` 複数ソースで一致、またはゲーム内で確認済み
- `[推]` 単一ソースの記述からの推定。おそらく正しいが裏取り未了
- `[?]` 未確認・矛盾あり。スキーマ設計に影響する場合は解消するまで実装しない
