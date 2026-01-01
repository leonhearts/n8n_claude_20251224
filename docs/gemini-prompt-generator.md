# Gemini プロンプト生成ワークフロー

YouTube動画をGemini APIで分析し、Veo3用のプロンプト（image_prompt1-16, video_prompt1-16）を自動生成するワークフロー。

## 概要

```
スプレッドシート (status=New)
    ↓
Gemini API (動画分析)
    ↓
プロンプト抽出・パース
    ↓
スプレッドシート更新 (status=Plan)
    ↓
Discord通知
```

## 使用技術

- **Gemini Browser**: `gemini-auto.js`（既存のブラウザ自動化スクリプト）
- **Chrome CDP**: Veo3と同じChromeインスタンスを使用
- **入力**: YouTube URL（Geminiチャットに渡す）

## スプレッドシート構造

| カラム | 説明 |
|--------|------|
| search_url | YouTube動画URL（入力） |
| status | ワークフロー状態（New → Plan） |
| image_prompt1-16 | 画像生成プロンプト（出力） |
| video_prompt1-16 | 動画生成プロンプト（出力） |

## ワークフローフロー

### 1. トリガー
- 手動実行 または スケジュール

### 2. スプレッドシート読み込み
- フィルタ: `status = "New"`
- 1行ずつ処理

### 3. プロンプト構築
- システムプロンプト + YouTube URLを結合
- JSON出力形式を指定

### 4. Gemini Browser 呼び出し
- `gemini-auto.js` を実行
- gemini.google.com でプロンプトを送信
- 回答を待機して取得

### 5. 出力パース
- Geminiの出力からJSONを抽出
- `image_prompt1-16`, `video_prompt1-16` にマッピング

### 6. スプレッドシート更新
- プロンプトを書き込み
- `status` を `"Plan"` に更新

### 7. Discord通知
- 成功/失敗を通知

## Geminiシステムプロンプト

動画を「建築学的・美術的」に解析し、以下を出力：
- 8秒単位でセグメント分割
- 各セグメントに「ベース画像プロンプト」と「動画生成プロンプト」のペア
- 固有名詞、素材、形状、状態を詳細に記述

### 出力形式例

```
#### Segment 1 (00:00 - 00:08)
**1. 構造・演出意図:** ...
**2. ベース画像プロンプト:** ...
**3. 動画生成プロンプト:** ...

#### Segment 2 (00:08 - 00:16)
...
```

## 再利用パーツ（既存ワークフローより）

- スプレッドシート読み書き設定
- Discord通知設定
- エラーハンドリングパターン

## ファイル構成

```
/home/user/n8n_claude_20251224/
├── docs/
│   └── gemini-prompt-generator.md  # このドキュメント
└── workflows/
    └── gemini-prompt-generator.json  # ワークフロー定義
```

## 注意事項

- Gemini APIのレート制限に注意
- 長い動画は16セグメント（128秒）まで
- YouTube URLはGeminiが直接アクセス可能な公開動画のみ
