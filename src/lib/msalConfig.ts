import type { Configuration } from "@azure/msal-browser";
import { LogLevel } from "@azure/msal-browser";

export const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_MSAL_CLIENT_ID ?? "",
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_MSAL_TENANT_ID ?? ""}`,
    // BASE_URL は vite.config.ts の base に連動（GitHub Pages: /manmarudairyreport/, サーバ: /）
    redirectUri: window.location.origin + import.meta.env.BASE_URL,
  },
  cache: {
    cacheLocation: "localStorage",
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
    },
  },
};

export const graphScopes = [
  "Sites.ReadWrite.All",
  "Sites.Manage.All",
  "User.Read",
];

// Teams チャネルへのメッセージ投稿用スコープ（発報ボタン）
export const teamsScopes = [
  ...graphScopes,
  "ChannelMessage.Send",
];
