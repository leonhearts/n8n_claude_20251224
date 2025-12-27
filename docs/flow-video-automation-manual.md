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

workflows/
├── flow-video-generation.json  # Webhook トリガー ワークフロー
└── flow-video-manual.json      # 手動トリガー ワークフロー
```

## セレクタ一覧（2024-12-27更新）

| 要素 | セレクタ | 説明 |
|------|----------|------|
| プロンプト入力 | `#PINHOLE_TEXT_AREA_ELEMENT_ID` | テキスト入力欄 |
| 作成ボタン | `button:has(i:text("arrow_forward"))` | 動画生成開始ボタン |
| 設定ボタン | `button:has(i:text("tune"))` | モデル設定ダイアログを開く |
| モデル表示 | `button:has-text("Veo 3")` | 現在選択中のモデル |
| モード選択 | `button[role="combobox"]:has-text("テキストから動画")` | テキストから動画モード |
| 通知ドロワー | `[role="region"][aria-label*="通知ドロワー"]` | 通知表示エリア |

## 使用方法

### 1. セレクタテスト（推奨）

まず、セレクタが正しく動作するか確認します：

```bash
node /home/node/flow-test-selectors.js
```

### 2. 動画生成（コマンドライン）

```bash
node /home/node/flow-video-auto.js '{"prompt": "動画のプロンプト", "model": "fast"}'
```

### パラメータ

| パラメータ | 型 | デフォルト | 説明 |
|------------|------|-----------|------|
| `prompt` | string | (必須) | 動画生成プロンプト |
| `model` | string | `"fast"` | モデル選択: `"fast"` または `"quality"` |
| `projectUrl` | string | null | 既存プロジェクトURL（オプション） |
| `waitTimeout` | number | 600000 | 生成待機時間（ミリ秒、デフォルト10分） |
| `screenshotDir` | string | `/tmp` | スクリーンショット保存先 |
| `keepTabOpen` | boolean | false | 完了後タブを開いたままにするか |
| `downloadVideo` | boolean | true | 動画を自動ダウンロードするか |
| `outputDir` | string | `/tmp` | 動画の保存先ディレクトリ |
| `outputFilename` | string | null | ファイル名（nullで自動生成） |

### 使用例

```bash
# 基本的な使用（自動ダウンロード有効）
node /home/node/flow-video-auto.js '{"prompt": "A cat walking in a garden"}'

# 高品質モデルを使用
node /home/node/flow-video-auto.js '{"prompt": "A cat walking in a garden", "model": "quality"}'

# タブを開いたまま
node /home/node/flow-video-auto.js '{"prompt": "A dog running", "keepTabOpen": true}'

# カスタム出力先
node /home/node/flow-video-auto.js '{"prompt": "Ocean waves", "outputDir": "/tmp/videos", "outputFilename": "ocean.mp4"}'
```

## 出力

成功時：
```json
{
  "success": true,
  "videoUrl": "https://storage.googleapis.com/...",
  "localVideoPath": "/tmp/flow-video-1703667890123.mp4",
  "projectUrl": "https://labs.google/fx/ja/tools/flow/project/...",
  "screenshot": "/tmp/flow-final-result.png",
  "generationTime": "86s"
}
```

エラー時：
```json
{
  "error": "エラーメッセージ",
  "screenshot": "/tmp/flow-error.png"
}
```

## n8n ワークフロー

### Webhook トリガー（flow-video-generation.json）

外部からAPIで動画生成をトリガーできます。

**インポート方法:**
1. n8n管理画面で「Import from file」を選択
2. `workflows/flow-video-generation.json` をアップロード
3. ワークフローをアクティブ化

**使用方法:**
```bash
curl -X POST http://localhost:5678/webhook/generate-video \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A beautiful sunset", "model": "fast"}'
```

### 手動トリガー（flow-video-manual.json）

n8n UIから手動で動画生成を実行できます。

**インポート方法:**
1. n8n管理画面で「Import from file」を選択
2. `workflows/flow-video-manual.json` をアップロード
3. 「Set Prompt」ノードでプロンプトを編集
4. 「Execute Workflow」をクリック

## トラブルシューティング

### セレクタが見つからない場合

1. `flow-test-selectors.js` を実行してどのセレクタが機能していないか確認
2. `/tmp/flow-page-structure.html` を確認して正しいセレクタを特定
3. `flow-video-auto.js` の `SELECTORS` オブジェクトを更新

### 設定ボタンがクリックできない

スクリプトは設定ボタンのクリックに失敗しても、デフォルト設定で続行します。
これは正常な動作です。

### 通知ドロワーが邪魔する場合

スクリプトは自動的に通知を閉じようとしますが、問題がある場合は手動でブラウザから通知を閉じてください。

### 作成ボタンが無効のまま

- プロンプトが正しく入力されているか確認
- ページが完全に読み込まれているか確認
- スクリーンショットを確認して状態を把握

### 動画ダウンロードが失敗する

- `blob:` URLの場合はダウンロードできません（ブラウザ内のみ有効）
- ネットワーク接続を確認
- 出力ディレクトリの書き込み権限を確認

## 更新履歴

- **2024-12-27**: 動画自動ダウンロード機能追加
  - `downloadVideo`, `outputDir`, `outputFilename` オプション追加
  - n8n ワークフロー（Webhook/手動）追加
- **2024-12-27**: 実際のUI HTMLに基づいてセレクタを修正
  - `#PINHOLE_TEXT_AREA_ELEMENT_ID` をプロンプト入力に使用
  - 通知ドロワー対応を追加
  - 新しいプロジェクトボタン自動クリック追加
