# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

Hugo + PaperMod で構築した個人技術ブログ（GitHub Pages）。自分で書いた記事に加え、Zenn の記事をビルド時に取り込み、同一のタグ・アーカイブ・検索に横断表示するのが本リポジトリ固有の仕組み。

## コマンド

```bash
hugo server                       # ローカルプレビュー (http://localhost:1313)
hugo --gc --minify                # 本番と同じビルド（出力: public/）
hugo new content posts/foo.md     # archetypes/posts.md から記事の雛形を生成

cd tools/fetch-external && go run .   # Zenn を取り込んで content/external/ を再生成
cd tools/fetch-external && go vet ./. # 取り込みツールの静的チェック
```

- テストは存在しない（Hugo サイト + 標準ライブラリのみの小さな Go ツール）。
- テーマは Hugo Module（`go.mod` の `hugo-PaperMod`）。初回ビルドや更新時はネットワークが必要。更新は `hugo mod get -u github.com/adityatelange/hugo-PaperMod`。
- `tools/fetch-external` はリポジトリ直下とは別の Go module。ビルド・実行はそのディレクトリ内で行う。

## アーキテクチャ

### 外部記事の取り込みパイプライン

`tools/fetch-external/main.go`（標準ライブラリのみ、単一ファイル）が中核。

1. `hugo.toml` を上方向に探して repo root を特定（`findRoot`）
2. `config/sources.json` からユーザー名を読む。環境変数 `ZENN_USER` が優先（CI では Secrets から注入）
3. Zenn の RSS フィードを取得し、`article` 構造体へ正規化
4. `content/external/` の `_index.md` 以外の `.md` を**全削除してから**書き直す（上流での削除を反映するため）
5. 各記事は本文を持たず、front matter の `externalUrl` / `source` / `layout: external` と要約のみを持つスタブ

取得失敗はサイト全体を落とさず警告のみで続行する設計（`warn: ... fetch failed`）。書き込み系のエラーだけ `fatal`。

**`content/external/*.md` は生成物なので手で編集しない。** 変更したい場合は `writeArticle` を直す。

投稿元は Zenn のみ（Qiita 連携は削除済み）。別の投稿元を足す場合は、取得関数 + `source` の値 + CSS のバッジ色（`.external-badge--*` / `.source-dot--*`）をセットで追加する。

### front matter が挙動を駆動する

レイアウト側はこれらのパラメータを見て分岐するため、追加時は影響範囲に注意:

| param | 効果 |
| --- | --- |
| `externalUrl` | 一覧カードのリンク先を元記事へ差し替え（`target=_blank`）、`extend_head.html` で単体ページから元記事へリダイレクト、`index.json` の検索結果 permalink も差し替え |
| `source` (`Zenn`) | バッジ表示・読了時間の代わりに「Zenn の記事」表記 |
| `sources` | タクソノミー（`/sources/` での絞り込み）。`source` とは別物で両方必要 |
| `hiddenInHomeList` | ホームのフィードから除外 |
| `hideSummary` | カードの要約を非表示 |
| `searchHidden` | 検索インデックス（`layouts/index.json`）から除外 |

### レイアウト構成

PaperMod をベースに、以下だけを上書きしている:

- `layouts/index.html` — ホーム。3カラム（プロフィール / フィード / 検索・投稿元・タグ・アーカイブ）の独自レイアウト
- `layouts/list.html` — セクション・タグ・投稿元ページ。ホームと**同じカード markup** を使う
- `layouts/archives.html` — 年・月グルーピング（`content/archives.md` が `layout: archives` で呼ぶ）
- `layouts/external/single.html` — 外部記事の単体ページ（実際にはリダイレクトされるがフォールバックとして機能）
- `layouts/index.json` — Fuse.js 用の検索インデックス（`[outputs] home = [..., "JSON"]`）
- `layouts/_partials/extend_head.html` — 外部記事のリダイレクト meta/script

カードの markup は `index.html` と `list.html` に重複している。片方を変更したらもう片方も揃えること（`.feed-item` 系のスタイルは `assets/css/extended/custom.css`）。

### デプロイ

`.github/workflows/deploy.yml`: main への push / 毎日 21:00 UTC (06:00 JST) / 手動実行 で、Go による取り込み → `hugo --gc --minify` → GitHub Pages へデプロイ。日次実行があるため、Zenn へ投稿すれば翌朝には自動反映される。Hugo のバージョンは workflow 内の `HUGO_VERSION` で固定。

## 注意点

- パーマリンクは `posts = /:year/:month/:slug/`。既存記事の日付やファイル名を変えると URL が変わる。
- `[markup.goldmark.renderer] unsafe = true` のため記事内の生 HTML はそのまま出力される。
- `mainSections = ["posts", "external"]` がホーム・アーカイブの対象を決めている。新しいセクションを追加する場合はここも更新する。
