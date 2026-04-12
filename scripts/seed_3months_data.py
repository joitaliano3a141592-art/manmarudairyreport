"""
SharePoint List テストデータ投入スクリプト（3ヶ月分）

既存のセットアップスクリプトの認証・API関数を再利用し、
過去3ヶ月分のリアルな業務日報テストデータを全テーブルに投入する。
"""

from __future__ import annotations
import sys
import random
from datetime import date, timedelta
from pathlib import Path

# 既存スクリプトからインポート
sys.path.insert(0, str(Path(__file__).resolve().parent))
from setup_sharepoint_lists import (
    resolve_site_id, get_item_map_by_title, get_items, add_item, GROUP_ID,
)

# ---------- 定数 ----------

SITE_ID = None  # 実行時に解決

# sharepointConfig.ts のリスト ID
LIST_IDS = {
    "customers": "c43b0091-7d93-4ad9-a7b6-18c3667fdeb0",
    "systems": "17232c11-c714-4e5f-af12-c72b723a2f6e",
    "workTypes": "d2c44136-32cf-4518-be4e-fbf637d3e599",
    "reports": "b7a8c8b8-904e-4c41-b35b-ce256f16e694",
    "plans": "4c4b5d8f-2faf-4b8a-8f3d-2169ebdcaf07",
}

# ---------- マスタデータ定義 ----------

CUSTOMERS = ["ABC 株式会社", "XYZ 工業", "テックス合同会社", "グローバルシステムズ", "ネクスト商事"]

SYSTEMS = {
    "ABC 株式会社": [
        ("基幹システム", "販売・在庫・会計を統合管理する基幹業務システム"),
        ("営業支援システム", "顧客管理・案件管理・日報管理を行う CRM"),
    ],
    "XYZ 工業": [
        ("製造管理システム", "生産計画・工程管理・品質管理を行うシステム"),
        ("IoT 監視システム", "工場設備のセンサーデータを可視化するダッシュボード"),
    ],
    "テックス合同会社": [
        ("販売管理システム", "受注・出荷・請求を管理するシステム"),
        ("ECサイト", "BtoB 向けオンライン受注システム"),
    ],
    "グローバルシステムズ": [
        ("人事給与システム", "勤怠管理・給与計算・年末調整を行うシステム"),
    ],
    "ネクスト商事": [
        ("在庫管理システム", "倉庫の入出庫・棚卸を管理するシステム"),
        ("配送管理システム", "配送ルート最適化・配送状況追跡システム"),
    ],
}

WORK_TYPES = {
    "要件定義": "開発",
    "基本設計": "開発",
    "詳細設計": "開発",
    "機能開発": "開発",
    "コードレビュー": "開発",
    "テスト": "保守",
    "バグ修正": "保守",
    "運用保守": "運用",
    "サーバー管理": "運用",
    "定例会議": "会議",
    "要件ヒアリング": "会議",
    "ドキュメント作成": "その他",
}

# リアルな作業内容テンプレート
REPORT_TEMPLATES = {
    "要件定義": [
        "業務フロー整理と要件一覧の作成",
        "画面要件の洗い出しとワイヤーフレーム作成",
        "非機能要件の整理とレビュー",
        "ユーザーストーリーの作成と優先度付け",
    ],
    "基本設計": [
        "画面遷移図の作成とレビュー",
        "テーブル設計書の作成",
        "API 設計書の作成",
        "アーキテクチャ設計と技術選定",
    ],
    "詳細設計": [
        "処理フロー図の作成",
        "入出力項目定義の詳細化",
        "バッチ処理の設計書作成",
        "エラーハンドリング方針の策定",
    ],
    "機能開発": [
        "ログイン画面の実装",
        "一覧画面のフィルター機能実装",
        "帳票出力機能の実装",
        "データインポート機能の開発",
        "ダッシュボード画面の実装",
        "権限管理機能の実装",
        "検索機能の高速化対応",
        "通知機能の実装",
    ],
    "コードレビュー": [
        "プルリクエストのレビューとフィードバック",
        "セキュリティ観点でのコードレビュー",
        "パフォーマンス改善のコードレビュー",
    ],
    "テスト": [
        "結合テストケースの作成と実施",
        "画面操作テストの実施とバグ報告",
        "性能テストの実施と結果分析",
        "回帰テストの実施",
        "ユーザー受入テストの支援",
    ],
    "バグ修正": [
        "画面表示崩れの修正",
        "データ不整合の原因調査と修正",
        "計算ロジックの修正",
        "文字化け対応",
        "タイムアウトエラーの修正",
    ],
    "運用保守": [
        "月次バッチの実行と結果確認",
        "ログ監視とアラート対応",
        "データパッチの適用",
        "定期メンテナンス作業",
    ],
    "サーバー管理": [
        "SSL 証明書の更新",
        "OS パッチ適用とサーバー再起動",
        "ディスク容量の監視と不要ファイル削除",
        "バックアップの確認とリストアテスト",
    ],
    "定例会議": [
        "週次進捗報告と課題共有",
        "スプリントレビュー会議",
        "リリース判定会議",
        "チーム内振り返り（レトロスペクティブ）",
    ],
    "要件ヒアリング": [
        "追加要件のヒアリングと議事録作成",
        "業務担当者への操作方法確認",
        "改善要望のヒアリングと整理",
    ],
    "ドキュメント作成": [
        "操作マニュアルの作成",
        "リリースノートの作成",
        "運用手順書の更新",
        "設計書の最終更新",
    ],
}

PLAN_DESCRIPTIONS = [
    "画面の実装作業（続き）",
    "テストケース作成と実施",
    "コードレビュー対応",
    "設計書の修正と更新",
    "バグ修正と動作確認",
    "定例ミーティング",
    "要件確認の打ち合わせ",
    "デプロイ作業と動作確認",
    "パフォーマンス改善対応",
    "ドキュメント整備",
    "環境構築と設定",
    "データ移行の準備と検証",
    "ユーザー受入テスト支援",
    "リリース準備作業",
    "障害調査と対応",
]

PLAN_STATUSES = ["完了", "進行中", "未着手"]


def get_weekdays(start: date, end: date) -> list[date]:
    """start から end までの平日一覧を返す。"""
    result = []
    d = start
    while d <= end:
        if d.weekday() < 5:  # 月〜金
            result.append(d)
        d += timedelta(days=1)
    return result


def main():
    print("=" * 60)
    print("SharePoint List テストデータ投入（3ヶ月分）")
    print("=" * 60)

    # サイト ID 解決
    print("\n[STEP 1] サイト ID を取得")
    site_id = resolve_site_id(GROUP_ID)

    # ---------- マスタデータ投入 ----------

    # 顧客マスタ
    print("\n[STEP 2] 顧客マスタ")
    customer_map = get_item_map_by_title(site_id, LIST_IDS["customers"])
    for name in CUSTOMERS:
        if name not in customer_map:
            add_item(site_id, LIST_IDS["customers"], {"Title": name})
    customer_map = get_item_map_by_title(site_id, LIST_IDS["customers"])
    print(f"  顧客数: {len(customer_map)}")

    # システムマスタ
    print("\n[STEP 3] システムマスタ")
    system_map = get_item_map_by_title(site_id, LIST_IDS["systems"])
    for cust_name, systems in SYSTEMS.items():
        cust_id = customer_map.get(cust_name)
        if not cust_id:
            continue
        for sys_name, desc in systems:
            if sys_name not in system_map:
                add_item(site_id, LIST_IDS["systems"], {
                    "Title": sys_name,
                    "CustomerLookupId": cust_id,
                    "Description": desc,
                })
    system_map = get_item_map_by_title(site_id, LIST_IDS["systems"])
    print(f"  システム数: {len(system_map)}")

    # 作業種別マスタ
    print("\n[STEP 4] 作業種別マスタ")
    wt_map = get_item_map_by_title(site_id, LIST_IDS["workTypes"])
    for wt_name, category in WORK_TYPES.items():
        if wt_name not in wt_map:
            add_item(site_id, LIST_IDS["workTypes"], {"Title": wt_name, "Category": category})
    wt_map = get_item_map_by_title(site_id, LIST_IDS["workTypes"])
    print(f"  作業種別数: {len(wt_map)}")

    # ---------- 顧客→システム マッピング ----------
    # system_map の各システム名からどの顧客のものかを引けるようにする
    sys_to_cust: dict[str, str] = {}
    for cust_name, systems in SYSTEMS.items():
        for sys_name, _ in systems:
            sys_to_cust[sys_name] = cust_name

    all_systems = list(system_map.keys())
    all_work_types = list(wt_map.keys())

    # ---------- 作業報告（3ヶ月分）----------

    print("\n[STEP 5] 作業報告（3ヶ月分）")
    today = date.today()
    start_date = today - timedelta(days=90)
    weekdays = get_weekdays(start_date, today)

    existing_reports = get_items(site_id, LIST_IDS["reports"])
    existing_count = len(existing_reports)
    print(f"  既存レポート数: {existing_count}")

    random.seed(42)  # 再現性のため固定シード
    report_count = 0

    for day in weekdays:
        # 1日あたり 2〜4 件の作業報告
        num_reports = random.randint(2, 4)
        day_str = day.isoformat()

        for _ in range(num_reports):
            sys_name = random.choice(all_systems)
            cust_name = sys_to_cust.get(sys_name, random.choice(CUSTOMERS))
            wt_name = random.choice(all_work_types)

            templates = REPORT_TEMPLATES.get(wt_name, ["作業実施"])
            description = random.choice(templates)

            hours = random.choice([0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 6.0, 7.0, 8.0])

            title = f"日報-{wt_name}-{day_str}"

            fields = {
                "Title": title,
                "ReportDate": day_str,
                "CustomerLookupId": customer_map.get(cust_name),
                "SystemLookupId": system_map.get(sys_name),
                "WorkTypeLookupId": wt_map.get(wt_name),
                "WorkDescription": description,
                "WorkHours": hours,
            }

            # None 値を除去
            fields = {k: v for k, v in fields.items() if v is not None}

            try:
                add_item(site_id, LIST_IDS["reports"], fields)
                report_count += 1
            except Exception as e:
                print(f"  [ERROR] {title}: {e}")

    print(f"  投入完了: {report_count} 件")

    # ---------- 作業予定（3ヶ月分）----------

    print("\n[STEP 6] 作業予定（3ヶ月分）")
    existing_plans = get_items(site_id, LIST_IDS["plans"])
    existing_plan_count = len(existing_plans)
    print(f"  既存プラン数: {existing_plan_count}")

    plan_count = 0

    for day in weekdays:
        # 1日あたり 1〜3 件の作業予定
        num_plans = random.randint(1, 3)
        day_str = day.isoformat()

        for _ in range(num_plans):
            sys_name = random.choice(all_systems)
            cust_name = sys_to_cust.get(sys_name, random.choice(CUSTOMERS))
            description = random.choice(PLAN_DESCRIPTIONS)

            # 過去の予定は完了 or 進行中、今日以降は未着手が多め
            if day < today:
                status = random.choices(PLAN_STATUSES, weights=[70, 20, 10])[0]
            elif day == today:
                status = random.choices(PLAN_STATUSES, weights=[30, 50, 20])[0]
            else:
                status = random.choices(PLAN_STATUSES, weights=[5, 15, 80])[0]

            title = f"予定-{description[:6]}-{day_str}"

            fields = {
                "Title": title,
                "PlanDate": day_str,
                "CustomerLookupId": customer_map.get(cust_name),
                "SystemLookupId": system_map.get(sys_name),
                "WorkDescription": description,
                "Status": status,
            }

            fields = {k: v for k, v in fields.items() if v is not None}

            try:
                add_item(site_id, LIST_IDS["plans"], fields)
                plan_count += 1
            except Exception as e:
                print(f"  [ERROR] {title}: {e}")

    print(f"  投入完了: {plan_count} 件")

    # ---------- サマリ ----------

    print("\n" + "=" * 60)
    print("テストデータ投入完了!")
    print(f"  顧客マスタ: {len(customer_map)} 件")
    print(f"  システムマスタ: {len(system_map)} 件")
    print(f"  作業種別マスタ: {len(wt_map)} 件")
    print(f"  作業報告: {report_count} 件（新規投入）")
    print(f"  作業予定: {plan_count} 件（新規投入）")
    print("=" * 60)


if __name__ == "__main__":
    main()
