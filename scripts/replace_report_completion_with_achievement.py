"""
作業報告リストの完了列を達成度列へ置き換えるスクリプト

- Achievement（達成度: ○ / △ / ✕）列を追加または補正
- 既存の IsComplete を Achievement へ移行
- 不要になった IsComplete 列を削除
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

import setup_sharepoint_lists as sp

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ACHIEVEMENT_FIELD = "Achievement"
LEGACY_COMPLETE_FIELD = "IsComplete"
ACHIEVEMENT_CHOICES = ["○", "△", "✕"]

load_dotenv(PROJECT_ROOT / ".env.production.local")
load_dotenv(PROJECT_ROOT / ".env", override=False)


def require_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"{name} が設定されていません。")
    return value


def ensure_achievement_column(site_id: str, report_list_id: str) -> None:
    cols = sp.get_columns(site_id, report_list_id)
    column = cols.get(ACHIEVEMENT_FIELD)
    if column is None:
        sp.ensure_choice_column(
            site_id,
            report_list_id,
            ACHIEVEMENT_FIELD,
            "達成度",
            ACHIEVEMENT_CHOICES,
            cols,
            required=False,
        )
        return

    patch: dict[str, object] = {}
    if column.get("displayName") != "達成度":
        patch["displayName"] = "達成度"
    if column.get("required") is not False:
        patch["required"] = False
    if column.get("choice", {}).get("choices") != ACHIEVEMENT_CHOICES:
        patch["choice"] = {
            "allowTextEntry": False,
            "choices": ACHIEVEMENT_CHOICES,
        }
    if patch:
        sp.graph_patch(f"/sites/{site_id}/lists/{report_list_id}/columns/{column['id']}", patch)
        print(f"[UPDATE] 作業報告.{ACHIEVEMENT_FIELD} -> {patch}")
    else:
        print(f"[SKIP] Column exists: 作業報告.{ACHIEVEMENT_FIELD}")


def resolve_achievement(fields: dict) -> str | None:
    current = fields.get(ACHIEVEMENT_FIELD)
    if current in ACHIEVEMENT_CHOICES:
        return current
    legacy = fields.get(LEGACY_COMPLETE_FIELD)
    if legacy is True:
        return "○"
    if legacy is False:
        return "✕"
    return None


def migrate_items(site_id: str, report_list_id: str) -> int:
    updated_count = 0
    for item in sp.get_items(site_id, report_list_id):
        item_id = item["id"]
        fields = item.get("fields", {})
        next_value = resolve_achievement(fields)
        if fields.get(ACHIEVEMENT_FIELD) == next_value:
            continue
        sp.graph_patch(
            f"/sites/{site_id}/lists/{report_list_id}/items/{item_id}/fields",
            {ACHIEVEMENT_FIELD: next_value},
        )
        updated_count += 1
        print(f"[UPDATE] 作業報告 item={item_id} Achievement={next_value}")
    return updated_count


def main() -> None:
    site_id = require_env("VITE_SP_SITE_ID")
    report_list_id = require_env("VITE_SP_LIST_REPORTS")

    print("[STEP] 達成度列を補正")
    ensure_achievement_column(site_id, report_list_id)

    print("[STEP] 既存データを移行")
    updated_count = migrate_items(site_id, report_list_id)

    print("[STEP] 完了列を削除")
    cols = sp.get_columns(site_id, report_list_id)
    sp.delete_column(site_id, report_list_id, LEGACY_COMPLETE_FIELD, cols)

    print("[DONE] 作業報告の達成度移行が完了しました。")
    print(f"  更新件数: {updated_count}")


if __name__ == "__main__":
    main()
