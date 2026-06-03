"""
Delete Reports list items where RegistrationDate is on/before a cutoff date.

Usage:
  # preview only
  python scripts/delete_reports_by_registrationdate.py --cutoff 2026-03-31

  # delete matching items
  python scripts/delete_reports_by_registrationdate.py --cutoff 2026-03-31 --execute
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date, datetime
from pathlib import Path

import requests
from azure.identity import AuthenticationRecord, DeviceCodeCredential, TokenCachePersistenceOptions
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


def graph_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {get_token()}",
        "Content-Type": "application/json",
    }


def _request_with_retry(method: str, path: str) -> requests.Response:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.request(
                method,
                f"{GRAPH_BASE}{path}",
                headers=graph_headers(),
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


def graph_delete(path: str) -> None:
    resp = _request_with_retry("DELETE", path)
    if resp.status_code not in (200, 202, 204):
        resp.raise_for_status()


def parse_date_only(value: object) -> date | None:
    if not value:
        return None
    s = str(value).strip()
    if not s:
        return None

    # Date-only field usually comes as YYYY-MM-DD. Keep first 10 chars for safety.
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        pass

    # Fallback for full ISO datetime values.
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def find_targets(cutoff: date) -> list[tuple[str, date]]:
    path = (
        f"/sites/{SITE_ID}/lists/{REPORTS_LIST_ID}/items"
        "?%24expand=fields(%24select=RegistrationDate)"
        "&%24select=id"
        "&%24top=999"
    )
    targets: list[tuple[str, date]] = []
    seen = 0

    while path:
        resp = graph_get(path)
        items = resp.get("value", [])
        seen += len(items)

        for item in items:
            reg_raw = (item.get("fields") or {}).get("RegistrationDate")
            reg_date = parse_date_only(reg_raw)
            if reg_date and reg_date <= cutoff:
                item_id = str(item.get("id"))
                targets.append((item_id, reg_date))

        next_link = resp.get("@odata.nextLink")
        path = next_link.replace("https://graph.microsoft.com/v1.0", "") if next_link else ""

    print(f"[INFO] scanned={seen}, matched={len(targets)}")
    return targets


def delete_targets(targets: list[tuple[str, date]]) -> tuple[int, int]:
    deleted = 0
    errors = 0

    for idx, (item_id, _) in enumerate(targets, start=1):
        try:
            graph_delete(f"/sites/{SITE_ID}/lists/{REPORTS_LIST_ID}/items/{item_id}")
            deleted += 1
            if idx % 50 == 0:
                print(f"[PROGRESS] {idx}/{len(targets)} processed, deleted={deleted}")
                time.sleep(1)
        except Exception as exc:
            errors += 1
            print(f"[ERROR] delete failed for id={item_id}: {exc}", file=sys.stderr)

    return deleted, errors


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Delete Reports items where RegistrationDate <= cutoff",
    )
    parser.add_argument(
        "--cutoff",
        default="2026-03-31",
        help="cutoff date in YYYY-MM-DD format (inclusive)",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="actually delete items (default is dry-run)",
    )
    args = parser.parse_args()

    if not SITE_ID or not REPORTS_LIST_ID:
        print("[ERROR] VITE_SP_SITE_ID / VITE_SP_LIST_REPORTS is not configured", file=sys.stderr)
        sys.exit(1)

    try:
        cutoff = date.fromisoformat(args.cutoff)
    except ValueError:
        print(f"[ERROR] invalid --cutoff: {args.cutoff}", file=sys.stderr)
        sys.exit(1)

    print(f"[INFO] site={SITE_ID}")
    print(f"[INFO] reports_list={REPORTS_LIST_ID}")
    print(f"[INFO] condition: RegistrationDate <= {cutoff.isoformat()}")

    targets = find_targets(cutoff)
    if not targets:
        print("[DONE] no matching items")
        return

    oldest = min(d for _, d in targets)
    newest = max(d for _, d in targets)
    print(f"[INFO] target range: {oldest.isoformat()} to {newest.isoformat()}")

    if not args.execute:
        print("[DRY-RUN] no deletion executed. add --execute to delete.")
        return

    deleted, errors = delete_targets(targets)
    print(f"[DONE] deleted={deleted}, errors={errors}, requested={len(targets)}")


if __name__ == "__main__":
    main()