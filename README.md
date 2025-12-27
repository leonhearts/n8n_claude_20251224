# n8n Google Flow 動画生成自動化

Google Flow (Veo 3) を使用した動画生成を n8n ワークフローから自動化するためのスクリプト集です。

## 機能

- Google Flow での動画生成を自動化
- テキストから動画（Text to Video）モードをサポート
- Fast / Quality モデルの選択
- 通知ドロワーの自動処理
- 進行状況のスクリーンショット保存

## 必要条件

- Node.js 18+
- Playwright (`npm install playwright`)
- Chrome がリモートデバッグモードで起動していること
- Google AI Pro/Ultra サブスクリプション

## クイックスタート

```bash
# 依存関係のインストール
npm install playwright

# セレクタのテスト（推奨）
node scripts/flow-test-selectors.js

# 動画生成
node scripts/flow-video-auto.js '{"prompt": "A beautiful sunset over the ocean"}'
```

## ドキュメント

詳細は [docs/flow-video-automation-manual.md](docs/flow-video-automation-manual.md) を参照してください。

## ファイル構成

```
├── scripts/
│   ├── flow-video-auto.js       # メイン自動化スクリプト
│   └── flow-test-selectors.js   # セレクタ検証スクリプト
├── docs/
│   └── flow-video-automation-manual.md
└── README.md
```

## 更新履歴

- 2024-12-27: 通知ドロワー対応、セレクタ修正
