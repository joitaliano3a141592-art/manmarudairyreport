"""
SharePoint リスト データ アーカイブ & クリーンアップ スクリプト

機能:
  1. 指定期間より古いデータを JSON ファイルにエクスポート（待避）
  2. エクスポート済みの古いデータを SharePoint リストから削除

対象リスト: Reports（日報）, Plans（予定）

使い方:
  # 1年以上前のデータをエクスポート（削除はしない）
  python3 scripts/archive_old_data.py --export-only

  # 1年以上前のデータをエクスポート＆削除
  python3 scripts/archive_old_data.py

  # 6ヶ月以上前のデータをエクスポート＆削除
  python3 scripts/archive_old_data.py --months 6

  # ドライラン（何が削除されるか確認するだけ）
  python3 scripts/archive_old_data.py --dry-run

SharePoint リストの制限:
  - リストあたり最大 3,000万件
  - ビュー閾値: 5,000件（超えると遅くなる）
  - → 定期的にこのスクリプトで古いデータを待避・削除することを推奨
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

# ── プロジェクトルートの .env を読み込み ──
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

# auth_helper は同じディレクトリにある
sys.path.insert(0, str(Path(__file__).resolve().parent))
from auth_helper import get_token  # noqa: E402

# ── 設定 ──
GRAPH_BASE = "https://graph.microsoft.com/v1.0"
SITE_ID = os.getenv("VITE_SP_SITE_ID", "")
ARCHIVE_DIR = _PROJECT_ROOT / "archives"

# アーカイブ対象リスト（日報と予定のみ。マスタはアーカイブ不要）
TARGET_LISTS = {
    "Reports": os.getenv("VITE_SP_LIST_REPORTS", ""),
    "Plans": os.getenv("VITE_SP_LIST_PLANS", ""),
}

# Graph API スコープ
GRAPH_SCOPE = "https://graph.microsoft.com/.default"

JST = timezone(timedelta(hours=9))


def get_headers() -> dict[str, str]:
    token = get_token(scope=GRAPH_SCOPE)
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def fetch_all_items(list_id: str) -> list[dict]:
    """リストの全アイテムを取得（ページネーション対応）"""
    import requests

    url = f"{GRAPH_BASE}/sites/{SITE_ID}/lists/{list_id}/items?$expand=fields&$top=999"
    all_items = []

    while url:
        resp = requests.get(url, headers=get_headers())
        resp.raise_for_status()
        data = resp.json()
        all_items.extend(data.get("value", []))
        url = data.get("@odata.nextLink")

    return all_items


def delete_item(list_id: str, item_id: str) -> None:
    """リストからアイテムを削除"""
    import requests

    url = f"{GRAPH_BASE}/sites/{SITE_ID}/lists/{list_id}/items/{item_id}"
    resp = requests.delete(url, headers=get_headers())
    resp.raise_for_status()


def parse_date(date_str: str | None) -> datetime | None:
    """SharePoint の日付文字列をパース（UTC → JST）"""
    if not date_str:
        return None
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        return dt.astimezone(JST)
    except (ValueError, TypeError):
        return None


def get_item_date(item: dict) -> datetime | None:
    """アイテムの日付を取得（ReportDate or PlanDate or Created）"""
    fields = item.get("fields", {})
    # ReportDate（日報）か PlanDate（予定）を優先
    for field_name in ["ReportDate", "PlanDate", "Created"]:
        d = parse_date(fields.get(field_name))
        if d:
            return d
    # フォールバック: アイテム自体の createdDateTime
    return parse_date(item.get("createdDateTime"))


def main():
    parser = argparse.ArgumentParser(
        description="SharePoint リストの古いデータをアーカイブ＆削除"
    )
    parser.add_argument(
        "--months", type=int, default=12,
        help="何ヶ月より前のデータを対象にするか（デフォルト: 12）"
    )
    parser.add_argument(
        "--export-only", action="store_true",
        help="エクスポートのみ（削除しない）"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="ドライラン（実際には何もしない）"
    )
    args = parser.parse_args()

    if not SITE_ID:
        print("エラー: VITE_SP_SITE_ID が .env に設定されていません", file=sys.stderr)
        sys.exit(1)

    # カットオフ日の計算
    cutoff = datetime.now(JST) - timedelta(days=args.months * 30)
    print(f"=== アーカイブ設定 ===")
    print(f"  対象: {args.months}ヶ月以上前のデータ")
    print(f"  カットオフ日: {cutoff.strftime('%Y-%m-%d')}")
    print(f"  モード: {'ドライラン' if args.dry_run else 'エクスポートのみ' if args.export_only else 'エクスポート＆削除'}")
    print()

    for list_name, list_id in TARGET_LISTS.items():
        if not list_id:
            print(f"⚠ {list_name}: リスト ID 未設定、スキップ")
            continue

        print(f"--- {list_name} リスト ---")

        # 全件取得
        print(f"  全アイテム取得中...")
        all_items = fetch_all_items(list_id)
        print(f"  合計: {len(all_items)} 件")

        # 古いデータを抽出
        old_items = []
        for item in all_items:
            item_date = get_item_date(item)
            if item_date and item_date < cutoff:
                old_items.append(item)

        print(f"  {cutoff.strftime('%Y-%m-%d')} より前: {len(old_items)} 件")

        if not old_items:
            print(f"  → アーカイブ対象なし\n")
            continue

        if args.dry_run:
            # ドライラン: 件数だけ表示
            oldest = min(get_item_date(i) for i in old_items if get_item_date(i))
            newest = max(get_item_date(i) for i in old_items if get_item_date(i))
            print(f"  → 削除対象: {len(old_items)} 件（{oldest.strftime('%Y-%m-%d')} 〜 {newest.strftime('%Y-%m-%d')}）")
            print()
            continue

        # エクスポート
        ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(JST).strftime("%Y%m%d_%H%M%S")
        archive_file = ARCHIVE_DIR / f"{list_name}_{timestamp}.json"

        export_data = []
        for item in old_items:
            export_data.append({
                "id": item["id"],
                "fields": item.get("fields", {}),
                "createdDateTime": item.get("createdDateTime"),
                "createdBy": item.get("createdBy", {}),
            })

        archive_file.write_text(
            json.dumps(export_data, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        print(f"  ✅ エクスポート完了: {archive_file} ({len(export_data)} 件)")

        # 削除
        if args.export_only:
            print(f"  → --export-only のため削除はスキップ\n")
            continue

        print(f"  削除中...")
        deleted = 0
        errors = 0
        for item in old_items:
            try:
                delete_item(list_id, item["id"])
                deleted += 1
                # レート制限対策: 少し間隔を空ける
                if deleted % 50 == 0:
                    print(f"    ... {deleted}/{len(old_items)} 件削除済み")
                    time.sleep(1)
            except Exception as e:
                errors += 1
                print(f"    ⚠ 削除失敗 (ID: {item['id']}): {e}", file=sys.stderr)

        print(f"  ✅ 削除完了: {deleted} 件削除, {errors} 件エラー\n")

    print("=== 完了 ===")


if __name__ == "__main__":
    main()
