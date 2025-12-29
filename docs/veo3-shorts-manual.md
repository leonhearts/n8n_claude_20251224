# Veo3 動画・画像生成マニュアル

Google Veo3/Imagen3を使用して、動画や画像を自動生成するスクリプトです。

## 目次

- [セットアップ](#セットアップ)
- [モード一覧](#モード一覧)
- [動画生成モード](#動画生成モードmode-frame)
- [画像生成モード](#画像生成モードmode-image)
- [共通パラメータ](#共通パラメータ)
- [ローカルへのダウンロード](#ローカルへのダウンロード)
- [ワークフロー統合](#sunoワークフロー統合)
- [トラブルシューティング](#トラブルシューティング)

---

## セットアップ

### スクリプトをDockerにコピー

```powershell
docker cp C:\script_all\n8n_claude_20251224\scripts\veo3-shorts-simple.js n8n-n8n-1:/home/node/veo3-shorts-simple.js
docker exec -u root n8n-n8n-1 chown node:node /home/node/veo3-shorts-simple.js
```

### 前提条件

- Chromeがリモートデバッグモードで起動していること
- Google Veo3にログイン済みであること

```powershell
# Chrome起動
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"
```

---

## モード一覧

| モード | 説明 | 主な用途 |
|--------|------|----------|
| `frame` | 画像から動画を生成 | ジャケット画像からショート動画作成 |
| `image` | プロンプトから画像を生成 | AIアート、背景画像作成 |

---

## 動画生成モード（mode: frame）

画像を参照して動画を生成します。

### 基本コマンド

```powershell
# シンプルな動画生成（シーン拡張なし）
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"frame\", \"prompt\": \"カメラがゆっくりズームアウト\", \"imagePath\": \"/tmp/output_kaeuta.png\"}'

# シーン拡張あり（videoCount: 2以上）
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"frame\", \"prompt\": \"カメラがゆっくりズームアウト\", \"imagePath\": \"/tmp/output_kaeuta.png\", \"videoCount\": 2}'
```

### パラメータ

| パラメータ | 必須 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `mode` | ○ | `frame` | `frame` を指定 |
| `prompt` | ○ | - | 動画のモーション指示 |
| `imagePath` | ○ | `/tmp/output_kaeuta.png` | 参照画像のパス（Docker内） |
| `videoCount` | - | `1` | シーン数（1=拡張なし、2以上=シーン拡張） |
| `outputPath` | - | `/tmp/veo3_movie.mp4` | 出力先パス |
| `projectUrl` | - | null | 既存プロジェクトURL（指定時は新規作成スキップ） |

### 既存プロジェクトを使用する場合

```powershell
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"frame\", \"prompt\": \"カメラがゆっくりズームアウト\", \"imagePath\": \"/tmp/output.png\", \"projectUrl\": \"https://labs.google/fx/ja/tools/flow/project/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\"}'
```

**⚠️ 注意: 既存プロジェクトを使用する場合の動作**

- シーンビルダーに既存のシーンがある場合、**続きとして追加**されます
- 画像のアップロードは既存プロジェクトでは正常に動作しない場合があります
- 主な用途: **同じプロジェクトで続きのシーンを作成する**場合に使用
- 新規で動画を作りたい場合は `projectUrl` を指定せずに実行してください

### 出力

```powershell
# 生成された動画をローカルにコピー
docker cp n8n-n8n-1:/tmp/veo3_movie.mp4 C:\Users\Administrator\Downloads\veo3_movie.mp4
```

---

## 画像生成モード（mode: image）

プロンプトからAI画像を生成します。

### 基本コマンド

```powershell
# 横向き画像を1枚生成
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"image\", \"prompt\": \"beautiful sunset over mountains, photorealistic\"}'

# 縦向き画像を2枚生成
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"image\", \"prompt\": \"anime style portrait\", \"imageOutputCount\": 2, \"aspectRatio\": \"portrait\"}'
```

### パラメータ

| パラメータ | 必須 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `mode` | ○ | - | `image` を指定 |
| `prompt` | ○ | - | 画像生成プロンプト |
| `imageOutputCount` | - | `1` | 出力枚数（`1` または `2`） |
| `aspectRatio` | - | `landscape` | 縦横比（`landscape`=横向き16:9、`portrait`=縦向き9:16） |
| `outputPath` | - | `/tmp/veo3_movie.png` | 出力先パス（.mp4指定でも.pngに変換） |
| `projectUrl` | - | null | 既存プロジェクトURL（指定時は新規作成スキップ） |

### 出力

```powershell
# 生成された画像をローカルにコピー
docker cp n8n-n8n-1:/tmp/veo3_movie.png C:\Users\Administrator\Downloads\generated_image.png

# JPG形式で保存された場合
docker cp n8n-n8n-1:/tmp/veo3_movie.jpg C:\Users\Administrator\Downloads\generated_image.jpg
```

---

## 共通パラメータ

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| `cdpUrl` | `http://192.168.65.254:9222` | Chrome CDP接続先 |
| `waitTimeout` | `600000` | 生成待ち最大時間（ミリ秒） |

---

## ローカルへのダウンロード

```powershell
# 動画をローカルにコピー
docker cp n8n-n8n-1:/tmp/veo3_movie.mp4 C:\Users\Administrator\Downloads\veo3_movie.mp4

# 画像をローカルにコピー
docker cp n8n-n8n-1:/tmp/veo3_movie.png C:\Users\Administrator\Downloads\veo3_movie.png
```

---

## 画像生成→動画生成の連携

1. まず画像を生成
2. 生成した画像を参照して動画を生成

```powershell
# 1. 画像を生成（出力: /tmp/veo3_movie.png）
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"image\", \"prompt\": \"cyberpunk cityscape at night\", \"aspectRatio\": \"landscape\"}'

# 2. 生成した画像から動画を作成
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"frame\", \"prompt\": \"camera slowly pans across the city\", \"imagePath\": \"/tmp/veo3_movie.png\"}'
```

---

## SUNOワークフロー統合

既存のSUNOワークフローに最小限の変更でVeo3動画生成を追加する方法。

### 変更概要

**変更前:**
```
ショート音声切出 → ショート動画生成3（静止画+FFmpeg）
```

**変更後:**
```
ショート音声切出 → Veo3動画生成 → Veo3結果パース → ショート動画生成3（Veo3動画+FFmpeg）
```

### ノード1: Veo3動画生成

- **タイプ:** Execute Command
- **位置:** ショート音声切出の後
- **コマンド:**
```
node /home/node/veo3-shorts-simple.js '{{ JSON.stringify({
  prompt: $('プロンプト生成 ✔').item.json.output.header_short + " " + $('プロンプト生成 ✔').item.json.output.footer_short,
  imagePath: "/tmp/output_kaeuta.png",
  outputPath: "/tmp/veo3_shorts_kaeuta.mp4",
  mode: "frame",
  videoCount: 2
}) }}'
```
- **タイムアウト:** 1800000ms（30分）

### ノード2: Veo3結果パース

- **タイプ:** Code
- **コード:**
```javascript
const output = $input.first().json.stdout;
try {
  const result = JSON.parse(output);
  if (result.success) {
    return [{ json: { veo3Path: result.outputPath, success: true } }];
  } else {
    throw new Error(result.error || 'Veo3 generation failed');
  }
} catch (e) {
  return [{ json: { veo3Path: null, success: false, fallback: true } }];
}
```

### ショート動画生成3 の修正

```bash
if [ -f "/tmp/veo3_shorts_kaeuta.mp4" ] && [ -s "/tmp/veo3_shorts_kaeuta.mp4" ]; then
  # Veo3動画を使用
  ffmpeg -y -i /tmp/veo3_shorts_kaeuta.mp4 -i /tmp/short_audio_kaeuta.mp3 \
    -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[bg];[bg]drawtext=...（テキストオーバーレイ）...[outv]" \
    -map "[outv]" -map 1:a \
    -c:v libx264 -c:a aac -b:a 192k -shortest -pix_fmt yuv420p -t 15 \
    /tmp/output_short_kaeuta.mp4
else
  # フォールバック: 従来の静止画モード
  ffmpeg -y -loop 1 -i /tmp/output_kaeuta.png ...
fi
```

---

## トラブルシューティング

### CDP接続URLは `192.168.65.254:9222` を使用

```javascript
// NG - Docker環境で500エラーになる
cdpUrl: 'http://host.docker.internal:9222'

// OK
cdpUrl: 'http://192.168.65.254:9222'
```

`host.docker.internal` はこの環境では動作しません。必ず `192.168.65.254` を使用してください。

### 「Unexpected status 500」エラー

```
browserType.connectOverCDP: Unexpected status 500 when connecting to http://host.docker.internal:9222/json/version/
```

→ CDP URLを `http://192.168.65.254:9222` に変更してください。

### ダウンロードが失敗する

Chromeのダウンロード履歴に「問題が発生しました」と表示される場合：
- これは `--remote-debugging-address=0.0.0.0` による既知の問題です
- スクリプトはBase64デコードで対応済みなので、スクリプト経由のダウンロードは成功します
- 手動ダウンロードは失敗する可能性があります

### 「File input not found」エラー

ファイルダイアログをEscapeで閉じるとUIが消えます。最新のスクリプトでは `fileChooser.setFiles()` で対応済みです。

### JSONエラー

PowerShellでのコマンド実行時、JSONの形式に注意してください：

```powershell
# NG - 閉じ括弧の位置がおかしい
'{\"mode\": \"frame\", \"prompt\": \"test\"},"videoCount":2}'

# OK - videoCountは閉じ括弧の前
'{\"mode\": \"frame\", \"prompt\": \"test\", \"videoCount\": 2}'
```

---

## 注意事項

- Veo3は1動画あたり約90秒かかるため、2動画で約3分の追加時間
- 既存のワークフローの他の部分は一切変更不要
- `mode: "text"` に変更すると、画像なしのText-to-Videoモードになる

---

## 更新履歴

- **2025-12-29**: 画像生成モード追加（出力数・縦横比設定対応）、動画生成のvideoCount=1でシーン拡張スキップ、projectUrl対応
- **2025-12-29**: Base64ダウンロード対応、シーンビルダー遷移修正
- **2025-12-28**: 初版作成
