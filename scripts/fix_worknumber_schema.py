"""
工事番号マスタの SharePoint スキーマと既存データを補正するスクリプト

- 既存データのうち `WorkNumber` 列にのみ値があるものは Title へ移行
- `WorkNumberName` 列が空の既存データは Title を初期値として補完
- `システムID` 列の一意制約を解除して同一システムへ複数工事番号を登録可能にする
- 不要になった `WorkNumber` 列を削除
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

import setup_sharepoint_lists as sp

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WORK_NUMBER_FIELD = "WorkNumber"
WORK_NUMBER_NAME_FIELD = "WorkNumberName"
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


def normalize_worknumber_items(site_id: str, worknumber_list_id: str) -> int:
    updated_count = 0

    for item in sp.get_items(site_id, worknumber_list_id):
        item_id = item["id"]
        fields = item.get("fields", {})
        current_title = str(fields.get("Title", "")).strip()
        legacy_work_number = str(fields.get(WORK_NUMBER_FIELD, "")).strip()
        current_work_number_name = str(fields.get(WORK_NUMBER_NAME_FIELD, "")).strip()

        patch: dict[str, object] = {}
        if not current_title and legacy_work_number:
            patch["Title"] = legacy_work_number
            current_title = legacy_work_number
        if not current_work_number_name and current_title:
            patch[WORK_NUMBER_NAME_FIELD] = current_title

        if not patch:
            continue

        sp.graph_patch(f"/sites/{site_id}/lists/{worknumber_list_id}/items/{item_id}/fields", patch)
        updated_count += 1
        print(f"[UPDATE] 工事番号マスタ item={item_id} fields={patch}")

    return updated_count


def main() -> None:
    site_id = resolve_site_id()
    worknumber_list_id = require_env("VITE_SP_LIST_WORKNUMBERS")

    print("[STEP] 列設定を補正")
    worknumber_cols = sp.get_columns(site_id, worknumber_list_id)
    sp.ensure_text_column(site_id, worknumber_list_id, "Title", "工事番号", worknumber_cols)
    sp.ensure_text_column(site_id, worknumber_list_id, WORK_NUMBER_NAME_FIELD, "工事番号名", worknumber_cols)
    worknumber_cols = sp.get_columns(site_id, worknumber_list_id)
    sp.ensure_number_column(site_id, worknumber_list_id, SYSTEM_ID_FIELD, "システムID", worknumber_cols, required=True)
    sp.ensure_boolean_column(site_id, worknumber_list_id, "IsDisabled", "無効", worknumber_cols, default_value=False)

    print("[STEP] 既存データを補正")
    updated_count = normalize_worknumber_items(site_id, worknumber_list_id)

    print("[STEP] 不要列を削除")
    worknumber_cols = sp.get_columns(site_id, worknumber_list_id)
    sp.delete_column(site_id, worknumber_list_id, WORK_NUMBER_FIELD, worknumber_cols)

    print("[DONE] 工事番号マスタの補正が完了しました。")
    print(f"  更新件数: {updated_count}")


if __name__ == "__main__":
    main()
