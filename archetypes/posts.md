---
title: {{ with getenv "POST_TITLE" }}{{ . | jsonify }}{{ else }}{{ replace .File.ContentBaseName `-` ` ` | title | jsonify }}{{ end }}
date: {{ .Date }}
draft: true
tags: []
summary: ""
---

ここに本文を書きます。
