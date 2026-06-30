# 業務日報アプリ

株式会社マンマルシステム向け業務日報管理システム。SharePoint Online リストをバックエンドに、Microsoft Entra ID 認証・GitHub Pages ホスティング・Teams タブ統合を組み合わせた業務 Web アプリです。

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-デプロイ済み-brightgreen?style=for-the-badge&logo=github)](https://joitaliano3a141592-art.github.io/manmarudairyreport/)
[![Teams](https://img.shields.io/badge/Microsoft%20Teams-タブ対応-6264A7?style=for-the-badge&logo=microsoftteams&logoColor=white)](https://teams.microsoft.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

---

## システム構成

- フロントエンド: React + Vite の SPA
- 認証: Microsoft Entra ID + MSAL.js
- データ: SharePoint Online 7リスト（顧客 / システム / 工事番号 / 作業種別 / 作業報告 / 作業予定 / 作業日）
- Teams 連携: Teams タブ表示、Teams チャネル発報
- 配信: GitHub Pages / 社内サーバー（IIS・Nginx）

詳細は以下を参照してください。

- [システム構成と認証フロー](./docs/SYSTEM_ARCHITECTURE.md)
- [SharePoint リスト定義](./docs/SHAREPOINT_LIST_PLAN.md)

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

SharePoint サイト ID とリスト ID は設定値で切り替えます。現在アプリが参照する主なリストは次の 7 つです。

| リスト | 環境変数キー |
|--------|-------------|
| 顧客マスタ | `VITE_SP_LIST_CUSTOMERS` |
| システムマスタ | `VITE_SP_LIST_SYSTEMS` |
| 工事番号マスタ | `VITE_SP_LIST_WORKNUMBERS` |
| 作業種別マスタ | `VITE_SP_LIST_WORKTYPES` |
| 作業報告 | `VITE_SP_LIST_REPORTS` |
| 作業予定 | `VITE_SP_LIST_PLANS` |
| 作業日 | `VITE_SP_LIST_WORKDAYS` |

列構成の詳細は [docs/SHAREPOINT_LIST_PLAN.md](./docs/SHAREPOINT_LIST_PLAN.md) を参照してください。

---

## セットアップ

### 前提条件

- Node.js 20.x LTS
- Microsoft 365 テナント（SharePoint Online + Teams）
- Azure AD アプリ登録（SPA プラットフォーム）済み

### ローカル開発

```bash
git clone https://github.com/joitaliano3a141592-art/manmarudairyreport.git
cd manmarudairyreport
npm install
```

.env.local をプロジェクトルートに作成:

```env
VITE_MSAL_TENANT_ID=<Azure AD テナント ID>
VITE_MSAL_CLIENT_ID=<Azure AD クライアント ID>
VITE_SP_SITE_ID=<SharePoint サイト ID>
VITE_SP_LIST_CUSTOMERS=<顧客マスタ リスト ID>
VITE_SP_LIST_SYSTEMS=<システムマスタ リスト ID>
VITE_SP_LIST_WORKNUMBERS=<工事番号マスタ リスト ID>
VITE_SP_LIST_WORKTYPES=<作業種別マスタ リスト ID>
VITE_SP_LIST_REPORTS=<作業報告 リスト ID>
VITE_SP_LIST_PLANS=<作業予定 リスト ID>
VITE_SP_LIST_WORKDAYS=<作業日 リスト ID>
VITE_TEAMS_TEAM_ID=<Teams グループ ID>
VITE_TEAMS_CHANNEL_ID=<Teams チャネル ID>
```

```bash
npm run dev   # http://localhost:5173 で起動
```

---

## ビルド & デプロイ

### GitHub Pages（本番）

main ブランチへの push で GitHub Actions が自動的に実行されます。

```bash
git push origin main   # → GitHub Actions → GitHub Pages へ自動デプロイ
```

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
| VITE_SP_LIST_WORKNUMBERS | 工事番号マスタ リスト ID |
| VITE_SP_LIST_WORKTYPES | 作業種別マスタ リスト ID |
| VITE_SP_LIST_REPORTS | 作業報告 リスト ID |
| VITE_SP_LIST_PLANS | 作業予定 リスト ID |
| VITE_SP_LIST_WORKDAYS | 作業日 リスト ID |
| VITE_TEAMS_TEAM_ID | Teams グループ ID |
| VITE_TEAMS_CHANNEL_ID | Teams チャネル ID |
| VITE_APP_BASE_PATH | /manmarudairyreport/ |

SharePoint の参照先を変えるときに更新する Secret:

1. VITE_SP_SITE_ID
2. VITE_SP_LIST_CUSTOMERS
3. VITE_SP_LIST_SYSTEMS
4. VITE_SP_LIST_WORKNUMBERS
5. VITE_SP_LIST_WORKTYPES
6. VITE_SP_LIST_REPORTS
7. VITE_SP_LIST_PLANS
8. VITE_SP_LIST_WORKDAYS

### 社内サーバー配信

.env.production.server をテンプレートに .env.production.local を作成してビルド:

```bash
# .env.production.local を設定してから実行
npm run build:server
```

dist/ を IIS の仮想ディレクトリへ配置。public/web.config で SPA のフォールバックルーティングを設定済み。

---

## Teams タブ統合

### マニフェスト情報

- バージョン: 1.0.6（スキーマ v1.17）
- ファイル: 	eams-app/manifest.json
- ZIP: `teams-app.zip`

### タブ種別

| 種別 | スコープ | 備考 |
|------|---------|------|
| 設定可能タブ | 	eam, groupChat | 共有チャネル対応（supportedChannelTypes: ["sharedChannels"]） |
| 静的タブ | personal | 個人タブ |

### Teams タブ認証

認証フローの詳細は [docs/SYSTEM_ARCHITECTURE.md](./docs/SYSTEM_ARCHITECTURE.md) を参照してください。現在の方針は次の通りです。

1. 単体ブラウザ起動時は `loginRedirect()` で初回ログイン
2. Teams タブ起動時は `ssoSilent()` を優先
3. Teams 側で SSO を取得できない場合のみ `microsoftTeams.authentication.authenticate()` にフォールバック

---

## GitHub Copilot での活用

VS Code の GitHub Copilot Chat で以下のエージェントが使用可能:

| エージェント | 用途 |
|-------------|------|
| @SharePointWebTeamsOps | SharePoint Online、Web システム、Teams アプリ連携の保守運用向け。認証、manifest、UI不具合、配信調整に対応 |
| @GeekSPApp | SharePoint + MSAL.js アプリ全般 |
| @TeamsIntranetDeploy | 社内サーバー配信・Teams マニフェスト更新 |

---

## 運用: SharePoint リスト肥大化対策

詳細手順は運用ランブックを参照してください。

- [年次アーカイブ運用ランブック](./docs/ARCHIVE_OPERATION_RUNBOOK.md)

作業実績（`VITE_SP_LIST_REPORTS`）と作業予定（`VITE_SP_LIST_PLANS`）は、
件数増加時に性能劣化しやすいため、以下の方針で運用します。

- 保持方針: 直近24か月を現役リストに保持
- 年次移行: 1月末に前年度分を年別テーブルへ移行
- 実行方式: 自動実行は行わず、必ずユーザーへアラート表示して手動実行
- SharePoint 側インデックス: `ReportDate` / `PlanDate`（必須）

本アプリは日付条件付き取得時、Graph API のサーバー側フィルタを使うため、
全件取得より負荷を下げられます。

### 年別テーブルへの手動移行

`scripts/migrate_previous_year_data.py` は前年度データを以下へ移行します。

- DB: `archives/sharepoint_yearly_archive.db`
- テーブル: `reports_YYYY` / `plans_YYYY`

安全確認後に削除を有効化してください。

```bash
# 1) まず安全確認（移行のみ）
python scripts/migrate_previous_year_data.py --year 2025 --export-only

# 2) 確認後、元リストから削除まで実施
python scripts/migrate_previous_year_data.py --year 2025 --delete-source
```

件数確認のみ:

```bash
python scripts/migrate_previous_year_data.py --year 2025 --dry-run
```

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
│   └── ARCHIVE_OPERATION_RUNBOOK.md     # 年次アーカイブ運用手順
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
