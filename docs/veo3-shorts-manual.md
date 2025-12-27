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
ショート音声切出 → Veo3動画生成 → Veo3結果パース → ショート動画生成3（Veo3動画+FFmpeg）
```

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

### 2. 既存ワークフローに追加するノード

#### ノード1: Veo3動画生成
- **タイプ:** Execute Command
- **位置:** ショート音声切出の後
- **コマンド:**
```
node /home/node/veo3-shorts-simple.js '{{ JSON.stringify({
  prompt: $('プロンプト生成 ✔').item.json.output.header_short + " " + $('プロンプト生成 ✔').item.json.output.footer_short,
  imagePath: "/tmp/output_kaeuta.png",
  outputPath: "/tmp/veo3_shorts_kaeuta.mp4",
  mode: "image",
  videoCount: 2
}) }}'
```
- **タイムアウト:** 1800000ms（30分）

#### ノード2: Veo3結果パース
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

### 3. ショート動画生成3 の修正

既存のFFmpegコマンドを、Veo3動画対応版に置き換え：

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

## 動作フロー

1. `ジャケット画像保存` で `/tmp/output_kaeuta.png` が保存される
2. `ショート音声切出` で `/tmp/short_audio_kaeuta.mp3` が作成される
3. `Veo3動画生成` がジャケット画像を使って2つの動画を生成・結合
4. `ショート動画生成3` がVeo3動画にテキストとオーディオを追加

## フォールバック

Veo3生成が失敗した場合、自動的に従来の静止画モードにフォールバックします。

## テスト

```bash
# スクリプト単体テスト
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{"prompt":"test animation","imagePath":"/tmp/output_kaeuta.png","videoCount":1}'
```

## 注意事項

- Veo3は1動画あたり約90秒かかるため、2動画で約3分の追加時間
- 既存のワークフローの他の部分は一切変更不要
- `mode: "text"` に変更すると、画像なしのText-to-Videoモードになる
