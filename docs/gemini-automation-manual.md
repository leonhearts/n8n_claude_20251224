# Gemini 壁打ち自動化 マニュアル

## 概要

n8nからWindows上のChromeブラウザに接続し、Geminiで自動的に会話を行うシステムです。
ブラウザ自動化により、ログイン状態を維持したまま会話履歴がGeminiに残ります。

---

## フォルダ構成

### Windows側
```
C:\gemini-login\
├── gemini-auto.js          # 本番用スクリプト（バックアップ）
├── test-script.js          # テスト用スクリプト
├── cookies.json            # Cookie（バックアップ）
└── result.png              # スクリーンショット確認用

C:\gemini-chrome-profile\   # Chrome専用プロファイル（自動作成）
└── （Chromeのユーザーデータ）
```

### Docker側（n8n-n8n-1コンテナ）
```
/home/node/scripts/
├── gemini-auto.js          # 本番用スクリプト
├── gemini-cookies.json     # Cookie（現在は未使用）
├── gemini-auto-result.png  # 最新の実行結果スクリーンショット
└── test-script.js          # テスト用スクリプト
```

---

## 1. Chromeをリモートデバッグモードで起動する方法

### 初回起動

```powershell
# 1. Chromeを完全に終了
Stop-Process -Name "chrome" -Force -ErrorAction SilentlyContinue

# 2. 少し待つ
Start-Sleep -Seconds 2

# 3. リモートデバッグモードで起動
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"
```

### 起動後の設定（初回のみ）

1. Chromeが開いたら https://gemini.google.com にアクセス
2. Googleアカウントでログイン
3. 何か1つメッセージを送信して動作確認

### 接続確認

```powershell
# ローカル確認
curl http://localhost:9222/json/version

# Docker側から確認
docker exec n8n-n8n-1 curl -s http://192.168.65.254:9222/json/version
```

JSONが返ってくれば接続OK。

---

## 2. サーバー再起動時の手順

### 手順

1. **Chromeを起動**
   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"
   ```

2. **Dockerコンテナを起動**（停止していた場合）
   ```powershell
   cd C:\Users\Administrator\n8n
   docker compose up -d
   ```

3. **接続確認**
   ```powershell
   docker exec n8n-n8n-1 curl -s http://192.168.65.254:9222/json/version
   ```

4. **Geminiにログイン確認**
   - Chromeで https://gemini.google.com を開く
   - ログイン済みならOK
   - 未ログインなら再ログイン

### 自動起動設定（オプション）

タスクスケジューラでChrome起動を自動化できます：

1. タスクスケジューラを開く
2. 「タスクの作成」
3. トリガー: 「スタートアップ時」
4. 操作: プログラム `"C:\Program Files\Google\Chrome\Application\chrome.exe"`
5. 引数: `--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"`

---

## 3. Cookieの更新方法

通常は不要です。Chromeブラウザに直接接続しているため、Cookieは自動的に管理されます。

### ログインが切れた場合

1. Chromeで https://gemini.google.com を開く
2. 手動でGoogleアカウントにログイン
3. 完了（自動的に反映される）

---

## 4. トラブルシューティング

### 問題: Chrome接続エラー

**症状**: `docker exec` で接続テストしても応答がない

**解決策**:
```powershell
# Chromeが起動しているか確認
Get-Process chrome

# 起動していなければ再起動
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"

# ポートフォワードが設定されているか確認
netstat -an | findstr 9222

# 0.0.0.0:9222 がなければ再設定
netsh interface portproxy add v4tov4 listenport=9222 listenaddress=0.0.0.0 connectport=9222 connectaddress=127.0.0.1
```

### 問題: Geminiにログインできない

**症状**: 会話は送信されるが履歴に残らない

**解決策**:
1. Chromeを直接確認
2. https://gemini.google.com を開く
3. 右上にアカウントアイコンがあるか確認
4. なければ手動ログイン

### 問題: スクリプトがハングする

**症状**: ワークフローが終わらない

**解決策**:
```powershell
# 現在のスクリーンショットを確認
docker cp n8n-n8n-1:/home/node/scripts/gemini-auto-result.png C:\gemini-login\result.png
C:\gemini-login\result.png
```

画面を見て状況を確認。

### 問題: 権限エラー

**症状**: `EACCES: permission denied`

**解決策**:
```powershell
docker exec -u root n8n-n8n-1 chown -R node:node /home/node/scripts
docker exec -u root n8n-n8n-1 chmod -R 755 /home/node/scripts
```

### 問題: n8nコンテナが見つからない

**症状**: `Error response from daemon: No such container: n8n`

**解決策**:
```powershell
# 正しいコンテナ名を確認
docker ps

# 通常は n8n-n8n-1
docker exec n8n-n8n-1 echo "OK"
```

---

## 5. n8nワークフロー設定

### ワークフロー名
`Gemini 壁打ち自動化`

### 必須ノード

1. **スクリプト作成** (Execute Command)
   - スクリプトファイルを作成

2. **Gemini実行** (Execute Command)
   - コマンド: `node /home/node/scripts/gemini-auto.js '{{ JSON.stringify($json) }}' 2>&1`

3. **結果パース** (Code)
   - stdoutからJSONを抽出

### 重要な設定

docker-compose.yml に以下が必要:
```yaml
services:
  n8n:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

---

## 6. 設定値

| 項目 | 値 |
|------|-----|
| Chrome接続先 | `http://192.168.65.254:9222` |
| 応答待ち最大時間 | 240秒 |
| 応答完了判定 | 送信ボタンが再度有効になったら完了 |
| スクリーンショット保存先 | `/home/node/scripts/gemini-auto-result.png` |

---

## 7. よく使うコマンド

```powershell
# Chrome起動
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\gemini-chrome-profile"

# 接続テスト
docker exec n8n-n8n-1 curl -s http://192.168.65.254:9222/json/version

# スクリーンショット確認
docker cp n8n-n8n-1:/home/node/scripts/gemini-auto-result.png C:\gemini-login\result.png
C:\gemini-login\result.png

# スクリプト更新
docker cp C:\gemini-login\gemini-auto.js n8n-n8n-1:/home/node/scripts/gemini-auto.js

# コンテナ再起動
cd C:\Users\Administrator\n8n
docker compose restart

# 権限修正
docker exec -u root n8n-n8n-1 chown -R node:node /home/node/scripts
```
