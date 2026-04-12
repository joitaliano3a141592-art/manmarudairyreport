---
name: sharepoint-app
description: "SharePoint List + MSAL.js + GitHub Pages でコスト効率の高いウェブアプリを構築する。Use when: SharePoint List, MSAL.js, Graph API, GitHub Pages, Azure AD, SPA認証, React, Vite, TypeScript, Tailwind, shadcn, TanStack Query, Teams通知, 低コスト, ライセンス不要"
---

# SharePoint List ウェブアプリ開発スキル

## 概要

Power Apps ライセンスを使わず、**SharePoint Online のリスト（表）をデータベース代わり**にし、
**React ウェブアプリを GitHub Pages に無料ホスティング**する低コスト開発パターン。

認証は **Microsoft Entra ID（Azure AD）+ MSAL.js** で社員アカウントを利用する。

### このパターンを選ぶ理由

- Power Apps の追加ライセンス不要（Microsoft 365 のみで動作）
- Dataverse 不要 → ストレージ課金なし
- GitHub Pages 無料 → ホスティング課金なし
- Power Apps ポータルにアプリを置かない → 管理が簡単

### 技術スタック

| 役割 | 技術 |
|------|------|
| 画面（フロントエンド） | React + TypeScript + Vite |
| UIパーツ | shadcn/ui + Tailwind CSS |
| データ取得・キャッシュ | TanStack React Query |
| データ保管 | SharePoint Online リスト（Graph API 経由） |
| ログイン認証 | Microsoft Entra ID + MSAL.js（SPA フロー） |
| 通知 | Microsoft Teams（Graph API チャネルメッセージ） |
| ホスティング | GitHub Pages（静的サイト） |
| 自動デプロイ | GitHub Actions（push → build → deploy） |
| 初期設定スクリプト | Python 3（Graph API / DeviceCodeCredential） |

---

## 絶対遵守ルール（過去の失敗から学んだ教訓）

### 環境情報の取得

1. **Azure AD でアプリ登録が必要**。ユーザーに以下を確認する:
   - テナント ID (`VITE_MSAL_TENANT_ID`)
   - Azure AD アプリのクライアント ID (`VITE_MSAL_CLIENT_ID`)
   - SharePoint サイト ID (`VITE_SP_SITE_ID`)
2. **サイト ID の取得方法**: `https://graph.microsoft.com/v1.0/sites/{hostname}:/{server-relative-path}` で取得
3. **Azure AD アプリ登録**: SPA リダイレクト URI に `http://localhost:5173`（開発）と GitHub Pages URL（本番）を設定

### SharePoint リスト設計

4. **リスト名は英語推奨**。日本語でも動くが URL エンコードの問題が起きやすい
5. **カスタム列名は英語のみ**。内部名が自動エンコードされ API 呼び出しが複雑になる
6. **作成者は `createdBy` システム列を利用**。カスタムユーザー列は不要
7. **リスト ID は作成後に控える**。Graph API でリスト操作する際に必須
8. **マスタ系リスト（選択肢の元データ）は先に作成**。メインリストより先に用意する
9. **デモデータは全リストに投入**。マスタ・メイン・関連リストすべてに用意する

### Graph API 操作（重要な制約）

10. **`$filter` はリストアイテムの `fields/` に対して使えない**。サーバー側フィルタではなく、全件取得 → クライアント側フィルタリングを使う
11. **ページネーションは `@odata.nextLink` で実装**。`$top=999` に頼らず、nextLink をループして全件取得する
12. **日付保存は JST タイムゾーン付き**。`T00:00:00+09:00` を末尾に付ける。付けないと UTC 解釈でズレる
13. **日付読取は UTC → ローカル変換**。SharePoint が返す日付は UTC。`split("T")[0]` ではなく `toLocaleDateString` やカスタム変換関数を使う
14. **`$expand=fields` で列データを取得**。デフォルトではフィールドがレスポンスに含まれない

### 認証（MSAL.js）

15. **MSAL.js は SPA（シングルページアプリ）フローを使用**。リダイレクトまたはポップアップ認証
16. **スコープ**: `Sites.ReadWrite.All`, `Sites.Manage.All`, `User.Read` を基本に設定
17. **Teams 通知を使う場合**: `ChannelMessage.Send` スコープが追加で必要（Azure AD アプリに API 権限を追加）
18. **トークンは localStorage にキャッシュ**（MSAL.js 標準動作）
19. **開発時はプロキシ経由**。Vite の Proxy Plugin で `/api/graph/*` を中継し、Python スクリプトでトークン取得

### Graph API クライアント設計パターン

```typescript
// 開発 / 本番で通信先を切り替え
const isDev = import.meta.env.DEV;
const API_PREFIX = isDev ? "/api/graph" : "https://graph.microsoft.com/v1.0";

// 認証ヘッダー（本番のみ MSAL トークン付与）
async function getAuthHeaders() {
  if (isDev) return {};
  const token = await acquireGraphToken();
  return { Authorization: `Bearer ${token}` };
}
```

### ページネーション実装パターン

```typescript
async function fetchListItems<F>(listId: string) {
  let url = `/sites/${SP_SITE_ID}/lists/${listId}/items?$expand=fields`;
  const allItems = [];
  while (url) {
    const data = await graphGet(url);
    allItems.push(...data.value);
    url = data["@odata.nextLink"] || null;
    // 開発時は proxy 用にプレフィックスを除去
    if (isDev && url) url = url.replace("https://graph.microsoft.com/v1.0", "");
  }
  return allItems;
}
```

### 日付処理パターン

```typescript
// 保存時: JST タイムゾーンを付加
const dateForSave = `${dateString}T00:00:00+09:00`;

// 読取時: UTC → ローカルタイムゾーン変換
function toLocalDateStr(utcStr: string): string {
  const d = new Date(utcStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
```

### GitHub Pages デプロイ

20. **秘密情報は GitHub Secrets に保管**。コードに直書きしない
21. **環境変数は `VITE_` プレフィックス**。Vite ビルド時に注入される
22. **`404.html` を `index.html` のコピーとして作成**。SPA ルーティング対応
23. **リポジトリは Private（開発）＋ Public（デプロイ用）の2つ構成**。Private から Public へクリーンプッシュ
24. **クリーンプッシュ**: `git checkout --orphan clean-push && git commit && git push public clean-push:main --force` パターン。秘密情報の履歴を含まない

### GitHub Actions ワークフロー構成

```yaml
# .github/workflows/deploy.yml
- run: npm run build
  env:
    VITE_MSAL_TENANT_ID: ${{ secrets.VITE_MSAL_TENANT_ID }}
    VITE_MSAL_CLIENT_ID: ${{ secrets.VITE_MSAL_CLIENT_ID }}
    VITE_SP_SITE_ID: ${{ secrets.VITE_SP_SITE_ID }}
    # ... 各リスト ID も secrets から注入
```

### Teams 通知

25. **Teams チャネルへの投稿は Graph API**。`POST /teams/{teamId}/channels/{channelId}/messages`
26. **メッセージは HTML テーブル形式**。`contentType: "html"` で送信
27. **Team ID と Channel ID は環境変数で管理**

### フォルダ構成

```
project/
├── .github/
│   ├── workflows/deploy.yml      # GitHub Actions
│   ├── agents/                   # カスタムエージェント
│   └── skills/                   # スキルファイル
├── src/
│   ├── components/               # UI コンポーネント
│   │   └── ui/                   # shadcn/ui パーツ
│   ├── hooks/                    # カスタム Hooks
│   │   ├── use-sharepoint.ts     # SharePoint CRUD Hooks
│   │   └── use-current-user.ts   # ログインユーザー情報
│   ├── lib/
│   │   ├── graphClient.ts        # Graph API 通信
│   │   ├── msalConfig.ts         # MSAL.js 設定
│   │   └── sharepointConfig.ts   # SP サイト/リスト ID
│   ├── pages/                    # 各画面ページ
│   ├── providers/                # React Context
│   │   ├── msal-provider.tsx     # MSAL 認証
│   │   └── query-provider.tsx    # TanStack Query
│   └── types/                    # TypeScript 型定義
├── scripts/
│   ├── auth_helper.py            # 認証ヘルパー（開発用）
│   ├── get_token.py              # トークン取得（Vite proxy用）
│   └── setup_sharepoint_lists.py # SP リスト自動作成
├── plugins/
│   └── plugin-graph-proxy.ts     # Vite proxy プラグイン
├── .env.example                  # 環境変数テンプレート
├── .env                          # 秘密情報（gitignore）
└── package.json
```

---

## 作業手順

### Phase 0: 設計（ユーザー確認必須）

1. ユーザー要件のヒアリング（管理対象、必要データ、操作、ユーザー）
2. **必要情報の取得**:
   - Azure AD テナント ID
   - Azure AD アプリ登録のクライアント ID（なければ登録手順を案内）
   - SharePoint サイト URL
3. リスト設計書の作成:
   - リスト一覧（マスタ → メイン → 関連の順）
   - 列定義（英語内部名、型、必須）
   - デモデータ計画（全リストに対して）
4. **ユーザーに設計を提示し、承認を得てから構築に進む**

### Phase 1: SharePoint リスト構築

1. Python スクリプトで Graph API 経由でリスト作成
2. 列追加（Text, Number, DateTime, Choice 等）
3. デモデータ投入（全リスト）
4. リスト ID を控えて `.env` に設定

### Phase 2: React アプリ開発

**Step A: UI 設計（ユーザー承認必須）**

1. 画面構成を設計（一覧・入力・ダッシュボード等）
2. **ユーザーに UI 設計を提示し、承認を得る**

**Step B: 開発**

1. `npm create vite@latest` でプロジェクト初期化（React + TypeScript）
2. Tailwind CSS + shadcn/ui セットアップ
3. MSAL.js 設定 (`msalConfig.ts`, `msal-provider.tsx`)
4. Graph API クライアント (`graphClient.ts`) — 開発/本番切替パターン
5. SharePoint 設定 (`sharepointConfig.ts`) — 環境変数からリスト ID 読込
6. カスタム Hooks (`use-sharepoint.ts`) — CRUD + TanStack Query
7. ページ実装（承認済み設計に従う）
8. Vite Proxy Plugin（開発時の認証中継）

### Phase 3: デプロイ

1. Azure AD アプリにリダイレクト URI 追加（GitHub Pages URL）
2. GitHub リポジトリ作成（Private + Public）
3. GitHub Secrets 設定（全環境変数）
4. GitHub Actions ワークフロー作成
5. 初回デプロイ確認

### Phase 4（オプション）: Teams 通知

1. Azure AD アプリに `ChannelMessage.Send` 権限追加
2. Team ID / Channel ID を環境変数に設定
3. 通知機能実装（Graph API POST）

### Phase 5（オプション）: Copilot Studio エージェント

Power Automate や Copilot Studio を追加する場合は、既存の `copilot-studio-agent` や `power-automate-flow` スキルを参照。
