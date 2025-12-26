# Google Flow 動画生成自動化 マニュアル

## 概要

n8nからWindows上のChromeブラウザに接続し、Google Flow（labs.google/fx/tools/flow）で自動的にAI動画を生成するシステムです。

---

## 前提条件

- **Google AI Pro/Ultra サブスクリプション** が必要
- Chromeがリモートデバッグモードで起動していること
- Googleアカウントでログイン済みであること
- Google Flowにアクセス可能であること

---

## Google Flowについて

### 概要

Flow は Google の AI 映像制作ツールで、以下のモデルを使用:
- **Veo 3**: 動画生成
- **Imagen 4**: 画像生成
- **Gemini**: テキスト処理

### 料金

| モデル | クレジット/動画 |
|--------|----------------|
| Veo 3 – Fast | 20 クレジット |
| Veo 3 – Quality | 100 クレジット |

### 動画仕様

- 8秒のクリップを生成
- 複数クリップを結合可能
- カメラコントロール機能あり

---

## 1. セットアップ

### 1.1 Chromeの準備

Gemini自動化と同じChromeを使用します:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"
```

### 1.2 Google Flowへのアクセス確認

1. Chromeで https://labs.google/fx/tools/flow を開く
2. サブスクリプションが有効か確認
3. "New project" が表示されればOK

### 1.3 スクリプトのデプロイ

```powershell
docker cp C:\gemini-login\flow-video-auto.js n8n-n8n-1:/home/node/scripts/flow-video-auto.js
```

---

## 2. 使用方法

### 2.1 コマンドライン実行

```bash
# Docker内から実行
docker exec n8n-n8n-1 node /home/node/scripts/flow-video-auto.js '{"prompt": "A serene sunset over the ocean, cinematic shot", "model": "fast"}'
```

### 2.2 入力パラメータ

```json
{
  "prompt": "動画の説明プロンプト",
  "model": "fast",
  "projectUrl": "https://labs.google/fx/tools/flow/project/xxx",
  "waitTimeout": 600000
}
```

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| prompt | ○ | 動画生成のプロンプト |
| model | × | "fast" または "quality"（デフォルト: fast） |
| projectUrl | × | 既存プロジェクトURL |
| waitTimeout | × | 最大待機時間（ミリ秒、デフォルト: 600000 = 10分） |

### 2.3 出力

```json
{
  "success": true,
  "videoUrl": "https://...",
  "projectUrl": "https://labs.google/fx/tools/flow/project/xxx",
  "screenshot": "/home/node/scripts/flow-final-result.png",
  "generationTime": "120s"
}
```

---

## 3. プロンプトのコツ

### 効果的なプロンプト要素

1. **被写体とアクション**: 明確なキャラクター/オブジェクトと動き
2. **カメラワーク**: wide shot, close-up, tracking shot, aerial view など
3. **ロケーションと照明**: 環境設定とムード

### 良いプロンプト例

```
A young woman walking through a rainy Tokyo street at night,
neon signs reflecting on wet pavement,
cinematic tracking shot, warm colors
```

### 避けるべきこと

- 詳細すぎる指示（グリッチの原因）
- 複数の複雑なアクション
- 物理法則に反する動き

---

## 4. n8nワークフロー設定

### ワークフロー名
`Flow ショート動画自動生成`

### ノード構成

```
Schedule Trigger
      ↓
スクリプト作成（flow-video-auto.js）
      ↓
プロンプト準備（Code）
      ↓
Flow実行（Execute Command）
      ↓
結果パース（Code）
      ↓
動画ダウンロード（HTTP Request）※オプション
```

### Execute Command ノード設定

```
node /home/node/scripts/flow-video-auto.js '{{ JSON.stringify($json) }}' 2>&1
```

### 結果パースコード

```javascript
const stdout = $json.stdout || '';
const lines = stdout.split('\n');
let result = {};
for (const line of lines) {
  if (line.startsWith('{') && (line.includes('success') || line.includes('error'))) {
    try {
      result = JSON.parse(line);
      break;
    } catch (e) {}
  }
}
if (Object.keys(result).length === 0) {
  result = { error: 'Parse failed', raw: stdout };
}
return { json: result };
```

---

## 5. トラブルシューティング

### 問題: ログインエラー

**症状**: `Not logged in to Google`

**解決策**:
1. Chromeで https://labs.google/fx/tools/flow を開く
2. Google アカウントでログイン
3. サブスクリプションが有効か確認

### 問題: プロンプト入力が見つからない

**症状**: `Could not find prompt input`

**解決策**:
```powershell
# スクリーンショットを確認
docker cp n8n-n8n-1:/home/node/scripts/flow-no-prompt-input.png C:\gemini-login\
```

UIが変更された可能性あり。セレクタの更新が必要。

### 問題: 動画生成がタイムアウト

**症状**: 10分以上待っても完了しない

**解決策**:
- waitTimeout を延長（最大20分程度）
- Quality モデルは時間がかかる
- Googleサーバー側の問題の可能性

### 問題: クレジット不足

**症状**: 生成が開始されない

**解決策**:
- Google AI サブスクリプションを確認
- クレジット残高を確認

---

## 6. スクリーンショット一覧

| ファイル名 | 説明 |
|-----------|------|
| flow-step1-loaded.png | ページ読み込み後 |
| flow-step2-prompt-entered.png | プロンプト入力後 |
| flow-step3-generating.png | 生成開始後 |
| flow-progress-60s.png | 進行状況（60秒後） |
| flow-final-result.png | 最終結果 |
| flow-error.png | エラー発生時 |
| flow-login-required.png | ログイン必要時 |

---

## 7. よく使うコマンド

```powershell
# スクリプトをコンテナにコピー
docker cp C:\gemini-login\flow-video-auto.js n8n-n8n-1:/home/node/scripts/

# テスト実行
docker exec n8n-n8n-1 node /home/node/scripts/flow-video-auto.js '{"prompt": "test", "model": "fast"}' 2>&1

# 最新スクリーンショット確認
docker cp n8n-n8n-1:/home/node/scripts/flow-final-result.png C:\gemini-login\
C:\gemini-login\flow-final-result.png

# 進行状況確認
docker cp n8n-n8n-1:/home/node/scripts/flow-step3-generating.png C:\gemini-login\
C:\gemini-login\flow-step3-generating.png
```

---

## 参考リンク

- [Google Flow 公式](https://labs.google/fx/tools/flow)
- [Flow ヘルプ - 動画生成](https://support.google.com/labs/answer/16353334)
- [Flow プロンプティングガイド](https://blog.google/technology/ai/flow-video-tips/)
