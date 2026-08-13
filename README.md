# Iwatsuka Yura Blog

Hugo + [PaperMod](https://github.com/adityatelange/hugo-PaperMod) で構築した技術ブログ。
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

```bash
hugo new content posts/my-first-post.md   # content/posts/ に雛形が生成される
```

front matter 例:

```yaml
---
title: "記事タイトル"
date: 2026-07-14T10:00:00+09:00
draft: false
tags: ["Go", "Hugo"]
summary: "一覧に表示される要約"
---
```

`draft: false` にして `git push` すると GitHub Actions がビルド・デプロイします。

## ローカルで確認

```bash
hugo server            # http://localhost:1313
```

## 外部記事を手元で取り込む

```bash
cd tools/fetch-external && go run .
# content/external/ に Zenn の記事が Markdown として生成される
```

## デプロイの仕組み（CI/CD）

`.github/workflows/deploy.yml`:

1. `main` への push / 毎日 06:00 JST / 手動実行 で起動
2. Go で `tools/fetch-external` を実行し Zenn の最新記事を取得
3. `hugo --minify` でビルド
4. GitHub Pages へデプロイ

毎日のスケジュール実行により、Zenn に新規投稿すると翌朝には自動でサイトへ反映されます。

## 構成

| パス | 役割 |
| --- | --- |
| `content/posts/` | 自分で書く記事 |
| `content/external/` | Zenn から自動生成（`_index.md` 以外は生成物） |
| `config/sources.json` | 取り込み対象ユーザー名 |
| `tools/fetch-external/` | Zenn RSS 取り込みツール（Go 標準ライブラリのみ） |
| `layouts/external/single.html` | 外部記事のリンクカード表示 |
| `.github/workflows/deploy.yml` | CI/CD |
| `hugo.toml` | サイト設定 |
