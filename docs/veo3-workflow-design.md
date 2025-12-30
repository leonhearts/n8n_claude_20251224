# Veo3 連続シーン生成ワークフロー 設計書

## 概要

スプレッドシートから1行ずつ読み込み、最大16シーン（画像→動画ペア）を連続生成するワークフロー。
1つのプロジェクトURLを再利用し、シーンビルダーに複数シーンを蓄積。最終シーンのみダウンロード。

## スプレッドシート構造

```
| 列名 | 説明 |
|------|------|
| status | 処理状態 (Plan/Processing/Completed/Error) |
| search_url | 元動画URL |
| search_keyword | 検索キーワード |
| upload_time | アップロード予定時刻 |
| image_prompt1〜16 | 画像生成プロンプト（最大16個） |
| video_prompt1〜16 | 動画生成プロンプト（最大16個） |
| title | YouTube用タイトル |
| youtube_text | YouTube説明文 |
| youtube_time | YouTube投稿時間 |
| twitter_status | Twitter投稿状態 |
| twitter_text | Twitter投稿テキスト |
| project_url | Veo3プロジェクトURL（自動入力） |
```

## フロー図

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. スプレッドシートから未処理行を取得                                 │
│     - status = "Plan" の行を取得                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  2. 有効なプロンプトペアを抽出                                        │
│     - image_promptN と video_promptN の両方が存在するペアを抽出        │
│     - 空のペアはスキップ                                             │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  3. シーン1生成（プロジェクト作成）                                    │
│     ├─ 画像生成 (mode: image) → projectUrl取得、画像保存              │
│     ├─ スプレッドシートにprojectURL記録                               │
│     └─ 動画生成 (mode: frame, download: false)                       │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  4. シーン2〜N生成（ループ）                                          │
│     FOR each remaining prompt pair:                                  │
│       ├─ 画像生成 (projectUrl再利用)                                 │
│       └─ 動画生成 (最後のみ download: true)                          │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  5. 完了処理                                                         │
│     - status を "Completed" に更新                                   │
│     - 最終動画パスを記録                                              │
└─────────────────────────────────────────────────────────────────────┘
```

## 重要な仕様

### 画像保存について

**画像は常にファイルに保存される（downloadパラメータとは無関係）**

```
画像生成 (mode: image)
  ↓
画像を /tmp/veo3_scene.png に保存（常に実行）
  ↓
動画生成 (mode: frame, imagePath: "/tmp/veo3_scene.png")
  ↓
動画生成完了 → シーンビルダーに追加
```

`download` パラメータは**最終動画のダウンロード**のみを制御：
- `download: false` → 動画生成後、ダウンロードせずプロジェクトURLのみ返す
- `download: true` → 動画生成後、動画ファイルをダウンロード

### projectUrl の流れ

```
シーン1: 画像生成 → projectUrl取得（新規作成）
         ↓
シーン1: 動画生成 → projectUrl再利用
         ↓
シーン2: 画像生成 → projectUrl再利用（既存画像削除→新画像アップロード）
         ↓
シーン2: 動画生成 → projectUrl再利用
         ↓
        ...（繰り返し）
         ↓
最終シーン: 動画生成 → download: true で動画ダウンロード
```

## ノード構成

### Phase 1: 初期化

#### 1-1. Google Sheets Trigger または Manual Trigger
```
Trigger on: New row with status = "Plan"
or
Manual execution for batch processing
```

#### 1-2. Google Sheets - Read Row
```
Operation: Read specific row
Sheet: メインシート
Output: Row data with all columns
```

#### 1-3. Code - Extract Prompt Pairs
```javascript
const row = $input.first().json;
const promptPairs = [];

// 最大16ペアをチェック
for (let i = 1; i <= 16; i++) {
  const imagePrompt = row['image_prompt' + i];
  const videoPrompt = row['video_prompt' + i];

  // 両方が存在する場合のみ追加
  if (imagePrompt && imagePrompt.trim() && videoPrompt && videoPrompt.trim()) {
    promptPairs.push({
      index: i,
      imagePrompt: imagePrompt.trim(),
      videoPrompt: videoPrompt.trim(),
      isFirst: promptPairs.length === 0,
      isLast: false  // 後で更新
    });
  }
}

if (promptPairs.length === 0) {
  throw new Error('有効なプロンプトペアがありません');
}

// 最後のペアにフラグを設定
promptPairs[promptPairs.length - 1].isLast = true;

return [{
  json: {
    rowIndex: row.rowIndex || $input.first().json.$row,
    promptPairs: promptPairs,
    totalScenes: promptPairs.length
  }
}];
```

#### 1-4. Google Sheets - Update Status to Processing
```
Operation: Update row
Column: status
Value: Processing
```

### Phase 2: 最初のシーン（プロジェクト作成）

#### 2-1. Execute Command - Image Generation (First)
```bash
node /home/node/veo3-shorts-simple.js '{{ JSON.stringify({
  mode: "image",
  prompt: $json.promptPairs[0].imagePrompt,
  outputPath: "/tmp/veo3_scene.png"
}) }}'
```
**タイムアウト: 300000ms (5分)**

#### 2-2. Code - Parse Image Result
```javascript
const output = $input.first().json.stdout;
const result = JSON.parse(output);

if (!result.success) {
  throw new Error('Image generation failed: ' + (result.error || 'Unknown error'));
}

return [{
  json: {
    projectUrl: result.projectUrl,
    imagePath: result.outputPath,
    promptPairs: $('Extract Prompt Pairs').item.json.promptPairs,
    rowIndex: $('Extract Prompt Pairs').item.json.rowIndex
  }
}];
```

#### 2-3. Google Sheets - Write ProjectURL
```
Operation: Update row
Row: {{ $json.rowIndex }}
Column: project_url
Value: {{ $json.projectUrl }}
```

#### 2-4. Execute Command - Video Generation (First)
```bash
node /home/node/veo3-shorts-simple.js '{{ JSON.stringify({
  mode: "frame",
  prompt: $json.promptPairs[0].videoPrompt,
  imagePath: "/tmp/veo3_scene.png",
  projectUrl: $json.projectUrl,
  download: $json.promptPairs[0].isLast
}) }}'
```
**タイムアウト: 900000ms (15分)**

#### 2-5. Code - Prepare Loop
```javascript
const output = $input.first().json.stdout;
const result = JSON.parse(output);

if (!result.success) {
  throw new Error('Video generation failed: ' + (result.error || 'Unknown error'));
}

const promptPairs = $('Parse Image Result').item.json.promptPairs;
const remainingPairs = promptPairs.slice(1);

// 最初のシーンが最後だった場合（1シーンのみ）
if (promptPairs[0].isLast) {
  return [{
    json: {
      completed: true,
      outputPath: result.outputPath,
      projectUrl: result.projectUrl,
      totalScenes: 1,
      rowIndex: $('Parse Image Result').item.json.rowIndex
    }
  }];
}

// 残りのシーンを返す
return remainingPairs.map((pair, idx) => ({
  json: {
    imagePrompt: pair.imagePrompt,
    videoPrompt: pair.videoPrompt,
    isLast: pair.isLast,
    sceneIndex: pair.index,
    projectUrl: result.projectUrl,
    rowIndex: $('Parse Image Result').item.json.rowIndex
  }
}));
```

### Phase 3: 残りのシーン（ループ）

#### 3-1. IF - Check If Completed
```
Condition: {{ $json.completed }} === true
True → Go to Final Update
False → Continue to Loop
```

#### 3-2. Split In Batches
```
Batch Size: 1
Options: Process items individually
```

#### 3-3. Execute Command - Image Generation (Loop)
```bash
node /home/node/veo3-shorts-simple.js '{{ JSON.stringify({
  mode: "image",
  prompt: $json.imagePrompt,
  outputPath: "/tmp/veo3_scene.png",
  projectUrl: $json.projectUrl
}) }}'
```

#### 3-4. Code - Parse Loop Image Result
```javascript
const output = $input.first().json.stdout;
const result = JSON.parse(output);

if (!result.success) {
  throw new Error('Image generation failed: ' + (result.error || 'Unknown error'));
}

return [{
  json: {
    videoPrompt: $json.videoPrompt,
    isLast: $json.isLast,
    sceneIndex: $json.sceneIndex,
    projectUrl: result.projectUrl,
    rowIndex: $json.rowIndex
  }
}];
```

#### 3-5. Execute Command - Video Generation (Loop)
```bash
node /home/node/veo3-shorts-simple.js '{{ JSON.stringify({
  mode: "frame",
  prompt: $json.videoPrompt,
  imagePath: "/tmp/veo3_scene.png",
  projectUrl: $json.projectUrl,
  download: $json.isLast,
  outputPath: "/tmp/veo3_final.mp4"
}) }}'
```

#### 3-6. Code - Parse Loop Video Result
```javascript
const output = $input.first().json.stdout;
const result = JSON.parse(output);

if (!result.success) {
  throw new Error('Video generation failed: ' + (result.error || 'Unknown error'));
}

return [{
  json: {
    completed: $json.isLast,
    outputPath: result.outputPath || null,
    projectUrl: result.projectUrl,
    sceneIndex: $json.sceneIndex,
    rowIndex: $json.rowIndex
  }
}];
```

### Phase 4: 完了処理

#### 4-1. Merge (Wait for all items)
```
Mode: Merge by position
```

#### 4-2. Google Sheets - Update Status to Completed
```
Operation: Update row
Row: {{ $json.rowIndex }}
Column: status
Value: Completed
```

## 実行パラメータまとめ

| フェーズ | Mode | projectUrl | download | outputPath |
|---------|------|------------|----------|------------|
| 最初の画像 | image | なし | - | /tmp/veo3_scene.png |
| 最初の動画 | frame | 取得したURL | isLast | - |
| ループ画像 | image | 再利用 | - | /tmp/veo3_scene.png（上書き） |
| ループ動画 | frame | 再利用 | isLast | /tmp/veo3_final.mp4 |

**重要:**
- 画像は常に `/tmp/veo3_scene.png` に保存（毎回上書き）
- 動画ダウンロードは最後のシーンのみ（`isLast: true`）
- projectUrlは最初の画像生成時に取得し、以降再利用

## エラーハンドリング

### リトライ設定
```
各Execute Commandノード:
  - Retry on Fail: Yes
  - Max Retries: 2
  - Wait Between Retries: 30000ms
```

### エラー時の処理
```javascript
// Error Workflow
// statusを "Error" に更新
// エラーメッセージをerror_message列に記録
```

## タイムアウト設定

| ノード | タイムアウト |
|--------|------------|
| 画像生成 | 300000ms (5分) |
| 動画生成（中間） | 900000ms (15分) |
| 動画生成（最終+ダウンロード） | 1800000ms (30分) |

## 制約事項

1. **シーン数上限**: 1プロジェクトあたり最大16シーン
2. **シーケンシャル実行**: 並列実行不可（同一projectUrlを使用するため）
3. **一時ファイル上書き**: `/tmp/veo3_scene.png` は毎シーン上書き

## 処理時間の目安

| シーン数 | 画像生成 | 動画生成 | ダウンロード | 合計 |
|---------|---------|---------|------------|------|
| 1シーン | 30秒 | 90秒 | 60秒 | 約3分 |
| 4シーン | 2分 | 6分 | 60秒 | 約9分 |
| 8シーン | 4分 | 12分 | 60秒 | 約17分 |
| 16シーン | 8分 | 24分 | 60秒 | 約33分 |

---

## 更新履歴

- **2025-12-30**: 実際のスプレッドシート構造に合わせて設計書を大幅改訂
- **2025-12-30**: 初版作成
