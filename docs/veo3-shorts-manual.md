# Veo3 ショート動画生成マニュアル

## 概要

Google Flow (Veo3) を使用して2つの動画を生成し、FFmpegで結合して16秒のショート動画を作成するシステムです。
SUNOで生成した音楽と組み合わせて使用することを想定しています。

## 必要条件

- Google AI Pro/Ultra サブスクリプション
- Chromeがリモートデバッグモードで起動していること（ポート9222）
- Googleアカウントでログイン済みであること
- Node.js と Playwright がインストールされていること
- FFmpegがインストールされていること

## ファイル構成

```
scripts/
├── flow-video-shorts.js    # ショート動画生成スクリプト
├── flow-video-auto.js      # 単体動画生成スクリプト
└── flow-test-selectors.js  # セレクタ検証スクリプト

workflows/
├── veo3-shorts-generation.json  # 手動トリガー版
└── veo3-shorts-webhook.json     # Webhook版（SUNO連携用）
```

## 動作モード

### 1. テキストから動画 (Text-to-Video)

プロンプトのみで動画を生成します。

```bash
node /home/node/flow-video-shorts.js '{
  "prompt": "A beautiful landscape with flowing water",
  "mode": "text",
  "videoCount": 2
}'
```

### 2. 画像から動画 (Image-to-Video)

ジャケット画像をベースに動画を生成します。

```bash
node /home/node/flow-video-shorts.js '{
  "prompt": "Gentle motion and flowing animation",
  "mode": "image",
  "imagePath": "/tmp/jacket-image.jpg",
  "videoCount": 2
}'
```

## パラメータ

| パラメータ | 型 | デフォルト | 説明 |
|------------|------|-----------|------|
| `prompt` | string | (必須) | 動画生成プロンプト |
| `mode` | string | `"text"` | モード: `"text"` または `"image"` |
| `imagePath` | string | null | Image-to-Video用の画像パス |
| `audioPath` | string | null | SUNOオーディオファイルパス |
| `videoCount` | number | 2 | 生成する動画数 |
| `waitTimeout` | number | 600000 | 動画生成待機時間（ミリ秒） |
| `outputDir` | string | `/tmp/videos` | 動画の保存先 |
| `outputFilename` | string | null | 最終出力ファイル名 |
| `screenshotDir` | string | `/tmp` | スクリーンショット保存先 |

## 出力

成功時：
```json
{
  "success": true,
  "videoCount": 2,
  "videos": [
    {
      "index": 1,
      "url": "https://storage.googleapis.com/...",
      "localPath": "/tmp/videos/flow-video-1-xxx.mp4",
      "generationTime": "90s"
    },
    {
      "index": 2,
      "url": "https://storage.googleapis.com/...",
      "localPath": "/tmp/videos/flow-video-2-xxx.mp4",
      "generationTime": "85s"
    }
  ],
  "finalVideoPath": "/tmp/videos/flow-shorts-xxx.mp4",
  "totalGenerationTime": "175s"
}
```

## n8n ワークフロー

### 手動トリガー版（veo3-shorts-generation.json）

n8n UIから手動で実行できます。

**インポート方法:**
1. n8n管理画面で「Import from file」を選択
2. `workflows/veo3-shorts-generation.json` をアップロード
3. 「Set Parameters」ノードでパラメータを編集
4. Google Drive認証情報を設定（アップロードする場合）
5. 「Execute Workflow」をクリック

### Webhook版（veo3-shorts-webhook.json）

外部からAPIで呼び出し可能です。SUNO ワークフローと連携できます。

**使用方法:**
```bash
curl -X POST http://localhost:5678/webhook/veo3-shorts \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Flowing abstract patterns",
    "mode": "text",
    "audioUrl": "https://example.com/suno-music.mp3",
    "videoCount": 2
  }'
```

**Image-to-Video モード:**
```bash
curl -X POST http://localhost:5678/webhook/veo3-shorts \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Gentle movement and animation",
    "mode": "image",
    "imagePath": "/tmp/jacket.jpg",
    "audioPath": "/tmp/suno.mp3"
  }'
```

## SUNO ワークフローとの連携

既存のSUNOワークフローから呼び出すには：

1. SUNOワークフローにHTTP Requestノードを追加
2. 以下のパラメータを設定：
   - URL: `http://localhost:5678/webhook/veo3-shorts`
   - Method: POST
   - Body:
     ```json
     {
       "prompt": "{{ $json.videoPrompt }}",
       "mode": "image",
       "imagePath": "{{ $json.jacketImagePath }}",
       "audioUrl": "{{ $json.sunoAudioUrl }}"
     }
     ```

## 処理フロー

```
1. プロンプト/画像入力
        ↓
2. Veo3で動画1を生成（約90秒）
        ↓
3. Veo3で動画2を生成（約90秒）
        ↓
4. FFmpegで動画を結合（約16秒の動画）
        ↓
5. SUNOオーディオを追加（オプション）
        ↓
6. 最終動画出力
```

## トラブルシューティング

### FFmpegエラー

```bash
# FFmpegがインストールされているか確認
docker exec n8n-n8n-1 ffmpeg -version

# 動画コーデックの問題の場合
# スクリプトは自動的に再エンコードを試みます
```

### セレクタエラー

```bash
# セレクタ検証スクリプトを実行
docker exec n8n-n8n-1 node /home/node/flow-test-selectors.js
```

### 動画ダウンロード失敗

- `blob:` URLはダウンロードできません
- ネットワーク接続を確認
- 出力ディレクトリの書き込み権限を確認

### タイムアウト

デフォルトの待機時間は10分です。長い動画の場合は `waitTimeout` を増やしてください：

```json
{
  "prompt": "...",
  "waitTimeout": 900000
}
```

## よく使うコマンド

```bash
# スクリプトをDockerにコピー
docker cp /path/to/flow-video-shorts.js n8n-n8n-1:/home/node/flow-video-shorts.js

# 権限設定
docker exec -u root n8n-n8n-1 chown node:node /home/node/flow-video-shorts.js

# テスト実行
docker exec n8n-n8n-1 node /home/node/flow-video-shorts.js '{"prompt":"test","videoCount":1}'

# 結果確認
docker exec n8n-n8n-1 ls -la /tmp/videos/
```

## 更新履歴

- **2024-12-27**: 初版作成
  - Text-to-Video / Image-to-Video 両モード対応
  - FFmpeg動画結合機能
  - SUNOオーディオ追加機能
  - n8n ワークフロー（手動/Webhook）追加
