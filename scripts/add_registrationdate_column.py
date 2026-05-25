"""
作業実績リストに RegistrationDate (登録日) DateTime 列を追加するスクリプト

列が存在しない場合のみ作成し、既存データは ReportDate（報告日）を RegistrationDate（登録日）へ補完する。
ReportDate が無いレコードのみ createdDateTime をフォールバック使用する。

使い方:
  python scripts/add_registrationdate_column.py
"""

from __future__ import annotations

import os
import sys
import time
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
REQUEST_TIMEOUT = 60
MAX_RETRIES = 5


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


def _request_with_retry(method: str, path: str, *, body: dict | None = None) -> requests.Response:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.request(
                method,
                f"{GRAPH_BASE}{path}",
                headers=graph_headers(),
                json=body,
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code in {409, 429, 500, 502, 503, 504}:
                raise requests.HTTPError(
                    f"retryable status={resp.status_code}: {resp.text[:200]}",
                    response=resp,
                )
            return resp
        except Exception as exc:
            last_error = exc
            if attempt >= MAX_RETRIES:
                break
            wait_sec = min(2 * attempt, 10)
            print(f"[WARN] {method} {path} failed (attempt {attempt}/{MAX_RETRIES}): {exc}")
            print(f"[WARN] retry after {wait_sec}s")
            time.sleep(wait_sec)

    raise RuntimeError(f"Graph request failed after retries: {method} {path}") from last_error


def graph_get(path: str) -> dict:
    resp = _request_with_retry("GET", path)
    resp.raise_for_status()
    return resp.json()


def graph_post(path: str, body: dict) -> dict:
    resp = _request_with_retry("POST", path, body=body)
    if resp.status_code >= 400:
        print(f"[ERROR] POST {path}: {resp.status_code} {resp.text[:500]}", file=sys.stderr)
    resp.raise_for_status()
    return resp.json()


def graph_patch(path: str, body: dict) -> dict:
    resp = _request_with_retry("PATCH", path, body=body)
    if resp.status_code >= 400:
        print(f"[ERROR] PATCH {path}: {resp.status_code} {resp.text[:500]}", file=sys.stderr)
    resp.raise_for_status()
    if resp.text:
        return resp.json()
    return {}


def get_columns(site_id: str, list_id: str) -> dict[str, dict]:
    resp = graph_get(f"/sites/{site_id}/lists/{list_id}/columns")
    return {col["name"]: col for col in resp.get("value", [])}


def ensure_registration_date_column(site_id: str, list_id: str, cols: dict[str, dict]) -> None:
    if "RegistrationDate" in cols:
        print("[SKIP] Column exists: RegistrationDate")
        return

    body = {
        "name": "RegistrationDate",
        "displayName": "登録日",
        "required": False,
        "dateTime": {"format": "dateOnly"},
    }
    graph_post(f"/sites/{site_id}/lists/{list_id}/columns", body)
    print("[CREATE] Column: RegistrationDate (dateTime)")


def backfill_registration_date(site_id: str, list_id: str) -> None:
    path = f"/sites/{site_id}/lists/{list_id}/items?%24expand=fields&%24select=id,createdDateTime&%24top=999"
    updated = 0
    skipped = 0
    seen = 0
    reportdate_applied = 0
    created_applied = 0

    while path:
        resp = graph_get(path)
        items = resp.get("value", [])
        seen += len(items)

        for item in items:
            fields = item.get("fields", {})
            report_date = fields.get("ReportDate")
            created = item.get("createdDateTime")
            target_date = report_date or created
            if not target_date:
                skipped += 1
                continue

            current = fields.get("RegistrationDate")
            # Date-only列のため、日時は日付部分（YYYY-MM-DD）で同値判定する。
            if current and str(current)[:10] == str(target_date)[:10]:
                skipped += 1
                continue

            item_id = item.get("id")
            graph_patch(
                f"/sites/{site_id}/lists/{list_id}/items/{item_id}/fields",
                {"RegistrationDate": target_date},
            )
            updated += 1
            if report_date:
                reportdate_applied += 1
            else:
                created_applied += 1
            if updated % 100 == 0:
                print(f"[PROGRESS] updated={updated}, seen={seen}")

        next_link = resp.get("@odata.nextLink")
        path = next_link.replace("https://graph.microsoft.com/v1.0", "") if next_link else None

    print(
        f"[DONE] backfill completed: seen={seen}, updated={updated}, skipped={skipped}, "
        f"from_report_date={reportdate_applied}, from_created={created_applied}"
    )


def main() -> None:
    if not SITE_ID or not REPORTS_LIST_ID:
        print("[ERROR] VITE_SP_SITE_ID / VITE_SP_LIST_REPORTS が .env.production.local に未設定です", file=sys.stderr)
        sys.exit(1)

    print(f"Site ID: {SITE_ID}")
    print(f"Reports List ID: {REPORTS_LIST_ID}")

    cols = get_columns(SITE_ID, REPORTS_LIST_ID)
    ensure_registration_date_column(SITE_ID, REPORTS_LIST_ID, cols)
    backfill_registration_date(SITE_ID, REPORTS_LIST_ID)
    print("[DONE] 完了")


if __name__ == "__main__":
    main()
