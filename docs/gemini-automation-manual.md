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

### 3. ポートフォワード設定

```powershell
netsh interface portproxy add v4tov4 listenport=9222 listenaddress=0.0.0.0 connectport=9222 connectaddress=127.0.0.1
```

### 4. ファイアウォール設定

```powershell
netsh advfirewall firewall add rule name="Chrome Debug" dir=in action=allow protocol=tcp localport=9222
```

### 5. Chromeをリモートデバッグモードで起動

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"
```

### 6. Geminiにログイン

1. 起動したChromeで https://gemini.google.com にアクセス
2. Googleアカウントでログイン
3. 何か1つメッセージを送信して動作確認

### 7. 接続テスト

```powershell
# ローカル確認
curl http://localhost:9222/json/version

# Docker側から確認
docker exec n8n-n8n-1 curl -s http://192.168.65.254:9222/json/version
```

### 8. スクリプトをDockerにコピー

```powershell
docker cp C:\gemini-login\gemini-auto.js n8n-n8n-1:/home/node/scripts/gemini-auto.js
```

### 9. n8nワークフローのインポート

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

## トラブルシューティング

### Chrome接続エラー

```powershell
# Chromeが起動しているか確認
Get-Process chrome

# ポートフォワード確認
netstat -an | findstr 9222

# ポートフォワード再設定
netsh interface portproxy add v4tov4 listenport=9222 listenaddress=0.0.0.0 connectport=9222 connectaddress=127.0.0.1
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

## 設定値

| 項目 | 値 |
|------|-----|
| Chrome接続先 | `http://192.168.65.254:9222` |
| 応答待ち最大時間 | 240秒 |
| 応答完了判定 | 5秒間隔で2回連続テキスト長が同じなら完了 |

## よく使うコマンド

```powershell
# Chrome起動
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"

# 接続テスト
docker exec n8n-n8n-1 curl -s http://192.168.65.254:9222/json/version

# スクリプト更新
docker cp C:\gemini-login\gemini-auto.js n8n-n8n-1:/home/node/scripts/gemini-auto.js

# 手動テスト
[System.IO.File]::WriteAllText("C:\gemini-login\input.json", '{"prompts":[{"text":"hello","index":1}]}')
docker cp C:\gemini-login\input.json n8n-n8n-1:/tmp/input.json
docker exec n8n-n8n-1 node /home/node/scripts/gemini-auto.js
```
