# Veo3 ショート動画生成 - SUNOワークフロー統合

既存のSUNOワークフローに最小限の変更でVeo3動画生成を追加する方法。

## 概要

現在のショート動画生成（静止画ループ）を、Veo3で生成した動画に置き換えます。

**変更前:**
```
ショート音声切出 → ショート動画生成3（静止画+FFmpeg）
```

**変更後:**
```
ショート音声切出 → Veo3動画生成 → ショート動画生成3（Veo3動画+FFmpeg）
```

## Veo3 動画生成フロー

### mode: "frame"（フレームから動画）

**1回目（画像アップロード+生成）:**
1. 「フレームから動画」モードを選択
2. 「+」ボタンで画像追加エリアを開く
3. 「アップロード」ボタンをクリック
4. ファイル選択（input[type="file"]）
5. 「切り抜きして保存」ボタン
6. プロンプト入力
7. 送信ボタン → 動画生成待機

**2回目以降（シーン拡張）:**
1. `#PINHOLE_ADD_CLIP_CARD_ID`（シーン追加+ボタン）をクリック
2. 「拡張…」メニューを選択
3. プロンプト入力
4. 送信ボタン → 動画生成待機

### mode: "text"（テキストから動画）

毎回新しいプロジェクトを作成してテキストのみで生成。

## ファイル構成

```
scripts/
└── veo3-shorts-simple.js  # Veo3動画生成スクリプト

workflows/
└── suno-veo3-patch.json   # 追加ノード定義
```

## セットアップ

### 1. スクリプトをDockerにコピー

```powershell
docker cp C:\script_all\n8n_claude_20251224\scripts\veo3-shorts-simple.js n8n-n8n-1:/home/node/veo3-shorts-simple.js
docker exec -u root n8n-n8n-1 chown node:node /home/node/veo3-shorts-simple.js
```

### 2. 使用方法

```bash
# フレームから動画（デフォルト）
node /home/node/veo3-shorts-simple.js '{
  "prompt": "ゆっくりとした動き",
  "imagePath": "/tmp/output_kaeuta.png",
  "mode": "frame",
  "videoCount": 2
}'

# テキストから動画
node /home/node/veo3-shorts-simple.js '{
  "prompt": "美しい風景",
  "mode": "text",
  "videoCount": 2
}'
```

### 3. n8n ワークフローへの追加

#### ノード1: Veo3動画生成
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

#### ノード2: ショート動画生成3の修正

既存のFFmpegコマンドを、Veo3動画対応版に置き換え：

```bash
if [ -f "/tmp/veo3_shorts_kaeuta.mp4" ] && [ -s "/tmp/veo3_shorts_kaeuta.mp4" ]; then
  # Veo3動画を使用
  ffmpeg -y -i /tmp/veo3_shorts_kaeuta.mp4 -i /tmp/short_audio_kaeuta.mp3 \
    -filter_complex "[0:v]scale=1080:1920:...[outv]" \
    -map "[outv]" -map 1:a \
    -c:v libx264 -c:a aac -shortest -t 15 \
    /tmp/output_short_kaeuta.mp4
else
  # フォールバック: 従来の静止画モード
  ffmpeg -y -loop 1 -i /tmp/output_kaeuta.png ...
fi
```

## 動作フロー

```
1. ジャケット画像保存 → /tmp/output_kaeuta.png
2. ショート音声切出 → /tmp/short_audio_kaeuta.mp3
3. Veo3動画生成:
   a. フレームから動画モード選択
   b. 画像アップロード → 切り抜き保存
   c. プロンプト入力 → 1回目の動画生成
   d. シーン拡張 → 2回目の動画生成
   e. 2つの動画をFFmpegで結合
   → /tmp/veo3_shorts_kaeuta.mp4
4. ショート動画生成3:
   - Veo3動画 + SUNO音声 + テキストオーバーレイ
   → /tmp/output_short_kaeuta.mp4
```

## セレクタ一覧

| 要素 | セレクタ |
|------|----------|
| モード選択 | `button[role="combobox"]` |
| フレームから動画 | `text=フレームから動画` |
| 画像追加+ | `button:has(i.google-symbols:text("add"))` |
| アップロード | `button:has(i:text("upload"))` |
| ファイル入力 | `input[type="file"]` |
| 切り抜き保存 | `button:has-text("切り抜きして保存")` |
| シーン追加+ | `#PINHOLE_ADD_CLIP_CARD_ID` |
| 拡張メニュー | `div[role="menuitem"]:has-text("拡張")` |
| プロンプト | `#PINHOLE_TEXT_AREA_ELEMENT_ID` |
| 作成ボタン | `button:has(i:text("arrow_forward"))` |

## フォールバック

Veo3生成が失敗した場合、自動的に従来の静止画モードにフォールバックします。

## 注意事項

- Veo3は1動画あたり約90秒、2動画で約3分の追加時間
- シーン拡張は同一プロジェクト内で行うため、一貫性のある動画になる
- 既存のワークフローの他の部分は変更不要
