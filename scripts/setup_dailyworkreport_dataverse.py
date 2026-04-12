"""
Daily Work Report Dataverse テーブル構築スクリプト

Phase 1: ソリューション作成 → テーブル作成（マスタ→主→従属）→ Lookup → ローカライズ → デモデータ → ソリューション含有検証

使い方:
  1. .env ファイルに DATAVERSE_URL, TENANT_ID, SOLUTION_NAME, PUBLISHER_PREFIX を設定
  2. pip install azure-identity requests python-dotenv
  3. python scripts/setup_dailyworkreport_dataverse.py
"""

import json
import os
import sys
import time
from datetime import datetime, timedelta

# scripts/ ディレクトリを sys.path に追加
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import requests
from dotenv import load_dotenv
from auth_helper import get_token as _get_token

load_dotenv()

# ── 環境変数 ──────────────────────────────────────────────
DATAVERSE_URL = os.environ["DATAVERSE_URL"].rstrip("/")
SOLUTION_NAME = os.environ.get("SOLUTION_NAME", "DailyWorkReport")
SOLUTION_DISPLAY_NAME = os.environ.get("SOLUTION_DISPLAY_NAME", "日次作業報告")
PREFIX = os.environ.get("PUBLISHER_PREFIX", "jwo")

# ── 認証 ──────────────────────────────────────────────────

def get_headers():
    token = _get_token()
    return {
        "Authorization": f"Bearer {token}",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "MSCRM.SolutionName": SOLUTION_NAME,
    }

# ── API ヘルパー ─────────────────────────────────────────

def api_get(path, params=None):
    r = requests.get(f"{DATAVERSE_URL}/api/data/v9.2/{path}",
                     headers=get_headers(), params=params)
    r.raise_for_status()
    return r.json()

def api_post(path, body):
    r = requests.post(f"{DATAVERSE_URL}/api/data/v9.2/{path}",
                      headers=get_headers(), json=body)
    if not r.ok:
        print(f"  API ERROR {r.status_code}: {r.text[:500]}")
    r.raise_for_status()
    return r

def api_put(path, body):
    h = get_headers()
    h["MSCRM.MergeLabels"] = "true"
    r = requests.put(f"{DATAVERSE_URL}/api/data/v9.2/{path}",
                     headers=h, json=body)
    r.raise_for_status()
    return r

def api_patch(path, body):
    r = requests.patch(f"{DATAVERSE_URL}/api/data/v9.2/{path}",
                       headers=get_headers(), json=body)
    r.raise_for_status()
    return r

def api_delete(path):
    r = requests.delete(f"{DATAVERSE_URL}/api/data/v9.2/{path}",
                        headers=get_headers())
    r.raise_for_status()
    return r

# ── リトライ付きメタデータ操作 ────────────────────────────

def retry_metadata(fn, description, max_attempts=5):
    """メタデータ操作をリトライ。ロック競合時は累進的に待機。"""
    for attempt in range(max_attempts):
        try:
            return fn()
        except requests.HTTPError as e:
            resp_text = ""
            if e.response is not None:
                try:
                    resp_text = e.response.text or e.response.content.decode("utf-8", errors="replace")
                except Exception:
                    resp_text = str(e.response.content)
            err = str(e) + " " + resp_text
            err_lower = err.lower()
            if "already exists" in err_lower or "0x80048403" in err or "not unique" in err_lower:
                print(f"  {description}: already exists — skipping")
                return None
            if "0x80040237" in err or "0x80040216" in err or ("another" in err_lower and "running" in err_lower):
                wait = 10 * (attempt + 1)
                print(f"  {description}: lock contention / metadata sync, waiting {wait}s …")
                time.sleep(wait)
                continue
            raise

# ── ソリューション作成/検索 ─────────────────────────────

def ensure_solution():
    print(f"\n[Phase 1-0] ソリューション作成: {SOLUTION_NAME}")
    
    # 既存ソリューション検索
    result = api_get("solutions", {"$filter": f"uniquename eq '{SOLUTION_NAME}'"})
    if result["value"]:
        sol = result["value"][0]
        sol_id = sol["solutionid"]
        print(f"  既存ソリューション: {sol['friendlyname']} ({sol_id})")
        return sol_id
    
    # 新規ソリューション作成
    # 環境の既定のパブリッシャーを使用
    body = {
        "uniquename": SOLUTION_NAME,
        "friendlyname": SOLUTION_DISPLAY_NAME,
        "publisherid@odata.bind": f"/publishers(d21aab71-79e7-11dd-8874-00188b01e34f)",
    }
    resp = api_post("solutions", body)
    sol_id = resp.headers["OData-EntityId"].split("(")[1].rstrip(")")
    print(f"  新規ソリューション作成: {sol_id}")
    return sol_id

# ── テーブル定義 ─────────────────────────────────────────

TABLE_DEFINITIONS = {
    # マスタテーブル
    "jwo_customer": {
        "display_name": "顧客",
        "logical_name": f"{PREFIX}_customer",
        "pluralname": f"{PREFIX}_customers",
        "columns": [
            {
                "name": f"{PREFIX}_customername",
                "display_name": "顧客名",
                "type": "String",
                "required": True,
                "max_length": 100,
            },
            {
                "name": f"{PREFIX}_department",
                "display_name": "部門",
                "type": "String",
                "required": False,
                "max_length": 100,
            },
            {
                "name": f"{PREFIX}_emailaddress",
                "display_name": "メールアドレス",
                "type": "String",
                "required": False,
                "max_length": 256,
            },
        ],
    },
    "jwo_system": {
        "display_name": "システム",
        "logical_name": f"{PREFIX}_system",
        "pluralname": f"{PREFIX}_systems",
        "columns": [
            {
                "name": f"{PREFIX}_systemname",
                "display_name": "システム名",
                "type": "String",
                "required": True,
                "max_length": 100,
            },
            {
                "name": f"{PREFIX}_description",
                "display_name": "説明",
                "type": "String",
                "required": False,
                "max_length": 1000,
            },
            {
                "name": f"{PREFIX}_ownercustomerlookup",
                "display_name": "所有顧客",
                "type": "Lookup",
                "required": False,
                "relationship_target": f"{PREFIX}_customer",
            },
        ],
    },
    "jwo_worktype": {
        "display_name": "作業区分",
        "logical_name": f"{PREFIX}_worktype",
        "pluralname": f"{PREFIX}_worktypes",
        "columns": [
            {
                "name": f"{PREFIX}_worktypename",
                "display_name": "区分名",
                "type": "String",
                "required": True,
                "max_length": 100,
            },
            {
                "name": f"{PREFIX}_description",
                "display_name": "説明",
                "type": "String",
                "required": False,
                "max_length": 1000,
            },
        ],
    },
    # 主テーブル
    "jwo_workreport": {
        "display_name": "作業報告",
        "logical_name": f"{PREFIX}_workreport",
        "pluralname": f"{PREFIX}_workreports",
        "columns": [
            {
                "name": f"{PREFIX}_reportdate",
                "display_name": "報告日",
                "type": "DateOnly",
                "required": True,
            },
            {
                "name": f"{PREFIX}_customerlookup",
                "display_name": "顧客",
                "type": "Lookup",
                "required": True,
                "relationship_target": f"{PREFIX}_customer",
            },
            {
                "name": f"{PREFIX}_systemlookup",
                "display_name": "システム",
                "type": "Lookup",
                "required": True,
                "relationship_target": f"{PREFIX}_system",
            },
            {
                "name": f"{PREFIX}_workdescription",
                "display_name": "作業内容",
                "type": "String",
                "required": True,
                "max_length": 1000,
            },
            {
                "name": f"{PREFIX}_worktypelookup",
                "display_name": "作業区分",
                "type": "Lookup",
                "required": True,
                "relationship_target": f"{PREFIX}_worktype",
            },
            {
                "name": f"{PREFIX}_worktime",
                "display_name": "作業時間",
                "type": "Decimal",
                "required": True,
                "precision": 5,
                "scale": 2,
            },
        ],
    },
    # 従属テーブル
    "jwo_workplan": {
        "display_name": "作業予定",
        "logical_name": f"{PREFIX}_workplan",
        "pluralname": f"{PREFIX}_workplans",
        "columns": [
            {
                "name": f"{PREFIX}_plandate",
                "display_name": "予定日",
                "type": "DateOnly",
                "required": True,
            },
            {
                "name": f"{PREFIX}_customerlookup",
                "display_name": "顧客",
                "type": "Lookup",
                "required": True,
                "relationship_target": f"{PREFIX}_customer",
            },
            {
                "name": f"{PREFIX}_systemlookup",
                "display_name": "システム",
                "type": "Lookup",
                "required": True,
                "relationship_target": f"{PREFIX}_system",
            },
            {
                "name": f"{PREFIX}_workdescription",
                "display_name": "作業内容",
                "type": "String",
                "required": True,
                "max_length": 1000,
            },
        ],
    },
}

# ── テーブル作成 ─────────────────────────────────────────

def create_table(table_name, config):
    print(f"\n[Phase 1-1] {config['display_name']} テーブル作成: {table_name}")
    
    # 既存テーブル検索
    result = api_get("EntityDefinitions", {
        "$filter": f"LogicalName eq '{config['logical_name']}'"
    })
    if result["value"]:
        entity = result["value"][0]
        print(f"  既存テーブル: {entity['DisplayName']['UserLocalizedLabel']['Label']} ({entity['MetadataId']})")
        return entity["MetadataId"]
    
    # テーブが作成
    body = {
        "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
        "SchemaName": config["logical_name"],
        "DisplayName": {
            "UserLocalizedLabel": {
                "Label": config["display_name"],
                "LanguageCode": 1041,
            }
        },
        "DisplayCollectionName": {
            "UserLocalizedLabel": {
                "Label": config["pluralname"],
                "LanguageCode": 1041,
            }
        },
        "OwnershipType": "UserOwned",
        "IsActivity": False,
        "HasActivities": False,
        "HasNotes": False,
        "HasFeedback": False,
        "Attributes": _build_attributes(config["columns"]),
    }
    
    def create_fn():
        resp = api_post("EntityDefinitions", body)
        entity_id = resp.headers["OData-EntityId"].split("(")[1].rstrip(")")
        return entity_id
    
    entity_id = retry_metadata(create_fn, f"{config['display_name']} テーブル作成")
    print(f"  テーブル作成: {entity_id}")
    return entity_id

def _build_attributes(columns):
    """列定義リストから OData attributes を構築"""
    attributes = []
    for col in columns:
        if col["type"] == "String":
            attr = {
                "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
                "SchemaName": col["name"],
                "DisplayName": {
                    "UserLocalizedLabel": {
                        "Label": col["display_name"],
                        "LanguageCode": 1041,
                    }
                },
                "MaxLength": col.get("max_length", 100),
                "RequiredLevel": {
                    "Value": "SystemRequired" if col.get("required") else "None"
                },
            }
        elif col["type"] == "DateOnly":
            attr = {
                "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
                "SchemaName": col["name"],
                "DisplayName": {
                    "UserLocalizedLabel": {
                        "Label": col["display_name"],
                        "LanguageCode": 1041,
                    }
                },
                "Format": "DateOnly",
                "RequiredLevel": {
                    "Value": "SystemRequired" if col.get("required") else "None"
                },
            }
        elif col["type"] == "Lookup":
            continue  # Lookup は別途リレーション作成
        elif col["type"] == "Decimal":
            attr = {
                "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
                "SchemaName": col["name"],
                "DisplayName": {
                    "UserLocalizedLabel": {
                        "Label": col["display_name"],
                        "LanguageCode": 1041,
                    }
                },
                "Precision": col.get("precision", 10),
                "Scale": col.get("scale", 0),
                "RequiredLevel": {
                    "Value": "SystemRequired" if col.get("required") else "None"
                },
            }
        else:
            continue
        
        attributes.append(attr)
    
    return attributes

# ── Lookup / リレーション作成 ────────────────────────────

def create_lookup(source_entity, target_entity, lookup_schema_name, display_name):
    """Lookup リレーション作成"""
    print(f"  Lookup 作成: {lookup_schema_name} ({source_entity} → {target_entity})")
    
    # 既存リレーション検索
    result = api_get("RelationshipDefinitions", {
        "$filter": f"SchemaName eq '{lookup_schema_name}'"
    })
    if result["value"]:
        print(f"    既存リレーション: {lookup_schema_name}")
        return
    
    # リレーション作成
    body = {
        "@odata.type": "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
        "SchemaName": lookup_schema_name,
        "ReferencingEntity": source_entity,
        "ReferencedEntity": target_entity,
        "Lookup": {
            "SchemaName": f"{source_entity}_{target_entity}",
            "DisplayName": {
                "UserLocalizedLabel": {
                    "Label": display_name,
                    "LanguageCode": 1041,
                }
            },
        },
    }
    
    def create_fn():
        api_post("RelationshipDefinitions", body)
    
    retry_metadata(create_fn, f"Lookup {lookup_schema_name} 作成")

# ── ローカライズ（日本語） ────────────────────────────

def localize_table(entity_logical_name, ja_display_name):
    """テーブル表示名を日本語に設定（PUT + MetadataId パターン）"""
    print(f"  {entity_logical_name} ローカライズ")
    
    result = api_get("EntityDefinitions", {
        "$filter": f"LogicalName eq '{entity_logical_name}'",
        "$select": "MetadataId,DisplayName"
    })
    if not result["value"]:
        print(f"    テーブルが見つかりません")
        return
    
    entity = result["value"][0]
    metadata_id = entity["MetadataId"]
    
    body = {
        "DisplayName": {
            "UserLocalizedLabel": {
                "Label": ja_display_name,
                "LanguageCode": 1041,
            }
        }
    }
    api_put(f"EntityDefinitions({metadata_id})", body)

# ── デモデータ投入 ──────────────────────────────────────

def seed_demo_data():
    """デモデータを投入（マスタ → 主テーブル → 従属テーブル）"""
    print(f"\n[Phase 1-3] デモデータ投入")
    
    # 顧客マスタ
    print("  顧客マスタ投入")
    customers = [
        {"jwo_customername": "ABC システムズ", "jwo_department": "営業部", "jwo_emailaddress": "info@abc.co.jp"},
        {"jwo_customername": "XYZ コンサル", "jwo_department": "企画部", "jwo_emailaddress": "contact@xyz.co.jp"},
        {"jwo_customername": "DEF 製造", "jwo_department": "生産部", "jwo_emailaddress": "support@def.co.jp"},
    ]
    customer_ids = {}
    for cust in customers:
        resp = api_post(f"{PREFIX}_customers", cust)
        cust_id = resp.headers["OData-EntityId"].split("(")[1].rstrip(")")
        customer_ids[cust["jwo_customername"]] = cust_id
        print(f"    {cust['jwo_customername']}: {cust_id}")
    
    # システムマスタ
    print("  システムマスタ投入")
    systems = [
        {"jwo_systemname": "会計システム", "jwo_description": "財務会計業務用", "jwo_ownercustomerlookup@odata.bind": f"/{PREFIX}_customers({customer_ids['ABC システムズ']})"},
        {"jwo_systemname": "営業管理システム", "jwo_description": "営業情報管理用", "jwo_ownercustomerlookup@odata.bind": f"/{PREFIX}_customers({customer_ids['ABC システムズ']})"},
        {"jwo_systemname": "在庫管理システム", "jwo_description": "在庫情報管理用", "jwo_ownercustomerlookup@odata.bind": f"/{PREFIX}_customers({customer_ids['XYZ コンサル']})"},
        {"jwo_systemname": "生産管理システム", "jwo_description": "生産情報管理用", "jwo_ownercustomerlookup@odata.bind": f"/{PREFIX}_customers({customer_ids['DEF 製造']})"},
    ]
    system_ids = {}
    for sys in systems:
        resp = api_post(f"{PREFIX}_systems", sys)
        sys_id = resp.headers["OData-EntityId"].split("(")[1].rstrip(")")
        system_ids[sys["jwo_systemname"]] = sys_id
        print(f"    {sys['jwo_systemname']}: {sys_id}")
    
    # 作業区分マスタ
    print("  作業区分マスタ投入")
    worktypes = [
        {"jwo_worktypename": "開発", "jwo_description": "システム開発業務"},
        {"jwo_worktypename": "保守", "jwo_description": "既存システム保守・バグ対応"},
        {"jwo_worktypename": "テスト", "jwo_description": "品質保証・テスト業務"},
        {"jwo_worktypename": "ドキュメント", "jwo_description": "ドキュメント作成・更新"},
        {"jwo_worktypename": "会議", "jwo_description": "進捗会議・打ち合わせ"},
    ]
    worktype_ids = {}
    for wt in worktypes:
        resp = api_post(f"{PREFIX}_worktypes", wt)
        wt_id = resp.headers["OData-EntityId"].split("(")[1].rstrip(")")
        worktype_ids[wt["jwo_worktypename"]] = wt_id
        print(f"    {wt['jwo_worktypename']}: {wt_id}")
    
    # 作業報告（本日）
    print("  作業報告投入")
    today = datetime.now().date()
    workreports = [
        {
            "jwo_reportdate": today.isoformat(),
            "jwo_customerlookup@odata.bind": f"/{PREFIX}_customers({customer_ids['ABC システムズ']})",
            "jwo_systemlookup@odata.bind": f"/{PREFIX}_systems({system_ids['会計システム']})",
            "jwo_workdescription": "会計システムの UI 改善 — フォーム入力画面の確認",
            "jwo_worktypelookup@odata.bind": f"/{PREFIX}_worktypes({worktype_ids['開発']})",
            "jwo_worktime": 2.5,
        },
        {
            "jwo_reportdate": today.isoformat(),
            "jwo_customerlookup@odata.bind": f"/{PREFIX}_customers({customer_ids['ABC システムズ']})",
            "jwo_systemlookup@odata.bind": f"/{PREFIX}_systems({system_ids['営業管理システム']})",
            "jwo_workdescription": "営業管理システムのバグ修正 (Bug ID: #1234)",
            "jwo_worktypelookup@odata.bind": f"/{PREFIX}_worktypes({worktype_ids['保守']})",
            "jwo_worktime": 1.5,
        },
        {
            "jwo_reportdate": today.isoformat(),
            "jwo_customerlookup@odata.bind": f"/{PREFIX}_customers({customer_ids['XYZ コンサル']})",
            "jwo_systemlookup@odata.bind": f"/{PREFIX}_systems({system_ids['在庫管理システム']})",
            "jwo_workdescription": "在庫管理システム — 新規機能テスト",
            "jwo_worktypelookup@odata.bind": f"/{PREFIX}_worktypes({worktype_ids['テスト']})",
            "jwo_worktime": 3.0,
        },
    ]
    for report in workreports:
        resp = api_post(f"{PREFIX}_workreports", report)
        report_id = resp.headers["OData-EntityId"].split("(")[1].rstrip(")")
        print(f"    {report['jwo_workdescription']}: {report_id}")
    
    # 作業予定（明日）
    print("  作業予定投入")
    tomorrow = today + timedelta(days=1)
    workplans = [
        {
            "jwo_plandate": tomorrow.isoformat(),
            "jwo_customerlookup@odata.bind": f"/{PREFIX}_customers({customer_ids['ABC システムズ']})",
            "jwo_systemlookup@odata.bind": f"/{PREFIX}_systems({system_ids['会計システム']})",
            "jwo_workdescription": "会計システムの画面テスト",
        },
        {
            "jwo_plandate": tomorrow.isoformat(),
            "jwo_customerlookup@odata.bind": f"/{PREFIX}_customers({customer_ids['DEF 製造']})",
            "jwo_systemlookup@odata.bind": f"/{PREFIX}_systems({system_ids['生産管理システム']})",
            "jwo_workdescription": "生産管理システムの仕様検討",
        },
    ]
    for plan in workplans:
        resp = api_post(f"{PREFIX}_workplans", plan)
        plan_id = resp.headers["OData-EntityId"].split("(")[1].rstrip(")")
        print(f"    {plan['jwo_workdescription']}: {plan_id}")

# ── ソリューション含有検証・補完 ────────────────────────

def validate_solution_components():
    """すべてのテーブル・列がソリューション内にあることを検証・補完"""
    print(f"\n[Phase 1-4] ソリューション含有検証・補完")
    
    sol_result = api_get("solutions", {"$filter": f"uniquename eq '{SOLUTION_NAME}'"})
    if not sol_result["value"]:
        print(f"  ソリューションが見つかりません")
        return
    
    solution_id = sol_result["value"][0]["solutionid"]
    
    # テーブルメタデータ ID を取得
    for table_name, config in TABLE_DEFINITIONS.items():
        entity_result = api_get("EntityDefinitions", {
            "$filter": f"LogicalName eq '{config['logical_name']}'",
            "$select": "MetadataId"
        })
        if not entity_result["value"]:
            print(f"  {config['display_name']}: テーブルが見つかりません")
            continue
        
        entity_id = entity_result["value"][0]["MetadataId"]
        
        # ソリューション内にあるか確認
        comp_result = api_get(
            f"solutions({solution_id})/Microsoft.Dynamics.CRM.GetSolutionComponent",
            {"$filter": f"ObjectId eq {entity_id} and ComponentType eq 1"}
        )
        
        if comp_result["value"]:
            print(f"  ✓ {config['display_name']}: ソリューション内に含まれている")
        else:
            print(f"  + {config['display_name']}: ソリューションに追加中...")
            
            body = {
                "ComponentType": 1,  # Entity
                "ObjectId": entity_id,
                "AddRequiredComponents": False,
                "IncludedComponentSettingsValues": None,
            }
            api_post(f"solutions({solution_id})/Microsoft.Dynamics.CRM.AddSolutionComponent", body)
            print(f"    ✓ ソリューションに追加完了")

# ── Main ─────────────────────────────────────────────

def main():
    print("=" * 70)
    print(f"Daily Work Report — Dataverse テーブル構築")
    print(f"Solution: {SOLUTION_NAME} | Prefix: {PREFIX}")
    print("=" * 70)
    
    try:
        # Phase 1-0: ソリューション作成
        ensure_solution()
        
        # Phase 1-1: テーブル作成（マスタ → 主 → 従属の順）
        print("\n[Phase 1-1] テーブル作成")
        # マスタ
        create_table("jwo_customer", TABLE_DEFINITIONS["jwo_customer"])
        create_table("jwo_system", TABLE_DEFINITIONS["jwo_system"])
        create_table("jwo_worktype", TABLE_DEFINITIONS["jwo_worktype"])
        # 主
        create_table("jwo_workreport", TABLE_DEFINITIONS["jwo_workreport"])
        # 従属
        create_table("jwo_workplan", TABLE_DEFINITIONS["jwo_workplan"])
        
        time.sleep(5)  # メタデータ同期待機
        
        # Phase 1-2: Lookup / リレーション作成
        print("\n[Phase 1-2] Lookup リレーション作成")
        create_lookup(f"{PREFIX}_system", f"{PREFIX}_customer", f"{PREFIX}_system_customer_lookup", "所有顧客")
        create_lookup(f"{PREFIX}_workreport", f"{PREFIX}_customer", f"{PREFIX}_workreport_customer_lookup", "顧客")
        create_lookup(f"{PREFIX}_workreport", f"{PREFIX}_system", f"{PREFIX}_workreport_system_lookup", "システム")
        create_lookup(f"{PREFIX}_workreport", f"{PREFIX}_worktype", f"{PREFIX}_workreport_worktype_lookup", "作業区分")
        create_lookup(f"{PREFIX}_workplan", f"{PREFIX}_customer", f"{PREFIX}_workplan_customer_lookup", "顧客")
        create_lookup(f"{PREFIX}_workplan", f"{PREFIX}_system", f"{PREFIX}_workplan_system_lookup", "システム")
        
        time.sleep(5)  # メタデータ同期待機
        
        # Phase 1-3: ローカライズ
        print("\n[Phase 1-3] ローカライズ（日本語）")
        localize_table(f"{PREFIX}_customer", "顧客")
        localize_table(f"{PREFIX}_system", "システム")
        localize_table(f"{PREFIX}_worktype", "作業区分")
        localize_table(f"{PREFIX}_workreport", "作業報告")
        localize_table(f"{PREFIX}_workplan", "作業予定")
        
        # Phase 1-4: デモデータ投入
        time.sleep(5)
        seed_demo_data()
        
        # Phase 1-5: ソリューション含有検証・補完
        time.sleep(5)
        validate_solution_components()
        
        print("\n" + "=" * 70)
        print("✓ Dataverse テーブル構築完了")
        print("=" * 70)
        
    except Exception as e:
        print(f"\n✗ エラー: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
