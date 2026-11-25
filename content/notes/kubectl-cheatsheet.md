---
title: "kubectl よく使うコマンド"
date: 2026-11-25T10:20:00+09:00
lastmod: 2026-11-25T10:20:00+09:00
draft: false
category: "Kubernetes"
tags:
  - Kubernetes
  - kubectl
summary: "調査・デバッグでよく叩く kubectl コマンドの早見メモ。"
---

障害調査やデバッグで手が止まらないように、よく使う `kubectl` を並べておく。

## 状態を見る

```bash
kubectl get pods -A -o wide          # 全 namespace の Pod を配置ノードつきで
kubectl describe pod <pod>           # イベント・状態の詳細
kubectl get events --sort-by=.lastTimestamp   # 直近のイベントを時系列で
```

## ログ・中に入る

```bash
kubectl logs <pod> -c <container> -f        # ログを追従
kubectl logs <pod> --previous               # 直前にクラッシュしたコンテナのログ
kubectl exec -it <pod> -- sh                 # コンテナ内でシェル
```

## デバッグの定番

```bash
kubectl run tmp --rm -it --image=busybox -- sh   # 使い捨て Pod で疎通確認
kubectl port-forward svc/<svc> 8080:80           # 手元からサービスへ
```

> `-o yaml` / `-o jsonpath=...` を覚えておくと、必要なフィールドだけ抜き出せて便利。
