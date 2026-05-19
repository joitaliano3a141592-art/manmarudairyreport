# 年次アーカイブ運用ランブック

このドキュメントは、作業実績/作業予定の年次移行を担当者が毎年同じ手順で実行できるようにする運用手順書です。

## 運用方針

- 現役リスト保持期間: 直近24か月
- 年次移行タイミング: 毎年1月末
- 対象データ: 前年度分（例: 2026年1月末なら2025年分）
- 実行方式: 自動実行なし（必ず手動実行）
- 画面通知: 1月25日〜31日にシステムが案内アラートを表示

## 移行先

- DBファイル: `archives/sharepoint_yearly_archive.db`
- 年別テーブル:
  - `reports_YYYY`
  - `plans_YYYY`

## 事前確認

1. `.env` に以下が設定されていること
- `VITE_SP_SITE_ID`
- `VITE_SP_LIST_REPORTS`
- `VITE_SP_LIST_PLANS`

2. Python 実行環境が準備済みであること

3. SharePoint 側インデックス（推奨）
- `ReportDate`
- `PlanDate`

## 実行手順（必須）

### 1. ドライラン（件数確認）

```bash
python scripts/migrate_previous_year_data.py --year 2025 --dry-run
```

### 2. 安全確認（移行のみ）

```bash
python scripts/migrate_previous_year_data.py --year 2025 --export-only
```

### 3. 移行結果確認

- `archives/sharepoint_yearly_archive.db` が作成/更新されている
- `reports_2025`, `plans_2025` テーブルが存在する
- 件数が想定どおりである

### 4. 本実行（元リスト削除あり）

```bash
python scripts/migrate_previous_year_data.py --year 2025 --delete-source
```

## ロールバック方針

- 本スクリプトは移行先へ upsert 後に元リスト削除を行うため、
  先に `--export-only` で必ず検証する。
- 誤削除時は、年別テーブル保存データ（fields_json/raw_item_json）を元に復旧スクリプトで戻す。

## 参考コマンド

```bash
# 前年を自動指定して実行（必要に応じて）
python scripts/migrate_previous_year_data.py --export-only

# 本実行
python scripts/migrate_previous_year_data.py --delete-source
```

## 補足

- 1月末はシステム上で案内アラートが表示されます。
- アラートは「実行の促し」であり、移行は必ず担当者が手動で実行してください。
