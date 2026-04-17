"""
作業実績リストに IsProject (案件) Boolean 列を追加するスクリプト

列が既に存在する場合はスキップする。
.env.production.local から環境変数を読み取り Graph API で列を作成する。

使い方:
  python scripts/add_isproject_column.py
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


def graph_post(path: str, body: dict) -> dict:
    resp = requests.post(f"{GRAPH_BASE}{path}", headers=graph_headers(), json=body)
    if resp.status_code >= 400:
        print(f"[ERROR] POST {path}: {resp.status_code} {resp.text[:500]}", file=sys.stderr)
    resp.raise_for_status()
    return resp.json()


def get_columns(site_id: str, list_id: str) -> dict[str, dict]:
    resp = graph_get(f"/sites/{site_id}/lists/{list_id}/columns")
    return {col["name"]: col for col in resp.get("value", [])}


def ensure_boolean_column(
    site_id: str,
    list_id: str,
    name: str,
    display_name: str,
    cols: dict,
    *,
    default_value: bool = True,
) -> None:
    if name in cols:
        print(f"[SKIP] Column exists: {name}")
        return
    body: dict = {
        "name": name,
        "displayName": display_name,
        "boolean": {},
        "defaultValue": {"value": "true" if default_value else "false"},
    }
    graph_post(f"/sites/{site_id}/lists/{list_id}/columns", body)
    print(f"[CREATE] Column: {name} (boolean, default={default_value})")


def main() -> None:
    if not SITE_ID or not REPORTS_LIST_ID:
        print("[ERROR] VITE_SP_SITE_ID / VITE_SP_LIST_REPORTS が .env.production.local に未設定です", file=sys.stderr)
        sys.exit(1)

    print(f"Site ID: {SITE_ID}")
    print(f"Reports List ID: {REPORTS_LIST_ID}")

    cols = get_columns(SITE_ID, REPORTS_LIST_ID)
    ensure_boolean_column(SITE_ID, REPORTS_LIST_ID, "IsProject", "案件", cols, default_value=True)
    print("[DONE] 完了")


if __name__ == "__main__":
    main()
