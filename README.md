# Iwatsuka Yura Blog

[Hugo](https://gohugo.io/) で構築した技術ブログ（テーマは使わずレイアウトは自作）。
GitHub Pages 上で **完全無料 + CI/CD** で運用し、Zenn の記事も一元管理します。

公開URL: https://iwatsukayura.github.io/

## 特徴

- 📝 Markdown で記事を書いて `git push` するだけで自動デプロイ
- 🏷️ **タグ**でのフィルタリング（`/tags/`）
- 🗓️ **投稿年・月**ごとのアーカイブ（`/archives/`）
- 🔗 **Zenn** の投稿をビルド時に自動取得し、サイト内のタグ・アーカイブに横断表示（`/sources/` で投稿元フィルタ）
- 🔍 全文検索（`/search/`）
- 🌗 ダークモード / レスポンシブ対応

## セットアップ（初回のみ）

外部記事の取り込み対象を設定します。`config/sources.json` を編集:

```json
{
  "zenn": "あなたのZennユーザー名"
}
```

> Secret（`ZENN_USER`）を GitHub リポジトリに設定すると、この設定ファイルより優先されます。

GitHub 側の設定: **Settings → Pages → Build and deployment → Source を "GitHub Actions"** にする。

## 記事を書く

[mise](https://mise.jdx.dev/) のタスクで完結します（初回のみ `mise trust && mise install`）。

```bash
mise run new nfc-card -t "NFC名刺の続編"   # content/posts/nfc-card.md を生成
mise run dev                               # http://localhost:1313 で下書き込みプレビュー
mise run publish nfc-card                  # 公開（確認プロンプトあり）
```

`mise run new` の第 1 引数がファイル名かつ URL になります（`/2026/08/nfc-card/`）。タイトルは `-t` で日本語のまま渡せます。

生成される front matter:

```yaml
---
title: "NFC名刺の続編"
date: 2026-08-13T12:00:00+09:00
draft: true
tags: []
summary: ""
---
```

`tags` と `summary` を埋めてから `mise run publish` すると、draft 解除 → 本番同等ビルドでの確認 → コミット → push → デプロイ監視までを一括で行います。

## その他のタスク

```bash
mise run fetch     # Zenn を取り込んで content/external/ を再生成
mise run build     # 本番と同じビルド
mise run status    # 直近のデプロイ結果を見届ける
mise tasks         # タスク一覧
```

## デプロイの仕組み（CI/CD）

`.github/workflows/deploy.yml`:

1. `main` への push / 毎日 06:00 JST / 手動実行 で起動
2. `jdx/mise-action` が `mise.toml` の hugo / go を用意（手元と同じバージョン）
3. `mise run fetch` で Zenn の最新記事を取得
4. `mise run build` でビルドし、GitHub Pages へデプロイ

毎日のスケジュール実行により、Zenn に新規投稿すると翌朝には自動でサイトへ反映されます。

## 構成

| パス | 役割 |
| --- | --- |
| `content/posts/` | 自分で書く記事 |
| `content/external/` | Zenn から自動生成（`_index.md` 以外は生成物） |
| `config/sources.json` | 取り込み対象ユーザー名 |
| `tools/fetch-external/` | Zenn RSS 取り込みツール（Go 標準ライブラリのみ） |
| `layouts/` | ページテンプレート一式（テーマ非依存） |
| `assets/` | CSS / JS（ビルド時に連結・minify） |
| `.github/workflows/deploy.yml` | CI/CD |
| `mise.toml` | ツールのバージョンと執筆・公開タスク |
| `hugo.toml` | サイト設定 |
