# 業務日報アプリ

株式会社マンマルシステム向け業務日報管理システム。SharePoint Online リストをバックエンドに、Microsoft Entra ID 認証・GitHub Pages ホスティング・Teams タブ統合を組み合わせた業務 Web アプリです。

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-デプロイ済み-brightgreen?style=for-the-badge&logo=github)](https://joitaliano3a141592-art.github.io/manmarudairyreport/)
[![Teams](https://img.shields.io/badge/Microsoft%20Teams-タブ対応-6264A7?style=for-the-badge&logo=microsoftteams&logoColor=white)](https://teams.microsoft.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

---

## システム構成

`
[ユーザー]
    │
    ├── ブラウザ ──► GitHub Pages (React SPA)
    │                   https://joitaliano3a141592-art.github.io/manmarudairyreport/
    │
    └── Microsoft Teams タブ (同一 SPA を iframe 表示)
            ├── チャネルタブ（チーム・グループチャット・共有チャネル）
            └── 個人タブ（パーソナル）

[認証]
    Microsoft Entra ID (Azure AD)
    ├── テナント: <VITE_MSAL_TENANT_ID> ※ GitHub Secrets 管理
    ├── クライアント: <VITE_MSAL_CLIENT_ID> ※ GitHub Secrets 管理
    ├── 認証方式: MSAL.js SPA (PKCE)
    └── スコープ: Sites.ReadWrite.All / Sites.Manage.All / User.Read / ChannelMessage.Send

[データ]
    SharePoint Online (manmarusystem テナント)
    ├── 顧客マスタ (List1)
    ├── システムマスタ (List2)
    ├── 作業種別マスタ (List3)
    ├── 作業報告 (List4)
    └── 作業予定 (List5)
    ※ サイト ID・リスト ID は GitHub Secrets / .env.production.local で管理

[CI/CD]
    GitHub Actions → GitHub Pages (main ブランチへの push で自動デプロイ)
    シークレット管理: GitHub Secrets (VITE_* 環境変数)

[Teams 通知]
    Graph API ChannelMessage.Send
    ├── グループ ID: <VITE_TEAMS_TEAM_ID> ※ GitHub Secrets 管理
    └── チャネル ID: <VITE_TEAMS_CHANNEL_ID> ※ GitHub Secrets 管理
`

---

## 機能一覧

| ページ | パス | 説明 |
|--------|------|------|
| ダッシュボード | /dashboard | 作業状況サマリー・統計カード |
| 日次入力 | /daily-entry | 日報入力 + Teams チャネルへの発報 |
| 作業報告入力 | /workreport-input | 作業報告の新規作成・編集 |
| 作業報告一覧 | /workreport-list | 作業報告の検索・一覧 |
| 作業予定入力 | /workplan-input | 作業予定の新規作成・編集 |
| 作業予定一覧 | /workplan-list | 作業予定の検索・一覧 |
| マスタ管理 | /masters | 顧客・システム・作業種別マスタの管理 |
| Teams タブ設定 | /teams-config | Teams チャネルタブ設定ページ |

---

## 技術スタック

| レイヤー | 技術 | バージョン |
|----------|------|-----------|
| UI フレームワーク | React | 19.x |
| 言語 | TypeScript | 5.x |
| ビルドツール | Vite | 7.x |
| スタイリング | Tailwind CSS + shadcn/ui | 4.x |
| データフェッチ | TanStack React Query | 5.x |
| ルーティング | React Router | 7.x |
| 認証 | @azure/msal-browser | 5.6.x |
| Teams SDK | @microsoft/teams-js | 2.52.x |
| ホスティング | GitHub Pages | — |
| CI/CD | GitHub Actions | — |

---

## SharePoint リスト構成

SharePoint サイト: manmarusystem テナント内の Teams チャネル専用サイト
※ サイト URL・リスト ID は機密情報のため `VITE_SP_*` 環境変数で管理

| リスト | 環境変数キー |
|--------|-------------|
| 顧客マスタ | `VITE_SP_LIST_CUSTOMERS` |
| システムマスタ | `VITE_SP_LIST_SYSTEMS` |
| 作業種別マスタ | `VITE_SP_LIST_WORKTYPES` |
| 作業報告 | `VITE_SP_LIST_REPORTS` |
| 作業予定 | `VITE_SP_LIST_PLANS` |

---

## セットアップ

### 前提条件

- Node.js 20.x LTS
- Microsoft 365 テナント（SharePoint Online + Teams）
- Azure AD アプリ登録（SPA プラットフォーム）済み

### ローカル開発

`ash
git clone https://github.com/joitaliano3a141592-art/manmarudairyreport.git
cd manmarudairyreport
npm install
`

.env.local をプロジェクトルートに作成:

`env
VITE_MSAL_TENANT_ID=<Azure AD テナント ID>
VITE_MSAL_CLIENT_ID=<Azure AD クライアント ID>
VITE_SP_SITE_ID=<SharePoint サイト ID>
VITE_SP_LIST_CUSTOMERS=<顧客マスタ リスト ID>
VITE_SP_LIST_SYSTEMS=<システムマスタ リスト ID>
VITE_SP_LIST_WORKTYPES=<作業種別マスタ リスト ID>
VITE_SP_LIST_REPORTS=<作業報告 リスト ID>
VITE_SP_LIST_PLANS=<作業予定 リスト ID>
VITE_TEAMS_TEAM_ID=<Teams グループ ID>
VITE_TEAMS_CHANNEL_ID=<Teams チャネル ID>
`

`ash
npm run dev   # http://localhost:5173 で起動
`

---

## ビルド & デプロイ

### GitHub Pages（本番）

main ブランチへの push で GitHub Actions が自動的に実行されます。

`ash
git push origin main   # → GitHub Actions → GitHub Pages へ自動デプロイ
`

環境変数は GitHub Secrets で管理:
**Settings → Secrets and variables → Actions**

SharePoint 関連は共有フォルダリンクではなく、対象サイトの Graph site ID と、そのサイト配下の list ID を設定します。
対象サイトが https://manmarusystem.sharepoint.com/sites/msteams_596d4d の場合は、Graph Explorer などで site ID と lists を取得してから以下を更新してください。

| Secret 名 | 内容 |
|-----------|------|
| VITE_MSAL_TENANT_ID | Azure AD テナント ID |
| VITE_MSAL_CLIENT_ID | Azure AD クライアント ID |
| VITE_SP_SITE_ID | SharePoint サイト ID |
| VITE_SP_LIST_CUSTOMERS | 顧客マスタ リスト ID |
| VITE_SP_LIST_SYSTEMS | システムマスタ リスト ID |
| VITE_SP_LIST_WORKTYPES | 作業種別マスタ リスト ID |
| VITE_SP_LIST_REPORTS | 作業報告 リスト ID |
| VITE_SP_LIST_PLANS | 作業予定 リスト ID |
| VITE_TEAMS_TEAM_ID | Teams グループ ID |
| VITE_TEAMS_CHANNEL_ID | Teams チャネル ID |
| VITE_APP_BASE_PATH | /manmarudairyreport/ |

SharePoint の参照先を変えるときに更新する Secret:

1. VITE_SP_SITE_ID
2. VITE_SP_LIST_CUSTOMERS
3. VITE_SP_LIST_SYSTEMS
4. VITE_SP_LIST_WORKTYPES
5. VITE_SP_LIST_REPORTS
6. VITE_SP_LIST_PLANS

### 社内サーバー配信

.env.production.server をテンプレートに .env.production.local を作成してビルド:

`ash
# .env.production.local を設定してから実行
npm run build:server
`

dist/ を IIS の仮想ディレクトリへ配置。public/web.config で SPA のフォールバックルーティングを設定済み。

---

## Teams タブ統合

### マニフェスト情報

- バージョン: 1.0.2（スキーマ v1.17）
- ファイル: 	eams-app/manifest.json
- ZIP: 	eams-manifest-github-v1.0.2.zip（デスクトップ）

### タブ種別

| 種別 | スコープ | 備考 |
|------|---------|------|
| 設定可能タブ | 	eam, groupChat | 共有チャネル対応（supportedChannelTypes: ["sharedChannels"]） |
| 静的タブ | personal | 個人タブ |

### Teamsタブでの認証フロー

Teams iframe 内では loginRedirect が不可のため、Teams SDK 経由のポップアップ認証を使用:

1. microsoftTeams.app.initialize() でコンテキスト確認
2. microsoftTeams.authentication.authenticate() でポップアップ起動
3. ポップアップ側で MSAL loginRedirect → localStorage にトークン保存
4. 親フレームがトークンを検出・利用

---

## GitHub Copilot での活用

VS Code の GitHub Copilot Chat で以下のエージェントが使用可能:

| エージェント | 用途 |
|-------------|------|
| @SharePointWebTeamsOps | SharePoint Online、Web システム、Teams アプリ連携の保守運用向け。認証、manifest、UI不具合、配信調整に対応 |
| @GeekSPApp | SharePoint + MSAL.js アプリ全般 |
| @TeamsIntranetDeploy | 社内サーバー配信・Teams マニフェスト更新 |

---

## リポジトリ構造

`
.
├── .github/
│   ├── agents/
│   │   ├── ManmaruDairyReport.agent.md  # 本アプリ専用エージェント
│   │   ├── GeekSPApp.agent.md           # SP+MSAL汎用エージェント
│   │   └── TeamsIntranetDeploy.agent.md # Teams/社内配信エージェント
│   ├── skills/                          # GitHub Copilot スキル
│   └── workflows/
│       └── deploy.yml                   # GitHub Pages 自動デプロイ
├── docs/                                # アーキテクチャ・設計ドキュメント
├── src/
│   ├── components/                      # 共通 UI コンポーネント
│   ├── hooks/                           # カスタムフック (use-sharepoint 等)
│   ├── lib/
│   │   ├── graphClient.ts               # Graph API クライアント
│   │   ├── msalConfig.ts                # MSAL 設定
│   │   ├── sharepointConfig.ts          # SP サイト・リスト ID 設定
│   │   └── reportStore.ts               # レポートストア
│   ├── pages/                           # ページコンポーネント
│   ├── providers/
│   │   └── msal-provider.tsx            # MSAL 認証プロバイダー
│   └── types/                           # TypeScript 型定義
├── scripts/                             # Python 運用スクリプト
├── teams-app/
│   └── manifest.json                    # Teams アプリマニフェスト
├── public/
│   └── web.config                       # IIS 用 SPA ルーティング設定
├── .env.production.server               # 社内サーバー用 env テンプレート
├── vite.config.ts
└── package.json
`

---

## ライセンス

MIT License — 詳細は [LICENSE](./LICENSE) を参照してください。
