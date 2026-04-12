"""
SharePoint List テストデータ投入スクリプト（10ユーザー × 3ヶ月分）

既存データを削除してから、10人のユーザーの作業報告・予定を3ヶ月分投入する。
"""

from __future__ import annotations
import sys
import random
import os
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from setup_sharepoint_lists import (
    resolve_site_id, get_item_map_by_title, get_items, add_item, GROUP_ID,
    _get_graph_credential, GRAPH_BASE, GRAPH_SCOPE,
)
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# ---------- リスト ID ----------
LIST_IDS = {
    "customers": os.getenv("VITE_SP_LIST_CUSTOMERS", ""),
    "systems": os.getenv("VITE_SP_LIST_SYSTEMS", ""),
    "workTypes": os.getenv("VITE_SP_LIST_WORKTYPES", ""),
    "reports": os.getenv("VITE_SP_LIST_REPORTS", ""),
    "plans": os.getenv("VITE_SP_LIST_PLANS", ""),
}

# ---------- 10人のテストユーザー ----------
USERS = [
    "鈴木 一郎",
    "佐藤 花子",
    "田中 太郎",
    "高橋 美咲",
    "伊藤 健太",
    "渡辺 由美",
    "山本 翔太",
    "中村 恵子",
    "小林 大輔",
    "加藤 さくら",
]

# ---------- マスタデータ ----------
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
        ("勤怠管理システム", "出退勤・残業管理・有給管理を行うシステム"),
    ],
    "ネクスト商事": [
        ("在庫管理システム", "倉庫の入出庫・棚卸を管理するシステム"),
        ("配送管理システム", "配送ルート最適化・配送状況追跡システム"),
    ],
}

WORK_TYPES = {
    "要件定義": "開発", "基本設計": "開発", "詳細設計": "開発",
    "機能開発": "開発", "コードレビュー": "開発",
    "テスト": "保守", "バグ修正": "保守",
    "運用保守": "運用", "サーバー管理": "運用",
    "定例会議": "会議", "要件ヒアリング": "会議",
    "ドキュメント作成": "その他",
}

REPORT_TEMPLATES = {
    "要件定義": ["業務フロー整理と要件一覧の作成", "画面要件の洗い出し", "非機能要件の整理", "ユーザーストーリーの作成"],
    "基本設計": ["画面遷移図の作成", "テーブル設計書の作成", "API 設計書の作成", "アーキテクチャ設計"],
    "詳細設計": ["処理フロー図の作成", "入出力項目定義の詳細化", "バッチ処理の設計", "エラーハンドリング方針の策定"],
    "機能開発": ["ログイン画面の実装", "一覧画面のフィルター機能実装", "帳票出力機能の実装", "ダッシュボード画面の実装", "権限管理機能の実装", "検索機能の高速化対応", "通知機能の実装", "データインポート機能の開発"],
    "コードレビュー": ["プルリクエストのレビュー", "セキュリティ観点でのコードレビュー", "パフォーマンス改善のレビュー"],
    "テスト": ["結合テストケースの作成と実施", "画面操作テストの実施", "性能テストの実施と分析", "回帰テストの実施", "ユーザー受入テストの支援"],
    "バグ修正": ["画面表示崩れの修正", "データ不整合の修正", "計算ロジックの修正", "タイムアウトエラーの修正"],
    "運用保守": ["月次バッチの実行と確認", "ログ監視とアラート対応", "データパッチの適用", "定期メンテナンス"],
    "サーバー管理": ["SSL 証明書の更新", "OS パッチ適用", "ディスク容量の監視", "バックアップの確認"],
    "定例会議": ["週次進捗報告", "スプリントレビュー会議", "リリース判定会議", "振り返り会議"],
    "要件ヒアリング": ["追加要件のヒアリング", "業務担当者への確認", "改善要望のヒアリング"],
    "ドキュメント作成": ["操作マニュアルの作成", "リリースノートの作成", "運用手順書の更新", "設計書の最終更新"],
}

PLAN_DESCRIPTIONS = [
    "画面の実装作業（続き）", "テストケース作成と実施", "コードレビュー対応",
    "設計書の修正と更新", "バグ修正と動作確認", "定例ミーティング",
    "要件確認の打ち合わせ", "デプロイ作業と動作確認", "パフォーマンス改善対応",
    "ドキュメント整備", "環境構築と設定", "データ移行の準備",
    "ユーザー受入テスト支援", "リリース準備作業", "障害調査と対応",
]

PLAN_STATUSES = ["完了", "進行中", "未着手"]

# 各ユーザーに担当顧客を割り当て（メイン2社程度）
USER_CUSTOMER_AFFINITY = {
    "鈴木 一郎": ["ABC 株式会社", "XYZ 工業"],
    "佐藤 花子": ["ABC 株式会社", "テックス合同会社"],
    "田中 太郎": ["XYZ 工業", "グローバルシステムズ"],
    "高橋 美咲": ["テックス合同会社", "ネクスト商事"],
    "伊藤 健太": ["グローバルシステムズ", "ABC 株式会社"],
    "渡辺 由美": ["ネクスト商事", "XYZ 工業"],
    "山本 翔太": ["ABC 株式会社", "グローバルシステムズ"],
    "中村 恵子": ["XYZ 工業", "テックス合同会社"],
    "小林 大輔": ["ネクスト商事", "ABC 株式会社"],
    "加藤 さくら": ["テックス合同会社", "グローバルシステムズ"],
}


def get_weekdays(start: date, end: date) -> list[date]:
    result = []
    d = start
    while d <= end:
        if d.weekday() < 5:
            result.append(d)
        d += timedelta(days=1)
    return result


def delete_all_items(site_id: str, list_id: str, token: str) -> int:
    """リスト内の全アイテムを削除する。"""
    headers = {"Authorization": f"Bearer {token}"}
    deleted = 0
    while True:
        r = requests.get(
            f"{GRAPH_BASE}/sites/{site_id}/lists/{list_id}/items?$select=id&$top=200",
            headers=headers,
        )
        items = r.json().get("value", [])
        if not items:
            break
        for item in items:
            dr = requests.delete(
                f"{GRAPH_BASE}/sites/{site_id}/lists/{list_id}/items/{item['id']}",
                headers=headers,
            )
            if dr.ok:
                deleted += 1
    return deleted


def main():
    print("=" * 60)
    print("SharePoint List テストデータ投入（10ユーザー × 3ヶ月分）")
    print("=" * 60)

    # サイト ID 解決
    print("\n[STEP 1] サイト ID を取得")
    site_id = resolve_site_id(GROUP_ID)

    # トークン取得（削除用）
    cred = _get_graph_credential()
    token = cred.get_token(GRAPH_SCOPE).token

    # ---------- 既存データ削除 ----------
    print("\n[STEP 2] 既存の reports / plans を削除")
    del_r = delete_all_items(site_id, LIST_IDS["reports"], token)
    print(f"  reports 削除: {del_r} 件")
    del_p = delete_all_items(site_id, LIST_IDS["plans"], token)
    print(f"  plans 削除: {del_p} 件")

    # ---------- マスタデータ確認・投入 ----------
    print("\n[STEP 3] マスタデータ確認・投入")
    customer_map = get_item_map_by_title(site_id, LIST_IDS["customers"])
    for name in CUSTOMERS:
        if name not in customer_map:
            add_item(site_id, LIST_IDS["customers"], {"Title": name})
    customer_map = get_item_map_by_title(site_id, LIST_IDS["customers"])
    print(f"  顧客数: {len(customer_map)}")

    system_map = get_item_map_by_title(site_id, LIST_IDS["systems"])
    for cust_name, systems in SYSTEMS.items():
        cust_id = customer_map.get(cust_name)
        if not cust_id:
            continue
        for sys_name, desc in systems:
            if sys_name not in system_map:
                add_item(site_id, LIST_IDS["systems"], {
                    "Title": sys_name, "CustomerLookupId": cust_id, "Description": desc,
                })
    system_map = get_item_map_by_title(site_id, LIST_IDS["systems"])
    print(f"  システム数: {len(system_map)}")

    wt_map = get_item_map_by_title(site_id, LIST_IDS["workTypes"])
    for wt_name, category in WORK_TYPES.items():
        if wt_name not in wt_map:
            add_item(site_id, LIST_IDS["workTypes"], {"Title": wt_name, "Category": category})
    wt_map = get_item_map_by_title(site_id, LIST_IDS["workTypes"])
    print(f"  作業種別数: {len(wt_map)}")

    # 顧客→システム名マッピング
    sys_to_cust: dict[str, str] = {}
    for cust_name, systems in SYSTEMS.items():
        for sys_name, _ in systems:
            sys_to_cust[sys_name] = cust_name

    # 顧客→そのシステム名リスト
    cust_to_systems: dict[str, list[str]] = {}
    for cust_name, systems in SYSTEMS.items():
        cust_to_systems[cust_name] = [s[0] for s in systems]

    all_work_types = list(wt_map.keys())

    # ---------- 3ヶ月分の平日 ----------
    today = date.today()
    start_date = today - timedelta(days=90)
    weekdays = get_weekdays(start_date, today)

    # ---------- 作業報告（10ユーザー × 3ヶ月）----------
    print(f"\n[STEP 4] 作業報告を投入（{len(USERS)} ユーザー × {len(weekdays)} 日）")
    random.seed(2026)
    report_count = 0

    for day in weekdays:
        day_str = day.isoformat()
        # 各ユーザーが毎日 1〜3 件の作業報告
        for user in USERS:
            # 20% の確率で休暇（報告なし）
            if random.random() < 0.2:
                continue

            num_reports = random.randint(1, 3)
            preferred_custs = USER_CUSTOMER_AFFINITY.get(user, CUSTOMERS[:2])

            for _ in range(num_reports):
                # 80% で担当顧客、20% で他の顧客
                if random.random() < 0.8:
                    cust_name = random.choice(preferred_custs)
                else:
                    cust_name = random.choice(CUSTOMERS)

                cust_systems = cust_to_systems.get(cust_name, [])
                sys_name = random.choice(cust_systems) if cust_systems else None

                wt_name = random.choice(all_work_types)
                templates = REPORT_TEMPLATES.get(wt_name, ["作業実施"])
                description = random.choice(templates)
                hours = random.choice([0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0])

                fields = {
                    "Title": f"{user}-{wt_name}-{day_str}",
                    "ReportDate": day_str,
                    "CustomerLookupId": customer_map.get(cust_name),
                    "SystemLookupId": system_map.get(sys_name) if sys_name else None,
                    "WorkTypeLookupId": wt_map.get(wt_name),
                    "WorkDescription": description,
                    "WorkHours": hours,
                    "ReporterName": user,
                }
                fields = {k: v for k, v in fields.items() if v is not None}

                try:
                    add_item(site_id, LIST_IDS["reports"], fields)
                    report_count += 1
                    if report_count % 100 == 0:
                        print(f"  ... {report_count} 件投入済み")
                except Exception as e:
                    print(f"  [ERROR] {fields.get('Title','')}: {e}")

    print(f"  投入完了: {report_count} 件")

    # ---------- 作業予定（10ユーザー × 3ヶ月）----------
    print(f"\n[STEP 5] 作業予定を投入（{len(USERS)} ユーザー × {len(weekdays)} 日）")
    plan_count = 0

    for day in weekdays:
        day_str = day.isoformat()

        for user in USERS:
            if random.random() < 0.15:
                continue

            num_plans = random.randint(1, 2)
            preferred_custs = USER_CUSTOMER_AFFINITY.get(user, CUSTOMERS[:2])

            for _ in range(num_plans):
                if random.random() < 0.8:
                    cust_name = random.choice(preferred_custs)
                else:
                    cust_name = random.choice(CUSTOMERS)

                cust_systems = cust_to_systems.get(cust_name, [])
                sys_name = random.choice(cust_systems) if cust_systems else None

                description = random.choice(PLAN_DESCRIPTIONS)

                if day < today:
                    status = random.choices(PLAN_STATUSES, weights=[70, 20, 10])[0]
                elif day == today:
                    status = random.choices(PLAN_STATUSES, weights=[30, 50, 20])[0]
                else:
                    status = random.choices(PLAN_STATUSES, weights=[5, 15, 80])[0]

                fields = {
                    "Title": f"{user}-{description[:8]}-{day_str}",
                    "PlanDate": day_str,
                    "CustomerLookupId": customer_map.get(cust_name),
                    "SystemLookupId": system_map.get(sys_name) if sys_name else None,
                    "WorkDescription": description,
                    "Status": status,
                    "AssigneeName": user,
                }
                fields = {k: v for k, v in fields.items() if v is not None}

                try:
                    add_item(site_id, LIST_IDS["plans"], fields)
                    plan_count += 1
                    if plan_count % 100 == 0:
                        print(f"  ... {plan_count} 件投入済み")
                except Exception as e:
                    print(f"  [ERROR] {fields.get('Title','')}: {e}")

    print(f"  投入完了: {plan_count} 件")

    # ---------- サマリ ----------
    print("\n" + "=" * 60)
    print("テストデータ投入完了!")
    print(f"  ユーザー数: {len(USERS)}")
    print(f"  顧客マスタ: {len(customer_map)} 件")
    print(f"  システムマスタ: {len(system_map)} 件")
    print(f"  作業種別マスタ: {len(wt_map)} 件")
    print(f"  作業報告: {report_count} 件")
    print(f"  作業予定: {plan_count} 件")
    print("=" * 60)


if __name__ == "__main__":
    main()
