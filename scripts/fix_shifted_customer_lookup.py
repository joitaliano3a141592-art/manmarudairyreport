from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from setup_sharepoint_lists import get_graph_token  # noqa: E402

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
DEFAULT_ENV_CANDIDATES = [
    _PROJECT_ROOT / ".env.production.local",
    _PROJECT_ROOT / ".env",
]
DEFAULT_REMAP_FILE = _PROJECT_ROOT / "scripts" / "fix_shifted_customer_lookup.local.json"
TARGET_LISTS = {
    "reports": "VITE_SP_LIST_REPORTS",
    "plans": "VITE_SP_LIST_PLANS",
}


def resolve_env_path(explicit_path: str) -> Path:
    if explicit_path:
        return Path(explicit_path)
    for candidate in DEFAULT_ENV_CANDIDATES:
        if candidate.exists():
            return candidate
    raise FileNotFoundError("env ファイルが見つかりません。.env.production.local か .env を用意してください。")


def resolve_remap_file_path(explicit_path: str) -> Path:
    if explicit_path:
        return Path(explicit_path)
    if DEFAULT_REMAP_FILE.exists():
        return DEFAULT_REMAP_FILE
    raise FileNotFoundError(
        "remap ファイルが見つかりません。--remap-file を指定するか scripts/fix_shifted_customer_lookup.local.json を作成してください。"
    )


def load_remap(remap_file: Path) -> dict[str, str]:
    data = json.loads(remap_file.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not data:
        raise RuntimeError("remap ファイルは 1 件以上の name-to-name JSON オブジェクトで指定してください。")

    remap: dict[str, str] = {}
    for old_name, new_name in data.items():
        normalized_old = str(old_name).strip()
        normalized_new = str(new_name).strip()
        if not normalized_old or not normalized_new:
            raise RuntimeError("remap ファイルに空の顧客名があります。")
        remap[normalized_old] = normalized_new
    return remap


def build_old_to_new_id_map(customer_id_map: dict[str, int], remap: dict[str, str]) -> dict[int, int]:
    old_to_new_id: dict[int, int] = {}
    for index, (old_name, new_name) in enumerate(remap.items(), start=1):
        old_id = customer_id_map.get(old_name)
        new_id = customer_id_map.get(new_name)
        if old_id is None or new_id is None:
            raise RuntimeError(f"顧客マスタに remap #{index} の対象がありません。")
        old_to_new_id[old_id] = new_id
    return old_to_new_id


def graph_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {get_graph_token()}",
        "Content-Type": "application/json",
    }


def graph_get_json(url: str) -> dict:
    response = requests.get(url, headers=graph_headers(), timeout=60)
    response.raise_for_status()
    return response.json()


def graph_patch_json(url: str, body: dict) -> None:
    response = requests.patch(url, headers=graph_headers(), json=body, timeout=60)
    if response.status_code >= 400:
        print(f"[ERROR] PATCH {url}: {response.status_code} {response.text[:500]}", file=sys.stderr)
    response.raise_for_status()


def get_required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"環境変数 {name} が未設定です。")
    return value


def fetch_all_items(site_id: str, list_id: str) -> list[dict]:
    url = f"{GRAPH_BASE}/sites/{site_id}/lists/{list_id}/items?$expand=fields&$top=999"
    items: list[dict] = []
    while url:
        data = graph_get_json(url)
        items.extend(data.get("value", []))
        url = data.get("@odata.nextLink", "")
    return items


def resolve_customer_id_map(site_id: str, list_id: str) -> dict[str, int]:
    items = fetch_all_items(site_id, list_id)
    customer_map: dict[str, int] = {}
    for item in items:
        title = str(item.get("fields", {}).get("Title", "")).strip()
        if title:
            customer_map[title] = int(item["id"])
    return customer_map


def collect_targets(site_id: str, list_id: str, old_to_new_id: dict[int, int]) -> list[dict]:
    targets: list[dict] = []
    for item in fetch_all_items(site_id, list_id):
        fields = item.get("fields", {})
        customer_id = fields.get("CustomerLookupId")
        if customer_id is None:
            continue
        current_id = int(customer_id)
        new_id = old_to_new_id.get(current_id)
        if new_id is None:
            continue
        targets.append(
            {
                "id": int(item["id"]),
                "fields": fields,
                "old_customer_id": current_id,
                "new_customer_id": new_id,
            }
        )
    return targets


def backup_targets(targets_by_list: dict[str, list[dict]]) -> Path:
    archive_dir = _PROJECT_ROOT / "archives"
    archive_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).astimezone().strftime("%Y%m%d_%H%M%S")
    backup_path = archive_dir / f"customer_lookup_fix_{timestamp}.json"
    serializable = {
        list_name: [
            {
                "id": target["id"],
                "old_customer_id": target["old_customer_id"],
                "new_customer_id": target["new_customer_id"],
                "modified": target["fields"].get("Modified"),
            }
            for target in items
        ]
        for list_name, items in targets_by_list.items()
    }
    backup_path.write_text(json.dumps(serializable, ensure_ascii=False, indent=2), encoding="utf-8")
    return backup_path


def update_targets(site_id: str, list_id: str, targets: list[dict], execute: bool) -> int:
    updated = 0
    for target in targets:
        if not execute:
            continue
        graph_patch_json(
            f"{GRAPH_BASE}/sites/{site_id}/lists/{list_id}/items/{target['id']}/fields",
            {"CustomerLookupId": target["new_customer_id"]},
        )
        updated += 1
    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description="SharePoint の顧客 Lookup ずれ補正")
    parser.add_argument("--env-file", default="", help="読み込む env ファイル")
    parser.add_argument("--remap-file", default="", help="顧客名 remap JSON ファイル")
    parser.add_argument("--execute", action="store_true", help="実際に更新する")
    args = parser.parse_args()

    env_path = resolve_env_path(args.env_file)
    remap_file = resolve_remap_file_path(args.remap_file)
    load_dotenv(env_path)

    site_id = get_required_env("VITE_SP_SITE_ID")
    customer_list_id = get_required_env("VITE_SP_LIST_CUSTOMERS")
    remap = load_remap(remap_file)

    customer_id_map = resolve_customer_id_map(site_id, customer_list_id)
    old_to_new_id = build_old_to_new_id_map(customer_id_map, remap)

    print(f"[INFO] env: {env_path}")
    print(f"[INFO] remap file: {remap_file}")
    print(f"[INFO] remap entries: {len(remap)}")

    targets_by_list: dict[str, list[dict]] = {}
    for list_name, env_name in TARGET_LISTS.items():
        list_id = get_required_env(env_name)
        targets = collect_targets(site_id, list_id, old_to_new_id)
        targets_by_list[list_name] = targets
        print(f"[CHECK] {list_name}: {len(targets)} 件")

    total_targets = sum(len(items) for items in targets_by_list.values())
    if total_targets == 0:
        print("[OK] 補正対象はありません。")
        return

    backup_path = backup_targets(targets_by_list)
    print(f"[BACKUP] {backup_path}")

    if not args.execute:
        print("[DRY-RUN] --execute 未指定のため更新は行いません。")
        return

    updated_counts: dict[str, int] = {}
    for list_name, env_name in TARGET_LISTS.items():
        list_id = get_required_env(env_name)
        updated_counts[list_name] = update_targets(site_id, list_id, targets_by_list[list_name], execute=True)

    print("[DONE] 更新件数")
    for list_name, count in updated_counts.items():
        print(f"  - {list_name}: {count} 件")


if __name__ == "__main__":
    main()
