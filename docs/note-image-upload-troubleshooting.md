# NOTE ヘッダー画像アップロード トラブルシューティングガイド

## 概要

NOTEの投稿自動化ワークフローで、ヘッダー画像をアップロードする際に発生する問題と解決策をまとめています。

---

## 問題の症状

### エラー内容
`get_draft_data` ノードで **404 Not Found** エラーが発生する。

```
404 - "{"error":{"message":"","type":"not_found"}}"
Request URI: https://note.com/api/v3/notes/{key}
```

### 原因
**X-XSRF-TOKEN の値の先頭に余分な `=` が付いている**

```
# 問題のあるリクエスト
x-xsrf-token: =JtmSVUr907IVyR2krLnQX2FpTBZHeWH%2BhmsLTMJujXQ%3D
              ↑ この = が問題
```

---

## 根本原因の詳細

### Cookie からトークンを抽出する式の問題

**問題のある式：**
```javascript
{{ $('get_Cookie').item.json.headers["set-cookie"].find(c => c.startsWith("XSRF-TOKEN")).split(';')[0].split('=')[1] }}
```

XSRF-TOKEN の値が Base64 エンコードされている場合（末尾に `=` パディングがある）、`split('=')[1]` では正しく値を取得できません。

**例：**
```
Cookie: XSRF-TOKEN=abc123def456=
split('=') → ['XSRF-TOKEN', 'abc123def456', '']
split('=')[1] → 'abc123def456' （末尾の = が欠落）
```

---

## 解決策

### 修正後の式

**X-XSRF-TOKEN ヘッダー：**
```javascript
{{ $('get_Cookie').item.json.headers["set-cookie"].find(c => c.startsWith("XSRF-TOKEN")).split(';')[0].replace('XSRF-TOKEN=', '') }}
```

または、より安全な方法：
```javascript
{{ (() => {
  const cookie = $('get_Cookie').item.json.headers["set-cookie"].find(c => c.startsWith("XSRF-TOKEN"));
  const tokenPart = cookie.split(';')[0];
  return tokenPart.substring(tokenPart.indexOf('=') + 1);
})() }}
```

### 変更点の比較

| 項目 | 変更前 | 変更後 |
|------|--------|--------|
| トークン抽出方法 | `.split('=')[1]` | `.replace('XSRF-TOKEN=', '')` |
| Base64対応 | × | ○ |
| 結果 | 404エラー | 成功 |

---

## 修正が必要なノード

以下のノードで X-XSRF-TOKEN ヘッダーの式を修正する必要があります：

1. **upload_img** - 画像アップロード
2. **get_draft_data** - 下書きデータ取得
3. **put_post_status** - 記事公開

---

## ワークフローの全体構成

```
スケジュールトリガー
    ↓
スクリプト作成
    ↓
ブログデータ読込 → Done_Database読込 → 記事プロンプト読込
    ↓
Build Prompts (Code)
    ↓
Convert to File → Read/Write Files → Gemini実行
    ↓
結果パース → Generate an image → ブログヘッダー画像保存
    ↓
初期情報取得1 → login → get_Cookie
    ↓
draft1次作成 → draft2次作成
    ↓
ブログヘッダー読込 → upload_img → [Wait 2秒]
    ↓
get_draft_data → put_post_status
```

---

## チェックリスト

ワークフローが動作しない場合、以下を確認してください：

### 1. X-XSRF-TOKEN の式
- [ ] `.split('=')[1]` ではなく `.replace('XSRF-TOKEN=', '')` を使用している

### 2. Cookie ヘッダー
- [ ] `$('login')` と `$('get_Cookie')` の両方からCookieを取得している
- [ ] XSRF-TOKEN が Cookie ヘッダーにも含まれている

### 3. ノード参照
- [ ] `$('get_Cookie')` が正しいノードを参照している
- [ ] ピン留めデータがある場合は解除している

### 4. タイミング
- [ ] `upload_img` と `get_draft_data` の間に Wait ノード（2秒）がある

---

## よくあるエラーと対処法

### 404 Not Found
**原因:** X-XSRF-TOKEN が正しくない、または下書きがまだAPIで取得できない状態
**対処:**
1. X-XSRF-TOKEN の式を修正
2. Wait ノードを追加（2〜5秒）

### 405 Method Not Allowed
**原因:** 間違った API エンドポイントを使用
**対処:**
- GET リクエストには `/api/v3/notes/{key}` を使用
- PUT リクエストには `/api/v1/text_notes/{id}` を使用

### 401 Unauthorized
**原因:** ログインセッションが無効
**対処:**
1. `初期情報取得1` のピン留めを解除
2. Cookie ヘッダーの式を確認

---

## 関連ドキュメント

- [n8n HTTP Request ノード公式ドキュメント](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/)
- [note API 仕様（非公式）](https://note.com/)

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-01-07 | 初版作成 - X-XSRF-TOKEN の問題と解決策を文書化 |
