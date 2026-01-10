# n8n Veo3 動画生成自動化

Google Veo3/Imagen3 を使用した動画・画像生成を n8n ワークフローから自動化するためのスクリプト集です。

## 機能

- **マルチシーン動画生成**: 複数の画像+動画プロンプトから連続シーンを作成
- **キャラクター動画生成**: 1枚の画像から複数シーンの動画を生成
- **画像生成 (Imagen3)**: プロンプトからAI画像を生成
- **フレーム動画 (Veo3)**: 画像を参照して動画を生成
- **自動リトライ**: 生成失敗時に自動でリトライ（3回まで）
- **ユニークファイルパス**: executionId による並列実行対応
- **一時ファイル自動削除**: Drive アップロード後にクリーンアップ

## 必要条件

- Node.js 18+
- Playwright (`npm install playwright`)
- Chrome がリモートデバッグモードで起動していること
- Google AI Pro/Ultra サブスクリプション

## クイックスタート

```bash
# 依存関係のインストール
npm install playwright

# 画像生成
node scripts/veo3-shorts-simple.js '{"mode": "image", "prompt": "beautiful sunset"}'

# フレーム動画生成
node scripts/veo3-shorts-simple.js '{"mode": "frame", "prompt": "camera slowly zooms out", "imagePath": "/tmp/image.png"}'
```

## ドキュメント

| ドキュメント | 説明 |
|-------------|------|
| [veo3-shorts-manual.md](docs/veo3-shorts-manual.md) | Veo3スクリプト詳細マニュアル |
| [veo3-workflow-design.md](docs/veo3-workflow-design.md) | ワークフロー設計ガイド |
| [flow-video-automation-manual.md](docs/flow-video-automation-manual.md) | Flow動画自動化マニュアル |
| [gemini-automation-manual.md](docs/gemini-automation-manual.md) | Gemini自動化マニュアル |

## ファイル構成

```
├── scripts/
│   ├── veo3-shorts-simple.js    # メインスクリプト（画像/動画生成）
│   ├── veo3-common.js           # 共通モジュール
│   ├── veo3-character-video.js  # キャラクター動画生成
│   ├── flow-video-auto.js       # Flow動画自動化
│   ├── gemini-auto.js           # Gemini自動化
│   └── gpt-auto.js              # GPT自動化
├── workflows/
│   ├── veo3-multi-scene-workflow-v5-loop.json  # マルチシーン（推奨）
│   ├── veo3-character-video-loop.json          # キャラクター動画
│   └── ...
├── docs/
│   └── *.md
└── README.md
```

## ワークフロー一覧

### 推奨ワークフロー

| ワークフロー | 説明 | 特徴 |
|-------------|------|------|
| `veo3-multi-scene-workflow-v5-loop.json` | マルチシーン動画生成 | ループ処理、ユニークファイル、自動クリーンアップ |
| `veo3-character-video-loop.json` | キャラクター動画生成 | 1画像→複数シーン、ループ処理 |

### 旧バージョン（参考用）

| ワークフロー | 説明 |
|-------------|------|
| `veo3-multi-scene-workflow-v4-organized.json` | v4（Manual Trigger、固定ファイルパス） |
| `veo3-multi-scene-workflow-v3.json` | v3 |
| `veo3-multi-scene-workflow-v2.json` | v2 |
| `veo3-multi-scene-workflow.json` | v1 |

## スクリプトモード

### veo3-shorts-simple.js

| モード | 説明 | 主な用途 |
|--------|------|----------|
| `image` | プロンプトから画像生成 (Imagen3) | 背景画像、キャラクター画像 |
| `frame` | 画像から動画生成 (Veo3) | フレーム動画、シーン動画 |

### veo3-character-video.js

1枚の画像から複数のビデオプロンプトで連続シーンを生成。

## デプロイ手順

### Gitからプル（ローカルPC）

```powershell
git pull origin main
```

### Dockerコンテナへコピー（ローカルPC）

```powershell
# veo3-shorts-simple.js
docker cp C:\script_all\n8n_claude_20251224\scripts\veo3-shorts-simple.js n8n-n8n-1:/home/node/veo3-shorts-simple.js

# veo3-common.js
docker cp C:\script_all\n8n_claude_20251224\scripts\veo3-common.js n8n-n8n-1:/home/node/veo3-common.js

# veo3-character-video.js
docker cp C:\script_all\n8n_claude_20251224\scripts\veo3-character-video.js n8n-n8n-1:/home/node/veo3-character-video.js
```

### Chrome起動（ローカルPC）

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"
```

## 更新履歴

- **2026-01-10**: マルチシーンワークフローv5追加（ループ処理、ユニークファイル、自動クリーンアップ）
- **2026-01-09**: 画像生成リトライロジック追加、isVisible タイムアウト修正
- **2026-01-06**: ダウンロードロジック改善、エクスポート完了待機
- **2025-12-30**: downloadパラメータ追加、既存画像自動削除
- **2025-12-29**: 画像生成モード追加、projectUrl対応
- **2025-12-27**: 初版作成
