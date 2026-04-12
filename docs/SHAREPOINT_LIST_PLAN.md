# SharePoint List 移行プラン（業務日報アプリ）

このドキュメントは、既存のローカル実装を SharePoint List バックエンドへ移行するための設計と手順をまとめています。

## 1. リスト構成

- 顧客マスタ
- システムマスタ
- 作業種別マスタ
- 作業報告
- 作業予定

## 2. 列定義

### 顧客マスタ

- Title（既定）: 会社名

### システムマスタ

- Title（既定）: システム名
- Customer（Lookup -> 顧客マスタ.Title）: 顧客
- Description（複数行テキスト）: 説明

### 作業種別マスタ

- Title（既定）: 作業種別名
- Category（Choice）: 開発 / 保守 / 運用 / 会議 / その他

### 作業報告

- Title（既定）: 件名
- ReportDate（日付）: 作業日
- Customer（Lookup -> 顧客マスタ.Title）: 顧客
- System（Lookup -> システムマスタ.Title）: システム
- WorkType（Lookup -> 作業種別マスタ.Title）: 作業種別
- WorkDescription（複数行テキスト）: 作業内容
- WorkHours（数値）: 作業時間
- Reporter（ユーザー）: 報告者

### 作業予定

- Title（既定）: 件名
- PlanDate（日付）: 予定日
- Customer（Lookup -> 顧客マスタ.Title）: 顧客
- System（Lookup -> システムマスタ.Title）: システム
- WorkDescription（複数行テキスト）: 作業内容
- Assignee（ユーザー）: 担当者
- Status（Choice）: 未着手 / 進行中 / 完了

## 3. 自動化スクリプト

PowerShell（PnP.PowerShell）でリストと列を作成し、任意でテストデータを投入できます。

- スクリプト: scripts/sharepoint/setup_sharepoint_lists.ps1

実行例:

```powershell
# 1) 初回のみモジュール導入
Install-Module PnP.PowerShell -Scope CurrentUser

# 2) リスト作成のみ
./scripts/sharepoint/setup_sharepoint_lists.ps1 -SiteUrl "https://{tenant}.sharepoint.com/sites/{siteName}"

# 3) リスト作成 + テストデータ投入
./scripts/sharepoint/setup_sharepoint_lists.ps1 -SiteUrl "https://{tenant}.sharepoint.com/sites/{siteName}" -SeedDemoData
```

## 4. 人の手が必要な作業

次は UI 操作が必要です。

1. SharePoint サイト作成（未作成なら）
2. スクリプト実行アカウントにサイト所有者権限付与
3. Power Apps（make.powerapps.com）でアプリに SharePoint コネクタを追加
4. 各画面のデータソース差し替え
   - 顧客マスタ画面 -> 顧客マスタリスト
   - システムマスタ画面 -> システムマスタリスト
   - 日報入力/一覧 -> 作業報告リスト
   - 作業予定入力/一覧 -> 作業予定リスト

## 5. 次の実装タスク（このリポジトリ側）

- reportStore の永続層を SharePoint API 呼び出しに置換
- Lookup 列の整形関数追加（ID/表示名変換）
- 既存画面の CRUD を sharepointService 経由に統一
- ダッシュボード集計を SharePoint データで再計算
