# Gemini Prompt Generator ワークフロー

YouTube動画を分析し、画像生成・動画生成用のプロンプトを自動生成するワークフロー。

> **注意**: GPT版（gpt-auto.js）も作成済みですが、ログイン周りにバグが残っています。現時点ではGemini版を使用してください。

## ワークフロー構成

```
Manual Trigger
    ↓
Read Spreadsheet (status="New"のみ)
    ↓
Build Prompt (プロンプト構造を作成)
    ↓
Convert to File (JSONをファイルに変換)
    ↓
Write Input File (/tmp/gemini_input.json)
    ↓
Gemini Browser (gemini-auto.js実行)
    ↓
Parse Gemini Response (JSON解析)
    ↓
Update Spreadsheet (status="Plan"に更新)
    ↓
Discord Success / Discord Error
```

## ノード詳細

### 1. Read Spreadsheet
| 項目 | 値 |
|------|-----|
| タイプ | Google Sheets |
| 操作 | Read |
| フィルター | `status = "New"` |
| 出力 | `search_url` (YouTube URL) |

### 2. Build Prompt
| 項目 | 値 |
|------|-----|
| タイプ | Code |
| 処理 | システムプロンプト + YouTube URLを結合 |

**出力構造:**
```json
{
  "prompts": [
    { "index": 1, "text": "システムプロンプト + YouTube URL" }
  ]
}
```

### 3. Convert to File
| 項目 | 値 |
|------|-----|
| タイプ | Convert To File |
| 操作 | toJson |
| 処理 | JSONをバイナリファイルに変換 |

### 4. Write Input File
| 項目 | 値 |
|------|-----|
| タイプ | Read/Write Files from Disk |
| 操作 | Write |
| ファイルパス | `/tmp/gemini_input.json` |

### 5. Gemini Browser
| 項目 | 値 |
|------|-----|
| タイプ | Execute Command |
| コマンド | `node /home/node/scripts/gemini-auto.js /tmp/gemini_input.json --file --cdp=http://192.168.65.254:9222` |
| エラー処理 | continueErrorOutput |

### 6. Parse Gemini Response
| 項目 | 値 |
|------|-----|
| タイプ | Code |
| 入力 | `$json.stdout` |
| 処理 | JSONパース → segments配列をimage_prompt/video_promptにマッピング |

### 7. Update Spreadsheet
| 項目 | 値 |
|------|-----|
| タイプ | Google Sheets |
| 操作 | Update |
| マッチキー | `search_url` |
| 更新フィールド | status="Plan", image_prompt1-16, video_prompt1-16 |

---

## gemini-auto.js (FULL版)

### 使用方法

```bash
# CDPモード（推奨、Veo3と同様）
node /home/node/scripts/gemini-auto.js /tmp/gemini_input.json --file --cdp=http://192.168.65.254:9222

# Cookie + プロファイルモード（CDPなし）
node /home/node/scripts/gemini-auto.js /tmp/gemini_input.json --file
```

### フラグ一覧

| フラグ | 説明 | デフォルト |
|--------|------|------------|
| `--file` | 入力がJSONファイルパス | - |
| `--base64` | 入力がBase64エンコードJSON | - |
| `--cdp=URL` | CDP接続URL | なし（Cookieモード） |
| `--cookies=PATH` | Cookieファイルパス | `/home/node/scripts/gemini-cookies.json` |
| `--profile=DIR` | ブラウザプロファイルディレクトリ | `/home/node/scripts/gemini-browser-profile` |
| `--headful` | ヘッドフルモード（非CDPのみ） | headless |
| `--goto=URL` | Gemini URL | `https://gemini.google.com/app` |
| `--timeout=MS` | 一般タイムアウト | 180000 |
| `--answerWait=MS` | 応答待ちタイムアウト | 180000 |
| `--stabilize=MS` | 応答安定化待ち時間 | 6000 |
| `--screenshot=PATH` | スクリーンショット保存先 | `/home/node/scripts/gemini-auto-result.png` |
| `--noScreenshot` | スクリーンショット無効 | - |

### 入力形式

```json
{
  "prompts": [
    { "index": 1, "text": "プロンプトテキスト" },
    { "index": 2, "text": "2つ目のプロンプト" }
  ]
}
```

### 出力形式

```json
{
  "result_p1": "Geminiからの応答テキスト",
  "result_p2": "2つ目の応答"
}
```

### 動作フロー

1. CDPモードまたはCookieモードでブラウザに接続
2. `https://gemini.google.com/app` に移動
3. ログイン状態を確認（未ログインならエラー終了）
4. 各プロンプトについて:
   - 生成中の場合は完了まで待機（停止ボタン非表示を確認）
   - テキストボックス（`div[role="textbox"]`）にプロンプトを入力
   - 送信ボタンをクリック
   - 応答が安定するまで待機（テキストが6秒間変化しなければ完了）
   - `.markdown`要素から最新の応答を取得
5. スクリーンショット保存（オプション）
6. 結果をJSON形式で標準出力

### セレクタ一覧

| 要素 | セレクタ |
|------|----------|
| 入力欄 | `div[role="textbox"]` |
| 送信ボタン | `button[aria-label="送信"], button[aria-label="Send message"]` |
| 停止ボタン | `button[aria-label*="停止"], button[aria-label*="Stop"]` |
| 応答エリア | `.markdown` |

---

## スプレッドシート構造

| 列名 | 説明 | 例 |
|------|------|-----|
| search_url | YouTube動画URL | `https://youtube.com/watch?v=xxx` |
| status | ワークフロー状態 | New → Plan |
| image_prompt1-16 | 画像生成プロンプト | "A realistic photo of..." |
| video_prompt1-16 | 動画生成プロンプト | "Slow camera pan..." |

---

## エラーハンドリング

```
Gemini Browser ─┬─ 成功 → Parse Gemini Response ─┬─ 成功 → Update Spreadsheet → Discord Success
                │                                 │
                └─ 失敗 → Format Error ───────────┴─ 失敗 → Discord Error
```

---

## Geminiシステムプロンプト概要

動画を「建築学的・美術的」に解析し、以下を出力：
- 8秒単位でセグメント分割（最大16セグメント = 128秒）
- 各セグメントに「ベース画像プロンプト」と「動画生成プロンプト」のペア
- 固有名詞、素材、形状、状態を詳細に記述

**出力JSON形式:**
```json
{
  "project": {
    "subject": "特定した固有名詞・場所名",
    "components": "主要な素材や形状のキーワード",
    "duration": "総尺（例: 1:30）"
  },
  "segments": [
    {
      "index": 1,
      "timeRange": "00:00 - 00:08",
      "intent": "このシーンの意図",
      "imagePrompt": "A realistic photo of...",
      "videoPrompt": "Slow camera pan..."
    }
  ]
}
```

---

## ファイル構成

```
/home/user/n8n_claude_20251224/
├── docs/
│   └── gemini-prompt-generator.md  # このドキュメント
├── scripts/
│   └── gemini-auto.js              # ブラウザ自動化スクリプト
└── workflows/
    └── gemini-prompt-generator.json # ワークフロー定義
```

---

## 注意事項

- 長いプロンプトはシェルエスケープの問題があるため、必ずファイル経由（`--file`フラグ）で渡す
- Geminiの応答待ち時間は最大240秒（4分）
- YouTube URLはGeminiが直接アクセス可能な公開動画のみ対応
- Chrome CDPは `http://192.168.65.254:9222` で待機している必要がある
