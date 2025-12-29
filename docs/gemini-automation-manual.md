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

## Veo3 動画・画像生成（veo3-shorts-simple.js）

### 概要

Google Veo3/Imagen3を使用して、動画や画像を自動生成するスクリプトです。

### モード一覧

| モード | 説明 | 主な用途 |
|--------|------|----------|
| `frame` | 画像から動画を生成 | ジャケット画像からショート動画作成 |
| `image` | プロンプトから画像を生成 | AIアート、背景画像作成 |

### スクリプトのコピー

```powershell
docker cp C:\script_all\n8n_claude_20251224\scripts\veo3-shorts-simple.js n8n-n8n-1:/home/node/veo3-shorts-simple.js
```

---

### 動画生成モード（mode: frame）

画像を参照して動画を生成します。

#### 基本コマンド

```powershell
# シンプルな動画生成（シーン拡張なし）
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"frame\", \"prompt\": \"カメラがゆっくりズームアウト\", \"imagePath\": \"/tmp/output_kaeuta.png\"}'

# シーン拡張あり（videoCount: 2以上）
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"frame\", \"prompt\": \"カメラがゆっくりズームアウト\", \"imagePath\": \"/tmp/output_kaeuta.png\", \"videoCount\": 2}'
```

#### パラメータ

| パラメータ | 必須 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `mode` | ○ | `frame` | `frame` を指定 |
| `prompt` | ○ | - | 動画のモーション指示 |
| `imagePath` | ○ | `/tmp/output_kaeuta.png` | 参照画像のパス（Docker内） |
| `videoCount` | - | `1` | シーン数（1=拡張なし、2以上=シーン拡張） |
| `outputPath` | - | `/tmp/veo3_movie.mp4` | 出力先パス |
| `projectUrl` | - | null | 既存プロジェクトURL（指定時は新規作成スキップ） |

#### 既存プロジェクトを使用する場合

```powershell
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"frame\", \"prompt\": \"カメラがゆっくりズームアウト\", \"imagePath\": \"/tmp/output.png\", \"projectUrl\": \"https://labs.google/fx/ja/tools/flow/project/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\"}'
```

#### 出力

```powershell
# 生成された動画をローカルにコピー
docker cp n8n-n8n-1:/tmp/veo3_movie.mp4 C:\Users\Administrator\Downloads\veo3_movie.mp4
```

---

### 画像生成モード（mode: image）

プロンプトからAI画像を生成します。

#### 基本コマンド

```powershell
# 横向き画像を1枚生成
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"image\", \"prompt\": \"beautiful sunset over mountains, photorealistic\"}'

# 縦向き画像を2枚生成
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"image\", \"prompt\": \"anime style portrait\", \"imageOutputCount\": 2, \"aspectRatio\": \"portrait\"}'
```

#### パラメータ

| パラメータ | 必須 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `mode` | ○ | - | `image` を指定 |
| `prompt` | ○ | - | 画像生成プロンプト |
| `imageOutputCount` | - | `1` | 出力枚数（`1` または `2`） |
| `aspectRatio` | - | `landscape` | 縦横比（`landscape`=横向き16:9、`portrait`=縦向き9:16） |
| `outputPath` | - | `/tmp/veo3_movie.png` | 出力先パス（.mp4指定でも.pngに変換） |
| `projectUrl` | - | null | 既存プロジェクトURL（指定時は新規作成スキップ） |

#### 出力

```powershell
# 生成された画像をローカルにコピー
docker cp n8n-n8n-1:/tmp/veo3_movie.png C:\Users\Administrator\Downloads\generated_image.png

# JPG形式で保存された場合
docker cp n8n-n8n-1:/tmp/veo3_movie.jpg C:\Users\Administrator\Downloads\generated_image.jpg
```

---

### 画像生成→動画生成の連携

1. まず画像を生成
2. 生成した画像を参照して動画を生成

```powershell
# 1. 画像を生成（出力: /tmp/veo3_movie.png）
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"image\", \"prompt\": \"cyberpunk cityscape at night\", \"aspectRatio\": \"landscape\"}'

# 2. 生成した画像から動画を作成
docker exec n8n-n8n-1 node /home/node/veo3-shorts-simple.js '{\"mode\": \"frame\", \"prompt\": \"camera slowly pans across the city\", \"imagePath\": \"/tmp/veo3_movie.png\"}'
```

### 重要な注意事項

#### CDP接続URLは `192.168.65.254:9222` を使用

```javascript
// NG - Docker環境で500エラーになる
cdpUrl: 'http://host.docker.internal:9222'

// OK
cdpUrl: 'http://192.168.65.254:9222'
```

`host.docker.internal` はこの環境では動作しません。必ず `192.168.65.254` を使用してください。

#### Chromeのダウンロードマネージャは使用しない

`--remote-debugging-address=0.0.0.0` でChromeを起動すると、**Chromeのダウンロードマネージャが不安定**になり、手動でもダウンロードが失敗することがあります。

**解決策**: スクリプトはダウンロードURLがBase64エンコード（`data:video/mp4;base64,...`）で提供されることを利用し、Node.jsで直接デコードして保存します。Chromeのダウンロードマネージャを完全にバイパスしています。

#### ファイルアップロードダイアログの処理

Windowsのファイル選択ダイアログが開いた場合、Playwrightの `fileChooser.setFiles()` を使用して直接ファイルを設定します。

**注意**: `Escape` キーでダイアログを閉じると、アップロードUI自体が閉じてしまうため使用しません。

### トラブルシューティング

#### 「Unexpected status 500」エラー

```
browserType.connectOverCDP: Unexpected status 500 when connecting to http://host.docker.internal:9222/json/version/
```

→ CDP URLを `http://192.168.65.254:9222` に変更してください。

#### ダウンロードが失敗する

Chromeのダウンロード履歴に「問題が発生しました」と表示される場合：
- これは `--remote-debugging-address=0.0.0.0` による既知の問題です
- スクリプトはBase64デコードで対応済みなので、スクリプト経由のダウンロードは成功します
- 手動ダウンロードは失敗する可能性があります

#### 「File input not found」エラー

ファイルダイアログをEscapeで閉じるとUIが消えます。最新のスクリプトでは `fileChooser.setFiles()` で対応済みです。

---

## 更新履歴

- **2025-12-29**: 画像生成モード追加（出力数・縦横比設定対応）、動画生成のvideoCount=1でシーン拡張スキップ
- **2025-12-29**: Veo3ショート動画生成スクリプトのドキュメント追加、Base64ダウンロード対応
- **2025-12-28**: ポートプロキシ競合問題の修正、備忘録セクション追加
- **2024-12-27**: 初版作成
