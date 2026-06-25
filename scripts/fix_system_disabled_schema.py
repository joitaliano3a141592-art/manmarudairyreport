"""
システムマスタに無効列を追加し、既存データを補正するスクリプト

- `IsDisabled` 列を追加
- 既存レコードで `IsDisabled` が未設定のものは false を設定
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

import setup_sharepoint_lists as sp

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SYSTEM_DISABLED_FIELD = "IsDisabled"

load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env", override=False)


def resolve_site_id() -> str:
    site_id = (os.getenv("VITE_SP_SITE_ID") or "").strip()
    if site_id:
        return site_id

    group_id = (os.getenv("SP_GROUP_ID") or "").strip()
    if not group_id:
        raise RuntimeError("VITE_SP_SITE_ID または SP_GROUP_ID が設定されていません。")
    return sp.resolve_site_id(group_id)


def require_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"{name} が設定されていません。")
    return value


def normalize_system_items(site_id: str, systems_list_id: str) -> int:
    updated_count = 0

    for item in sp.get_items(site_id, systems_list_id):
      item_id = item["id"]
      fields = item.get("fields", {})
      current_value = fields.get(SYSTEM_DISABLED_FIELD)
      if current_value in (True, False):
          continue

      sp.graph_patch(f"/sites/{site_id}/lists/{systems_list_id}/items/{item_id}/fields", {SYSTEM_DISABLED_FIELD: False})
      updated_count += 1
      print(f"[UPDATE] システムマスタ item={item_id} fields={{'{SYSTEM_DISABLED_FIELD}': False}}")

    return updated_count


def main() -> None:
    site_id = resolve_site_id()
    systems_list_id = require_env("VITE_SP_LIST_SYSTEMS")

    print("[STEP] 列設定を補正")
    system_cols = sp.get_columns(site_id, systems_list_id)
    sp.ensure_boolean_column(site_id, systems_list_id, SYSTEM_DISABLED_FIELD, "無効", system_cols, default_value=False)

    print("[STEP] 既存データを補正")
    updated_count = normalize_system_items(site_id, systems_list_id)

    print("[DONE] システムマスタの補正が完了しました。")
    print(f"  更新件数: {updated_count}")


if __name__ == "__main__":
    main()
