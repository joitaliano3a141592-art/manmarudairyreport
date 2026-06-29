"""
顧客マスタ・システムマスタ・作業種別マスタに SortOrder (表示順) 列を追加するスクリプト

- SortOrder が未設定のアイテムはデフォルト 10 を設定
- タイトルに「その他」を含むアイテムは SortOrder=99 を設定

使い方:
  python scripts/add_sortorder_column.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import requests
from azure.identity import DeviceCodeCredential, AuthenticationRecord, TokenCachePersistenceOptions
from dotenv import load_dotenv

_PROJECT_ROOT = Path(__file__).resolve().parent.parent

load_dotenv(_PROJECT_ROOT / ".env.production.local")
load_dotenv(_PROJECT_ROOT / ".env", override=False)

SITE_ID = os.getenv("VITE_SP_SITE_ID", "")
CUSTOMERS_LIST_ID = os.getenv("VITE_SP_LIST_CUSTOMERS", "")
SYSTEMS_LIST_ID = os.getenv("VITE_SP_LIST_SYSTEMS", "")
WORKTYPES_LIST_ID = os.getenv("VITE_SP_LIST_WORKTYPES", "")
TENANT_ID = os.getenv("TENANT_ID", "") or os.getenv("VITE_MSAL_TENANT_ID", "")

GRAPH_SCOPE = "https://graph.microsoft.com/Sites.Manage.All"
GRAPH_BASE = "https://graph.microsoft.com/v1.0"
GRAPH_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e"
_GRAPH_AUTH_RECORD_PATH = _PROJECT_ROOT / ".graph_auth_record.json"

DEFAULT_SORT_ORDER = 10
OTHER_SORT_ORDER = 99


def get_sortorder_display_name(list_name: str) -> str:
    if list_name == "顧客マスタ":
        return "顧客番号"
    return "表示順"


def _get_credential() -> DeviceCodeCredential:
    cache_options = TokenCachePersistenceOptions(
        name="graph_token_cache_v4",
        allow_unencrypted_storage=True,
    )
    auth_record = None
    if _GRAPH_AUTH_RECORD_PATH.exists():
        try:
            serialized = _GRAPH_AUTH_RECORD_PATH.read_text(encoding="utf-8")
            auth_record = AuthenticationRecord.deserialize(serialized)
        except Exception:
            pass

    kwargs: dict = {
        "client_id": GRAPH_CLIENT_ID,
        "cache_persistence_options": cache_options,
    }
    if TENANT_ID:
        kwargs["tenant_id"] = TENANT_ID
    if auth_record is not None:
        kwargs["authentication_record"] = auth_record

    return DeviceCodeCredential(**kwargs)


def get_token() -> str:
    cred = _get_credential()
    if not _GRAPH_AUTH_RECORD_PATH.exists():
        record = cred.authenticate(scopes=[GRAPH_SCOPE])
        _GRAPH_AUTH_RECORD_PATH.write_text(record.serialize(), encoding="utf-8")
    token = cred.get_token(GRAPH_SCOPE)
    return token.token


def graph_headers() -> dict:
    return {
        "Authorization": f"Bearer {get_token()}",
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


def get_columns(site_id: str, list_id: str) -> dict[str, dict]:
    resp = graph_get(f"/sites/{site_id}/lists/{list_id}/columns")
    return {col["name"]: col for col in resp.get("value", [])}


def get_list_items(site_id: str, list_id: str) -> list[dict]:
    items = []
    url: str | None = f"/sites/{site_id}/lists/{list_id}/items?$expand=fields&$top=200"
    while url:
        resp = graph_get(url)
        items.extend(resp.get("value", []))
        next_link = resp.get("@odata.nextLink")
        url = next_link.replace(GRAPH_BASE, "") if next_link else None
    return items


def ensure_sortorder_column(site_id: str, list_id: str, list_name: str) -> None:
    cols = get_columns(site_id, list_id)
    if "SortOrder" in cols:
        column = cols["SortOrder"]
        desired_display_name = get_sortorder_display_name(list_name)
        current_display_name = column.get("displayName")
        if current_display_name != desired_display_name:
            graph_patch(
                f"/sites/{site_id}/lists/{list_id}/columns/{column['id']}",
                {"displayName": desired_display_name},
            )
            print(f"[UPDATE] Column display name: {list_name}.SortOrder => {desired_display_name}")
        else:
            print(f"[SKIP] Column exists: {list_name}.SortOrder")
        return
    body = {
        "name": "SortOrder",
        "displayName": get_sortorder_display_name(list_name),
        "required": False,
        "number": {"decimalPlaces": "none"},
        "defaultValue": {"value": str(DEFAULT_SORT_ORDER)},
    }
    graph_post(f"/sites/{site_id}/lists/{list_id}/columns", body)
    print(f"[CREATE] Column: {list_name}.SortOrder (number, default={DEFAULT_SORT_ORDER})")


def seed_sortorder(site_id: str, list_id: str, list_name: str) -> None:
    items = get_list_items(site_id, list_id)
    for item in items:
        item_id = item["id"]
        fields = item.get("fields", {})
        title: str = fields.get("Title", "")
        current = fields.get("SortOrder")

        if current is not None:
            print(f"  [SKIP] {list_name} id={item_id} '{title}' SortOrder={current} (already set)")
            continue

        sort_order = OTHER_SORT_ORDER if "その他" in title else DEFAULT_SORT_ORDER
        graph_patch(
            f"/sites/{site_id}/lists/{list_id}/items/{item_id}/fields",
            {"SortOrder": sort_order},
        )
        print(f"  [SET]  {list_name} id={item_id} '{title}' SortOrder={sort_order}")


def process_list(site_id: str, list_id: str, list_name: str) -> None:
    print(f"\n--- {list_name} ({list_id}) ---")
    ensure_sortorder_column(site_id, list_id, list_name)
    seed_sortorder(site_id, list_id, list_name)


def main() -> None:
    missing = []
    if not SITE_ID:
        missing.append("VITE_SP_SITE_ID")
    if not CUSTOMERS_LIST_ID:
        missing.append("VITE_SP_LIST_CUSTOMERS")
    if not SYSTEMS_LIST_ID:
        missing.append("VITE_SP_LIST_SYSTEMS")
    if not WORKTYPES_LIST_ID:
        missing.append("VITE_SP_LIST_WORKTYPES")
    if missing:
        print(f"[ERROR] .env.production.local に未設定: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    print(f"Site ID: {SITE_ID}")

    process_list(SITE_ID, CUSTOMERS_LIST_ID, "顧客マスタ")
    process_list(SITE_ID, SYSTEMS_LIST_ID, "システムマスタ")
    process_list(SITE_ID, WORKTYPES_LIST_ID, "作業種別マスタ")

    print("\n[DONE] 完了")


if __name__ == "__main__":
    main()
