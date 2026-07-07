# SharePoint リスト定義（現行）

このドキュメントは、現在の業務日報アプリが前提とする SharePoint リスト構成をまとめたものです。  
認証や全体構成は `docs/SYSTEM_ARCHITECTURE.md` を参照してください。

## 1. リスト一覧

| リスト | 用途 |
|--------|------|
| 顧客マスタ | 顧客名と顧客番号の管理 |
| システムマスタ | 顧客ごとのシステム管理 |
| 工事番号マスタ | システム配下の工事番号管理 |
| 作業種別マスタ | 作業種別の管理 |
| 作業報告 | 日々の実績記録 |
| 作業予定 | 今後の予定記録 |
| 作業日 | 出退勤・休憩・本日のひとこと |

## 2. 列定義

### 顧客マスタ

- `Title`（既定 / 単一行テキスト）: 顧客名
- `SortOrder`（数値）: 顧客番号
- `IsDisabled`（はい / いいえ）: 無効

### システムマスタ

- `Title`（既定 / 単一行テキスト）: システム名
- `Customer`（Lookup -> 顧客マスタ.Title）: 顧客
- `Description`（複数行テキスト）: 説明
- `SortOrder`（数値）: 表示順
- `IsDisabled`（はい / いいえ）: 無効

### 工事番号マスタ

- `Title`（既定 / 単一行テキスト）: 工事番号
- `WorkNumberName`（単一行テキスト）: 工事番号名
- `_x30b7__x30b9__x30c6__x30e0_ID`（数値）: システムマスタのアイテム ID
- `IsDisabled`（はい / いいえ）: 無効

### 作業種別マスタ

- `Title`（既定 / 単一行テキスト）: 作業種別名
- `SortOrder`（数値）: 表示順

### 作業報告

- `Title`（既定 / 単一行テキスト）: 件名
- `ReportDate`（日付）: 作業日
- `RegistrationDate`（日付）: 登録日
- `Customer`（Lookup -> 顧客マスタ.Title）: 顧客
- `System`（Lookup -> システムマスタ.Title）: システム
- `WorkType`（Lookup -> 作業種別マスタ.Title）: 作業種別
- `WorkNumber`（Lookup -> 工事番号マスタ.Title）: 工事番号
- `WorkDescription`（複数行テキスト）: 作業内容
- `PlannedHours`（数値）: 予定時間
- `WorkHours`（数値）: 作業時間
- `ReporterName`（単一行テキスト）: 報告者名
- `Reporter`（ユーザー）: 報告者
- `IsProject`（はい / いいえ）: 案件
- `Achievement`（Choice）: ○ / △ / ✕
- `IsComplete`（はい / いいえ）: 旧データ互換用

### 作業予定

- `Title`（既定 / 単一行テキスト）: 件名
- `PlanDate`（日付）: 予定日
- `Customer`（Lookup -> 顧客マスタ.Title）: 顧客
- `System`（Lookup -> システムマスタ.Title）: システム
- `WorkType`（Lookup -> 作業種別マスタ.Title）: 作業種別
- `WorkNumber`（Lookup -> 工事番号マスタ.Title）: 工事番号
- `WorkDescription`（複数行テキスト）: 作業内容
- `PlannedHours`（数値）: 作業予定時間
- `IsProject`（はい / いいえ）: 案件
- `AssigneeName`（単一行テキスト）: 担当者名
- `Assignee`（ユーザー）: 担当者
- `Status`（Choice）: 未着手 / 進行中 / 完了

### 作業日

- `Title`（既定 / 単一行テキスト）: 件名
- `WorkDate`（日付）: 作業日
- `WorkStartTime`（単一行テキスト）: 開始時刻
- `WorkEndTime`（単一行テキスト）: 終了時刻
- `BreakHours`（数値）: 休憩時間
- `TodayNote`（複数行テキスト）: 本日のひとこと
- `ReporterName`（単一行テキスト）: 登録者名

## 3. 現在の実装との対応

- リスト ID の設定値は `src/lib/sharepointConfig.ts` と `VITE_SP_*` 環境変数で切り替える
- 型定義の基準は `src/types/sharepoint.ts`
- リスト作成の基準スクリプトは `scripts/setup_sharepoint_lists.py`
- `SortOrder` 列（顧客番号 / 表示順）は `scripts/add_sortorder_column.py` で追加・補正する

## 4. 補足

- SPA 上で顧客番号として扱っている値は SharePoint の `SortOrder` 列です
- `作業予定.Status` はセットアップスクリプトで作成されますが、現状の SPA では主要な参照対象ではありません
- `作業報告.IsComplete` は旧データ互換のため読み取り側で吸収しています
