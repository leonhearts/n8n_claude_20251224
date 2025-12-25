# n8n Browser Automation System

n8nからWindows上のChromeブラウザに接続し、Google AI サービスを自動化するシステムです。

## 機能

### 1. Gemini 壁打ち自動化
Google Geminiとの連続会話を自動化し、ブログ記事を生成します。

### 2. Flow ショート動画自動生成 (NEW)
Google Flow (labs.google/fx/tools/flow) を使用してAI動画を自動生成します。

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                        Windows Server                            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Chrome (リモートデバッグモード)                              ││
│  │  - ポート: 9222                                              ││
│  │  - CDP (Chrome DevTools Protocol) 経由でアクセス            ││
│  └─────────────────────────────────────────────────────────────┘│
│                              ↕                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Docker Container (n8n-n8n-1)                                ││
│  │  ├── n8n Workflow Engine                                     ││
│  │  └── Playwright Scripts                                      ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## ディレクトリ構成

```
.
├── README.md
├── scripts/
│   ├── gemini-auto.js        # Gemini自動化スクリプト
│   └── flow-video-auto.js    # Flow動画生成スクリプト
├── workflows/
│   ├── gemini-automation-workflow.json   # Gemini用n8nワークフロー
│   └── flow-video-workflow.json          # Flow用n8nワークフロー
└── docs/
    ├── gemini-automation-manual.md       # Geminiマニュアル
    └── flow-video-automation-manual.md   # Flowマニュアル
```

---

## セットアップ

### 1. Chromeをリモートデバッグモードで起動

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --remote-debugging-address=0.0.0.0 `
  --user-data-dir="C:\gemini-chrome-profile"
```

### 2. 必要なアカウント設定

- **Gemini**: https://gemini.google.com にログイン
- **Flow**: https://labs.google/fx/tools/flow にアクセス（Google AI Pro/Ultra サブスクリプション必要）

### 3. Docker設定

`docker-compose.yml` に以下を追加:

```yaml
services:
  n8n:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

### 4. スクリプトのデプロイ

```powershell
docker cp scripts/gemini-auto.js n8n-n8n-1:/home/node/scripts/
docker cp scripts/flow-video-auto.js n8n-n8n-1:/home/node/scripts/
```

---

## 使用方法

### Gemini自動化

```bash
docker exec n8n-n8n-1 node /home/node/scripts/gemini-auto.js \
  '{"prompts": [{"text": "Hello!", "index": 1}]}'
```

### Flow動画生成

```bash
docker exec n8n-n8n-1 node /home/node/scripts/flow-video-auto.js \
  '{"prompt": "A sunset over the ocean", "model": "fast"}'
```

---

## 接続確認

```powershell
# Chrome CDPの接続テスト
docker exec n8n-n8n-1 curl -s http://192.168.65.254:9222/json/version
```

---

## ドキュメント

- [Gemini自動化マニュアル](docs/gemini-automation-manual.md)
- [Flow動画生成マニュアル](docs/flow-video-automation-manual.md)

---

## 参考リンク

- [Google Gemini](https://gemini.google.com)
- [Google Flow](https://labs.google/fx/tools/flow)
- [Flow ヘルプ](https://support.google.com/labs/answer/16353334)
- [n8n Documentation](https://docs.n8n.io)
- [Playwright Documentation](https://playwright.dev)

---

## ライセンス

MIT License
