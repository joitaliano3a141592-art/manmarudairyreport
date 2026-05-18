"""
作業報告・作業予定リストの WorkDescription 列の「必須」制約を解除するスクリプト

SharePoint List の WorkDescription 列が required=True で作成されており、
空文字での登録がブロックされるため required=False へ変更する。

使い方:
  python scripts/patch_workdescription_required.py
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
REPORTS_LIST_ID = os.getenv("VITE_SP_LIST_REPORTS", "")
PLANS_LIST_ID = os.getenv("VITE_SP_LIST_PLANS", "")
TENANT_ID = os.getenv("TENANT_ID", "") or os.getenv("VITE_MSAL_TENANT_ID", "")

GRAPH_SCOPE = "https://graph.microsoft.com/Sites.Manage.All"
GRAPH_BASE = "https://graph.microsoft.com/v1.0"
GRAPH_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e"
_GRAPH_AUTH_RECORD_PATH = _PROJECT_ROOT / ".graph_auth_record.json"


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


def patch_column_required(site_id: str, list_id: str, list_name: str, cols: dict, col_name: str) -> None:
    if col_name not in cols:
        print(f"[SKIP] Column not found: {list_name}.{col_name}")
        return

    col = cols[col_name]
    col_id = col["id"]

    if not col.get("required", False):
        print(f"[SKIP] Already not required: {list_name}.{col_name}")
        return

    graph_patch(f"/sites/{site_id}/lists/{list_id}/columns/{col_id}", {"required": False})
    print(f"[PATCH] {list_name}.{col_name}: required -> False")


def main() -> None:
    if not SITE_ID:
        print("[ERROR] VITE_SP_SITE_ID が .env.production.local に未設定です", file=sys.stderr)
        sys.exit(1)
    if not REPORTS_LIST_ID:
        print("[ERROR] VITE_SP_LIST_REPORTS が .env.production.local に未設定です", file=sys.stderr)
        sys.exit(1)
    if not PLANS_LIST_ID:
        print("[ERROR] VITE_SP_LIST_PLANS が .env.production.local に未設定です", file=sys.stderr)
        sys.exit(1)

    print(f"Site ID     : {SITE_ID}")
    print(f"Reports List: {REPORTS_LIST_ID}")
    print(f"Plans List  : {PLANS_LIST_ID}")
    print()

    reports_cols = get_columns(SITE_ID, REPORTS_LIST_ID)
    patch_column_required(SITE_ID, REPORTS_LIST_ID, "作業報告", reports_cols, "WorkDescription")

    plans_cols = get_columns(SITE_ID, PLANS_LIST_ID)
    patch_column_required(SITE_ID, PLANS_LIST_ID, "作業予定", plans_cols, "WorkDescription")

    print()
    print("[DONE] 完了")


if __name__ == "__main__":
    main()
