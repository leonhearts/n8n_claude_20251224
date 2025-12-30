# Veo3 連続シーン生成ワークフロー 設計書

## 概要

スプレッドシートからプロンプトを順番に読み込み、画像→動画を連続生成するワークフロー。
1つのプロジェクトURLを再利用することで、シーンビルダーに複数シーンを蓄積する。

## フロー図

```
┌─────────────────────────────────────────────────────────────────────┐
│  開始                                                                │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  1. スプレッドシートからプロンプト一覧を取得                            │
│     - Google Sheets node                                            │
│     - 出力: [{prompt, index}, ...]                                   │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  2. 最初のシーン生成（プロジェクト作成）                               │
│     ├─ 2a. 画像生成 (mode: image, download: false)                   │
│     │       → projectUrl取得                                        │
│     ├─ 2b. DriveにprojectURL記録                                    │
│     └─ 2c. 動画生成 (mode: frame, projectUrl使用, download: false)   │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  3. 残りのシーン生成（ループ）                                        │
│     FOR each prompt (index > 0):                                    │
│       ├─ 3a. 画像生成 (projectUrl使用, download: false)              │
│       ├─ 3b. 最後のプロンプトか判定                                  │
│       │       ├─ YES → download: true                               │
│       │       └─ NO  → download: false                              │
│       └─ 3c. 動画生成 (projectUrl使用)                               │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  終了（最終動画ダウンロード完了）                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## データフロー

```
スプレッドシート
┌──────────────────────────────────┐
│ A列: prompt                      │
│ B列: projectUrl (出力用)         │
│ C列: status (処理状態)           │
└──────────────────────────────────┘

例:
| prompt                    | projectUrl | status    |
|---------------------------|------------|-----------|
| 海辺の夕焼け               | (自動入力) | completed |
| 波が打ち寄せる             | (自動入力) | completed |
| 太陽が沈んでいく           | (自動入力) | completed |
```

## ノード構成

### Phase 1: 初期化

#### 1-1. Google Sheets - Read Prompts
```
Operation: Read rows
Sheet: プロンプト一覧
Range: A:C
Output: items[] with {prompt, projectUrl, status}
```

#### 1-2. Code - Filter & Prepare
```javascript
// 未処理のプロンプトを抽出
const items = $input.all();
const pending = items.filter(item => item.json.status !== 'completed');

if (pending.length === 0) {
  throw new Error('処理するプロンプトがありません');
}

return [{
  json: {
    prompts: pending.map((item, idx) => ({
      prompt: item.json.prompt,
      rowIndex: items.indexOf(item) + 2, // スプレッドシートの行番号（ヘッダー除く）
      isFirst: idx === 0,
      isLast: idx === pending.length - 1
    })),
    totalCount: pending.length
  }
}];
```

### Phase 2: 最初のシーン（プロジェクト作成）

#### 2-1. Execute Command - Image Generation (First)
```bash
node /home/node/veo3-shorts-simple.js '{{ JSON.stringify({
  mode: "image",
  prompt: $json.prompts[0].prompt,
  outputPath: "/tmp/veo3_scene.png",
  download: false
}) }}'
```

#### 2-2. Code - Parse Image Result
```javascript
const output = $input.first().json.stdout;
const result = JSON.parse(output);
if (!result.success) {
  throw new Error('Image generation failed: ' + result.error);
}
return [{
  json: {
    projectUrl: result.projectUrl,
    imagePath: "/tmp/veo3_scene.png",
    prompts: $('Filter & Prepare').item.json.prompts
  }
}];
```

#### 2-3. Google Sheets - Write ProjectURL
```
Operation: Update row
Row: {{ $json.prompts[0].rowIndex }}
Column B: {{ $json.projectUrl }}
Column C: processing
```

#### 2-4. Execute Command - Video Generation (First)
```bash
node /home/node/veo3-shorts-simple.js '{{ JSON.stringify({
  mode: "frame",
  prompt: $json.prompts[0].prompt,
  imagePath: "/tmp/veo3_scene.png",
  projectUrl: $json.projectUrl,
  download: false
}) }}'
```

#### 2-5. Code - Parse Video Result & Prepare Loop
```javascript
const output = $input.first().json.stdout;
const result = JSON.parse(output);
if (!result.success) {
  throw new Error('Video generation failed: ' + result.error);
}

const prompts = $('Parse Image Result').item.json.prompts;
const remainingPrompts = prompts.slice(1); // 最初以外

return remainingPrompts.map((p, idx) => ({
  json: {
    prompt: p.prompt,
    rowIndex: p.rowIndex,
    isLast: p.isLast,
    projectUrl: result.projectUrl,
    sceneIndex: idx + 2 // シーン番号（2から開始）
  }
}));
```

### Phase 3: 残りのシーン（ループ）

#### 3-1. Execute Command - Image Generation (Loop)
```bash
node /home/node/veo3-shorts-simple.js '{{ JSON.stringify({
  mode: "image",
  prompt: $json.prompt,
  outputPath: "/tmp/veo3_scene.png",
  projectUrl: $json.projectUrl,
  download: false
}) }}'
```

#### 3-2. Code - Parse & Determine Download
```javascript
const output = $input.first().json.stdout;
const result = JSON.parse(output);
if (!result.success) {
  throw new Error('Image generation failed: ' + result.error);
}

return [{
  json: {
    prompt: $json.prompt,
    rowIndex: $json.rowIndex,
    isLast: $json.isLast,
    projectUrl: result.projectUrl,
    sceneIndex: $json.sceneIndex,
    shouldDownload: $json.isLast // 最後のみダウンロード
  }
}];
```

#### 3-3. Execute Command - Video Generation (Loop)
```bash
node /home/node/veo3-shorts-simple.js '{{ JSON.stringify({
  mode: "frame",
  prompt: $json.prompt,
  imagePath: "/tmp/veo3_scene.png",
  projectUrl: $json.projectUrl,
  download: $json.shouldDownload,
  outputPath: "/tmp/veo3_final.mp4"
}) }}'
```

#### 3-4. Google Sheets - Update Status
```
Operation: Update row
Row: {{ $json.rowIndex }}
Column C: completed
```

#### 3-5. IF - Check Final Download
```
Condition: {{ $json.shouldDownload }} === true
```

#### 3-6. (True Branch) Code - Final Result
```javascript
const output = $input.first().json.stdout;
const result = JSON.parse(output);

return [{
  json: {
    success: true,
    outputPath: result.outputPath,
    projectUrl: result.projectUrl,
    totalScenes: $json.sceneIndex,
    message: '全シーン生成完了'
  }
}];
```

## 実行パラメータまとめ

| Phase | Mode | projectUrl | download | 備考 |
|-------|------|------------|----------|------|
| 2-1 | image | なし | false | 新規プロジェクト作成 |
| 2-4 | frame | あり | false | シーン1追加 |
| 3-1 | image | あり | false | 既存プロジェクトに画像追加 |
| 3-3 | frame | あり | isLast | 最終シーンのみダウンロード |

## エラーハンドリング

### リトライ設定
- 各Execute Commandノードに `Retry on Fail` を設定
- 最大3回リトライ、間隔30秒

### エラー時の処理
```javascript
// エラー発生時、スプレッドシートのstatusを'error'に更新
// エラーメッセージをD列に記録
```

## タイムアウト設定

| ノード | タイムアウト |
|--------|------------|
| 画像生成 | 300000ms (5分) |
| 動画生成 | 900000ms (15分) |
| 最終ダウンロード | 1800000ms (30分) |

## 注意事項

1. **プロジェクトURL再利用の制約**
   - 同じプロジェクトに最大10シーンまで
   - 超える場合は新規プロジェクト作成が必要

2. **画像パスの固定**
   - `/tmp/veo3_scene.png` を毎回上書き
   - 並列実行は不可（シーケンシャル実行のみ）

3. **シーンビルダーの状態**
   - 各シーン追加後、自動的にシーンビルダーに遷移
   - 次のシーン生成時は前のシーンが保持されている

## 将来の拡張

- [ ] 並列実行対応（複数プロジェクト同時生成）
- [ ] プロンプトテンプレート機能
- [ ] 生成画像のDrive保存
- [ ] Slack/Discord通知

---

## 更新履歴

- **2025-12-30**: 初版作成
