"""
SharePoint List セットアップスクリプト

Microsoft Graph API を使い、SharePoint サイト上にリスト・列・テストデータを作成する。
既存の auth_helper.py を Azure AD デバイスコード認証で再利用する。

使い方:
  python scripts/setup_sharepoint_lists.py                   # リスト作成のみ
  python scripts/setup_sharepoint_lists.py --seed-demo-data  # テストデータも投入
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

# プロジェクトルートを sys.path に追加
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

import requests
from dotenv import load_dotenv
from azure.identity import DeviceCodeCredential, AuthenticationRecord, TokenCachePersistenceOptions

load_dotenv(_PROJECT_ROOT / ".env")

# ---------- 設定 ----------

# Teams チームの groupId から SharePoint サイトを自動解決
GROUP_ID = os.getenv("SP_GROUP_ID", "")
TENANT_ID = os.getenv("TENANT_ID", "")
GRAPH_SCOPE = "https://graph.microsoft.com/Sites.Manage.All"
GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# Graph API 用: "Microsoft Graph Command Line Tools" 公開マルチテナントアプリ
GRAPH_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e"
_GRAPH_AUTH_RECORD_PATH = _PROJECT_ROOT / ".graph_auth_record.json"
_graph_credential = None


def _get_graph_credential() -> DeviceCodeCredential:
    global _graph_credential
    if _graph_credential is not None:
        return _graph_credential

    cache_options = TokenCachePersistenceOptions(
        name="graph_token_cache_v4",
        allow_unencrypted_storage=True,
    )

    auth_record = None
    if _GRAPH_AUTH_RECORD_PATH.exists():
        try:
            serialized = _GRAPH_AUTH_RECORD_PATH.read_text(encoding="utf-8")
            auth_record = AuthenticationRecord.deserialize(serialized)
            print("[auth] Graph 認証キャッシュをロードしました", file=sys.stderr)
        except Exception:
            pass

    kwargs = {
        "client_id": GRAPH_CLIENT_ID,
        "tenant_id": TENANT_ID or None,
        "cache_persistence_options": cache_options,
    }
    kwargs = {k: v for k, v in kwargs.items() if v is not None}

    if auth_record is not None:
        kwargs["authentication_record"] = auth_record

    _graph_credential = DeviceCodeCredential(**kwargs)
    return _graph_credential


def get_graph_token() -> str:
    cred = _get_graph_credential()
    if not _GRAPH_AUTH_RECORD_PATH.exists():
        record = cred.authenticate(scopes=[GRAPH_SCOPE])
        _GRAPH_AUTH_RECORD_PATH.write_text(record.serialize(), encoding="utf-8")
        print("[auth] Graph 認証レコードを保存しました", file=sys.stderr)
    token = cred.get_token(GRAPH_SCOPE)
    return token.token


# ---------- Graph 汎用 ----------

def graph_headers() -> dict:
    token = get_graph_token()
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def graph_get(path: str) -> dict:
    resp = requests.get(f"{GRAPH_BASE}{path}", headers=graph_headers())
    resp.raise_for_status()
    return resp.json()


def graph_post(path: str, body: dict) -> dict:
    resp = requests.post(f"{GRAPH_BASE}{path}", headers=graph_headers(), json=body)
    if resp.status_code >= 400:
        print(f"[ERROR] POST {path}: {resp.status_code} {resp.text[:500]}", file=sys.stderr)
    resp.raise_for_status()
    return resp.json()


def graph_patch(path: str, body: dict) -> dict:
    resp = requests.patch(f"{GRAPH_BASE}{path}", headers=graph_headers(), json=body)
    if resp.status_code >= 400:
        print(f"[ERROR] PATCH {path}: {resp.status_code} {resp.text[:500]}", file=sys.stderr)
    resp.raise_for_status()
    if resp.text:
        return resp.json()
    return {}


# ---------- Site ID 解決 ----------

def resolve_site_id(group_id: str) -> str:
    """Teams チームの groupId から Graph site ID を取得する。"""
    resp = graph_get(f"/groups/{group_id}/sites/root")
    site_id = resp["id"]
    web_url = resp.get("webUrl", "")
    print(f"[OK] Site ID: {site_id}")
    print(f"[OK] Site URL: {web_url}")
    return site_id


# ---------- リスト管理 ----------

def get_lists(site_id: str) -> dict[str, dict]:
    """既存リスト一覧を dict[displayName] -> list info で返す。"""
    resp = graph_get(f"/sites/{site_id}/lists?$top=200")
    return {lst["displayName"]: lst for lst in resp.get("value", [])}


def ensure_list(site_id: str, display_name: str, existing: dict[str, dict]) -> str:
    """リストを作成し list ID を返す。既存なら skip。"""
    if display_name in existing:
        list_id = existing[display_name]["id"]
        print(f"[SKIP] List exists: {display_name} ({list_id})")
        return list_id

    body = {
        "displayName": display_name,
        "list": {"template": "genericList"},
    }
    resp = graph_post(f"/sites/{site_id}/lists", body)
    list_id = resp["id"]
    print(f"[CREATE] List: {display_name} ({list_id})")
    time.sleep(1)
    return list_id


def get_columns(site_id: str, list_id: str) -> dict[str, dict]:
    """既存列一覧を dict[name] -> column info で返す。"""
    resp = graph_get(f"/sites/{site_id}/lists/{list_id}/columns")
    return {col["name"]: col for col in resp.get("value", [])}


def ensure_text_column(site_id: str, list_id: str, name: str, display_name: str, cols: dict, *, required: bool = False, multi_line: bool = False):
    if name in cols:
        print(f"[SKIP] Column exists: {name}")
        return
    body: dict = {
        "name": name,
        "displayName": display_name,
        "required": required,
        "enforceUniqueValues": False,
    }
    if multi_line:
        body["text"] = {"allowMultipleLines": True, "textType": "plain"}
    else:
        body["text"] = {"allowMultipleLines": False}
    graph_post(f"/sites/{site_id}/lists/{list_id}/columns", body)
    print(f"[CREATE] Column: {name} (text)")


def ensure_number_column(site_id: str, list_id: str, name: str, display_name: str, cols: dict, *, required: bool = False):
    if name in cols:
        print(f"[SKIP] Column exists: {name}")
        return
    body = {
        "name": name,
        "displayName": display_name,
        "required": required,
        "number": {"decimalPlaces": "one"},
    }
    graph_post(f"/sites/{site_id}/lists/{list_id}/columns", body)
    print(f"[CREATE] Column: {name} (number)")


def ensure_datetime_column(site_id: str, list_id: str, name: str, display_name: str, cols: dict, *, required: bool = False):
    if name in cols:
        print(f"[SKIP] Column exists: {name}")
        return
    body = {
        "name": name,
        "displayName": display_name,
        "required": required,
        "dateTime": {"format": "dateOnly"},
    }
    graph_post(f"/sites/{site_id}/lists/{list_id}/columns", body)
    print(f"[CREATE] Column: {name} (dateTime)")


def ensure_choice_column(site_id: str, list_id: str, name: str, display_name: str, choices: list[str], cols: dict, *, required: bool = False):
    if name in cols:
        print(f"[SKIP] Column exists: {name}")
        return
    body = {
        "name": name,
        "displayName": display_name,
        "required": required,
        "choice": {
            "allowTextEntry": False,
            "choices": choices,
        },
    }
    graph_post(f"/sites/{site_id}/lists/{list_id}/columns", body)
    print(f"[CREATE] Column: {name} (choice)")


def ensure_person_column(site_id: str, list_id: str, name: str, display_name: str, cols: dict, *, required: bool = False):
    if name in cols:
        print(f"[SKIP] Column exists: {name}")
        return
    body = {
        "name": name,
        "displayName": display_name,
        "required": required,
        "personOrGroup": {
            "allowMultipleSelection": False,
            "chooseFromType": "peopleOnly",
        },
    }
    graph_post(f"/sites/{site_id}/lists/{list_id}/columns", body)
    print(f"[CREATE] Column: {name} (personOrGroup)")


def ensure_lookup_column(site_id: str, list_id: str, name: str, display_name: str, lookup_list_id: str, cols: dict, *, required: bool = False):
    if name in cols:
        print(f"[SKIP] Column exists: {name}")
        return
    body = {
        "name": name,
        "displayName": display_name,
        "required": required,
        "lookup": {
            "listId": lookup_list_id,
            "columnName": "Title",
        },
    }
    graph_post(f"/sites/{site_id}/lists/{list_id}/columns", body)
    print(f"[CREATE] Column: {name} (lookup)")


# ---------- アイテム管理 ----------

def get_items(site_id: str, list_id: str) -> list[dict]:
    resp = graph_get(f"/sites/{site_id}/lists/{list_id}/items?$expand=fields&$top=500")
    return resp.get("value", [])


def add_item(site_id: str, list_id: str, fields: dict) -> dict:
    body = {"fields": fields}
    resp = graph_post(f"/sites/{site_id}/lists/{list_id}/items", body)
    print(f"  [ADD] {fields.get('Title', '(no title)')}")
    return resp


def get_item_map_by_title(site_id: str, list_id: str) -> dict[str, int]:
    """Title -> ID のマップを返す。"""
    items = get_items(site_id, list_id)
    result = {}
    for item in items:
        title = item.get("fields", {}).get("Title", "")
        if title:
            result[title] = int(item["id"])
    return result


# ---------- メイン ----------

def main():
    parser = argparse.ArgumentParser(description="SharePoint List セットアップ")
    parser.add_argument("--seed-demo-data", action="store_true", help="テストデータを投入する")
    args = parser.parse_args()

    print("=" * 50)
    print("SharePoint List セットアップ")
    print("=" * 50)

    # 1. サイト ID 解決
    print("\n[STEP 1] サイト ID を取得")
    site_id = resolve_site_id(GROUP_ID)

    # 2. 既存リスト取得
    existing_lists = get_lists(site_id)

    # 3. リスト作成
    print("\n[STEP 2] リスト作成")
    customer_list_id = ensure_list(site_id, "顧客マスタ", existing_lists)
    system_list_id = ensure_list(site_id, "システムマスタ", existing_lists)
    worktype_list_id = ensure_list(site_id, "作業種別マスタ", existing_lists)
    report_list_id = ensure_list(site_id, "作業報告", existing_lists)
    plan_list_id = ensure_list(site_id, "作業予定", existing_lists)

    # 4. 列作成
    print("\n[STEP 3] 列作成")

    # 顧客マスタ: Title のみ（デフォルト）
    print("  顧客マスタ: Title（既定）= 会社名")

    # システムマスタ
    sys_cols = get_columns(site_id, system_list_id)
    ensure_lookup_column(site_id, system_list_id, "Customer", "顧客", customer_list_id, sys_cols, required=True)
    ensure_text_column(site_id, system_list_id, "Description", "説明", sys_cols, multi_line=True)

    # 作業種別マスタ
    wt_cols = get_columns(site_id, worktype_list_id)
    ensure_choice_column(site_id, worktype_list_id, "Category", "カテゴリ", ["開発", "保守", "運用", "会議", "その他"], wt_cols)

    # 作業報告
    rpt_cols = get_columns(site_id, report_list_id)
    ensure_datetime_column(site_id, report_list_id, "ReportDate", "作業日", rpt_cols, required=True)
    ensure_lookup_column(site_id, report_list_id, "Customer", "顧客", customer_list_id, rpt_cols, required=True)
    ensure_lookup_column(site_id, report_list_id, "System", "システム", system_list_id, rpt_cols, required=True)
    ensure_lookup_column(site_id, report_list_id, "WorkType", "作業種別", worktype_list_id, rpt_cols, required=True)
    ensure_text_column(site_id, report_list_id, "WorkDescription", "作業内容", rpt_cols, required=True, multi_line=True)
    ensure_number_column(site_id, report_list_id, "WorkHours", "作業時間", rpt_cols, required=True)
    ensure_text_column(site_id, report_list_id, "ReporterName", "報告者名", rpt_cols)
    ensure_person_column(site_id, report_list_id, "Reporter", "報告者", rpt_cols)

    # 作業予定
    plan_cols = get_columns(site_id, plan_list_id)
    ensure_datetime_column(site_id, plan_list_id, "PlanDate", "予定日", plan_cols, required=True)
    ensure_lookup_column(site_id, plan_list_id, "Customer", "顧客", customer_list_id, plan_cols, required=True)
    ensure_lookup_column(site_id, plan_list_id, "System", "システム", system_list_id, plan_cols, required=True)
    ensure_text_column(site_id, plan_list_id, "WorkDescription", "作業内容", plan_cols, required=True, multi_line=True)
    ensure_text_column(site_id, plan_list_id, "AssigneeName", "担当者名", plan_cols)
    ensure_person_column(site_id, plan_list_id, "Assignee", "担当者", plan_cols)
    ensure_choice_column(site_id, plan_list_id, "Status", "状態", ["未着手", "進行中", "完了"], plan_cols, required=True)

    print("\n[OK] リストと列の作成が完了しました。")

    # 5. テストデータ
    if args.seed_demo_data:
        print("\n[STEP 4] テストデータ投入")
        seed_demo_data(site_id, customer_list_id, system_list_id, worktype_list_id, report_list_id, plan_list_id)

    print("\n" + "=" * 50)
    print("セットアップ完了!")
    print("=" * 50)


def seed_demo_data(site_id: str, customer_list_id: str, system_list_id: str, worktype_list_id: str, report_list_id: str, plan_list_id: str):
    from datetime import date, timedelta
    today = date.today().isoformat()
    tomorrow = (date.today() + timedelta(days=1)).isoformat()

    # 顧客マスタ
    print("\n  [顧客マスタ]")
    existing = get_item_map_by_title(site_id, customer_list_id)
    if not existing:
        add_item(site_id, customer_list_id, {"Title": "ABC 株式会社"})
        add_item(site_id, customer_list_id, {"Title": "XYZ 工業"})
        add_item(site_id, customer_list_id, {"Title": "テックス合同会社"})
    else:
        print("  [SKIP] Already has data")
    customer_map = get_item_map_by_title(site_id, customer_list_id)

    # システムマスタ
    print("\n  [システムマスタ]")
    existing = get_item_map_by_title(site_id, system_list_id)
    if not existing:
        add_item(site_id, system_list_id, {"Title": "システムA", "CustomerLookupId": customer_map.get("ABC 株式会社"), "Description": "基幹システム"})
        add_item(site_id, system_list_id, {"Title": "システムB", "CustomerLookupId": customer_map.get("ABC 株式会社"), "Description": "周辺システム"})
        add_item(site_id, system_list_id, {"Title": "システムC", "CustomerLookupId": customer_map.get("XYZ 工業"), "Description": "製造管理"})
        add_item(site_id, system_list_id, {"Title": "システムD", "CustomerLookupId": customer_map.get("テックス合同会社"), "Description": "販売管理"})
    else:
        print("  [SKIP] Already has data")
    system_map = get_item_map_by_title(site_id, system_list_id)

    # 作業種別マスタ
    print("\n  [作業種別マスタ]")
    existing = get_item_map_by_title(site_id, worktype_list_id)
    if not existing:
        add_item(site_id, worktype_list_id, {"Title": "機能開発", "Category": "開発"})
        add_item(site_id, worktype_list_id, {"Title": "テスト", "Category": "保守"})
        add_item(site_id, worktype_list_id, {"Title": "定例会議", "Category": "会議"})
        add_item(site_id, worktype_list_id, {"Title": "要件定義", "Category": "開発"})
        add_item(site_id, worktype_list_id, {"Title": "運用保守", "Category": "運用"})
    else:
        print("  [SKIP] Already has data")
    worktype_map = get_item_map_by_title(site_id, worktype_list_id)

    # 作業報告
    print("\n  [作業報告]")
    existing = get_items(site_id, report_list_id)
    if not existing:
        add_item(site_id, report_list_id, {
            "Title": "日報-機能開発",
            "ReportDate": today,
            "CustomerLookupId": customer_map.get("ABC 株式会社"),
            "SystemLookupId": system_map.get("システムA"),
            "WorkTypeLookupId": worktype_map.get("機能開発"),
            "WorkDescription": "画面設計と実装（ダッシュボード機能）",
            "WorkHours": 4.5,
        })
        add_item(site_id, report_list_id, {
            "Title": "日報-テスト",
            "ReportDate": today,
            "CustomerLookupId": customer_map.get("XYZ 工業"),
            "SystemLookupId": system_map.get("システムC"),
            "WorkTypeLookupId": worktype_map.get("テスト"),
            "WorkDescription": "結合テスト実施とバグ修正",
            "WorkHours": 3.0,
        })
        add_item(site_id, report_list_id, {
            "Title": "日報-定例会議",
            "ReportDate": today,
            "CustomerLookupId": customer_map.get("テックス合同会社"),
            "SystemLookupId": system_map.get("システムD"),
            "WorkTypeLookupId": worktype_map.get("定例会議"),
            "WorkDescription": "週次定例ミーティング",
            "WorkHours": 1.0,
        })
    else:
        print("  [SKIP] Already has data")

    # 作業予定
    print("\n  [作業予定]")
    existing = get_items(site_id, plan_list_id)
    if not existing:
        add_item(site_id, plan_list_id, {
            "Title": "今日-定例資料",
            "PlanDate": today,
            "CustomerLookupId": customer_map.get("ABC 株式会社"),
            "SystemLookupId": system_map.get("システムA"),
            "WorkDescription": "定例ミーティング資料の整理と共有",
            "Status": "完了",
        })
        add_item(site_id, plan_list_id, {
            "Title": "今日-環境構築",
            "PlanDate": today,
            "CustomerLookupId": customer_map.get("XYZ 工業"),
            "SystemLookupId": system_map.get("システムC"),
            "WorkDescription": "環境構築の確認と初期テスト",
            "Status": "進行中",
        })
        add_item(site_id, plan_list_id, {
            "Title": "明日-要件確認",
            "PlanDate": tomorrow,
            "CustomerLookupId": customer_map.get("テックス合同会社"),
            "SystemLookupId": system_map.get("システムD"),
            "WorkDescription": "要件確認と調整",
            "Status": "未着手",
        })
        add_item(site_id, plan_list_id, {
            "Title": "明日-障害調査",
            "PlanDate": tomorrow,
            "CustomerLookupId": customer_map.get("ABC 株式会社"),
            "SystemLookupId": system_map.get("システムB"),
            "WorkDescription": "障害対応の予備調査",
            "Status": "未着手",
        })
    else:
        print("  [SKIP] Already has data")

    print("\n[OK] テストデータ投入完了")


if __name__ == "__main__":
    main()
