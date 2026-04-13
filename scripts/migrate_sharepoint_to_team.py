"""
既存 SharePoint サイトの日報リストを Teams チームサイトへ移行するスクリプト。

機能:
- 5リスト（顧客マスタ / システムマスタ / 作業種別マスタ / 作業報告 / 作業予定）をコピー
- Lookup を Title ベースで再マッピング
- 必要に応じて .env.production.local の参照先 VITE_SP_* を更新

使い方（まずはドライラン推奨）:
  python scripts/migrate_sharepoint_to_team.py \
    --source-site-id "{source-site-id}" \
    --target-group-id "OLD_TEAMS_TEAM_ID" \
    --dry-run

実行:
  python scripts/migrate_sharepoint_to_team.py \
    --source-site-id "{source-site-id}" \
    --target-group-id "OLD_TEAMS_TEAM_ID" \
    --execute \
    --update-env .env.production.local
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from urllib.parse import urlparse
from pathlib import Path
from typing import Any

import requests
from azure.identity import AuthenticationRecord, DeviceCodeCredential, TokenCachePersistenceOptions
from dotenv import load_dotenv
from setup_sharepoint_lists import (
    ensure_choice_column,
    ensure_datetime_column,
    ensure_lookup_column,
    ensure_number_column,
    ensure_person_column,
    ensure_text_column,
    get_columns,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

TENANT_ID = os.getenv("TENANT_ID", "")
GRAPH_BASE = "https://graph.microsoft.com/v1.0"
GRAPH_SCOPES = (
    "https://graph.microsoft.com/Sites.Manage.All",
    "https://graph.microsoft.com/Sites.ReadWrite.All",
    "https://graph.microsoft.com/User.Read",
)
GRAPH_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e"
AUTH_RECORD_PATH = PROJECT_ROOT / ".graph_auth_record.json"

LIST_NAMES = ["顧客マスタ", "システムマスタ", "作業種別マスタ", "作業報告", "作業予定"]

ALLOWED_FIELDS_BY_LIST = {
    "顧客マスタ": {"Title"},
    "システムマスタ": {"Title", "CustomerLookupId", "Description"},
    "作業種別マスタ": {"Title", "Category"},
    "作業報告": {
        "Title",
        "ReportDate",
        "CustomerLookupId",
        "SystemLookupId",
        "WorkTypeLookupId",
        "WorkDescription",
        "WorkHours",
    },
    "作業予定": {
        "Title",
        "PlanDate",
        "CustomerLookupId",
        "SystemLookupId",
        "WorkDescription",
        "Status",
    },
}

SYSTEM_FIELD_NAMES = {
    "id",
    "ID",
    "ContentType",
    "Modified",
    "Created",
    "AuthorLookupId",
    "EditorLookupId",
    "_UIVersionString",
    "Attachments",
    "Edit",
    "LinkTitle",
    "DocIcon",
    "ComplianceAssetId",
}

_credential: DeviceCodeCredential | None = None


def _get_credential() -> DeviceCodeCredential:
    global _credential
    if _credential is not None:
        return _credential

    cache_options = TokenCachePersistenceOptions(
        name="graph_token_cache_v4",
        allow_unencrypted_storage=True,
    )

    auth_record = None
    if AUTH_RECORD_PATH.exists():
        try:
            auth_record = AuthenticationRecord.deserialize(AUTH_RECORD_PATH.read_text(encoding="utf-8"))
        except Exception:
            auth_record = None

    kwargs: dict[str, Any] = {
        "client_id": GRAPH_CLIENT_ID,
        "tenant_id": TENANT_ID or None,
        "cache_persistence_options": cache_options,
    }
    kwargs = {k: v for k, v in kwargs.items() if v is not None}
    if auth_record is not None:
        kwargs["authentication_record"] = auth_record

    _credential = DeviceCodeCredential(**kwargs)
    return _credential


def get_graph_token() -> str:
    cred = _get_credential()
    if not AUTH_RECORD_PATH.exists():
        record = cred.authenticate(scopes=list(GRAPH_SCOPES))
        AUTH_RECORD_PATH.write_text(record.serialize(), encoding="utf-8")
    return cred.get_token(*GRAPH_SCOPES).token


def graph_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {get_graph_token()}",
        "Content-Type": "application/json",
    }


def graph_get(path: str) -> dict[str, Any]:
    r = requests.get(f"{GRAPH_BASE}{path}", headers=graph_headers(), timeout=60)
    r.raise_for_status()
    return r.json()


def graph_post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    r = requests.post(f"{GRAPH_BASE}{path}", headers=graph_headers(), json=body, timeout=60)
    r.raise_for_status()
    if r.text:
        return r.json()
    return {}


def resolve_site_id_from_group(group_id: str) -> tuple[str, str]:
    d = graph_get(f"/groups/{group_id}/sites/root")
    return d["id"], d.get("webUrl", "")


def resolve_site_id_from_url(site_url: str) -> tuple[str, str]:
    """SharePoint サイト URL から Graph site id を解決する。"""
    parsed = urlparse(site_url)
    host = parsed.netloc
    if not host:
        raise ValueError(f"無効な URL: {site_url}")

    path = parsed.path or "/"
    # 例: /sites/SP_SITE_ALIAS/_layouts/15/viewlsts.aspx -> /sites/SP_SITE_ALIAS
    marker = "/_layouts/"
    if marker in path:
        path = path.split(marker, 1)[0]

    # root サイトの場合に備える
    if path == "/":
        d = graph_get(f"/sites/{host}")
        return d["id"], d.get("webUrl", "")

    d = graph_get(f"/sites/{host}:{path}")
    return d["id"], d.get("webUrl", "")


def list_all(site_id: str) -> list[dict[str, Any]]:
    data = graph_get(f"/sites/{site_id}/lists?$top=999")
    return data.get("value", [])


def list_map_by_name(site_id: str) -> dict[str, dict[str, Any]]:
    return {x["displayName"]: x for x in list_all(site_id)}


def ensure_target_lists(source_site_id: str, target_site_id: str, execute: bool) -> dict[str, str]:
    src_map = list_map_by_name(source_site_id)
    tgt_map = list_map_by_name(target_site_id)
    out: dict[str, str] = {}

    for name in LIST_NAMES:
        if name not in src_map:
            raise RuntimeError(f"ソースサイトにリストがありません: {name}")
        if name in tgt_map:
            out[name] = tgt_map[name]["id"]
            continue
        if not execute:
            print(f"[DRY-RUN CREATE LIST] target list: {name}")
            out[name] = ""
            continue
        created = graph_post(
            f"/sites/{target_site_id}/lists",
            {"displayName": name, "list": {"template": "genericList"}},
        )
        out[name] = created["id"]
        print(f"[CREATE] target list: {name} ({out[name]})")

    for name in LIST_NAMES:
        if name not in out:
            out[name] = tgt_map[name]["id"]
    return out


def ensure_target_schema(target_site_id: str, target_lists: dict[str, str], execute: bool) -> None:
    if not execute:
        print("[DRY-RUN] target schema sync")
        print("  - システムマスタ: Customer, Description")
        print("  - 作業種別マスタ: Category")
        print("  - 作業報告: ReportDate, Customer, System, WorkType, WorkDescription, WorkHours, Reporter")
        print("  - 作業予定: PlanDate, Customer, System, WorkDescription, Assignee, Status")
        return

    customer_list_id = target_lists["顧客マスタ"]
    system_list_id = target_lists["システムマスタ"]
    worktype_list_id = target_lists["作業種別マスタ"]
    report_list_id = target_lists["作業報告"]
    plan_list_id = target_lists["作業予定"]

    sys_cols = get_columns(target_site_id, system_list_id)
    ensure_lookup_column(target_site_id, system_list_id, "Customer", "顧客", customer_list_id, sys_cols, required=True)
    ensure_text_column(target_site_id, system_list_id, "Description", "説明", sys_cols, multi_line=True)

    wt_cols = get_columns(target_site_id, worktype_list_id)
    ensure_choice_column(target_site_id, worktype_list_id, "Category", "カテゴリ", ["開発", "保守", "運用", "会議", "その他"], wt_cols)

    rpt_cols = get_columns(target_site_id, report_list_id)
    ensure_datetime_column(target_site_id, report_list_id, "ReportDate", "作業日", rpt_cols, required=True)
    ensure_lookup_column(target_site_id, report_list_id, "Customer", "顧客", customer_list_id, rpt_cols, required=True)
    ensure_lookup_column(target_site_id, report_list_id, "System", "システム", system_list_id, rpt_cols, required=True)
    ensure_lookup_column(target_site_id, report_list_id, "WorkType", "作業種別", worktype_list_id, rpt_cols, required=True)
    ensure_text_column(target_site_id, report_list_id, "WorkDescription", "作業内容", rpt_cols, required=True, multi_line=True)
    ensure_number_column(target_site_id, report_list_id, "WorkHours", "作業時間", rpt_cols, required=True)
    ensure_person_column(target_site_id, report_list_id, "Reporter", "報告者", rpt_cols)

    plan_cols = get_columns(target_site_id, plan_list_id)
    ensure_datetime_column(target_site_id, plan_list_id, "PlanDate", "予定日", plan_cols, required=True)
    ensure_lookup_column(target_site_id, plan_list_id, "Customer", "顧客", customer_list_id, plan_cols, required=True)
    ensure_lookup_column(target_site_id, plan_list_id, "System", "システム", system_list_id, plan_cols, required=True)
    ensure_text_column(target_site_id, plan_list_id, "WorkDescription", "作業内容", plan_cols, required=True, multi_line=True)
    ensure_person_column(target_site_id, plan_list_id, "Assignee", "担当者", plan_cols)
    ensure_choice_column(target_site_id, plan_list_id, "Status", "状態", ["未着手", "進行中", "完了"], plan_cols, required=True)


def get_all_items(site_id: str, list_id: str) -> list[dict[str, Any]]:
    path = f"/sites/{site_id}/lists/{list_id}/items?$expand=fields&$top=999"
    items: list[dict[str, Any]] = []
    while path:
        if path.startswith("http"):
            r = requests.get(path, headers=graph_headers(), timeout=60)
            r.raise_for_status()
            d = r.json()
        else:
            d = graph_get(path)
        items.extend(d.get("value", []))
        next_link = d.get("@odata.nextLink")
        if next_link:
            path = next_link
        else:
            path = ""
    return items


def get_existing_title_map(site_id: str, list_id: str) -> dict[str, int]:
    m: dict[str, int] = {}
    for it in get_all_items(site_id, list_id):
        fields = it.get("fields", {})
        title = fields.get("Title")
        if title:
            m[str(title)] = int(it["id"])
    return m


def sanitize_fields(fields: dict[str, Any], allowed_fields: set[str] | None = None) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for k, v in fields.items():
        if k in SYSTEM_FIELD_NAMES:
            continue
        if k.startswith("@"):  # @odata.etag など
            continue
        if v is None:
            continue
        if allowed_fields is not None and k not in allowed_fields:
            continue
        clean[k] = v
    return clean


def upsert_by_title(
    target_site_id: str,
    target_list_id: str,
    fields: dict[str, Any],
    existing_title_map: dict[str, int],
    execute: bool,
) -> int | None:
    title = str(fields.get("Title", "")).strip()
    if not title:
        return None
    if title in existing_title_map:
        return existing_title_map[title]

    if not execute:
        print(f"  [DRY-RUN ADD] {title}")
        return None

    created = graph_post(
        f"/sites/{target_site_id}/lists/{target_list_id}/items",
        {"fields": fields},
    )
    new_id = int(created["id"])
    existing_title_map[title] = new_id
    print(f"  [ADD] {title}")
    return new_id


def map_lookup_id(source_id: Any, id_map: dict[int, int]) -> int | None:
    if source_id is None:
        return None
    try:
        src = int(source_id)
    except Exception:
        return None
    return id_map.get(src)


def copy_master_list(
    source_site_id: str,
    source_list_id: str,
    target_site_id: str,
    target_list_id: str,
    list_name: str,
    execute: bool,
) -> dict[int, int]:
    print(f"[COPY] {list_name}")
    source_items = get_all_items(source_site_id, source_list_id)
    target_title_map = get_existing_title_map(target_site_id, target_list_id)
    id_map: dict[int, int] = {}

    for src in source_items:
        src_id = int(src["id"])
        fields = sanitize_fields(src.get("fields", {}), ALLOWED_FIELDS_BY_LIST[list_name])
        if "Title" not in fields:
            continue

        if str(fields["Title"]) in target_title_map:
            id_map[src_id] = target_title_map[str(fields["Title"])]
            continue

        new_id = upsert_by_title(target_site_id, target_list_id, fields, target_title_map, execute)
        if new_id is not None:
            id_map[src_id] = new_id

    return id_map


def copy_systems(
    source_site_id: str,
    source_list_id: str,
    target_site_id: str,
    target_list_id: str,
    customer_id_map: dict[int, int],
    execute: bool,
) -> dict[int, int]:
    print("[COPY] システムマスタ")
    source_items = get_all_items(source_site_id, source_list_id)
    target_title_map = get_existing_title_map(target_site_id, target_list_id)
    id_map: dict[int, int] = {}

    for src in source_items:
        src_id = int(src["id"])
        fields = sanitize_fields(src.get("fields", {}), ALLOWED_FIELDS_BY_LIST["システムマスタ"])
        if "Title" not in fields:
            continue

        src_customer = fields.get("CustomerLookupId")
        mapped_customer = map_lookup_id(src_customer, customer_id_map)
        if mapped_customer is not None:
            fields["CustomerLookupId"] = mapped_customer
        else:
            fields.pop("CustomerLookupId", None)

        title = str(fields["Title"])
        if title in target_title_map:
            id_map[src_id] = target_title_map[title]
            continue

        new_id = upsert_by_title(target_site_id, target_list_id, fields, target_title_map, execute)
        if new_id is not None:
            id_map[src_id] = new_id

    return id_map


def copy_work_items(
    source_site_id: str,
    source_list_id: str,
    target_site_id: str,
    target_list_id: str,
    customer_id_map: dict[int, int],
    system_id_map: dict[int, int],
    worktype_id_map: dict[int, int],
    execute: bool,
) -> None:
    source_items = get_all_items(source_site_id, source_list_id)
    target_titles = get_existing_title_map(target_site_id, target_list_id)

    for src in source_items:
        list_name = "作業報告" if "WorkTypeLookupId" in src.get("fields", {}) or "ReportDate" in src.get("fields", {}) else "作業予定"
        fields = sanitize_fields(src.get("fields", {}), ALLOWED_FIELDS_BY_LIST[list_name])

        mapped_customer = map_lookup_id(fields.get("CustomerLookupId"), customer_id_map)
        mapped_system = map_lookup_id(fields.get("SystemLookupId"), system_id_map)
        mapped_worktype = map_lookup_id(fields.get("WorkTypeLookupId"), worktype_id_map)

        if mapped_customer is not None:
            fields["CustomerLookupId"] = mapped_customer
        else:
            fields.pop("CustomerLookupId", None)

        if mapped_system is not None:
            fields["SystemLookupId"] = mapped_system
        else:
            fields.pop("SystemLookupId", None)

        if "WorkTypeLookupId" in fields:
            if mapped_worktype is not None:
                fields["WorkTypeLookupId"] = mapped_worktype
            else:
                fields.pop("WorkTypeLookupId", None)

        # Person フィールドはサイト跨ぎで不整合になりやすいため除外
        for k in ["ReporterLookupId", "AssigneeLookupId", "Reporter", "Assignee"]:
            fields.pop(k, None)

        if "Title" not in fields or not str(fields.get("Title", "")).strip():
            # 同一判定用に Title を補完
            date_key = fields.get("ReportDate") or fields.get("PlanDate") or "undated"
            desc = str(fields.get("WorkDescription", ""))[:20]
            fields["Title"] = f"migrated-{date_key}-{desc}"

        upsert_by_title(target_site_id, target_list_id, fields, target_titles, execute)


def set_env_value(env_path: Path, key: str, value: str) -> None:
    if not env_path.exists():
        env_path.write_text("", encoding="utf-8")
    text = env_path.read_text(encoding="utf-8")
    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
    line = f"{key}={value}"
    if pattern.search(text):
        text = pattern.sub(line, text)
    else:
        if text and not text.endswith("\n"):
            text += "\n"
        text += line + "\n"
    env_path.write_text(text, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="SharePoint -> Teams サイト移行")
    parser.add_argument("--source-site-id", default="", help="移行元 site id")
    parser.add_argument("--source-site-url", default="", help="移行元 site URL")
    parser.add_argument("--target-group-id", required=True, help="Teams group id")
    parser.add_argument("--dry-run", action="store_true", help="書き込みせず確認")
    parser.add_argument("--execute", action="store_true", help="実際に作成・更新")
    parser.add_argument("--update-env", default="", help="更新する env ファイルパス（例: .env.production.local）")
    args = parser.parse_args()

    execute = args.execute and not args.dry_run
    if not args.dry_run and not args.execute:
        print("--dry-run か --execute のどちらかを指定してください", file=sys.stderr)
        return 2

    print("=" * 60)
    print("SharePoint -> Teams サイト移行")
    print("=" * 60)

    if not args.source_site_id and not args.source_site_url:
        print("--source-site-id か --source-site-url のどちらかを指定してください", file=sys.stderr)
        return 2

    if args.source_site_id:
        source_site_id = args.source_site_id
    else:
        source_site_id, source_site_url = resolve_site_id_from_url(args.source_site_url)
        print(f"[INFO] source url : {source_site_url}")

    target_site_id, target_site_url = resolve_site_id_from_group(args.target_group_id)

    print(f"[INFO] source site: {source_site_id}")
    print(f"[INFO] target site: {target_site_id}")
    print(f"[INFO] target url : {target_site_url}")
    print(f"[MODE] {'EXECUTE' if execute else 'DRY-RUN'}")

    src_lists = list_map_by_name(source_site_id)
    tgt_lists = ensure_target_lists(source_site_id, target_site_id, execute)

    if not execute and any(not list_id for list_id in tgt_lists.values()):
        print("\n[DRY-RUN RESULT] 移行先に不足リストがあります。--execute でリスト作成と移行を行ってください。")
        return 0

    ensure_target_schema(target_site_id, tgt_lists, execute)

    src_customer = src_lists["顧客マスタ"]["id"]
    src_system = src_lists["システムマスタ"]["id"]
    src_worktype = src_lists["作業種別マスタ"]["id"]
    src_report = src_lists["作業報告"]["id"]
    src_plan = src_lists["作業予定"]["id"]

    tgt_customer = tgt_lists["顧客マスタ"]
    tgt_system = tgt_lists["システムマスタ"]
    tgt_worktype = tgt_lists["作業種別マスタ"]
    tgt_report = tgt_lists["作業報告"]
    tgt_plan = tgt_lists["作業予定"]

    customer_id_map = copy_master_list(source_site_id, src_customer, target_site_id, tgt_customer, "顧客マスタ", execute)
    system_id_map = copy_systems(source_site_id, src_system, target_site_id, tgt_system, customer_id_map, execute)
    worktype_id_map = copy_master_list(source_site_id, src_worktype, target_site_id, tgt_worktype, "作業種別マスタ", execute)

    print("[COPY] 作業報告")
    copy_work_items(
        source_site_id,
        src_report,
        target_site_id,
        tgt_report,
        customer_id_map,
        system_id_map,
        worktype_id_map,
        execute,
    )

    print("[COPY] 作業予定")
    copy_work_items(
        source_site_id,
        src_plan,
        target_site_id,
        tgt_plan,
        customer_id_map,
        system_id_map,
        worktype_id_map,
        execute,
    )

    print("\n[RESULT] target list IDs")
    print(f"VITE_SP_SITE_ID={target_site_id}")
    print(f"VITE_SP_LIST_CUSTOMERS={tgt_customer}")
    print(f"VITE_SP_LIST_SYSTEMS={tgt_system}")
    print(f"VITE_SP_LIST_WORKTYPES={tgt_worktype}")
    print(f"VITE_SP_LIST_REPORTS={tgt_report}")
    print(f"VITE_SP_LIST_PLANS={tgt_plan}")

    if execute and args.update_env:
        env_path = Path(args.update_env)
        if not env_path.is_absolute():
            env_path = PROJECT_ROOT / env_path
        set_env_value(env_path, "VITE_SP_SITE_ID", target_site_id)
        set_env_value(env_path, "VITE_SP_LIST_CUSTOMERS", tgt_customer)
        set_env_value(env_path, "VITE_SP_LIST_SYSTEMS", tgt_system)
        set_env_value(env_path, "VITE_SP_LIST_WORKTYPES", tgt_worktype)
        set_env_value(env_path, "VITE_SP_LIST_REPORTS", tgt_report)
        set_env_value(env_path, "VITE_SP_LIST_PLANS", tgt_plan)
        print(f"[UPDATE] env updated: {env_path}")

    print("\n完了")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
