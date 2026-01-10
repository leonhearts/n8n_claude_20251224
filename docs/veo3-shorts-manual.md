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
- [技術的解説](#技術的解説)
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

### Chrome起動・終了コマンド（PowerShell）

```powershell
# ========== Chrome起動 ==========
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"
```

```powershell
# ========== Chrome終了 ==========
# gemini-chrome-profile を使用しているChromeプロセスのみ終了
Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | ? { $_.CommandLine -match 'gemini-chrome-profile' } | % { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
```

```powershell
# ========== Chrome再起動（終了→待機→起動） ==========
Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | ? { $_.CommandLine -match 'gemini-chrome-profile' } | % { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"
```

**⚠️ 重要:**
- `--remote-debugging-address=0.0.0.0` はDockerからの接続に必須
- `--user-data-dir="C:\gemini-chrome-profile"` で専用プロファイルを使用（通常のChromeと分離）
- 終了コマンドは `gemini-chrome-profile` を使用しているChromeのみを終了（他のChromeには影響なし）

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
| `download` | `true` | ダウンロード制御（`false`でダウンロードスキップ） |

### download パラメータ（n8n連携向け）

n8nワークフローで段階的に処理する場合、途中のダウンロードは不要なことがあります。

```powershell
# ダウンロードあり（デフォルト）
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"frame\", \"prompt\": \"test\", \"imagePath\": \"/tmp/test.png\", \"download\": true}'

# ダウンロードなし（プロジェクトURLのみ返す）
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"frame\", \"prompt\": \"test\", \"imagePath\": \"/tmp/test.png\", \"download\": false}'
```

**出力の違い:**

```json
// download: true の場合
{
  "success": true,
  "outputPath": "/tmp/veo3_movie.mp4",
  "projectUrl": "https://labs.google/fx/ja/tools/flow/project/xxx",
  "videoCount": 1,
  "totalTime": "120s",
  "downloaded": true
}

// download: false の場合
{
  "success": true,
  "projectUrl": "https://labs.google/fx/ja/tools/flow/project/xxx",
  "videoCount": 1,
  "totalTime": "85s",
  "downloaded": false
}
```

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

## 技術的解説

このセクションでは、スクリプトの内部動作と実装上の工夫を説明します。

### Chrome CDP接続アーキテクチャ

```
┌─────────────────┐     CDP      ┌──────────────────────────┐
│  Docker (n8n)   │ ←─────────→ │  Windows Chrome          │
│  192.168.65.254 │   Port 9222  │  --remote-debugging-port │
└─────────────────┘              └──────────────────────────┘
```

- **Playwright `connectOverCDP()`**: 既存のChromeセッションに接続
- **Docker→Windows通信**: `192.168.65.254:9222` を使用（`host.docker.internal`は動作しない）

### 既存画像の自動削除メカニズム

`projectUrl`で既存プロジェクトを使用する場合、以前アップロードした画像が残っていることがあります。

**問題:** 既存画像があると新しい画像がアップロードできない

**解決策:** 以下の順序で既存画像を検出・削除

```javascript
// 1. addボタンをクリック（これで削除ボタンが表示される）
await addImgBtn.click();

// 2. google-symbolsアイコンから"close"を探す
const closeIcons = await page.$$('i.google-symbols');
for (const icon of closeIcons) {
  const text = await icon.evaluate(el => el.textContent);
  if (text.trim() === 'close') {
    // 親divをクリックして削除
    await icon.evaluate(el => el.parentElement.click());
    break;
  }
}

// 3. 再度addボタンをクリックしてアップロードダイアログを開く
// （削除した場合のみ必要）
```

**HTMLの構造:**
```html
<!-- 削除ボタン -->
<div class="..."><i class="google-symbols">close</i></div>

<!-- 追加ボタン -->
<button class="..."><i class="google-symbols">add</i></button>
```

注意: `<button>`要素ではなく`<div>`+`<i>`構造のため、`i.google-symbols`で検索する必要がある

### ダウンロード処理の最適化

**問題:** `--remote-debugging-address=0.0.0.0`使用時、Chromeのダウンロードマネージャーが正常動作しない

**解決策:** エクスポート完了待機 + 4段階のフォールバック

```
1. ダウンロードボタンクリック → エクスポートダイアログ表示待機
2. エクスポート完了待機（href準備完了 or プログレス表示消失まで、最低10分）
   ↓ 完了後
方法1: hrefから直接ダウンロード（HTTP/data/blob URL対応）
   ↓ 失敗時
方法2: ダウンロードリンクをクリックしてイベント待機（3分）
   ↓ 失敗時
方法3: キャプチャしたネットワークURLを使用
   ↓ 失敗時
方法4: Chromeダウンロードフォルダ（/mnt/downloads）を検索
```

**エクスポート完了の判定:**
```javascript
// 有効なhrefがあればエクスポート完了
if (href && (href.startsWith('http') || href.startsWith('data:') || href.startsWith('blob:'))) {
  exportComplete = true;
}

// または、ダウンロードリンクのテキストが「準備中」でなくなったら完了
const linkText = await downloadLink.textContent();
if (!linkText.includes('準備') && !linkText.includes('Processing')) {
  exportComplete = true;
}
```

**長い動画（12シーン以上）の場合:**
- エクスポートに5分以上かかる可能性があるため、最低10分のタイムアウトを設定
- 30秒ごとにプログレス状況をログ出力
- タイムアウト時はスクリーンショットを保存（`/tmp/veo3-export-timeout.png`）

### n8nワークフロー統合のベストプラクティス

複数のシーンを生成する場合、途中でダウンロードする必要はありません。

**推奨フロー:**
```
1. 画像生成 (download: false) → projectUrl取得
2. シーン1生成 (download: false, projectUrl使用) → projectUrl継続
3. シーン2生成 (download: false, projectUrl使用) → projectUrl継続
4. 最終シーン生成 (download: true, projectUrl使用) → 動画ダウンロード
```

これにより：
- 中間ダウンロードのオーバーヘッドを削減
- プロジェクトURLで状態を引き継ぎ
- 最終的な完成動画のみをダウンロード

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

## リトライロジック

画像生成・動画生成ともに、失敗時に自動でリトライする機能があります。

### パラメータ

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| `maxRetries` | `3` | 最大リトライ回数 |
| `retryDelay` | `10000` | リトライ間隔（ミリ秒） |

### リトライ対象のエラー

以下のエラーメッセージが含まれる場合にリトライします：

- `生成できませんでした`
- `Could not generate`
- `Image generation failed`
- `Video generation failed`
- `RETRY:` プレフィックス

### 画像生成のリトライ

```javascript
// リトライ時の動作
// 1. SceneBuilder URLをプロジェクトURLに変換
//    /project/xxx/scenes/yyy → /project/xxx
// 2. プロジェクトページをリロード
// 3. 画像生成を再実行
```

### 使用例

```powershell
# カスタムリトライ設定
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{
  "mode": "image",
  "prompt": "beautiful sunset",
  "maxRetries": 5,
  "retryDelay": 15000
}'
```

---

## 更新履歴

- **2026-01-10**: マルチシーンワークフローv5追加（ループ処理、ユニークファイル）
- **2026-01-09**: 画像生成リトライロジック追加、SceneBuilder URL変換対応、isVisibleタイムアウト修正
- **2026-01-06**: ダウンロードロジック大幅改善 - エクスポート完了待機（最低10分）、4段階フォールバック、長時間動画（12シーン等）対応
- **2025-12-30**: downloadパラメータ追加（n8n連携向け）、既存画像自動削除機能、href早期終了最適化、技術的解説セクション追加
- **2025-12-29**: 画像生成モード追加（出力数・縦横比設定対応）、動画生成のvideoCount=1でシーン拡張スキップ、projectUrl対応
- **2025-12-29**: Base64ダウンロード対応、シーンビルダー遷移修正
- **2025-12-28**: 初版作成
