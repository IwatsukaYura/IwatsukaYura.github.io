# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

Hugo で構築した個人技術ブログ（GitHub Pages）。**テーマは使わず `layouts/` を自前で持つ**。自分で書いた記事に加え、Zenn の記事をビルド時に取り込み、同一のタグ・アーカイブ・検索に横断表示するのが本リポジトリ固有の仕組み。

## コマンド

**mise のタスクが入口。**`mise tasks` で一覧が出る（初回のみ `mise trust` が必要）。

```bash
mise run new <name> -t "タイトル"  # 記事の雛形を作る。<name> がそのまま URL になる
mise run dev                       # プレビュー（下書き・予約投稿込み、Zenn 取り込み付き）
mise run publish <name>            # draft 解除 → ビルド確認 → 確認プロンプト → commit → push → CI 監視

mise run drafts                    # 下書きと予約投稿の一覧
mise run fetch                     # Zenn を取り込んで content/external/ を再生成
mise run build                     # 本番と同じビルド（出力: public/）
mise run status                    # 直近のデプロイの結果を見届ける
mise run vet                       # 取り込みツールの静的チェック
```

- テストは存在しない（Hugo サイト + 標準ライブラリのみの小さな Go ツール）。
- **hugo と go のバージョンは `mise.toml` の `[tools]` が唯一の定義**。CI も `jdx/mise-action` で同じ値を読む。片方だけ上げない。
- 外部テーマ・Hugo Modules・npm には依存しない（SCSS も未使用なので extended である必要は本来ないが、従来の CI と同じ `hugo-extended` に固定している）。
- `tools/fetch-external` は独立した Go module（`mise run fetch` / `mise run vet` が `dir` 指定で吸収している）。
- `publish` は**必ず確認プロンプトを挟んでから** push する。この確認を外さないこと。main 以外のブランチでは中止する。
- front matter の書き換え（`draft` の解除・巻き戻し）は awk で**先頭の `---` ブロック内に限定**している。本文のコードブロックに `draft: true` と書いても壊れない。この限定を外さないこと。

## アーキテクチャ

### 外部記事の取り込みパイプライン

`tools/fetch-external/main.go`（標準ライブラリのみ、単一ファイル）が中核。

1. `hugo.toml` を上方向に探して repo root を特定（`findRoot`）
2. `config/sources.json` からユーザー名を読む。環境変数 `ZENN_USER` が優先（CI では Secrets から注入）
3. Zenn の RSS フィードを取得し、`article` 構造体へ正規化
4. `content/external/` の `_index.md` 以外の `.md` を**全削除してから**書き直す（上流での削除を反映するため）
5. 各記事は本文を持たず、front matter の `externalUrl` / `source` / `layout: external` と要約のみを持つスタブ

**`content/external/*.md` は生成物であり Git 管理外**（`.gitignore` で除外、`_index.md` だけ追跡）。手で編集せず、変更したい場合は `writeArticle` を直す。ローカルで外部記事込みの表示を確認したいときは、先に `go run .` を実行する。

取得に失敗した場合は `content/external/` に触れる前に `fatal` で止める。生成物が Git に無いため、警告だけで続行すると外部記事が 1 本も無いサイトがデプロイされてしまうため。CI はここで落ち、直前のデプロイが公開されたまま残る。

投稿元は Zenn のみ。別の投稿元を足す場合は、取得関数 + `source` の値をセットで追加する（表示はソース名をそのまま小文字で出すだけなので CSS 追加は不要）。

### front matter が挙動を駆動する

レイアウト側はこれらのパラメータを見て分岐するため、追加時は影響範囲に注意:

| param | 効果 |
| --- | --- |
| `externalUrl` | 一覧の行のリンク先を元記事へ差し替え（`target=_blank`）、`head.html` で単体ページから元記事へリダイレクト、`canonical` と `index.json` の permalink も差し替え |
| `source` (`Zenn`) | 一覧・記事ヘッダにソース名を表示し、読了時間の表示を抑止 |
| `sources` | タクソノミー（`/sources/` での絞り込み）。`source` とは別物で両方必要 |
| `hiddenInHomeList` | ホームのフィードから除外 |
| `searchHidden` | 検索インデックス（`layouts/index.json`）から除外 |
| `hideToc` | 記事ページの目次を出さない（既定は見出し 2 つ以上で自動表示） |

### 記事の URL

パーマリンクは `posts = /:year/:month/:slugorcontentbasename/`。**front matter に `slug` が無ければファイル名がそのまま URL** になるので、`mise run new` に渡す `<name>` を英語にしておけば `slug` を書く必要はない。日本語タイトルは `-t` で渡す（`archetypes/posts.md` が環境変数 `POST_TITLE` 経由で受け取る。この getenv は `hugo.toml` の `[security.funcs]` で明示的に許可している）。

URL を変えたい既存記事は `slug` を足す。逆に URL が変わってしまう変更をする場合は、旧 URL を `aliases` に列挙してリダイレクトを残す（`content/posts/hello-world.md` がその例）。

### レイアウト構成

テーマ継承は無く、`layouts/` 配下がすべて。一覧系の markup は partial に集約されているので、**カードや行の見た目を変えるときは partial 側を直す**。

- `layouts/baseof.html` — 全ページの外枠（head / header / main / footer / scripts）
- `layouts/index.html` — ホーム（記事索引 + サイドバー）
- `layouts/list.html` / `term.html` / `taxonomy.html` — セクション・タグ／投稿元・その索引
- `layouts/archives.html` — 年・月グルーピング（`content/archives.md` が `layout: archives` で呼ぶ）
- `layouts/single.html` — 記事本文。見出し数に応じて目次カラムを出す
- `layouts/external/single.html` — 外部記事の単体ページ（リダイレクト前に一瞬見えるフォールバック）
- `layouts/search.html` — 検索 UI（`content/search.md` が `layout: search` で呼ぶ）
- `layouts/index.json` — Fuse.js 用の検索インデックス（`[outputs] home = [..., "JSON"]`）
- `layouts/_partials/entry.html` — 索引の 1 行。ページ単体か `dict "page" ... "dateFormat" ...` を受ける
- `layouts/_partials/index-list.html` — 年で区切った索引。ホーム・一覧・タグで共用
- `layouts/_partials/page-head.html` — 一覧系ページの見出し（eyebrow / title / note）
- `layouts/_partials/head.html` — メタ情報、CSS 連結、外部記事のリダイレクト
- `layouts/_partials/scripts.html` — JS 連結。検索ページでのみ Fuse.js を追加で読む

### アセット

- `assets/css/main.css` — 全スタイル。色は `--paper` / `--ink` / `--ash` / `--mark` の 4 色のみで、濃淡は `color-mix` で派生させる。**新しい色相を増やさない**
- `assets/css/chroma.css` — シンタックスハイライト。同じ 4 色縛り
- `assets/js/theme.js`（配色切替）/ `code.js`（コピーボタン）/ `toc.js`（目次追従）は 1 本に連結。`search.js` + `vendor/fuse.min.js` は検索ページのみ
- CSS/JS は本番ビルドでのみ minify + fingerprint される

### デプロイ

`.github/workflows/deploy.yml`: main への push / 毎日 21:00 UTC (06:00 JST) / 手動実行 で、`jdx/mise-action` でツールを揃えたうえで `mise run fetch` → `mise run build` → GitHub Pages へデプロイ。手元と同じタスクを CI が実行する。日次実行があるため、Zenn へ投稿すれば翌朝には自動反映される。

## 注意点

- 既存記事の日付やファイル名を変えると URL が変わる（`aliases` での救済が必要）。
- `[markup.goldmark.renderer] unsafe = true` のため記事内の生 HTML はそのまま出力される。
- `mainSections = ["posts", "external"]` がホーム・アーカイブ・検索の対象を決めている。新しいセクションを追加する場合はここも更新する。
