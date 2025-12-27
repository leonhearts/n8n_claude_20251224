# Google Flow 動画生成自動化マニュアル

## 概要

Google Flow（Veo 3）を使用した動画生成を自動化するスクリプトです。

## 必要条件

- Google AI Pro/Ultra サブスクリプション
- Chromeがリモートデバッグモードで起動していること（ポート9222）
- Googleアカウントでログイン済みであること
- Node.js と Playwright がインストールされていること

## ファイル構成

```
scripts/
├── flow-video-auto.js      # メイン自動化スクリプト
└── flow-test-selectors.js  # セレクタ検証テストスクリプト
```

## セレクタ一覧（2024-12-27更新）

| 要素 | セレクタ | 説明 |
|------|----------|------|
| プロンプト入力 | `#PINHOLE_TEXT_AREA_ELEMENT_ID` | テキスト入力欄 |
| 作成ボタン | `button[aria-label="作成"]` | 動画生成開始ボタン |
| 設定ボタン | `button[aria-label*="設定"]` | モデル設定ダイアログを開く |
| モデル表示 | `button:has-text("Veo 3")` | 現在選択中のモデル |
| モード選択 | `button[role="combobox"]:has-text("テキストから動画")` | テキストから動画モード |
| 通知ドロワー | `[role="region"][aria-label*="通知ドロワー"]` | 通知表示エリア |

## 使用方法

### 1. セレクタテスト（推奨）

まず、セレクタが正しく動作するか確認します：

```bash
node scripts/flow-test-selectors.js
```

### 2. 動画生成

```bash
node scripts/flow-video-auto.js '{"prompt": "動画のプロンプト", "model": "fast"}'
```

### パラメータ

| パラメータ | 型 | デフォルト | 説明 |
|------------|------|-----------|------|
| `prompt` | string | (必須) | 動画生成プロンプト |
| `model` | string | `"fast"` | モデル選択: `"fast"` または `"quality"` |
| `projectUrl` | string | null | 既存プロジェクトURL（オプション） |
| `waitTimeout` | number | 600000 | 生成待機時間（ミリ秒、デフォルト10分） |
| `screenshotDir` | string | `/home/node/scripts` | スクリーンショット保存先 |

### 使用例

```bash
# 基本的な使用
node scripts/flow-video-auto.js '{"prompt": "A cat walking in a garden"}'

# 高品質モデルを使用
node scripts/flow-video-auto.js '{"prompt": "A cat walking in a garden", "model": "quality"}'

# タイムアウトを20分に設定
node scripts/flow-video-auto.js '{"prompt": "Complex scene", "waitTimeout": 1200000}'
```

## 出力

成功時：
```json
{
  "success": true,
  "videoUrl": "https://...",
  "projectUrl": "https://labs.google/fx/tools/flow/...",
  "screenshot": "/home/node/scripts/flow-final-result.png",
  "generationTime": "180s"
}
```

エラー時：
```json
{
  "error": "エラーメッセージ",
  "screenshot": "/home/node/scripts/flow-error.png"
}
```

## トラブルシューティング

### セレクタが見つからない場合

1. `flow-test-selectors.js` を実行してどのセレクタが機能していないか確認
2. `/tmp/flow-page-structure.html` を確認して正しいセレクタを特定
3. `flow-video-auto.js` の `SELECTORS` オブジェクトを更新

### 通知ドロワーが邪魔する場合

スクリプトは自動的に通知を閉じようとしますが、問題がある場合は手動でブラウザから通知を閉じてください。

### 作成ボタンが無効のまま

- プロンプトが正しく入力されているか確認
- ページが完全に読み込まれているか確認
- スクリーンショットを確認して状態を把握

## 更新履歴

- **2024-12-27**: 実際のUI HTMLに基づいてセレクタを修正
  - `#PINHOLE_TEXT_AREA_ELEMENT_ID` をプロンプト入力に使用
  - `aria-label="作成"` を作成ボタンに使用
  - 通知ドロワー対応を追加
