"""Graph API トークンを標準出力に出力する（Vite proxy 用）。

既存の認証キャッシュ (.graph_auth_record.json) を再利用し、
サイレントにトークンを取得する。キャッシュがなければ device code flow で認証。
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from azure.identity import (
    DeviceCodeCredential,
    AuthenticationRecord,
    TokenCachePersistenceOptions,
)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

TENANT_ID = os.getenv("TENANT_ID", "")
CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e"
SCOPE = "https://graph.microsoft.com/Sites.Manage.All"
AUTH_RECORD_PATH = _PROJECT_ROOT / ".graph_auth_record.json"

cache_opts = TokenCachePersistenceOptions(
    name="graph_token_cache_v4",
    allow_unencrypted_storage=True,
)

kwargs: dict = {
    "client_id": CLIENT_ID,
    "tenant_id": TENANT_ID or None,
    "cache_persistence_options": cache_opts,
}
kwargs = {k: v for k, v in kwargs.items() if v is not None}

if AUTH_RECORD_PATH.exists():
    rec = AuthenticationRecord.deserialize(
        AUTH_RECORD_PATH.read_text(encoding="utf-8")
    )
    kwargs["authentication_record"] = rec

cred = DeviceCodeCredential(**kwargs)

if not AUTH_RECORD_PATH.exists():
    record = cred.authenticate(scopes=[SCOPE])
    AUTH_RECORD_PATH.write_text(record.serialize(), encoding="utf-8")
    print("authenticated", file=sys.stderr)

token = cred.get_token(SCOPE)
print(token.token, end="")
