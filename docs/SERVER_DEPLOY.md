# 社内サーバ デプロイ手順

## 前提条件

- Node.js 20 以上
- npm がインストール済み
- サーバで静的ファイルを配信できること（IIS / Nginx / Apache 等）

## 手順

### 1. プロジェクトをクローン

```bash
git clone https://github.com/joitaliano3a141592-art/daily-work-report.git
cd daily-work-report
```

### 2. 環境設定ファイルを作成

同梱の `.env.production.server` を `.env.production.local` にコピーします。
このファイルに MS 認証情報やリスト ID が入っています。

```bash
cp .env.production.server .env.production.local
```

> **`VITE_APP_BASE_PATH` の変更**
>
> - サーバルート直下に配置 → `/`（デフォルト）
> - サブディレクトリに配置（例: `https://server/report/`） → `/report/`

### 3. ビルド

```bash
npm ci
npm run build:server
```

`dist/` フォルダにビルド結果が出力されます。

### 4. サーバに配置

`dist/` フォルダの中身をウェブサーバの公開ディレクトリにコピーします。

#### IIS の場合

1. `dist/` の中身を `C:\inetpub\wwwroot\report\`（任意）にコピー
2. IIS マネージャでサイトを作成
3. **URL リライト**を設定（SPA なので全パスを `index.html` に転送）:

```xml
<!-- web.config を dist/ に配置 -->
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="SPA" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="index.html" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

#### Nginx の場合

```nginx
server {
    listen 80;
    server_name your-server.local;
    root /var/www/report;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 5. Azure AD にリダイレクト URI を追加

1. [Azure Portal](https://portal.azure.com) → Entra ID → アプリの登録 → 対象アプリ
2. 認証 → プラットフォーム構成 → SPA
3. リダイレクト URI に **サーバの URL** を追加:
   - 例: `https://your-server.local/report/`
   - 例: `http://192.168.1.100/`

> ⚠️ これをやらないとログインできません

### 6. 動作確認

ブラウザでサーバの URL にアクセスし、Microsoft ログイン画面が出ればOKです。

---

## 更新手順

アプリを更新する場合:

```bash
cd daily-work-report
git pull origin main
npm ci
npm run build:server
# dist/ の中身をサーバにコピー
```

---

## GitHub Pages との違い

| 項目 | GitHub Pages | 社内サーバ |
|------|-------------|-----------|
| 環境変数 | GitHub Secrets → ビルド時注入 | `.env.production.local` に直書き |
| ベースパス | `/manmarudairyreport/` | `/`（設定可能） |
| ビルド | GitHub Actions 自動 | `npm run build:server` 手動 |
| HTTPS | 自動 | サーバ側で設定 |

---

## トラブルシューティング

### ページ遷移で 404 が出る

SPA（シングルページアプリ）なので、サーバ側で全パスを `index.html` に転送する設定が必要です。
上記の IIS / Nginx 設定を確認してください。

### ログイン画面が出ない / エラーが出る

Azure AD アプリにサーバの URL がリダイレクト URI として登録されているか確認してください。

### データが表示されない

ブラウザの開発者ツール → ネットワークタブで Graph API の呼び出しを確認。
403 の場合は Azure AD アプリの API 権限を確認してください。
