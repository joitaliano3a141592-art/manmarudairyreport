"""
工番マスタの SharePoint スキーマと既存データを補正するスクリプト

- 工番マスタに `WorkNumber`（数値列 / 表示名: 工番）を追加
- 既存データのうち、Title に数値が入っているものは WorkNumber へ移行
- Title は工番の文字列表現へ正規化
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

import setup_sharepoint_lists as sp

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WORK_NUMBER_FIELD = "WorkNumber"
SYSTEM_ID_FIELD = "_x30b7__x30b9__x30c6__x30e0_ID"

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


def to_nullable_int(value: object) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def normalize_worknumber_items(site_id: str, worknumber_list_id: str) -> int:
    updated_count = 0

    for item in sp.get_items(site_id, worknumber_list_id):
        item_id = item["id"]
        fields = item.get("fields", {})
        current_title = str(fields.get("Title", "")).strip()
        existing_work_number = to_nullable_int(fields.get(WORK_NUMBER_FIELD))
        title_as_number = to_nullable_int(current_title)
        normalized_work_number = existing_work_number if existing_work_number is not None else title_as_number

        patch: dict[str, object] = {}
        if existing_work_number is None and title_as_number is not None:
            patch[WORK_NUMBER_FIELD] = title_as_number
        if normalized_work_number is not None and current_title != str(normalized_work_number):
            patch["Title"] = str(normalized_work_number)

        if not patch:
            continue

        sp.graph_patch(f"/sites/{site_id}/lists/{worknumber_list_id}/items/{item_id}/fields", patch)
        updated_count += 1
        print(f"[UPDATE] 工番マスタ item={item_id} fields={patch}")

    return updated_count


def main() -> None:
    site_id = resolve_site_id()
    worknumber_list_id = require_env("VITE_SP_LIST_WORKNUMBERS")

    print("[STEP] 工番マスタ列を確認")
    worknumber_cols = sp.get_columns(site_id, worknumber_list_id)
    sp.ensure_number_column(site_id, worknumber_list_id, WORK_NUMBER_FIELD, "工番", worknumber_cols, required=False)

    print("[STEP] 既存データを補正")
    updated_count = normalize_worknumber_items(site_id, worknumber_list_id)

    print("[DONE] 工番マスタの補正が完了しました。")
    print(f"  更新件数: {updated_count}")


if __name__ == "__main__":
    main()
