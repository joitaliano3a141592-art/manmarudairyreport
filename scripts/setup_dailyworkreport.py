"""
DailyWorkReport — 日次作業報告管理システム Dataverse セットアップスクリプト

Phase 1: テーブル作成（マスタ → 主 → 従属）→ Lookup → ローカライズ → デモデータ

使い方:
  1. .env ファイルに DATAVERSE_URL, TENANT_ID, SOLUTION_NAME, PUBLISHER_PREFIX を設定
  2. pip install azure-identity requests python-dotenv
  3. python scripts/setup_dailyworkreport.py

【テーブル構成】
  マスタ:
    - jwo_customer（顧客マスタ）
    - jwo_worktype（作業区分マスタ）
    - jwo_system（システムマスタ → jwo_customer への Lookup）
  主テーブル:
    - jwo_workreport（本日の作業報告 → customer, system, worktype への Lookup）
    - jwo_workplan（翌日の作業予定 → customer, system への Lookup）
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
PREFIX = os.environ.get("PUBLISHER_PREFIX", "jwo")
SOLUTION_DISPLAY_NAME = os.environ.get("SOLUTION_DISPLAY_NAME", "日次作業報告")

# ── 認証 ──────────────────────────────────────────────────

def get_headers() -> dict:
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
            if "already exists" in err_lower or "same name already exists" in err_lower \
               or "0x80044363" in err or "0x80048403" in err or "not unique" in err_lower:
                print(f"  {description}: already exists — skipping")
                return None
            if "0x80040237" in err or "0x80040216" in err or ("another" in err_lower and "running" in err_lower):
                wait = 10 * (attempt + 1)
                print(f"  {description}: lock contention / metadata sync, waiting {wait}s …")
                time.sleep(wait)
                continue
            raise
    raise RuntimeError(f"{description}: max retries exceeded")

# ── ラベルヘルパー ────────────────────────────────────────

def label_jp(text):
    return {"LocalizedLabels": [{"Label": text, "LanguageCode": 1041}]}

# ── Phase 1.1: ソリューション確認 ─────────────────────────

def _save_env_value(key: str, value: str):
    """既存の .env ファイルにキーを追記または更新する"""
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    lines = []
    found = False
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    for i, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[i] = f"{key}={value}\n"
            found = True
            break
    if not found:
        lines.append(f"{key}={value}\n")
    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(lines)


def ensure_solution():
    global SOLUTION_DISPLAY_NAME
    print("\n=== Phase 1.1: ソリューション確認 ===")
    existing = api_get("solutions",
                       {"$filter": f"uniquename eq '{SOLUTION_NAME}'",
                        "$select": "solutionid,friendlyname"})
    if existing["value"]:
        display_name = existing["value"][0].get("friendlyname", SOLUTION_DISPLAY_NAME)
        print(f"  ソリューション '{SOLUTION_NAME}' は既存（表示名: {display_name}）。スキップ。")
        SOLUTION_DISPLAY_NAME = display_name
        _save_env_value("SOLUTION_DISPLAY_NAME", display_name)
        print(f"  .env に SOLUTION_DISPLAY_NAME={display_name} を保存")
        return
    print(f"  ソリューション '{SOLUTION_NAME}' を作成します…")
    pubs = api_get("publishers",
                   {"$filter": f"customizationprefix eq '{PREFIX}'", "$select": "publisherid"})
    if not pubs["value"]:
        raise RuntimeError(f"パブリッシャー prefix='{PREFIX}' が見つかりません。Power Apps で作成してください。")
    pub_id = pubs["value"][0]["publisherid"]
    api_post("solutions", {
        "uniquename": SOLUTION_NAME,
        "friendlyname": SOLUTION_DISPLAY_NAME,
        "version": "1.0.0.0",
        "publisherid@odata.bind": f"/publishers({pub_id})",
    })
    _save_env_value("SOLUTION_DISPLAY_NAME", SOLUTION_DISPLAY_NAME)
    print(f"  ソリューション作成完了（表示名: {SOLUTION_DISPLAY_NAME}）")
    print(f"  .env に SOLUTION_DISPLAY_NAME={SOLUTION_DISPLAY_NAME} を保存")

# ── Phase 1.2: テーブル作成 ───────────────────────────────

TABLES = [
    # マスタ系
    {
        "logical": f"{PREFIX}_customer",
        "display": "Customer",
        "plural": "Customers",
        "description": "顧客マスタ",
        "columns": [
            {
                "logical": f"{PREFIX}_department",
                "type": "String",
                "display": "Department",
                "maxLength": 100,
            },
            {
                "logical": f"{PREFIX}_email",
                "type": "String",
                "display": "Email",
                "maxLength": 100,
            },
        ],
    },
    {
        "logical": f"{PREFIX}_worktype",
        "display": "Work Type",
        "plural": "Work Types",
        "description": "作業区分マスタ",
        "columns": [
            {
                "logical": f"{PREFIX}_worktype_description",
                "type": "Memo",
                "display": "Description",
                "maxLength": 500,
            },
        ],
    },
    {
        "logical": f"{PREFIX}_system",
        "display": "System",
        "plural": "Systems",
        "description": "システムマスタ",
        "columns": [
            {
                "logical": f"{PREFIX}_description",
                "type": "Memo",
                "display": "Description",
                "maxLength": 1000,
            },
        ],
    },
    # 主テーブル
    {
        "logical": f"{PREFIX}_workreport",
        "display": "Work Report",
        "plural": "Work Reports",
        "description": "本日の作業報告",
        "columns": [
            {
                "logical": f"{PREFIX}_reportdate",
                "type": "DateOnly",
                "display": "Report Date",
            },
            {
                "logical": f"{PREFIX}_workdescription",
                "type": "Memo",
                "display": "Work Description",
                "maxLength": 2000,
            },
            {
                "logical": f"{PREFIX}_worktime",
                "type": "Decimal",
                "display": "Work Time",
                "precision": 1,
            },
        ],
    },
    {
        "logical": f"{PREFIX}_workplan",
        "display": "Work Plan",
        "plural": "Work Plans",
        "description": "翌日の作業予定",
        "columns": [
            {
                "logical": f"{PREFIX}_plandate",
                "type": "DateOnly",
                "display": "Plan Date",
            },
            {
                "logical": f"{PREFIX}_workdescription",
                "type": "Memo",
                "display": "Work Description",
                "maxLength": 2000,
            },
        ],
    },
]


def build_column_body(col):
    """列定義の JSON ボディを構築"""
    base = {
        "SchemaName": col["logical"],
        "DisplayName": label_jp(col["display"]),
        "RequiredLevel": {"Value": "None"},
    }
    if col["type"] == "Memo":
        base["@odata.type"] = "#Microsoft.Dynamics.CRM.MemoAttributeMetadata"
        base["Format"] = "Text"
        base["MaxLength"] = col.get("maxLength", 2000)
    elif col["type"] == "String":
        base["@odata.type"] = "#Microsoft.Dynamics.CRM.StringAttributeMetadata"
        base["FormatName"] = {"Value": "Text"}
        base["MaxLength"] = col.get("maxLength", 200)
    elif col["type"] == "DateOnly":
        base["@odata.type"] = "#Microsoft.Dynamics.CRM.DateTimeAttributeMetadata"
        base["Format"] = "DateOnly"
    elif col["type"] == "Decimal":
        base["@odata.type"] = "#Microsoft.Dynamics.CRM.DecimalAttributeMetadata"
        base["Precision"] = col.get("precision", 1)
        base["MinValue"] = 0.0
        base["MaxValue"] = 100.0
    elif col["type"] == "Integer":
        base["@odata.type"] = "#Microsoft.Dynamics.CRM.IntegerAttributeMetadata"
        base["MinValue"] = 0
        base["MaxValue"] = 100000
    return base


def create_tables():
    print("\n=== Phase 1.2: テーブル作成 ===")
    for tbl in TABLES:
        def _create(t=tbl):
            body = {
                "@odata.type": "#Microsoft.Dynamics.CRM.EntityMetadata",
                "SchemaName": t["logical"],
                "DisplayName": label_jp(t["display"]),
                "DisplayCollectionName": label_jp(t["plural"]),
                "Description": label_jp(t["description"]),
                "OwnershipType": "UserOwned",
                "IsActivity": False,
                "HasActivities": False,
                "HasNotes": False,
                "HasFeedback": False,
                "PrimaryNameAttribute": f"{PREFIX}_name",
                "Attributes": [
                    {
                        "@odata.type": "#Microsoft.Dynamics.CRM.StringAttributeMetadata",
                        "SchemaName": f"{PREFIX}_name",
                        "DisplayName": label_jp("Name"),
                        "IsPrimaryName": True,
                        "RequiredLevel": {"Value": "ApplicationRequired"},
                        "FormatName": {"Value": "Text"},
                        "MaxLength": 200,
                    }
                ],
            }
            api_post("EntityDefinitions", body)
            print(f"  テーブル '{t['logical']}' 作成完了")

        retry_metadata(_create, f"テーブル {tbl['logical']}")
        time.sleep(10)  # メタデータ反映に十分な待機

        # カスタム列追加
        for col in tbl.get("columns", []):
            def _add_col(c=col, t=tbl):
                api_post(f"EntityDefinitions(LogicalName='{t['logical']}')/Attributes",
                         build_column_body(c))
                print(f"    列 '{c['logical']}' 追加完了")

            retry_metadata(_add_col, f"列 {col['logical']}")
            time.sleep(5)

# ── Phase 1.3: Lookup リレーションシップ ─────────────────

LOOKUPS = [
    # jwo_system → jwo_customer
    {
        "schema": f"{PREFIX}_system_{PREFIX}_customer",
        "referencing": f"{PREFIX}_system",
        "referenced": f"{PREFIX}_customer",
        "lookup_attr": f"{PREFIX}_customer_lookup",
        "lookup_display": "Customer",
    },
    # jwo_workreport → jwo_customer
    {
        "schema": f"{PREFIX}_workreport_{PREFIX}_customer",
        "referencing": f"{PREFIX}_workreport",
        "referenced": f"{PREFIX}_customer",
        "lookup_attr": f"{PREFIX}_customerlookup",
        "lookup_display": "Customer",
    },
    # jwo_workreport → jwo_system
    {
        "schema": f"{PREFIX}_workreport_{PREFIX}_system",
        "referencing": f"{PREFIX}_workreport",
        "referenced": f"{PREFIX}_system",
        "lookup_attr": f"{PREFIX}_systemlookup",
        "lookup_display": "System",
    },
    # jwo_workreport → jwo_worktype
    {
        "schema": f"{PREFIX}_workreport_{PREFIX}_worktype",
        "referencing": f"{PREFIX}_workreport",
        "referenced": f"{PREFIX}_worktype",
        "lookup_attr": f"{PREFIX}_worktypelookup",
        "lookup_display": "Work Type",
    },
    # jwo_workplan → jwo_customer
    {
        "schema": f"{PREFIX}_workplan_{PREFIX}_customer",
        "referencing": f"{PREFIX}_workplan",
        "referenced": f"{PREFIX}_customer",
        "lookup_attr": f"{PREFIX}_customerlookup",
        "lookup_display": "Customer",
    },
    # jwo_workplan → jwo_system
    {
        "schema": f"{PREFIX}_workplan_{PREFIX}_system",
        "referencing": f"{PREFIX}_workplan",
        "referenced": f"{PREFIX}_system",
        "lookup_attr": f"{PREFIX}_systemlookup",
        "lookup_display": "System",
    },
]


def create_lookups():
    print("\n=== Phase 1.3: Lookup リレーションシップ作成 ===")
    for lk in LOOKUPS:
        def _create(l=lk):
            body = {
                "@odata.type": "#Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
                "SchemaName": l["schema"],
                "ReferencedEntity": l["referenced"],
                "ReferencingEntity": l["referencing"],
                "Lookup": {
                    "SchemaName": l["lookup_attr"],
                    "DisplayName": label_jp(l["lookup_display"]),
                    "RequiredLevel": {"Value": "None"},
                },
            }
            api_post("RelationshipDefinitions", body)
            print(f"  Lookup '{l['schema']}' 作成完了")

        retry_metadata(_create, f"Lookup {lk['schema']}")
        time.sleep(5)

# ── Phase 1.4: 日本語ローカライズ ─────────────────────────

LOCALIZE_TABLES = [
    (f"{PREFIX}_customer", "顧客", "顧客"),
    (f"{PREFIX}_worktype", "作業区分", "作業区分"),
    (f"{PREFIX}_system", "システム", "システム"),
    (f"{PREFIX}_workreport", "作業報告", "作業報告"),
    (f"{PREFIX}_workplan", "作業予定", "作業予定"),
]

LOCALIZE_COLUMNS = [
    # 顧客
    (f"{PREFIX}_customer", f"{PREFIX}_name", "顧客名"),
    (f"{PREFIX}_customer", f"{PREFIX}_department", "部門"),
    (f"{PREFIX}_customer", f"{PREFIX}_email", "メールアドレス"),
    # 作業区分
    (f"{PREFIX}_worktype", f"{PREFIX}_name", "区分名"),
    (f"{PREFIX}_worktype", f"{PREFIX}_worktype_description", "説明"),
    # システム
    (f"{PREFIX}_system", f"{PREFIX}_name", "システム名"),
    (f"{PREFIX}_system", f"{PREFIX}_customer_lookup", "所有顧客"),
    (f"{PREFIX}_system", f"{PREFIX}_description", "説明"),
    # 作業報告
    (f"{PREFIX}_workreport", f"{PREFIX}_name", "報告ID"),
    (f"{PREFIX}_workreport", f"{PREFIX}_reportdate", "報告日"),
    (f"{PREFIX}_workreport", f"{PREFIX}_customerlookup", "顧客"),
    (f"{PREFIX}_workreport", f"{PREFIX}_systemlookup", "システム"),
    (f"{PREFIX}_workreport", f"{PREFIX}_workdescription", "作業内容"),
    (f"{PREFIX}_workreport", f"{PREFIX}_worktypelookup", "作業区分"),
    (f"{PREFIX}_workreport", f"{PREFIX}_worktime", "作業時間"),
    # 作業予定
    (f"{PREFIX}_workplan", f"{PREFIX}_name", "予定ID"),
    (f"{PREFIX}_workplan", f"{PREFIX}_plandate", "予定日"),
    (f"{PREFIX}_workplan", f"{PREFIX}_customerlookup", "顧客"),
    (f"{PREFIX}_workplan", f"{PREFIX}_systemlookup", "システム"),
    (f"{PREFIX}_workplan", f"{PREFIX}_workdescription", "作業内容"),
]


def localize_tables():
    print("\n=== Phase 1.4: 日本語ローカライズ ===")

    # テーブル表示名
    for logical, disp, plural in LOCALIZE_TABLES:
        data = api_get(
            f"EntityDefinitions(LogicalName='{logical}')?$select=MetadataId,DisplayName,DisplayCollectionName")
        mid = data["MetadataId"]
        body = {
            "@odata.type": "#Microsoft.Dynamics.CRM.EntityMetadata",
            "MetadataId": mid,
            "DisplayName": label_jp(disp),
            "DisplayCollectionName": label_jp(plural),
        }
        api_put(f"EntityDefinitions({mid})", body)
        print(f"  テーブル '{logical}' → '{disp}'")

    # 列表示名
    for table, col, disp in LOCALIZE_COLUMNS:
        data = api_get(
            f"EntityDefinitions(LogicalName='{table}')/Attributes(LogicalName='{col}')"
            f"?$select=MetadataId,AttributeType")
        mid = data["MetadataId"]
        attr_type = data.get("AttributeType", "")
        odata_type_map = {
            "String": "#Microsoft.Dynamics.CRM.StringAttributeMetadata",
            "Memo": "#Microsoft.Dynamics.CRM.MemoAttributeMetadata",
            "Picklist": "#Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
            "DateTime": "#Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
            "DateTimePickerFormat": "#Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
            "Lookup": "#Microsoft.Dynamics.CRM.LookupAttributeMetadata",
            "Integer": "#Microsoft.Dynamics.CRM.IntegerAttributeMetadata",
            "Decimal": "#Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
        }
        odata_type = odata_type_map.get(attr_type, "#Microsoft.Dynamics.CRM.AttributeMetadata")
        body = {
            "@odata.type": odata_type,
            "MetadataId": mid,
            "DisplayName": label_jp(disp),
        }
        api_put(f"EntityDefinitions(LogicalName='{table}')/Attributes({mid})",
                body)
        print(f"  列 '{table}.{col}' → '{disp}'")


# ── Phase 1.5: デモデータ投入 ─────────────────────────────

def insert_demo_data():
    print("\n=== Phase 1.5: デモデータ投入 ===")

    # 顧客3件作成
    customers = [
        {"name": "ABC 株式会社", "dept": "営業部", "email": "sales@abc.com"},
        {"name": "XYZ 工業", "dept": "製造部", "email": "contact@xyz.jp"},
        {"name": "テックス合同会社", "dept": "企画室", "email": "info@techx.co"},
    ]
    cust_ids = {}
    for c in customers:
        r = api_post(f"{PREFIX}_customers", {
            f"{PREFIX}_name": c["name"],
            f"{PREFIX}_department": c["dept"],
            f"{PREFIX}_email": c["email"],
        })
        cust_ids[c["name"]] = r.headers.get("OData-EntityId", "").split("(")[-1].rstrip(")")
        print(f"  顧客: {c['name']}")

    # 作業区分3件作成
    worktypes = [
        {"name": "開発", "desc": "新機能開発・プログラミング"},
        {"name": "保守", "desc": "既存システムの保守・修正"},
        {"name": "運用", "desc": "システム運用・監視・バックアップ"},
    ]
    worktype_ids = {}
    for wt in worktypes:
        r = api_post(f"{PREFIX}_worktypes", {
            f"{PREFIX}_name": wt["name"],
            f"{PREFIX}_worktype_description": wt["desc"],
        })
        worktype_ids[wt["name"]] = r.headers.get("OData-EntityId", "").split("(")[-1].rstrip(")")
        print(f"  作業区分: {wt['name']}")

    # システム3件作成
    systems = [
        {"name": "基幹業務システム", "cust": "ABC 株式会社", "desc": "売上・在庫・会計管理"},
        {"name": "顧客管理CRM", "cust": "XYZ 工業", "desc": "営業支援・顧客管理"},
        {"name": "製造管理ERP", "cust": "テックス合同会社", "desc": "生産計画・品質管理"},
    ]
    system_ids = {}
    for s in systems:
        body = {
            f"{PREFIX}_name": s["name"],
            f"{PREFIX}_description": s["desc"],
        }
        cust = s.get("cust")
        if cust and cust_ids.get(cust):
            body[f"{PREFIX}_customer_lookup@odata.bind"] = \
                f"/{PREFIX}_customers({cust_ids[cust]})"

        r = api_post(f"{PREFIX}_systems", body)
        system_ids[s["name"]] = r.headers.get("OData-EntityId", "").split("(")[-1].rstrip(")")
        print(f"  システム: {s['name']}")

    # 作業報告5件作成
    today = datetime.now().date()
    workreports = [
        {
            "date": today,
            "cust": "ABC 株式会社",
            "sys": "基幹業務システム",
            "desc": "売上入力フォームのUI検証と微調整。顧客要望の配色確認済み。",
            "type": "開発",
            "hours": 6.5,
        },
        {
            "date": today,
            "cust": "XYZ 工業",
            "sys": "顧客管理CRM",
            "desc": "顧客リスト画面のパフォーマンス改善。クエリ最適化により応答時間30%削減。",
            "type": "保守",
            "hours": 4.0,
        },
        {
            "date": today - timedelta(days=1),
            "cust": "テックス合同会社",
            "sys": "製造管理ERP",
            "desc": "システム定期メンテナンス実施。セキュリティパッチ適用、バックアップ完了。",
            "type": "運用",
            "hours": 3.0,
        },
        {
            "date": today - timedelta(days=1),
            "cust": "ABC 株式会社",
            "sys": "基幹業務システム",
            "desc": "バグ報告 #2341 対応。決算月末処理でエラー発生の原因特定・修正完了。",
            "type": "保守",
            "hours": 2.5,
        },
        {
            "date": today - timedelta(days=2),
            "cust": "XYZ 工業",
            "sys": "顧客管理CRM",
            "desc": "営業ダッシュボード新機能開発。売上予測グラフの実装。",
            "type": "開発",
            "hours": 7.0,
        },
    ]

    for wr in workreports:
        body = {
            f"{PREFIX}_name": f"RPT-{wr['date'].strftime('%Y%m%d')}-{wr['cust'][:3]}",
            f"{PREFIX}_reportdate": wr["date"].isoformat(),
            f"{PREFIX}_workdescription": wr["desc"],
            f"{PREFIX}_worktime": wr["hours"],
        }
        cust = wr.get("cust")
        if cust and cust_ids.get(cust):
            body[f"{PREFIX}_customerlookup@odata.bind"] = \
                f"/{PREFIX}_customers({cust_ids[cust]})"

        sys = wr.get("sys")
        if sys and system_ids.get(sys):
            body[f"{PREFIX}_systemlookup@odata.bind"] = \
                f"/{PREFIX}_systems({system_ids[sys]})"

        wt = wr.get("type")
        if wt and worktype_ids.get(wt):
            body[f"{PREFIX}_worktypelookup@odata.bind"] = \
                f"/{PREFIX}_worktypes({worktype_ids[wt]})"

        api_post(f"{PREFIX}_workreports", body)
        print(f"  作業報告: {body[f'{PREFIX}_name']}")

    # 作業予定3件作成
    tomorrow = today + timedelta(days=1)
    workplans = [
        {
            "date": tomorrow,
            "cust": "ABC 株式会社",
            "sys": "基幹業務システム",
            "desc": "売上入力フォーム本番環境へのデプロイ予定。11:00-12:00 UAT実施。",
        },
        {
            "date": tomorrow,
            "cust": "XYZ 工業",
            "sys": "顧客管理CRM",
            "desc": "営業ダッシュボード新機能の UAT レビュー。キック-オフ会議 14:00。",
        },
        {
            "date": tomorrow + timedelta(days=1),
            "cust": "テックス合同会社",
            "sys": "製造管理ERP",
            "desc": "定期メンテナンス計画立案会議。次期スケジュール調整。",
        },
    ]

    for wp in workplans:
        body = {
            f"{PREFIX}_name": f"PLN-{wp['date'].strftime('%Y%m%d')}-{wp['cust'][:3]}",
            f"{PREFIX}_plandate": wp["date"].isoformat(),
            f"{PREFIX}_workdescription": wp["desc"],
        }
        cust = wp.get("cust")
        if cust and cust_ids.get(cust):
            body[f"{PREFIX}_customerlookup@odata.bind"] = \
                f"/{PREFIX}_customers({cust_ids[cust]})"

        sys = wp.get("sys")
        if sys and system_ids.get(sys):
            body[f"{PREFIX}_systemlookup@odata.bind"] = \
                f"/{PREFIX}_systems({system_ids[sys]})"

        api_post(f"{PREFIX}_workplans", body)
        print(f"  作業予定: {body[f'{PREFIX}_name']}")

    print("  デモデータ投入完了")

# ── Phase 1.6: ソリューション含有検証 + 追加 ─────────────

def ensure_solution_membership():
    """全テーブルがソリューションに含まれているか確認し、不足分を AddSolutionComponent で追加"""
    print("\n=== Phase 1.6: ソリューション含有検証 ===")

    sols = api_get("solutions", {"$filter": f"uniquename eq '{SOLUTION_NAME}'", "$select": "solutionid"})
    if not sols["value"]:
        print(f"  ❌ ソリューション '{SOLUTION_NAME}' が見つかりません")
        return
    sol_id = sols["value"][0]["solutionid"]

    comps = api_get("solutioncomponents",
                    {"$filter": f"_solutionid_value eq {sol_id} and componenttype eq 1",
                     "$select": "objectid"})
    existing_ids = {c["objectid"] for c in comps.get("value", [])}

    for tbl in TABLES:
        logical = tbl["logical"]
        try:
            meta = api_get(f"EntityDefinitions(LogicalName='{logical}')",
                           {"$select": "MetadataId"})
            meta_id = meta["MetadataId"]
            if meta_id in existing_ids:
                print(f"  ✅ {logical}: ソリューション内に存在")
            else:
                print(f"  ➕ {logical}: ソリューションに追加中…")
                api_post("AddSolutionComponent", {
                    "ComponentId": meta_id,
                    "ComponentType": 1,
                    "SolutionUniqueName": SOLUTION_NAME,
                    "AddRequiredComponents": False,
                    "DoNotIncludeSubcomponents": False,
                })
                print(f"  ✅ {logical}: 追加完了")
        except Exception as e:
            print(f"  ❌ {logical}: {e}")

# ── Phase 1.7: テーブル検証 ───────────────────────────────

def verify_tables():
    print("\n=== Phase 1.7: テーブル検証 ===")
    table_sets = {
        f"{PREFIX}_customer": f"{PREFIX}_customers",
        f"{PREFIX}_worktype": f"{PREFIX}_worktypes",
        f"{PREFIX}_system": f"{PREFIX}_systems",
        f"{PREFIX}_workreport": f"{PREFIX}_workreports",
        f"{PREFIX}_workplan": f"{PREFIX}_workplans",
    }
    for logical, plural in table_sets.items():
        try:
            data = api_get(f"{plural}?$top=1&$select={PREFIX}_name")
            count = len(data.get("value", []))
            print(f"  ✅ {logical}: OK (rows={count})")
        except Exception as e:
            print(f"  ❌ {logical}: FAILED — {e}")

# ── カスタマイズ公開 ──────────────────────────────────────

def publish_all():
    print("\n=== カスタマイズ公開 ===")
    api_post("PublishAllXml", {})
    print("  公開完了")

# ── メイン ────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  DailyWorkReport — 日次作業報告管理")
    print("  Dataverse セットアップ")
    print("=" * 60)
    print(f"  環境: {DATAVERSE_URL}")
    print(f"  ソリューション: {SOLUTION_NAME}")
    print(f"  プレフィックス: {PREFIX}")

    ensure_solution()
    create_tables()
    publish_all()
    create_lookups()
    publish_all()
    localize_tables()
    publish_all()
    insert_demo_data()
    ensure_solution_membership()
    verify_tables()

    print("\n✅ Dataverse セットアップ完了!")
    print("次のステップ: Code Apps のデプロイ → npx power-apps add-data-source")


if __name__ == "__main__":
    main()
