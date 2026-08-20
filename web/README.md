# アビス名簿 (web SPA)

ドットアビスの所持キャラ管理＋娼館の編成最適化・営業アドバイザ。
Vite + TypeScript。保存はすべて localStorage（サーバなし）。

## 開発

```bash
cd web
npm install
npm run dev        # 開発サーバ
npm run build      # GitHub Pages 用ビルド (dist/)
npm run data       # data/master/*.csv から src/data/characters.json を再生成
npm run build:artifact  # 単一ファイル版を生成して ../tools/webui/roster.html を更新
```

- マスターデータの単一ソースは `../data/master/*.csv`。キャラ・提案を更新したら
  `npm run data` で JSON を再生成する（Pages のCIでは自動実行）。
- `../tools/webui/roster.html` は **build:artifact の生成物**（直接編集しない）。
  Claude Artifact への公開と、file:// で単体で開く用途に使う。

## 構成

```
src/
  data.ts        マスターデータ型と定数（SOUL_CAP等）
  data/characters.json  生成物（tools/build_web_data.py）
  state.ts       アプリ状態と localStorage 永続化
  engine.ts      娼館シミュレーションエンジン（tools/brothel_sim.py と同一モデル）
  router.ts      ハッシュルーティング (#/roster, #/opt, #/adv)
  views/         タブごとのUI（roster / optimize / advisor）
```

## デプロイ

main への push で `.github/workflows/pages.yml` が `web/dist` を GitHub Pages に公開する。
初回はリポジトリの Settings → Pages で Source を「GitHub Actions」にすること。

## 個人アプリとして使う（ローカル駆動）

```bash
cd web && npm install && npm run dev   # http://localhost:5173
```

dev サーバ自体がアプリ本体で、ローカルAPI（vite.config.ts の localApi プラグイン）が同居する:

- ロスターの正は `../data/roster.json`（リポジトリ管理）。UIの変更は自動でファイル保存される
- 画像はキャラのサムネイル（画像列）をクリックして設定 → `public/chars/` に保存
  （**gitignore済み** — 公開リポジトリにゲーム画像を含めないため）
- 「Claudeと同期 (git push)」ボタンで roster.json を commit & push →
  Claude がリポジトリ経由で手持ちデータを読める
- API が無い環境（Artifact / file:// / GitHub Pages）では従来どおり localStorage で動作
