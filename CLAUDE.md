# Claude Code ガイドライン

## 言語
- ユーザーとのやり取りは日本語で行う
- コード内のコメントは日本語OK
- 変数名・関数名は英語

## Git運用ルール
- 新機能は`main`から新ブランチを切る
- 完了したらすぐ`main`にマージ
- 同じファイルを複数セッションで同時に触らない
- コミットメッセージは英語

## プロジェクト構成
```
├── scripts/           # 自動化スクリプト
│   ├── veo3-character-video.js  # キャラクター動画生成
│   ├── veo3-common.js           # 共通モジュール
│   ├── veo3-shorts-simple.js    # ショート動画生成
│   ├── flow-video-auto.js       # Flow動画自動化
│   └── gemini-auto.js           # Gemini自動化
├── workflows/         # n8nワークフローJSON
├── docs/             # ドキュメント
└── README.md
```

## スクリプト開発ルール

### 並列実行対応
- 一時ファイルはハードコードせず、`config.outputPath`から導出する
- 例: `const tempPath = config.outputPath.replace('.mp4', '_temp.mp4');`
- n8nワークフロー側で`executionId`を使ってユニークなパスを生成

### Playwright/ブラウザ自動化
- Chrome CDPは `http://192.168.65.254:9222` に接続
- クリック操作には `{ force: true }` を付ける（オーバーレイ対策）
- 長時間処理にはリトライロジックを実装（3回リトライ、指数バックオフ）

### エラーハンドリング
- エラー時はスクリーンショットを `/tmp/` に保存
- JSON出力: 成功時 `{ success: true, ... }`、失敗時 `{ error: "message" }`

## 変更前の確認
- コード変更前に必ず現状を確認する
- 勝手に新ファイルを作らず、既存ファイルの修正を優先
- 大きな変更は先に提案して承認を得る

## よく使うコマンド（毎回完全な形で出力すること）

スクリプト修正後は以下のコマンドを省略せずに提示する：

### Gitからプル（ローカルPC）
```powershell
git pull origin main
```

### Dockerコンテナへコピー（ローカルPC）
```powershell
# veo3-character-video.js
docker cp C:\script_all\n8n_claude_20251224\scripts\veo3-character-video.js n8n-n8n-1:/home/node/veo3-character-video.js

# veo3-common.js
docker cp C:\script_all\n8n_claude_20251224\scripts\veo3-common.js n8n-n8n-1:/home/node/veo3-common.js

# veo3-shorts-simple.js
docker cp C:\script_all\n8n_claude_20251224\scripts\veo3-shorts-simple.js n8n-n8n-1:/home/node/veo3-shorts-simple.js
```

### コンテナ内で直接編集する場合
```bash
# ファイルを開く
vi /home/node/veo3-common.js

# 編集後、保存して終了
:wq
```
