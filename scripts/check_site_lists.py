"""Check SharePoint site ID and list IDs for SP_SITE_ALIAS and new Teams group"""
import sys
import os
import json
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import importlib.util
spec = importlib.util.spec_from_file_location('auth_helper', 'scripts/auth_helper.py')
auth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auth)

token = auth.get_token('https://graph.microsoft.com/.default')
print('Token OK:', bool(token))

def graph_get(url, token):
    req = urllib.request.Request(
        url,
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json'}
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except Exception as e:
        return {'error': str(e)}

# 新 Teams グループ TEAMS_TEAM_ID_SHORT のSPサイトを確認
print('\n=== New Teams Group (TEAMS_TEAM_ID_SHORT) SharePoint Site ===')
group_site = graph_get(
    'https://graph.microsoft.com/v1.0/groups/VITE_TEAMS_TEAM_ID/sites/root?select=id,displayName,webUrl',
    token
)
if 'error' in group_site:
    print('Error:', group_site['error'])
else:
    print('Site ID:', group_site.get('id'))
    print('Site name:', group_site.get('displayName'))
    print('Site URL:', group_site.get('webUrl'))
    new_site_id = group_site.get('id')
    
    # リスト一覧取得
    lists_data = graph_get(
        'https://graph.microsoft.com/v1.0/sites/' + new_site_id + '/lists?select=id,displayName,name',
        token
    )
    print('\nLists in new group site:')
    for l in lists_data.get('value', []):
        print('  [%s] %s (%s)' % (l['id'], l['displayName'], l['name']))

# SP_SITE_ALIAS のサイト情報も確認
print('\n=== SP_SITE_ALIAS ===')
site = graph_get(
    'https://graph.microsoft.com/v1.0/sites/manmarusystem.sharepoint.com:/sites/SP_SITE_ALIAS?select=id,displayName,webUrl',
    token
)
if 'error' in site:
    print('Error:', site['error'])
else:
    print('Site ID:', site.get('id'))
    print('Site name:', site.get('displayName'))
    
    site_id = site['id']
    data = graph_get(
        'https://graph.microsoft.com/v1.0/sites/' + site_id + '/lists?select=id,displayName,name',
        token
    )
    print('\nLists in SP_SITE_ALIAS:')
    for l in data.get('value', []):
        print('  [%s] %s (%s)' % (l['id'], l['displayName'], l['name']))

# 現在の .env.production.local のSP設定と比較
print('\n=== Current .env.production.local SP settings ===')
env_path = '.env.production.local'
if os.path.exists(env_path):
    with open(env_path, encoding='utf-8') as f:
        for line in f:
            if line.startswith('VITE_SP_'):
                print(' ', line.strip())
