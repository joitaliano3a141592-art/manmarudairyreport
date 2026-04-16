/**
 * SharePoint Graph API クライアント
 *
 * 開発時: Vite proxy (/api/graph/*) 経由
 * 本番時: MSAL.js でトークン取得 → Graph API 直接呼び出し
 */
import { SP_SITE_ID } from "./sharepointConfig";
import { markTeamsSessionReady } from "./teamsAuthSession";

const isDev = import.meta.env.DEV;
const API_PREFIX = isDev ? "/api/graph" : "https://graph.microsoft.com/v1.0";

// --------------- 汎用 fetch ---------------

async function getAuthHeaders(useTeamsScope = false): Promise<Record<string, string>> {
  if (isDev) return {};
  if (useTeamsScope) {
    const { acquireTeamsToken } = await import("@/providers/msal-provider");
    const token = await acquireTeamsToken();
    return { Authorization: `Bearer ${token}` };
  }
  const { acquireGraphToken } = await import("@/providers/msal-provider");
  const token = await acquireGraphToken();
  return { Authorization: `Bearer ${token}` };
}

async function graphFetch(path: string, init?: RequestInit, useTeamsScope = false): Promise<Response> {
  const url = `${API_PREFIX}${path}`;
  const authHeaders = await getAuthHeaders(useTeamsScope);
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Graph API ${res.status}: ${text.slice(0, 300)}`);
  }
  markTeamsSessionReady();
  return res;
}

async function graphGet<T = unknown>(path: string): Promise<T> {
  const res = await graphFetch(path);
  return res.json() as Promise<T>;
}

async function graphPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await graphFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

async function graphPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await graphFetch(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

async function graphDelete(path: string): Promise<void> {
  await graphFetch(path, { method: "DELETE" });
}

// --------------- List helpers ---------------

type GraphListItems<F> = {
  value: Array<{ id: string; fields: F; createdBy?: { user?: { displayName?: string; email?: string } } }>;
  "@odata.nextLink"?: string;
};

function encodeGraphPathSegment(value: string): string {
  return encodeURIComponent(value);
}

function listItemsPath(listId: string, query = ""): string {
  return `/sites/${encodeGraphPathSegment(SP_SITE_ID)}/lists/${encodeGraphPathSegment(listId)}/items?$expand=fields${query ? `&${query}` : ""}`;
}

function listItemPath(listId: string, itemId: string): string {
  return `/sites/${encodeGraphPathSegment(SP_SITE_ID)}/lists/${encodeGraphPathSegment(listId)}/items/${encodeGraphPathSegment(itemId)}`;
}

type ListItem<F> = { id: string; fields: F; createdByName?: string };

export async function fetchListItems<F>(listId: string, query = ""): Promise<ListItem<F>[]> {
  const all: ListItem<F>[] = [];
  let url: string | undefined = listItemsPath(listId, query);

  while (url) {
    const data: GraphListItems<F> = await graphGet(url);
    for (const item of data.value) {
      all.push({
        id: item.id,
        fields: item.fields,
        createdByName: item.createdBy?.user?.displayName,
      });
    }
    const next: string | undefined = data["@odata.nextLink"];
    if (next) {
      url = next.replace("https://graph.microsoft.com/v1.0", "");
    } else {
      url = undefined;
    }
  }
  return all;
}

export async function createListItem<F>(listId: string, fields: Record<string, unknown>): Promise<{ id: string; fields: F }> {
  return graphPost(`/sites/${encodeGraphPathSegment(SP_SITE_ID)}/lists/${encodeGraphPathSegment(listId)}/items`, { fields });
}

export async function updateListItem(listId: string, itemId: string, fields: Record<string, unknown>): Promise<void> {
  await graphPatch(`${listItemPath(listId, itemId)}/fields`, fields);
}

export async function deleteListItem(listId: string, itemId: string): Promise<void> {
  await graphDelete(listItemPath(listId, itemId));
}

// --------------- Teams channel message ---------------

export async function postTeamsChannelMessage(
  teamId: string,
  channelId: string,
  htmlBody: string,
): Promise<void> {
  const path = `/teams/${teamId}/channels/${channelId}/messages`;
  const body = { body: { contentType: "html", content: htmlBody } };
  const res = await graphFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  }, true); // useTeamsScope=true → ChannelMessage.Send トークンを使用
  await res.json().catch(() => {});
}
