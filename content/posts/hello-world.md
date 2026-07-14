---
title: "ブログをはじめました"
date: 2026-07-14T10:00:00+09:00
draft: false
tags:
  - お知らせ
  - Hugo
summary: "GitHub Pages 上に Hugo でブログを構築しました。Qiita / Zenn の記事もここに集約しています。"
---

はじめまして。このブログは [Hugo](https://gohugo.io/) と [PaperMod](https://github.com/adityatelange/hugo-PaperMod) テーマを使い、GitHub Pages 上で完全無料・CI/CD 付きで運用しています。

## このサイトの特徴

- **タグ管理**: 記事に付けたタグで絞り込みできます（[タグ一覧](/tags/)）。
- **年月アーカイブ**: [アーカイブ](/archives/)ページで投稿年・月ごとに一覧できます。
- **外部記事の集約**: Qiita・Zenn に投稿した記事も、ビルド時に自動取得してこのサイトのタグ／アーカイブに横断的に表示されます（[投稿元](/sources/)で絞り込み可）。
- **全文検索**: [検索ページ](/search/)からサイト内を検索できます。

新しい記事は `content/posts/` に Markdown を追加して `git push` するだけで、GitHub Actions が自動でビルド・デプロイします。
