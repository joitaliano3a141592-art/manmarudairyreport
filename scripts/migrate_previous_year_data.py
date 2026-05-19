"""
SharePoint 前年度データを年別テーブル(SQLite)へ移行するスクリプト

方針:
  - 現役リスト: 直近24か月を保持
  - 年次移行: 1月末に前年度分を手動移行（自動実行はしない）
  - まず --export-only で確認し、問題なければ --delete-source で元データ削除

移行先:
  archives/sharepoint_yearly_archive.db
  - reports_YYYY テーブル
  - plans_YYYY テーブル

使用例:
  # まず安全確認（移行先へ書き込みのみ、元リストは削除しない）
  python scripts/migrate_previous_year_data.py --year 2025 --export-only

  # 確認後、元リストから削除まで実行
  python scripts/migrate_previous_year_data.py --year 2025 --delete-source

  # ドライラン（件数確認のみ）
  python scripts/migrate_previous_year_data.py --year 2025 --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from auth_helper import get_token  # noqa: E402

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
SITE_ID = os.getenv("VITE_SP_SITE_ID", "")
GRAPH_SCOPE = "https://graph.microsoft.com/.default"
ARCHIVE_DIR = _PROJECT_ROOT / "archives"
DB_PATH = ARCHIVE_DIR / "sharepoint_yearly_archive.db"

TARGET_LISTS = {
    "reports": {
        "list_id": os.getenv("VITE_SP_LIST_REPORTS", ""),
        "date_field": "ReportDate",
    },
    "plans": {
        "list_id": os.getenv("VITE_SP_LIST_PLANS", ""),
        "date_field": "PlanDate",
    },
}


def get_headers() -> dict[str, str]:
    token = get_token(scope=GRAPH_SCOPE)
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def fetch_all_items(list_id: str) -> list[dict]:
    import requests

    url = f"{GRAPH_BASE}/sites/{SITE_ID}/lists/{list_id}/items?$expand=fields&$top=999"
    all_items: list[dict] = []

    while url:
        resp = requests.get(url, headers=get_headers(), timeout=60)
        resp.raise_for_status()
        data = resp.json()
        all_items.extend(data.get("value", []))
        url = data.get("@odata.nextLink")

    return all_items


def delete_item(list_id: str, item_id: str) -> None:
    import requests

    url = f"{GRAPH_BASE}/sites/{SITE_ID}/lists/{list_id}/items/{item_id}"
    resp = requests.delete(url, headers=get_headers(), timeout=60)
    resp.raise_for_status()


def parse_date(date_str: str | None) -> datetime | None:
    if not date_str:
        return None
    try:
        return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def ensure_table(conn: sqlite3.Connection, table_name: str) -> None:
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
          id TEXT PRIMARY KEY,
          source_created_datetime TEXT,
          source_updated_datetime TEXT,
          migrated_at TEXT NOT NULL,
          fields_json TEXT NOT NULL,
          raw_item_json TEXT NOT NULL
        )
        """
    )


def upsert_items(conn: sqlite3.Connection, table_name: str, items: list[dict]) -> int:
    now_iso = datetime.now(timezone.utc).isoformat()
    inserted = 0
    for item in items:
        fields = item.get("fields", {})
        conn.execute(
            f"""
            INSERT INTO {table_name} (
              id, source_created_datetime, source_updated_datetime, migrated_at, fields_json, raw_item_json
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              source_created_datetime=excluded.source_created_datetime,
              source_updated_datetime=excluded.source_updated_datetime,
              migrated_at=excluded.migrated_at,
              fields_json=excluded.fields_json,
              raw_item_json=excluded.raw_item_json
            """,
            (
                item.get("id"),
                item.get("createdDateTime"),
                item.get("lastModifiedDateTime"),
                now_iso,
                json.dumps(fields, ensure_ascii=False),
                json.dumps(item, ensure_ascii=False),
            ),
        )
        inserted += 1

    return inserted


def main() -> None:
    parser = argparse.ArgumentParser(description="前年データを年別テーブルへ移行")
    parser.add_argument("--year", type=int, default=datetime.now().year - 1, help="移行対象年（デフォルト: 前年）")
    parser.add_argument("--export-only", action="store_true", help="移行先へ書き込みのみ（削除しない）")
    parser.add_argument("--delete-source", action="store_true", help="移行後に元リストから対象データを削除")
    parser.add_argument("--dry-run", action="store_true", help="件数確認のみ")
    args = parser.parse_args()

    if not SITE_ID:
        print("エラー: VITE_SP_SITE_ID が .env に設定されていません", file=sys.stderr)
        sys.exit(1)

    if args.export_only and args.delete_source:
        print("エラー: --export-only と --delete-source は同時指定できません", file=sys.stderr)
        sys.exit(1)

    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)

    print("=== 年次移行設定 ===")
    print(f"  対象年: {args.year}")
    mode = "ドライラン" if args.dry_run else ("移行のみ" if args.export_only or not args.delete_source else "移行＋削除")
    print(f"  モード: {mode}")
    print(f"  DB: {DB_PATH}")
    print()

    conn = sqlite3.connect(DB_PATH)
    try:
        for logical_name, cfg in TARGET_LISTS.items():
            list_id = cfg["list_id"]
            date_field = cfg["date_field"]
            if not list_id:
                print(f"⚠ {logical_name}: リストID未設定のためスキップ")
                continue

            print(f"--- {logical_name} ---")
            items = fetch_all_items(list_id)
            print(f"  取得件数: {len(items)}")

            target_items: list[dict] = []
            for item in items:
                fields = item.get("fields", {})
                dt = parse_date(fields.get(date_field)) or parse_date(item.get("createdDateTime"))
                if dt and dt.year == args.year:
                    target_items.append(item)

            print(f"  {args.year}年 対象件数: {len(target_items)}")
            if not target_items:
                print("  → 対象なし\n")
                continue

            table_name = f"{logical_name}_{args.year}"
            if args.dry_run:
                print(f"  → ドライラン: {table_name} へ移行予定（削除なし）\n")
                continue

            ensure_table(conn, table_name)
            moved = upsert_items(conn, table_name, target_items)
            conn.commit()
            print(f"  ✅ 年別テーブル {table_name} へ移行: {moved}件")

            if args.export_only or not args.delete_source:
                print("  → 元リスト削除はスキップ\n")
                continue

            deleted = 0
            errors = 0
            for item in target_items:
                try:
                    delete_item(list_id, item["id"])
                    deleted += 1
                    if deleted % 50 == 0:
                        print(f"    ... {deleted}/{len(target_items)} 件削除済み")
                        time.sleep(1)
                except Exception as e:  # noqa: BLE001
                    errors += 1
                    print(f"    ⚠ 削除失敗 (ID: {item.get('id')}): {e}", file=sys.stderr)

            print(f"  ✅ 元リスト削除完了: {deleted}件, エラー {errors}件\n")

    finally:
        conn.close()

    print("=== 完了 ===")


if __name__ == "__main__":
    main()
