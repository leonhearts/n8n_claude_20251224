# Gemini 壁打ち自動化 セットアップガイド

## 概要

n8nからWindows上のChromeブラウザに接続し、Geminiで自動的に会話を行うシステムです。

## 必要なファイル

| ファイル | 説明 |
|---------|------|
| `gemini-auto.js` | メインスクリプト |
| `docker-compose.yml` | Docker設定 |
| `workflow-gemini-壁打ち自動化.json` | n8nワークフロー |

## セットアップ手順

### 1. Docker環境の準備

```powershell
# docker-compose.ymlを配置
cd C:\Users\Administrator\n8n
# docker-compose.yml を配置

# コンテナ起動
docker compose up -d
```

**重要**: `extra_hosts` の設定が必須です:
```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

### 2. Chromeプロファイル用フォルダ作成

```powershell
mkdir C:\gemini-chrome-profile
mkdir C:\gemini-login
```

### 3. ファイアウォール設定

```powershell
netsh advfirewall firewall add rule name="Chrome Debug" dir=in action=allow protocol=tcp localport=9222
```

### 4. Chromeをリモートデバッグモードで起動

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"
```

**重要**: `--remote-debugging-address=0.0.0.0` を指定することで、Dockerから直接接続できます。

### 5. Geminiにログイン

1. 起動したChromeで https://gemini.google.com にアクセス
2. Googleアカウントでログイン
3. 何か1つメッセージを送信して動作確認

### 6. 接続テスト

```powershell
# ローカル確認
curl http://localhost:9222/json/version

# Docker側から確認
docker exec n8n-n8n-1 curl -s http://192.168.65.254:9222/json/version
```

### 7. スクリプトをDockerにコピー

```powershell
docker cp C:\gemini-login\gemini-auto.js n8n-n8n-1:/home/node/scripts/gemini-auto.js
```

### 8. n8nワークフローのインポート

1. n8n管理画面を開く
2. 「Import from File」を選択
3. `workflow-gemini-壁打ち自動化.json` を選択
4. Google Sheets認証情報を設定
5. スプレッドシートIDを更新

## サーバー再起動時の手順

```powershell
# 1. Chromeを起動
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"

# 2. Dockerコンテナを起動（停止していた場合）
cd C:\Users\Administrator\n8n
docker compose up -d

# 3. 接続確認
docker exec n8n-n8n-1 curl -s http://192.168.65.254:9222/json/version
```

---

## Chrome再起動の自動化（n8n連携）

Chromeのセッションが不安定になった場合、n8nから自動的にChromeを再起動できます。

### 1. HTTPサーバーの起動

Windows上でPowerShellスクリプトを実行します（管理者権限推奨）：

```powershell
# スクリプトをダウンロードした場所に移動
cd C:\script_all\n8n_claude_20251224\scripts

# サーバー起動
.\chrome-restart-server.ps1
```

**出力例：**
```
==========================================
 Chrome Restart Server Started
==========================================
 Listening on: http://+:8888/
 Endpoints:
   GET /restart-chrome  - Restart Chrome
   GET /status          - Check Chrome status
   GET /stop            - Stop this server

 From n8n (Docker):
   http://host.docker.internal:8888/restart-chrome
==========================================
```

### 2. Windowsスタートアップに登録（推奨）

サーバーをWindowsログイン時に自動起動するには：

1. `Win + R` → `shell:startup` を実行
2. ショートカットを作成:
   - 対象: `powershell.exe -ExecutionPolicy Bypass -File "C:\script_all\n8n_claude_20251224\scripts\chrome-restart-server.ps1"`
   - 名前: `Chrome Restart Server`

### 3. n8nからの呼び出し

**HTTP Requestノードの設定：**

| 項目 | 値 |
|------|-----|
| Method | GET |
| URL | `http://host.docker.internal:8888/restart-chrome` |

**レスポンス例：**
```json
{
  "success": true,
  "message": "Chrome restarted successfully",
  "processCount": 8
}
```

### 4. エンドポイント一覧

| エンドポイント | 説明 |
|---------------|------|
| `/restart-chrome` | Chromeを再起動（終了→起動） |
| `/status` | Chromeの状態確認（起動中か、ポート9222でリッスン中か） |
| `/stop` | HTTPサーバーを停止 |

### 5. n8nワークフロー例：エラー時に自動再起動

```
[Execute Command (Gemini)]
    ↓ エラー発生
[IF: stderr contains "Target closed" or "Session closed"]
    ↓ True
[HTTP Request: restart-chrome]
    ↓
[Wait: 5秒]
    ↓
[Execute Command (Gemini) リトライ]
```

### 注意事項

- HTTPサーバーはWindowsファイアウォールでポート8888を許可する必要がある場合があります
- `host.docker.internal` はDocker Desktop for Windowsで使用できます
- サーバーは `gemini-chrome-profile` を使用しているChromeのみを再起動します（通常のChromeには影響なし）

---

## 重要な注意事項（備忘録）

### ポートプロキシは使わない

**以下のコマンドは実行しないでください：**

```powershell
# これは使わない！
netsh interface portproxy add v4tov4 listenport=9222 listenaddress=0.0.0.0 connectport=9222 connectaddress=127.0.0.1
```

**理由**: Chrome を `--remote-debugging-address=0.0.0.0` で起動すると、Chrome 自体が `0.0.0.0:9222` でリッスンします。ポートプロキシも同じポートを使おうとするため、競合が発生し「Empty reply from server」エラーになります。

**もしポートプロキシを設定してしまった場合の削除方法：**

```powershell
netsh interface portproxy delete v4tov4 listenport=9222 listenaddress=0.0.0.0
netsh interface portproxy show all  # 空であることを確認
```

### docker-compose.yml のボリューム設定

**同じコンテナパスに複数のボリュームをマウントしない：**

```yaml
# NG - 後者が優先され、n8nのデータが消える！
volumes:
  - n8n_data:/home/node/.n8n
  - C:/n8n/data:/home/node/.n8n  # これが上書きしてしまう

# OK - 一つだけ
volumes:
  - n8n_data:/home/node/.n8n
```

**ダウンロードフォルダのマウント（Veo3用）：**

```yaml
volumes:
  - n8n_data:/home/node/.n8n
  - chrome_profile:/home/node/chrome-profile
  - gemini_scripts:/home/node/scripts
  - C:\Users\Administrator\Downloads:/mnt/downloads
```

### Chromeプロセスの完全終了

Chrome の設定を変更する場合は、**全てのプロセスを終了**してから再起動：

```powershell
taskkill /F /IM chrome.exe
```

バックグラウンドプロセスが残っていると、新しい起動オプションが適用されません。

---

## トラブルシューティング

### 「Empty reply from server」エラー

**原因1: ポートプロキシとChromeの競合**

```powershell
# ポートプロキシを確認
netsh interface portproxy show all

# 何か表示されたら削除
netsh interface portproxy delete v4tov4 listenport=9222 listenaddress=0.0.0.0
```

**原因2: Chromeが正しく起動していない**

```powershell
# Chromeを完全終了
taskkill /F /IM chrome.exe

# 正しいオプションで再起動
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"
```

### 「Connection refused」エラー

Chromeが起動していないか、ポートが開いていません：

```powershell
# Chromeが起動しているか確認
Get-Process chrome

# ポートがリッスンしているか確認
netstat -an | findstr 9222
# 「TCP 0.0.0.0:9222 ... LISTENING」が表示されるべき
```

### n8nのワークフローやクレデンシャルが消えた

docker-compose.yml のボリューム設定を確認。同じパスに複数マウントしていないか確認：

```powershell
type docker-compose.yml
```

### Dockerからの接続確認方法

```powershell
# 詳細なデバッグ出力
docker exec n8n-n8n-1 curl -v http://192.168.65.254:9222/json/version
```

### 権限エラー

```powershell
docker exec -u root n8n-n8n-1 chown -R node:node /home/node/scripts
docker exec -u root n8n-n8n-1 chmod -R 755 /home/node/scripts
```

### スクリーンショット確認

```powershell
docker cp n8n-n8n-1:/home/node/scripts/gemini-auto-result.png C:\gemini-login\result.png
C:\gemini-login\result.png
```

---

## 設定値

| 項目 | 値 |
|------|-----|
| Chrome接続先（Docker内から） | `http://192.168.65.254:9222` |
| Chrome接続先（Windows内から） | `http://localhost:9222` |
| 応答待ち最大時間 | 240秒 |
| 応答完了判定 | 5秒間隔で2回連続テキスト長が同じなら完了 |

---

## よく使うコマンド

```powershell
# Chrome起動
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"

# 接続テスト（Windows）
curl http://localhost:9222/json/version

# 接続テスト（Docker）
docker exec n8n-n8n-1 curl -s http://192.168.65.254:9222/json/version

# スクリプト更新
docker cp C:\gemini-login\gemini-auto.js n8n-n8n-1:/home/node/scripts/gemini-auto.js

# 手動テスト
[System.IO.File]::WriteAllText("C:\gemini-login\input.json", '{"prompts":[{"text":"hello","index":1}]}')
docker cp C:\gemini-login\input.json n8n-n8n-1:/tmp/input.json
docker exec n8n-n8n-1 node /home/node/scripts/gemini-auto.js

# ポートプロキシ確認（空であるべき）
netsh interface portproxy show all

# Chromeプロセス完全終了
taskkill /F /IM chrome.exe
```

---

## 関連マニュアル

- **Veo3 動画・画像生成**: [veo3-shorts-manual.md](./veo3-shorts-manual.md)

---

## 更新履歴

- **2026-01-06**: Chrome再起動の自動化（n8n連携）セクション追加、HTTPサーバースクリプト追加
- **2025-12-29**: Veo3セクションを別ファイル（veo3-shorts-manual.md）に分離
- **2025-12-28**: ポートプロキシ競合問題の修正、備忘録セクション追加
- **2024-12-27**: 初版作成
